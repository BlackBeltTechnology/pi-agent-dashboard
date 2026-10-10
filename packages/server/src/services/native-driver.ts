/**
 * Native driver (D5): structured runner recipes (`uvx` / `npx`), never a shell.
 *
 * - Presence is OFFLINE: `uvx --offline --from <pkg> <bin> --help`, or the
 *   `prefetched.json` marker written after an explicit prefetch. Observed on
 *   uv 0.8.18: `--offline` fails fast (~1 s) with "not found in the cache".
 *   `npx --no` refuses a missing package but may still consult the registry to
 *   resolve it, so npx presence is the marker ALONE. `ensure` and `start` never
 *   fetch: `start` itself runs with the offline flag.
 * - Ports: a free loopback port per named port, re-allocated on every start.
 * - Spawn: `platform/exec.ts` `spawn`, detached (own process group on POSIX);
 *   pid, argv and ports recorded in `services-run/<id>/instance.json`.
 * - Stop: `killProcessGroup`, confirmed by no group member being alive.
 * - Adopt: pid alive AND its command line carries the package token AND the
 *   recorded port is held by it (or a member of its group). Anything less is
 *   `adoption-uncertain` — never a blind adopt, never a duplicate spawn.
 * See change: add-service-registry-core.
 */
import fs from "node:fs";
import { buildSafeArgv, spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  isProcessAlive,
  killProcessGroup,
  parseNetstatListeners,
  signalZero,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { readProcessCommandLine } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import type { NativeRecipe, ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { CommandRunner } from "./command-runner.js";
import type { AdoptResult, DriverInstance, PresenceResult, ServiceDriver, StartContext, StopOutcome } from "./driver.js";
import { readJsonFile, type ServicesPaths, writePrivateFile } from "./paths.js";
import { allocateLoopbackPort, loopbackEndpoint, type PortAllocator } from "./ports.js";
import { startCommandSecretEnv } from "./secret-delivery.js";

export interface NativeInstanceFile {
  pid: number;
  argv: string[];
  ports: Record<string, number>;
  package: string;
  defHash: string;
  startedAt: string;
}

export interface NativeDriverDeps {
  run: CommandRunner;
  resolveBinary: (name: string) => string | null;
  paths: ServicesPaths;
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
  allocatePort?: PortAllocator;
  killProcessGroup?: typeof killProcessGroup;
  /** Is the process (POSIX: its group) alive? */
  isAlive?: (pid: number) => boolean;
  readCommandLine?: (pid: number) => Promise<string | null>;
  /** PIDs listening on `port`; [] when undeterminable. */
  portHolders?: (port: number) => Promise<number[]>;
  /** Process-group id of `pid`, or null. */
  pgidOf?: (pid: number) => Promise<number | null>;
}

/** The executable a recipe runs: `bin`, else the package name sans scope/version. */
function recipeBin(r: NativeRecipe): string {
  if (r.bin) return r.bin;
  const at = r.package.lastIndexOf("@");
  const name = at > 0 ? r.package.slice(0, at) : r.package;
  return name.split("/").pop() ?? name;
}

/** Substitute `${port.<name>}` placeholders. */
function composeArgs(args: readonly string[], ports: Record<string, number>): string[] {
  return args.map((a) => a.replace(/\$\{port\.([A-Za-z][A-Za-z0-9_]*)\}/g, (_m, n: string) => String(ports[n])));
}

/** Runner argv (without the runner binary). `offline` = never fetch. */
function runnerArgs(r: NativeRecipe, rest: readonly string[], mode: "offline" | "prefetch"): string[] {
  const bin = recipeBin(r);
  if (r.runner === "uvx") {
    return mode === "offline" ? ["--offline", "--from", r.package, bin, ...rest] : ["--from", r.package, bin, ...rest];
  }
  return mode === "offline" ? ["--no", `--package=${r.package}`, "--", bin, ...rest] : ["--yes", `--package=${r.package}`, "--", bin, ...rest];
}

export class NativeDriver implements ServiceDriver {
  readonly name = "native" as const;

  constructor(private readonly deps: NativeDriverDeps) {}

  private get platform() {
    return this.deps.platform ?? process.platform;
  }

  private alive(pid: number): boolean {
    if (this.deps.isAlive) return this.deps.isAlive(pid);
    // POSIX: the GROUP (workers included); win32: the pid (taskkill /T reaches the tree).
    return this.platform === "win32" ? isProcessAlive(pid) : signalZero(-pid) !== "esrch";
  }

  private readInstance(id: string): NativeInstanceFile | null {
    return readJsonFile<NativeInstanceFile>(this.deps.paths.instanceFile(id));
  }

  private markerMatches(def: ServiceDefinition): boolean {
    const m = readJsonFile<{ package?: string }>(this.deps.paths.prefetchMarker(def.id));
    return m?.package === def.native?.package;
  }

  async presence(def: ServiceDefinition): Promise<PresenceResult> {
    const r = def.native!;
    const runner = this.deps.resolveBinary(r.runner);
    if (!runner) return { ok: false, reason: "runner-absent", hint: `${r.runner} is not installed` };
    if (r.runner === "uvx") {
      const { argv } = buildSafeArgv(runner, runnerArgs(r, ["--help"], "offline"), this.platform);
      const probe = await this.deps.run(argv[0], argv.slice(1), { timeoutMs: 30_000 });
      if (probe.code === 0) return { ok: true };
    }
    if (this.markerMatches(def)) return { ok: true };
    return {
      ok: false,
      reason: "package-absent",
      hint: `${r.package} is not in the ${r.runner} cache — fetch it explicitly: pi-dashboard service prefetch ${def.id}`,
    };
  }

  canStart(): boolean {
    return true;
  }

  canStop(): boolean {
    return true;
  }

  async start(def: ServiceDefinition, ctx: StartContext): Promise<DriverInstance> {
    const r = def.native!;
    const runner = this.deps.resolveBinary(r.runner);
    if (!runner) throw new Error(`${r.runner} is not installed`);
    const ports: Record<string, number> = {};
    for (const name of Object.keys(r.ports)) ports[name] = await (this.deps.allocatePort ?? allocateLoopbackPort)();
    const { argv, spawnOptions } = buildSafeArgv(runner, runnerArgs(r, composeArgs(r.args, ports), "offline"), this.platform);
    const child = (this.deps.spawn ?? spawn)(argv[0], argv.slice(1), {
      ...spawnOptions,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...(r.env ?? {}), ...startCommandSecretEnv(def, ctx.secrets) },
    });
    const spawnError = new Promise<Error>((resolve) => child.once("error", resolve));
    child.unref();
    if (!child.pid) throw await spawnError;
    const record: NativeInstanceFile = {
      pid: child.pid,
      argv, // never carries a secret: secrets go to env only
      ports,
      package: r.package,
      defHash: ctx.defHash,
      startedAt: new Date().toISOString(),
    };
    writePrivateFile(this.deps.paths.instanceFile(def.id), `${JSON.stringify(record, null, 2)}\n`);
    return this.instanceFromRecord(def, record);
  }

  private instanceFromRecord(def: ServiceDefinition, rec: NativeInstanceFile): DriverInstance {
    const endpoints: Record<string, string> = {};
    for (const [name, port] of Object.entries(rec.ports)) endpoints[name] = loopbackEndpoint(def.native?.ports[name]?.protocol, port);
    return { driver: "native", startedBy: "dashboard", pid: rec.pid, endpoints, defHash: rec.defHash };
  }

  async isAlive(_def: ServiceDefinition, inst: DriverInstance): Promise<boolean> {
    return inst.pid !== undefined && this.alive(inst.pid);
  }

  async stop(
    def: ServiceDefinition,
    inst: DriverInstance | undefined,
    stopTimeoutMs: number,
    opts: { force?: boolean } = {},
  ): Promise<StopOutcome> {
    const rec = inst?.pid === undefined ? this.readInstance(def.id) : null;
    const pid = inst?.pid ?? rec?.pid;
    if (pid === undefined) return "stopped";
    if (rec && !opts.force && this.alive(pid)) {
      // A pid known only from the record (no live instance) may have been
      // reused by an unrelated group: signal it only when its command line
      // still carries the recorded package; otherwise drop the record. An
      // explicit `stop --force` is the user's override.
      const cmd = await (this.deps.readCommandLine ?? ((p) => readProcessCommandLine(p, { platform: this.platform })))(pid);
      if (!cmd?.includes(rec.package)) {
        fs.rmSync(this.deps.paths.instanceFile(def.id), { force: true });
        return "stopped";
      }
    }
    if (this.alive(pid)) {
      await (this.deps.killProcessGroup ?? killProcessGroup)(pid, { timeoutMs: stopTimeoutMs, platform: this.platform });
    }
    if (this.alive(pid)) return "stop-failed";
    fs.rmSync(this.deps.paths.instanceFile(def.id), { force: true });
    return "stopped";
  }

  private async defaultPortHolders(port: number): Promise<number[]> {
    if (this.platform === "win32") {
      const r = await this.deps.run("netstat", ["-ano", "-p", "tcp"], { timeoutMs: 10_000 });
      return r.code === 0 ? parseNetstatListeners(r.stdout, port, process.pid) : [];
    }
    const lsof = this.deps.resolveBinary("lsof");
    if (!lsof) return [];
    const r = await this.deps.run(lsof, ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { timeoutMs: 10_000 });
    return r.stdout.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }

  private async defaultPgid(pid: number): Promise<number | null> {
    if (this.platform === "win32") return null;
    const r = await this.deps.run("ps", ["-o", "pgid=", "-p", String(pid)], { timeoutMs: 5_000 });
    const n = Number(r.stdout.trim());
    return r.code === 0 && Number.isInteger(n) && n > 0 ? n : null;
  }

  async adopt(def: ServiceDefinition): Promise<AdoptResult> {
    const rec = this.readInstance(def.id);
    if (!rec || !Number.isInteger(rec.pid)) return { kind: "none" };
    if (!this.alive(rec.pid)) {
      fs.rmSync(this.deps.paths.instanceFile(def.id), { force: true });
      return { kind: "none" };
    }
    const uncertain = (why: string): AdoptResult => ({
      kind: "unavailable",
      reason: "adoption-uncertain",
      hint: `pid ${rec.pid} is alive but ${why}; nothing new is started until: pi-dashboard service stop ${def.id} --force (or remove)`,
    });
    const cmdline = await (this.deps.readCommandLine ?? ((p) => readProcessCommandLine(p, { platform: this.platform })))(rec.pid);
    if (!cmdline?.includes(rec.package)) return uncertain("its command line does not carry the recorded package");
    const ports = Object.values(rec.ports);
    if (ports.length === 0) return uncertain("no port was recorded");
    for (const port of ports) {
      const holders = await (this.deps.portHolders ?? ((p) => this.defaultPortHolders(p)))(port);
      if (holders.length === 0) return uncertain(`the holder of port ${port} cannot be verified`);
      let held = holders.includes(rec.pid);
      for (const h of holders) {
        if (held) break;
        held = (await (this.deps.pgidOf ?? ((p) => this.defaultPgid(p)))(h)) === rec.pid;
      }
      if (!held) return uncertain(`port ${port} is held by another process`);
    }
    return { kind: "running", instance: this.instanceFromRecord(def, rec) };
  }

  async remove(def: ServiceDefinition): Promise<void> {
    fs.rmSync(this.deps.paths.instanceFile(def.id), { force: true });
    fs.rmSync(this.deps.paths.prefetchMarker(def.id), { force: true });
  }

  /** Explicit, confirmed fetch: run the recipe WITHOUT the offline flag, then write the marker. */
  async prefetch(def: ServiceDefinition): Promise<{ ok: boolean; message: string }> {
    const r = def.native!;
    const runner = this.deps.resolveBinary(r.runner);
    if (!runner) return { ok: false, message: `${r.runner} is not installed` };
    const { argv } = buildSafeArgv(runner, runnerArgs(r, ["--help"], "prefetch"), this.platform);
    const res = await this.deps.run(argv[0], argv.slice(1), { timeoutMs: 15 * 60_000 });
    if (res.code !== 0) return { ok: false, message: `prefetch of ${r.package} failed (exit ${res.code ?? "?"})` };
    writePrivateFile(this.deps.paths.prefetchMarker(def.id), `${JSON.stringify({ package: r.package, at: new Date().toISOString() })}\n`);
    return { ok: true, message: `${r.package} prefetched` };
  }
}
