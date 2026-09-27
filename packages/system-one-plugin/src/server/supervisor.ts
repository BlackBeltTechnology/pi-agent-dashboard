/**
 * Managed backend supervisor (spec: system-one-managed-backends; design D11).
 * POSIX + `uv` only: `uv tool install` into `~/.pi/agent/system-one/tools/`,
 * then the engine executable is spawned DIRECTLY (argv array, no shell,
 * 127.0.0.1) so the child PID is the server. Health: `GET /v1/models` 200, or
 * on 404 a one-`noul` `POST /v1/systemone`, within a 120 s budget. Stop:
 * SIGTERM, SIGKILL after 10 s. PID files under `run/` record pid + start time
 * + command; on plugin start a recorded process is terminated only when all
 * three still match. Ports: first free in 18400–18499, never 8000/8080/the
 * dashboard port/another backend's port; a busy configured port fails
 * `port-in-use` without moving. See change: add-system-one-registry.
 */
import { type ChildProcess, execFileSync, spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { atomicWrite0600, loadConfig, type ManagedBackend, stateDir } from "@blackbelt-technology/pi-system-one";
import { mergeWrite } from "./config-io.js";
import { checkpointFor, ENGINES } from "./engines.js";

type ManagedState = "stopped" | "installing" | "starting" | "ready" | "failed" | "unavailable" | "unsupported-platform";

export interface ManagedStatus {
  state: ManagedState;
  reason?: string;
  pid?: number;
  port?: number;
  rssKb?: number;
  uptimeMs?: number;
  lastHealthAt?: string;
  startedAt?: number;
  healthBudgetMs?: number;
}

export interface ManagedControl {
  status(id: string): ManagedStatus;
  start(id: string): Promise<ManagedStatus>;
  stop(id: string): Promise<ManagedStatus>;
  log(id: string): string[];
  platform(): string;
  hasLauncher(): boolean;
}

interface ProcInfo {
  startTime: string;
  command: string;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface SupervisorDeps {
  platform: NodeJS.Platform;
  /** Absolute path of `uv`, or null when absent. */
  findUv(): string | null;
  spawn: typeof nodeSpawn;
  clock: Clock;
  portFree(port: number): Promise<boolean>;
  procInfo(pid: number): ProcInfo | null;
  rssKb(pid: number): number | undefined;
  kill(pid: number, signal: NodeJS.Signals | 0): void;
  /** The dashboard's own listen port (known only after listen). */
  dashboardPort?: () => number | undefined;
  healthBudgetMs: number;
  stopGraceMs: number;
  log?: (msg: string) => void;
}

const LOG_LINES = 50;
const PORT_MIN = 18400;
const PORT_MAX = 18499;
const RESERVED = new Set([8000, 8080]);

const toolsDir = () => join(stateDir(), "tools");
export const toolDir = () => join(toolsDir(), "tools");
export const binDir = () => join(toolsDir(), "bin");
export const runDir = () => join(stateDir(), "run");

function which(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const p = join(dir, cmd);
    if (existsSync(p)) return p;
  }
  return null;
}

function ps(field: string, pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function defaultDeps(dashboardPort?: () => number | undefined): SupervisorDeps {
  return {
    platform: process.platform,
    findUv: () => which("uv"),
    spawn: nodeSpawn,
    clock: { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    portFree: (port) =>
      new Promise((resolve) => {
        const s = createServer();
        s.once("error", () => resolve(false));
        s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
      }),
    procInfo: (pid) => {
      const startTime = ps("lstart", pid);
      const command = ps("command", pid);
      return startTime && command ? { startTime, command } : null;
    },
    rssKb: (pid) => {
      const v = Number(ps("rss", pid));
      return Number.isFinite(v) ? v : undefined;
    },
    kill: (pid, sig) => process.kill(pid, sig),
    dashboardPort,
    healthBudgetMs: 120_000,
    stopGraceMs: 10_000,
  };
}

interface Entry {
  status: ManagedStatus;
  child?: ChildProcess;
  lines: string[];
  settled?: Promise<ManagedStatus>;
  stopping?: boolean;
}

interface PidRecord {
  pid: number;
  startTime: string;
  command: string;
  argv: string[];
}

export class Supervisor implements ManagedControl {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly d: SupervisorDeps) {}

  platform(): string {
    return this.d.platform;
  }
  hasLauncher(): boolean {
    return this.d.findUv() !== null;
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { status: { state: "stopped" }, lines: [] };
      this.entries.set(id, e);
    }
    return e;
  }

  private pushLog(e: Entry, chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) if (line) e.lines.push(line);
    if (e.lines.length > LOG_LINES) e.lines.splice(0, e.lines.length - LOG_LINES);
  }

  status(id: string): ManagedStatus {
    if (this.d.platform === "win32") return { state: "unsupported-platform" };
    const e = this.entry(id);
    if (!this.hasLauncher() && (e.status.state === "stopped" || e.status.state === "unavailable"))
      return { state: "unavailable", reason: "uv-missing" };
    const s = { ...e.status };
    if (s.pid && (s.state === "ready" || s.state === "starting")) {
      s.rssKb = this.d.rssKb(s.pid);
      if (s.startedAt) s.uptimeMs = this.d.clock.now() - s.startedAt;
    }
    return s;
  }

  log(id: string): string[] {
    return [...(this.entries.get(id)?.lines ?? [])];
  }

  /** Resolves when the current start attempt reaches ready/failed. */
  whenSettled(id: string): Promise<ManagedStatus> {
    return this.entries.get(id)?.settled ?? Promise.resolve(this.status(id));
  }

  private backend(id: string): ManagedBackend | null {
    const cfg = loadConfig();
    const b = Object.hasOwn(cfg.backends, id) ? cfg.backends[id] : undefined;
    return b?.kind === "managed" ? b : null;
  }

  async pickPort(id: string): Promise<number | null> {
    const cfg = loadConfig();
    const taken = new Set<number>(RESERVED);
    const own = this.d.dashboardPort?.();
    if (own) taken.add(own);
    for (const [other, b] of Object.entries(cfg.backends)) {
      if (other === id) continue;
      if (b.kind === "managed" && b.port) taken.add(b.port);
      if (b.kind === "http") {
        try {
          const p = Number(new URL(b.url).port);
          if (p) taken.add(p);
        } catch {
          // ignore
        }
      }
    }
    for (let p = PORT_MIN; p <= PORT_MAX; p++) if (!taken.has(p) && (await this.d.portFree(p))) return p;
    return null;
  }

  private fail(e: Entry, reason: string): ManagedStatus {
    e.status = { state: "failed", reason };
    return { ...e.status };
  }

  async start(id: string): Promise<ManagedStatus> {
    const pre = this.status(id);
    if (pre.state === "unsupported-platform" || pre.state === "unavailable") return pre;
    const e = this.entry(id);
    if (e.status.state === "starting" || e.status.state === "ready" || e.status.state === "installing") return this.status(id);
    const b = this.backend(id);
    if (!b) return this.fail(e, "unknown-backend");
    const uv = this.d.findUv();
    if (!uv) return { state: "unavailable", reason: "uv-missing" };

    let port = b.port;
    if (port) {
      if (!(await this.d.portFree(port))) return this.fail(e, "port-in-use");
    } else {
      const picked = await this.pickPort(id);
      if (!picked) return this.fail(e, "no-free-port");
      port = picked;
      mergeWrite((doc) => {
        const backends = (doc.backends ?? {}) as Record<string, Record<string, unknown>>;
        if (backends[id]) backends[id] = { ...backends[id], port };
        doc.backends = backends;
      });
    }

    const eng = ENGINES[b.engine];
    const bin = join(binDir(), eng.bin);
    if (!existsSync(bin)) {
      e.status = { state: "installing", port };
      const ok = await this.install(e, uv, eng.package);
      if (!ok || !existsSync(bin)) return this.fail(e, "install-failed");
    }
    const checkpoint = checkpointFor(b.engine, b.checkpoint);
    const argv = eng.argv(port, checkpoint);
    const child = this.d.spawn(bin, argv, {
      env: { ...process.env, ...eng.env(port, checkpoint) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    e.child = child;
    e.stopping = false;
    e.lines = [];
    const startedAt = this.d.clock.now();
    e.status = { state: "starting", port, pid: child.pid, startedAt, healthBudgetMs: this.d.healthBudgetMs };
    child.stdout?.on("data", (c) => this.pushLog(e, String(c)));
    child.stderr?.on("data", (c) => this.pushLog(e, String(c)));
    child.once("spawn", () => {
      if (!child.pid) return;
      const info = this.d.procInfo(child.pid);
      if (info) this.writePid(id, { pid: child.pid, ...info, argv: [bin, ...argv] });
    });
    child.once("error", (err) => {
      this.pushLog(e, String(err));
      if (e.child === child) this.fail(e, "spawn-error");
    });
    child.once("exit", (code, sig) => {
      this.removePid(id);
      if (e.child !== child) return;
      e.child = undefined;
      if (e.stopping) e.status = { state: "stopped" };
      else if (e.status.state === "ready" || e.status.state === "starting") this.fail(e, `exited:${sig ?? code}`);
    });
    e.settled = this.health(id, e, child, port, startedAt);
    return this.status(id);
  }

  private install(e: Entry, uv: string, pkg: string): Promise<boolean> {
    mkdirSync(toolDir(), { recursive: true });
    mkdirSync(binDir(), { recursive: true });
    return new Promise((resolve) => {
      const p = this.d.spawn(uv, ["tool", "install", pkg], {
        env: { ...process.env, UV_TOOL_DIR: toolDir(), UV_TOOL_BIN_DIR: binDir() },
        stdio: ["ignore", "pipe", "pipe"],
      });
      p.stdout?.on("data", (c) => this.pushLog(e, String(c)));
      p.stderr?.on("data", (c) => this.pushLog(e, String(c)));
      p.once("error", () => resolve(false));
      p.once("exit", (code) => resolve(code === 0));
    });
  }

  private async probe(port: number): Promise<boolean> {
    const base = `http://127.0.0.1:${port}`;
    try {
      const r = await fetch(`${base}/v1/models`, { redirect: "error", signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
      if (r.status !== 404) return false;
      const q = await fetch(`${base}/v1/systemone`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "health check", questions: { ok: { type: "noul", instructions: "Is this a health check?" } } }),
      });
      if (!q.ok) return false;
      const body: any = await q.json();
      const n = body?.answers?.ok?.noul;
      return typeof n === "number" && n >= 0 && n <= 1;
    } catch {
      return false;
    }
  }

  private async health(id: string, e: Entry, child: ChildProcess, port: number, startedAt: number): Promise<ManagedStatus> {
    while (e.child === child && e.status.state === "starting") {
      if (await this.probe(port)) {
        if (e.child === child && e.status.state === "starting") {
          e.status = { ...e.status, state: "ready", lastHealthAt: new Date(this.d.clock.now()).toISOString() };
        }
        return this.status(id);
      }
      if (this.d.clock.now() - startedAt >= this.d.healthBudgetMs) {
        this.fail(e, "health-timeout");
        await this.terminate(e, child);
        return this.status(id);
      }
      await this.d.clock.sleep(500);
    }
    return this.status(id);
  }

  private alive(pid: number): boolean {
    try {
      this.d.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async terminate(e: Entry, child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (!pid || child.exitCode !== null || child.signalCode !== null) return;
    let gone = false;
    const exited = new Promise<void>((r) =>
      child.once("exit", () => {
        gone = true;
        r();
      }),
    );
    try {
      this.d.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    const deadline = this.d.clock.now() + this.d.stopGraceMs;
    while (!gone && this.d.clock.now() < deadline) await this.d.clock.sleep(100);
    if (!gone) {
      try {
        this.d.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      await exited;
    }
  }

  async stop(id: string): Promise<ManagedStatus> {
    const e = this.entry(id);
    const child = e.child;
    if (!child) {
      if (e.status.state !== "failed") e.status = { state: "stopped" };
      return this.status(id);
    }
    e.stopping = true;
    await this.terminate(e, child);
    e.child = undefined;
    e.status = { state: "stopped" };
    this.removePid(id);
    return this.status(id);
  }

  /** Server shutdown: SIGTERM every child now; SIGKILL survivors after the grace period. */
  stopAllSync(): void {
    for (const e of this.entries.values()) {
      const child = e.child;
      if (!child?.pid) continue;
      e.stopping = true;
      const pid = child.pid;
      try {
        this.d.kill(pid, "SIGTERM");
      } catch {
        continue;
      }
      const t = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            this.d.kill(pid, "SIGKILL");
          } catch {
            // gone
          }
        }
      }, this.d.stopGraceMs);
      t.unref?.();
    }
  }

  async autostart(): Promise<void> {
    const cfg = loadConfig();
    for (const [id, b] of Object.entries(cfg.backends)) if (b.kind === "managed" && b.autostart) await this.start(id);
  }

  // ---------- PID files ----------
  private pidPath(id: string): string {
    return join(runDir(), `${encodeURIComponent(id)}.json`);
  }
  private writePid(id: string, rec: PidRecord): void {
    try {
      atomicWrite0600(this.pidPath(id), JSON.stringify(rec));
    } catch {
      // best effort
    }
  }
  private removePid(id: string): void {
    rmSync(this.pidPath(id), { force: true });
  }

  /**
   * Plugin start: terminate a recorded process only when it is alive AND its
   * start time AND command still match; remove every PID file either way.
   */
  cleanupOrphans(): number {
    let killed = 0;
    let names: string[] = [];
    try {
      names = readdirSync(runDir()).filter((n) => n.endsWith(".json"));
    } catch {
      return 0;
    }
    for (const n of names) {
      const path = join(runDir(), n);
      try {
        const rec = JSON.parse(readFileSync(path, "utf8")) as PidRecord;
        if (Number.isInteger(rec.pid) && rec.pid > 1 && this.alive(rec.pid)) {
          const info = this.d.procInfo(rec.pid);
          if (info && info.startTime === rec.startTime && info.command === rec.command) {
            this.d.kill(rec.pid, "SIGTERM");
            killed++;
          }
        }
      } catch {
        // unreadable record → just remove it
      }
      rmSync(path, { force: true });
    }
    return killed;
  }
}
