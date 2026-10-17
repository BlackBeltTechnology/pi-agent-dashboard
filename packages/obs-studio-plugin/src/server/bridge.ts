/**
 * Bridge manager (design D4): one piped child per OBS instance,
 *   <dashboard-cli…> service exec <id> -- <node> <pi-obs.mjs> serve --stdio --service <id> --url <ws>
 * spawned lazily via `platform/exec.js` with `stdio: pipe`. `service exec`
 * inherits the pipes into `pi-obs`, so the NDJSON channel is ours; without
 * `--json` exec writes nothing to stdout on success. Requests are id-correlated
 * (out-of-order responses fine) and bounded by 5 s → `obs-timeout` + bridge
 * terminated (a wedged connection is never reused); the next request spawns a
 * new bridge. Dispose = stdin EOF (serve exits, exec releases its lease), kill
 * only if still alive after 5 s (exec forwards no signals). Per instance:
 * `restarts` (abnormal ends) + `lastError` (last exec/pi-obs stderr line).
 * The password never passes through this process.
 * See change: add-obs-studio-plugin.
 */

import readline from "node:readline";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

const BRIDGE_REQUEST_TIMEOUT_MS = 5000;
const BRIDGE_DISPOSE_GRACE_MS = 5000;

export class BridgeError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

type SpawnFn = (argv: string[]) => ChildProcess;

export interface BridgeDeps {
  cliArgv: readonly string[];
  nodePath: string;
  piObsEntry: string;
  spawn: SpawnFn;
  requestTimeoutMs?: number;
  disposeGraceMs?: number;
  log?: (line: string) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Bridge {
  child: ChildProcess;
  pending: Map<number, Pending>;
  exited: boolean;
  ending: boolean;
}

export interface BridgeInfo {
  open: boolean;
  restarts: number;
  lastError?: string;
}

export class BridgeManager {
  private readonly deps: BridgeDeps;
  private readonly bridges = new Map<string, Bridge>();
  private readonly stats = new Map<string, { restarts: number; lastError?: string }>();
  private nextId = 1;

  constructor(deps: BridgeDeps) {
    this.deps = deps;
  }

  argvFor(id: string, url: string): string[] {
    return [...this.deps.cliArgv, "service", "exec", id, "--", this.deps.nodePath, this.deps.piObsEntry, "serve", "--stdio", "--service", id, "--url", url];
  }

  isOpen(id: string): boolean {
    const b = this.bridges.get(id);
    return Boolean(b && !b.exited && !b.ending);
  }

  info(id: string): BridgeInfo {
    const s = this.stats.get(id) ?? { restarts: 0 };
    return { open: this.isOpen(id), restarts: s.restarts, ...(s.lastError ? { lastError: s.lastError } : {}) };
  }

  private stat(id: string) {
    let s = this.stats.get(id);
    if (!s) {
      s = { restarts: 0 };
      this.stats.set(id, s);
    }
    return s;
  }

  private open(id: string, url: string): Bridge {
    const existing = this.bridges.get(id);
    if (existing && !existing.exited && !existing.ending) return existing;
    const argv = this.argvFor(id, url);
    const child = this.deps.spawn(argv);
    const b: Bridge = { child, pending: new Map(), exited: false, ending: false };
    this.bridges.set(id, b);
    const s = this.stat(id);
    if (child.stdout) {
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        let msg: { id?: number; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } & Record<string, unknown> };
        try {
          msg = JSON.parse(line);
        } catch {
          this.deps.log?.(`[obs-studio] bridge ${id}: non-protocol stdout line dropped`);
          return;
        }
        const p = typeof msg.id === "number" ? b.pending.get(msg.id) : undefined;
        if (!p) return;
        b.pending.delete(msg.id as number);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new BridgeError(String(msg.error?.code ?? "failed"), String(msg.error?.message ?? "request failed"), msg.error));
      });
    }
    if (child.stderr) {
      readline.createInterface({ input: child.stderr }).on("line", (line) => {
        const t = line.trim();
        if (t) s.lastError = t.slice(0, 500);
      });
    }
    child.on("error", (e) => {
      s.lastError = `cannot start the bridge: ${e.message}`;
    });
    child.on("exit", (code) => {
      b.exited = true;
      if (this.bridges.get(id) === b) this.bridges.delete(id);
      if (!b.ending && code !== 0) s.restarts++;
      for (const [, p] of b.pending) {
        clearTimeout(p.timer);
        p.reject(new BridgeError("obs-unavailable", s.lastError ?? `bridge exited (${code})`));
      }
      b.pending.clear();
    });
    this.deps.log?.(`[obs-studio] bridge ${id}: opened`);
    return b;
  }

  /** Send one panel op; opens the bridge when needed. */
  request(id: string, url: string, op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const b = this.open(id, url);
    const reqId = this.nextId++;
    const timeoutMs = this.deps.requestTimeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        b.pending.delete(reqId);
        this.stat(id).restarts++;
        this.deps.log?.(`[obs-studio] bridge ${id}: ${op} timed out after ${timeoutMs} ms; terminating`);
        void this.terminate(id, b);
        reject(new BridgeError("obs-timeout", `OBS did not answer ${op} within ${timeoutMs} ms`));
      }, timeoutMs);
      b.pending.set(reqId, { resolve, reject, timer });
      b.child.stdin?.write(`${JSON.stringify({ id: reqId, op, args })}\n`);
    });
  }

  /** stdin EOF first; kill only when the child outlives the grace period. */
  private terminate(id: string, b: Bridge): Promise<void> {
    b.ending = true;
    if (this.bridges.get(id) === b) this.bridges.delete(id);
    if (b.exited) return Promise.resolve();
    b.child.stdin?.end();
    return new Promise((resolve) => {
      const kill = setTimeout(() => {
        if (!b.exited) b.child.kill();
        resolve();
      }, this.deps.disposeGraceMs ?? BRIDGE_DISPOSE_GRACE_MS);
      b.child.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
    });
  }

  dispose(id: string): Promise<void> {
    const b = this.bridges.get(id);
    return b ? this.terminate(id, b) : Promise.resolve();
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.bridges.keys()].map((id) => this.dispose(id)));
  }
}
