/**
 * Attached and external drivers (D6).
 *
 * attached — user-authored per-platform argv (`origin: "user"` only), spawned
 * WITHOUT a shell (`shell: false`, argv verbatim; on win32 name the `.exe`, no
 * `cmd.exe` wrapper is added). An instance already running when the dashboard
 * first looks is `startedBy: "external"` and is never stopped by idle. Stop
 * success is judged ONLY by the exact-executable matcher no longer matching
 * within `stopTimeout` — never by the stop command's rc (F:S3.2) and never by
 * the probe failing (a `blocked` instance already fails its probe).
 *
 * external — probe + endpoint + secrets, no lifecycle at all.
 * See change: add-service-registry-core.
 */
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { findProcessesByExecutable } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import type { ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { CommandRunner } from "./command-runner.js";
import type { AdoptResult, DriverInstance, PresenceResult, ServiceDriver, StartContext, StopOutcome } from "./driver.js";
import { startCommandSecretEnv } from "./secret-delivery.js";

type Platform = "darwin" | "linux" | "win32";

export interface AttachedDriverDeps {
  run: CommandRunner;
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  /** Exact-executable matcher. */
  findProcesses?: (name: string) => Promise<number[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

export class AttachedDriver implements ServiceDriver {
  readonly name = "attached" as const;

  constructor(private readonly deps: AttachedDriverDeps) {}

  private get platform(): Platform {
    return (this.deps.platform ?? process.platform) as Platform;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private sleep(ms: number) {
    return (this.deps.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  private matches(def: ServiceDefinition): Promise<number[]> {
    const name = def.process?.name;
    if (!name) return Promise.resolve([]);
    return (this.deps.findProcesses ?? ((n) => findProcessesByExecutable(n, { platform: this.platform })))(name);
  }

  private startArgv(def: ServiceDefinition): string[] | undefined {
    return def.lifecycle?.start?.[this.platform];
  }

  private stopArgv(def: ServiceDefinition): string[] | undefined {
    return def.lifecycle?.stop?.[this.platform];
  }

  async presence(): Promise<PresenceResult> {
    return { ok: true };
  }

  canStart(def: ServiceDefinition): boolean {
    return this.startArgv(def) !== undefined;
  }

  canStop(def: ServiceDefinition): boolean {
    return this.stopArgv(def) !== undefined && def.process !== undefined;
  }

  private instance(def: ServiceDefinition, startedBy: "dashboard" | "external", pid?: number): DriverInstance {
    return { driver: "attached", startedBy, endpoints: { ...(def.endpoints ?? {}) }, ...(pid ? { pid } : {}) };
  }

  async adopt(def: ServiceDefinition): Promise<AdoptResult> {
    if (!def.process) return { kind: "none" };
    return (await this.matches(def)).length > 0 ? { kind: "running", instance: this.instance(def, "external") } : { kind: "none" };
  }

  async start(def: ServiceDefinition, ctx: StartContext): Promise<DriverInstance> {
    if (def.process && (await this.matches(def)).length > 0) return this.instance(def, "external");
    const argv = this.startArgv(def);
    if (!argv) throw new Error(`no start command for ${this.platform}`);
    const child = (this.deps.spawn ?? spawn)(argv[0], argv.slice(1), {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, ...startCommandSecretEnv(def, ctx.secrets) },
    });
    child.on("error", () => {});
    child.unref();
    return this.instance(def, "dashboard", child.pid);
  }

  async isAlive(def: ServiceDefinition): Promise<boolean | "unknown"> {
    if (!def.process) return "unknown";
    return (await this.matches(def)).length > 0;
  }

  async stop(def: ServiceDefinition, _inst: DriverInstance | undefined, stopTimeoutMs: number): Promise<StopOutcome> {
    const argv = this.stopArgv(def);
    if (!argv || !def.process) return "stop-failed";
    const deadline = this.now() + stopTimeoutMs;
    // The rc is deliberately ignored: osascript `quit` returned 1 on a real quit.
    await this.deps.run(argv[0], argv.slice(1), { timeoutMs: stopTimeoutMs });
    for (;;) {
      if ((await this.matches(def)).length === 0) return "stopped";
      if (this.now() >= deadline) return "stop-failed";
      await this.sleep(this.deps.pollMs ?? 500);
    }
  }

  async remove(): Promise<void> {}
}

export class ExternalDriver implements ServiceDriver {
  readonly name = "external" as const;

  async presence(): Promise<PresenceResult> {
    return { ok: true };
  }

  canStart(): boolean {
    return false;
  }

  canStop(): boolean {
    return false;
  }

  async adopt(def: ServiceDefinition): Promise<AdoptResult> {
    return { kind: "running", instance: { driver: "external", startedBy: "external", endpoints: { ...(def.endpoints ?? {}) } } };
  }

  async start(): Promise<DriverInstance> {
    throw new Error("an external service has no lifecycle");
  }

  async isAlive(): Promise<"unknown"> {
    return "unknown";
  }

  async stop(): Promise<StopOutcome> {
    return "stopped";
  }

  async remove(): Promise<void> {}
}
