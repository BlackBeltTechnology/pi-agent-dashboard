/**
 * OCI driver (D4) — ONE module for docker and podman; runtime quirks isolated.
 *
 * - Every runtime call runs with `DOCKER_CONFIG` (and podman's
 *   `REGISTRY_AUTH_FILE`) pointing at an empty dashboard-owned dir, so a broken
 *   `credHelpers` entry in `~/.docker/config.json` can never break a local start.
 * - Presence order: binary → engine (`info`) → image. The image is inspected
 *   only after `info` succeeded, so "engine down" is never reported as
 *   `image-absent`. Nothing is ever pulled.
 * - Create: `--init`, labels `pi.service` / `pi.owner` / `pi.def-hash`, ports
 *   `127.0.0.1::<p>`, secrets as `:ro` file mounts (never `-e`/`--env-file`),
 *   `--restart no`, retained after stop (no `--rm`).
 * - Host ports are re-read from `inspect` after every start.
 * - Stop is confirmed by `inspect` showing the container no longer running.
 * - Host VMs (Docker Desktop, podman machine) are reported, never started or
 *   stopped.
 * See change: add-service-registry-core.
 */
import fs from "node:fs";
import net from "node:net";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { isProcessAlive, killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { readProcessCommandLine } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import type { DriverName, ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { CommandRunner, RunResult } from "./command-runner.js";
import type { AdoptResult, DriverInstance, PresenceResult, ServiceDriver, StartContext, StopOutcome } from "./driver.js";
import { ensurePrivateDir, readJsonFile, type ServicesPaths, writePrivateFile } from "./paths.js";
import { allocateLoopbackPort, loopbackEndpoint, type PortAllocator } from "./ports.js";
import { secretPathEnv, writeSecretMounts } from "./secret-delivery.js";

export type OciRuntime = "docker" | "podman";

export interface OciDriverDeps {
  runtime: OciRuntime;
  run: CommandRunner;
  resolveBinary: (name: string) => string | null;
  paths: ServicesPaths;
  spawn?: typeof spawn;
  killProcess?: typeof killProcess;
  allocatePort?: PortAllocator;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Engine-reachability cache window. Default 30 s. */
  cacheMs?: number;
  /** Wait until a local forward accepts connections (default: TCP poll, 5 s). */
  waitForForward?: (port: number) => Promise<boolean>;
  isProcessAlive?: (pid: number) => boolean;
  readCommandLine?: (pid: number) => Promise<string | null>;
}

/** Poll a loopback port until it accepts a TCP connection. */
async function defaultWaitForForward(port: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect({ host: "127.0.0.1", port });
      const done = (v: boolean) => {
        s.destroy();
        resolve(v);
      };
      s.setTimeout(500, () => done(false));
      s.once("connect", () => done(true));
      s.once("error", () => done(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** The subset of `inspect` this driver reads (identical on docker and podman). */
export interface ContainerInspect {
  Id: string;
  Config?: { Labels?: Record<string, string> | null };
  State?: { Running?: boolean; Health?: { Status?: string } };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> | null };
}

export const LABEL_SERVICE = "pi.service";
export const LABEL_OWNER = "pi.owner";
export const LABEL_DEF_HASH = "pi.def-hash";
const STOP_CONFIRM_MARGIN_MS = 5_000;

export class OciDriver implements ServiceDriver {
  readonly name: DriverName;
  private engineCache?: { at: number; result: PresenceResult };

  constructor(private readonly deps: OciDriverDeps) {
    this.name = `oci:${deps.runtime}`;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private sleep(ms: number) {
    return (this.deps.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  /** Env for every runtime invocation: isolated, empty registry auth. */
  runtimeEnv(): NodeJS.ProcessEnv {
    const dir = this.deps.paths.emptyDockerConfig;
    ensurePrivateDir(dir);
    return { ...process.env, DOCKER_CONFIG: dir, REGISTRY_AUTH_FILE: `${dir}/auth.json` };
  }

  private bin(): string | null {
    return this.deps.resolveBinary(this.deps.runtime);
  }

  private exec(args: string[], timeoutMs = 30_000): Promise<RunResult> {
    const bin = this.bin();
    if (!bin) return Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: false, error: "runtime-missing" });
    return this.deps.run(bin, args, { env: this.runtimeEnv(), timeoutMs });
  }

  // ── presence ──────────────────────────────────────────────────────────────

  /** Steps 1–2 (binary, engine), cached for 30 s. */
  async engine(): Promise<PresenceResult> {
    const c = this.engineCache;
    if (c && this.now() - c.at < (this.deps.cacheMs ?? 30_000)) return c.result;
    const result = await this.probeEngine();
    this.engineCache = { at: this.now(), result };
    return result;
  }

  private async probeEngine(): Promise<PresenceResult> {
    if (!this.bin()) return { ok: false, reason: "runtime-missing", hint: `${this.deps.runtime} is not installed` };
    const info = await this.exec(["info", "--format", "{{json .}}"], 15_000);
    if (info.code !== 0) {
      if (await this.hostVmStopped()) {
        return {
          ok: false,
          reason: "host-vm-stopped",
          hint:
            this.deps.runtime === "podman"
              ? "the podman machine is stopped — start it yourself (podman machine start); the dashboard never does"
              : "Docker Desktop is stopped — start it yourself; the dashboard never does",
        };
      }
      return { ok: false, reason: "runtime-unreachable", hint: `${this.deps.runtime} engine is not reachable` };
    }
    try {
      const parsed = JSON.parse(info.stdout) as { OSType?: string; host?: { os?: string } };
      const os = parsed.OSType ?? parsed.host?.os;
      if (os && os.toLowerCase() === "windows") {
        return { ok: false, reason: "unsupported-platform", hint: "Windows-container mode is not supported; switch to Linux containers" };
      }
    } catch {
      /* unparseable info is still a reachable engine */
    }
    return { ok: true };
  }

  /** Host-VM state, report-only. Unknown / unparseable → false (degrades to runtime-unreachable). */
  private async hostVmStopped(): Promise<boolean> {
    if (this.deps.runtime === "podman") {
      const r = await this.exec(["machine", "list", "--format", "json"], 10_000);
      if (r.code !== 0) return false;
      try {
        const machines = JSON.parse(r.stdout) as Array<{ Running?: boolean }>;
        return Array.isArray(machines) && machines.length > 0 && machines.every((m) => m.Running !== true);
      } catch {
        return false;
      }
    }
    // `docker desktop status` is UNVERIFIED (design D4): parse defensively.
    const r = await this.exec(["desktop", "status", "--format", "json"], 10_000);
    if (r.code !== 0) return false;
    try {
      const s = JSON.parse(r.stdout) as { Status?: string; status?: string };
      return String(s.Status ?? s.status ?? "").toLowerCase() === "stopped";
    } catch {
      return false;
    }
  }

  async presence(def: ServiceDefinition): Promise<PresenceResult> {
    const engine = await this.engine();
    if (!engine.ok) return engine;
    const image = def.oci?.image ?? "";
    const r = await this.exec(["image", "inspect", image], 15_000);
    if (r.code !== 0) {
      return { ok: false, reason: "image-absent", hint: `image ${image} is not present locally — the dashboard never pulls; run: ${this.deps.runtime} pull ${image}` };
    }
    return { ok: true };
  }

  canStart(): boolean {
    return true;
  }

  canStop(): boolean {
    return true;
  }

  // ── inspect helpers ───────────────────────────────────────────────────────

  async inspect(ids: string[]): Promise<ContainerInspect[]> {
    if (ids.length === 0) return [];
    const r = await this.exec(["inspect", ...ids], 15_000);
    if (r.code !== 0 && r.stdout.trim() === "") return [];
    try {
      const parsed = JSON.parse(r.stdout) as ContainerInspect[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** `ps -a -q` with label filters → full inspect records. */
  async listContainers(filters: string[]): Promise<ContainerInspect[] | null> {
    const args = ["ps", "-a", "-q", "--no-trunc", ...filters.flatMap((f) => ["--filter", `label=${f}`])];
    const r = await this.exec(args, 15_000);
    if (r.code !== 0) return null;
    const ids = r.stdout.split(/\s+/).filter(Boolean);
    return this.inspect(ids);
  }

  endpointsOf(def: ServiceDefinition, c: ContainerInspect): Record<string, string> {
    const out: Record<string, string> = {};
    const ports = c.NetworkSettings?.Ports ?? {};
    for (const [name, spec] of Object.entries(def.oci?.ports ?? {})) {
      const binding = ports[`${spec.container}/tcp`]?.[0];
      const hostPort = Number(binding?.HostPort);
      if (Number.isInteger(hostPort) && hostPort > 0) out[name] = loopbackEndpoint(spec.protocol, hostPort);
    }
    return out;
  }

  private instanceOf(def: ServiceDefinition, c: ContainerInspect): DriverInstance {
    return {
      driver: this.name,
      startedBy: "dashboard",
      containerId: c.Id,
      endpoints: this.endpointsOf(def, c),
      defHash: c.Config?.Labels?.[LABEL_DEF_HASH],
    };
  }

  /**
   * Classify the containers labelled `pi.service=<id>` (D4 adopt rules). A
   * different `pi.owner` wins over everything: never create beside it.
   */
  classify(def: ServiceDefinition, all: ContainerInspect[], instanceId: string): AdoptResult {
    const forService = all.filter((c) => c.Config?.Labels?.[LABEL_SERVICE] === def.id);
    const mine = forService.filter((c) => c.Config?.Labels?.[LABEL_OWNER] === instanceId);
    if (forService.length > mine.length) {
      return {
        kind: "unavailable",
        reason: "owner-conflict",
        hint: `containers labelled pi.service=${def.id} belong to another dashboard install (pi.owner differs); remove or re-label them`,
      };
    }
    if (mine.length > 1) {
      return {
        kind: "unavailable",
        reason: "duplicate-instances",
        hint: `${mine.length} containers match ${def.id}: ${mine.map((c) => c.Id.slice(0, 12)).join(", ")} — stop/remove acts on all`,
      };
    }
    if (mine.length === 0) return { kind: "none" };
    return mine[0].State?.Running ? { kind: "running", instance: this.instanceOf(def, mine[0]) } : { kind: "stopped" };
  }

  async adopt(def: ServiceDefinition, instanceId: string): Promise<AdoptResult> {
    if (!this.bin()) return { kind: "none" };
    const all = await this.listContainers([`${LABEL_SERVICE}=${def.id}`]);
    if (all === null) return { kind: "none" };
    return this.classify(def, all, instanceId);
  }

  /** Boot adoption for many definitions with ONE `ps -a` (+ one `inspect`). */
  async adoptAll(defs: ServiceDefinition[], instanceId: string): Promise<Map<string, AdoptResult>> {
    const out = new Map<string, AdoptResult>();
    if (defs.length === 0 || !this.bin()) return out;
    const all = await this.listContainers([LABEL_SERVICE]);
    if (all === null) return out;
    for (const def of defs) out.set(def.id, this.classify(def, all, instanceId));
    return out;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  createArgs(def: ServiceDefinition, ctx: StartContext, mounts: Array<{ host: string; container: string }>): string[] {
    const oci = def.oci!;
    const args = ["create"];
    if (oci.init !== false) args.push("--init");
    args.push("--restart", "no");
    args.push("--label", `${LABEL_SERVICE}=${def.id}`, "--label", `${LABEL_OWNER}=${ctx.instanceId}`, "--label", `${LABEL_DEF_HASH}=${ctx.defHash}`);
    for (const spec of Object.values(oci.ports)) args.push("-p", `127.0.0.1::${spec.container}`);
    for (const [vol, target] of Object.entries(oci.volumes ?? {})) args.push("-v", `${vol}:${target}`);
    for (const [host, target] of Object.entries(oci.binds ?? {})) args.push("-v", `${host}:${target}`);
    for (const m of mounts) args.push("-v", `${m.host}:${m.container}:ro`);
    // Non-secret env only: literal values and secret MOUNT PATHS, never values.
    for (const [k, v] of Object.entries({ ...(oci.env ?? {}), ...secretPathEnv(def) })) args.push("-e", `${k}=${v}`);
    args.push(oci.image, ...(oci.command ?? []));
    return args;
  }

  async start(def: ServiceDefinition, ctx: StartContext): Promise<DriverInstance> {
    const existing = (await this.listContainers([`${LABEL_SERVICE}=${def.id}`, `${LABEL_OWNER}=${ctx.instanceId}`])) ?? [];
    const mounts = writeSecretMounts(this.deps.paths.secretsDir(def.id), ctx.secrets);
    let id: string | undefined;
    const reusable = existing.length === 1 && existing[0].Config?.Labels?.[LABEL_DEF_HASH] === ctx.defHash;
    if (reusable) {
      id = existing[0].Id;
    } else {
      // Definition changed (or duplicates): recreate. Named volumes survive `rm`.
      if (existing.length > 0) await this.exec(["rm", "-f", ...existing.map((c) => c.Id)], 60_000);
      const created = await this.exec(this.createArgs(def, ctx, mounts), 120_000);
      if (created.code !== 0) throw new Error(`${this.deps.runtime} create failed: ${firstLine(created)}`);
      id = created.stdout.trim().split(/\s+/).pop();
    }
    if (!id) throw new Error(`${this.deps.runtime} create returned no container id`);
    const started = await this.exec(["start", id], 120_000);
    if (started.code !== 0) throw new Error(`${this.deps.runtime} start failed: ${firstLine(started)}`);
    // Re-read host ports after EVERY start: the runtime may reassign them.
    const [c] = await this.inspect([id]);
    if (!c) throw new Error(`${this.deps.runtime} inspect returned nothing for ${id}`);
    return this.instanceOf(def, c);
  }

  async isAlive(_def: ServiceDefinition, inst: DriverInstance): Promise<boolean> {
    if (!inst.containerId) return false;
    const [c] = await this.inspect([inst.containerId]);
    return c?.State?.Running === true;
  }

  async stop(def: ServiceDefinition, inst: DriverInstance | undefined, stopTimeoutMs: number): Promise<StopOutcome> {
    let ids: string[];
    if (inst?.containerId) ids = [inst.containerId];
    else ids = ((await this.listContainers([`${LABEL_SERVICE}=${def.id}`])) ?? []).map((c) => c.Id);
    await this.closeTunnel(def, inst?.tunnelPid);
    if (ids.length === 0) return "stopped";
    const secs = Math.max(1, Math.round(stopTimeoutMs / 1000));
    await this.exec(["stop", "-t", String(secs), ...ids], stopTimeoutMs + 15_000);
    const deadline = this.now() + STOP_CONFIRM_MARGIN_MS;
    for (;;) {
      const running = (await this.inspect(ids)).filter((c) => c.State?.Running === true);
      if (running.length === 0) return "stopped";
      if (this.now() >= deadline) return "stop-failed";
      await this.sleep(500);
    }
  }

  async remove(def: ServiceDefinition, instanceId: string, opts: { purgeData: boolean }): Promise<void> {
    if (!this.bin()) return;
    const mine = ((await this.listContainers([`${LABEL_SERVICE}=${def.id}`, `${LABEL_OWNER}=${instanceId}`])) ?? []).map((c) => c.Id);
    if (mine.length > 0) await this.exec(["rm", "-f", ...mine], 60_000);
    if (opts.purgeData) {
      for (const vol of Object.keys(def.oci?.volumes ?? {})) await this.exec(["volume", "rm", vol], 60_000);
    }
  }

  async healthcheck(_def: ServiceDefinition, inst: DriverInstance): Promise<boolean> {
    if (!inst.containerId) return false;
    const [c] = await this.inspect([inst.containerId]);
    return c?.State?.Health?.Status === "healthy";
  }

  async imageHasHealthcheck(def: ServiceDefinition): Promise<boolean | undefined> {
    const engine = await this.engine();
    if (!engine.ok) return undefined;
    const r = await this.exec(["image", "inspect", def.oci?.image ?? ""], 15_000);
    if (r.code !== 0) return undefined;
    try {
      const [img] = JSON.parse(r.stdout) as Array<{ Config?: { Healthcheck?: { Test?: string[] } | null }; Healthcheck?: { Test?: string[] } | null }>;
      const test = img?.Config?.Healthcheck?.Test ?? img?.Healthcheck?.Test;
      return Array.isArray(test) && test.length > 0 && test[0] !== "NONE";
    } catch {
      return undefined;
    }
  }

  /**
   * podman machine (macOS / Windows): the host cannot reach a published port
   * directly, so open an owned `ssh -N -L` forward per port, without any
   * in-container precondition. Connection identity/port come from
   * `podman system connection list --format json` (shape recorded in the
   * test fixture from a real podman 6.1 machine).
   */
  /**
   * Terminate this service's tunnel: the live one, or a recorded one a previous
   * server left behind (re-checked to still be an `ssh -L` before signalling).
   */
  async closeTunnel(def: ServiceDefinition, livePid?: number): Promise<void> {
    const file = this.deps.paths.tunnelFile(def.id);
    const recorded = readJsonFile<{ pid?: number }>(file)?.pid;
    for (const pid of new Set([livePid, recorded].filter((p): p is number => Number.isInteger(p)))) {
      if (!(this.deps.isProcessAlive ?? isProcessAlive)(pid)) continue;
      if (pid !== livePid) {
        const cmd = await (this.deps.readCommandLine ?? ((p) => readProcessCommandLine(p)))(pid);
        if (!cmd || !/\bssh\b/.test(cmd) || !cmd.includes("-L")) continue;
      }
      await (this.deps.killProcess ?? killProcess)(pid, { timeoutMs: 2_000 });
    }
    fs.rmSync(file, { force: true });
  }

  async onProbeFailed(def: ServiceDefinition, inst: DriverInstance): Promise<DriverInstance | null> {
    if (this.deps.runtime !== "podman" || inst.tunnelPid) return null;
    const conn = await this.machineConnection();
    if (!conn) return null;
    const ssh = this.deps.resolveBinary("ssh");
    if (!ssh) return null;
    const forwards: string[] = [];
    const endpoints: Record<string, string> = {};
    for (const [name, url] of Object.entries(inst.endpoints)) {
      const u = new URL(url);
      const local = await (this.deps.allocatePort ?? allocateLoopbackPort)();
      forwards.push("-L", `127.0.0.1:${local}:127.0.0.1:${u.port}`);
      endpoints[name] = `${u.protocol}//127.0.0.1:${local}${u.pathname === "/" ? "" : u.pathname}`;
    }
    if (forwards.length === 0) return null;
    const args = [
      "-N",
      ...forwards,
      "-i", conn.identity,
      "-p", String(conn.port),
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      `${conn.user}@${conn.host}`,
    ];
    await this.closeTunnel(def); // a previous server's forward would hold stale ports
    const child = (this.deps.spawn ?? spawn)(ssh, args, { detached: false, stdio: "ignore", shell: false });
    child.on("error", () => {});
    child.unref();
    if (!child.pid) return null;
    writePrivateFile(this.deps.paths.tunnelFile(def.id), `${JSON.stringify({ pid: child.pid })}\n`);
    // Re-probe only once the forward is up: ssh needs a moment to bind it.
    const first = Number(new URL(Object.values(endpoints)[0]).port);
    await (this.deps.waitForForward ?? defaultWaitForForward)(first);
    return { ...inst, endpoints, tunnelPid: child.pid };
  }

  async machineConnection(): Promise<{ user: string; host: string; port: number; identity: string } | null> {
    const r = await this.exec(["system", "connection", "list", "--format", "json"], 10_000);
    if (r.code !== 0) return null;
    try {
      const list = JSON.parse(r.stdout) as Array<{ URI?: string; Identity?: string; IsMachine?: boolean; Default?: boolean }>;
      const c = list.find((x) => x.Default && x.IsMachine) ?? list.find((x) => x.IsMachine);
      if (!c?.URI || !c.Identity || !fs.existsSync(c.Identity)) return null;
      const u = new URL(c.URI);
      if (u.protocol !== "ssh:") return null;
      return { user: decodeURIComponent(u.username), host: u.hostname, port: Number(u.port || 22), identity: c.Identity };
    } catch {
      return null;
    }
  }
}

function firstLine(r: RunResult): string {
  return (r.stderr || r.stdout || r.error || "").trim().split("\n")[0]?.slice(0, 300) ?? "";
}
