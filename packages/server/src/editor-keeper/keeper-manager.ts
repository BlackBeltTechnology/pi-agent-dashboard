/**
 * EditorKeeperManager — server-side helper for spawning, probing, writing
 * to, killing, and discovering editor keeper sidecars.
 *
 * One keeper process per editor instance (one per `cwd`). The keeper itself
 * is `keeper.cjs` (CJS-pure). EditorKeeperManager bridges between the
 * dashboard server's TypeScript world and the spawned CJS subprocess.
 *
 * Mirrors `packages/server/src/rpc-keeper/keeper-manager.ts`, adapted for
 * editor lifecycle (per-editor argv, status/child_exit events, stable
 * cwd-derived id).
 *
 * See: openspec/changes/add-editor-keeper-sidecar
 *   - specs/editor-keeper-sidecar/spec.md
 *   - design.md Decisions 1, 3, 4, 5, 7
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  spawnDetached as defaultSpawnDetached,
  type SpawnDetachedOptions,
  type SpawnDetachedResult,
} from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import {
  isProcessAlive,
  killPidWithGroup,
} from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";

// ── Path conventions ─────────────────────────────────────────────────────────

function defaultEditorsDir(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "editors");
}

function defaultKeeperPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "keeper.cjs");
}

/** Stable id derived from cwd. Same scheme as the existing data-dir hash. */
export function editorIdFromCwd(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 12);
}

export function sockPathFor(
  editorsDir: string,
  editorId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\pi-editor-${editorId}`
    : path.join(editorsDir, `${editorId}.sock`);
}

export function pidPathFor(
  editorsDir: string,
  editorId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? path.join(editorsDir, `pi-editor-${editorId}.pid`)
    : `${sockPathFor(editorsDir, editorId, platform)}.pid`;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface PidSidecar {
  editorId: string;
  keeperPid: number;
  childPid: number;
  port: number;
  cwd: string;
  dataDir: string;
  binary?: string;
  spawnedAt?: string;
}

export interface SpawnKeeperInput {
  cwd: string;
  port: number;
  binary: string;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnKeeperResult {
  success: boolean;
  editorId: string;
  keeperPid?: number;
  sockPath?: string;
  process?: ChildProcess;
  error?: string;
}

export interface ProbeResult {
  alive: boolean;
  editorId: string;
  childPid?: number;
  port?: number;
  cwd?: string;
  dataDir?: string;
}

export interface AdoptedEditor {
  editorId: string;
  keeperPid: number;
  childPid: number;
  port: number;
  cwd: string;
  dataDir: string;
  sockPath: string;
}

export type ChildExitHandler = (info: { code: number | null; signal: string | null }) => void;

export interface EditorKeeperManager {
  spawnKeeperFor(input: SpawnKeeperInput): Promise<SpawnKeeperResult>;
  probe(editorId: string): Promise<ProbeResult>;
  writeCommand(editorId: string, cmd: object): Promise<void>;
  /**
   * Subscribe to keeper events on a persistent connection. Returns an
   * unsubscribe function. The handler is invoked once when `child_exit`
   * is received; the socket is then closed.
   */
  onChildExit(editorId: string, handler: ChildExitHandler): () => void;
  killKeeper(editorId: string): Promise<void>;
  discoverExistingKeepers(): Promise<AdoptedEditor[]>;
  readonly editorsDir: string;
}

// ── Dependency-injection options ─────────────────────────────────────────────

export interface EditorKeeperManagerOptions {
  editorsDir?: string;
  keeperPath?: string;
  nodeBinary?: string;
  platform?: NodeJS.Platform;
  spawnDetached?: (opts: SpawnDetachedOptions) => Promise<SpawnDetachedResult>;
  createConnection?: typeof net.createConnection;
  isProcessAlive?: (pid: number) => boolean;
  killPid?: (pid: number, signal: NodeJS.Signals) => boolean;
}

// ── Implementation ───────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 500;
const WRITE_CMD_TIMEOUT_MS = 500;
const KILL_WAIT_MS = 1000;

export function createEditorKeeperManager(
  opts: EditorKeeperManagerOptions = {},
): EditorKeeperManager {
  const editorsDir = opts.editorsDir ?? defaultEditorsDir();
  const keeperPath = opts.keeperPath ?? defaultKeeperPath();
  const nodeBinary = opts.nodeBinary ?? process.execPath;
  const platform = opts.platform ?? process.platform;
  const spawnDetached = opts.spawnDetached ?? defaultSpawnDetached;
  const createConnection = opts.createConnection ?? net.createConnection;
  const isAlive = opts.isProcessAlive ?? isProcessAlive;
  const kill =
    opts.killPid ??
    ((pid: number, sig: NodeJS.Signals) => {
      try { killPidWithGroup(pid, sig); return true; } catch { return false; }
    });

  function ensureDir(): void {
    try { mkdirSync(editorsDir, { recursive: true }); } catch { /* surfaced by spawn */ }
  }

  function unlinkQuiet(p: string): void {
    try { unlinkSync(p); } catch { /* ignore */ }
  }

  // ── spawnKeeperFor ─────────────────────────────────────────────────────────

  async function spawnKeeperFor(input: SpawnKeeperInput): Promise<SpawnKeeperResult> {
    const { cwd, port, binary, dataDir, env } = input;
    const editorId = editorIdFromCwd(cwd);
    if (!existsSync(keeperPath)) {
      return { success: false, editorId, error: `keeper.cjs not found at ${keeperPath}` };
    }
    ensureDir();

    const launchLogPath = path.join(editorsDir, `keeper-launch-${editorId}.log`);
    let logFd: number | undefined;
    try { logFd = openSync(launchLogPath, "a"); } catch { logFd = undefined; }

    const r = await spawnDetached({
      cmd: nodeBinary,
      args: [keeperPath, editorId, cwd, String(port), binary, dataDir],
      cwd,
      env: env ?? process.env,
      logFd,
      stdinMode: "ignore",
      detach: true,
    });

    if (!r.ok || typeof r.pid !== "number") {
      return { success: false, editorId, error: r.error ?? "spawn returned no pid" };
    }
    try { r.process?.unref(); } catch { /* ignore */ }

    return {
      success: true,
      editorId,
      keeperPid: r.pid,
      sockPath: sockPathFor(editorsDir, editorId, platform),
      process: r.process,
    };
  }

  // ── socket helpers ────────────────────────────────────────────────────────

  function readSidecar(editorId: string): PidSidecar | null {
    const p = pidPathFor(editorsDir, editorId, platform);
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw);
      if (
        j &&
        typeof j === "object" &&
        typeof j.editorId === "string" &&
        typeof j.keeperPid === "number" &&
        typeof j.childPid === "number" &&
        typeof j.port === "number" &&
        typeof j.cwd === "string" &&
        typeof j.dataDir === "string"
      ) {
        return j as PidSidecar;
      }
      return null;
    } catch { return null; }
  }

  function sendAndAwaitJsonLine(
    sockPath: string,
    payload: object,
    timeoutMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let buf = "";
      let sock: net.Socket;
      try { sock = createConnection(sockPath); } catch (e) { reject(e); return; }
      const settle = (ok: boolean, val: unknown): void => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        if (ok) resolve(val); else reject(val);
      };
      const timer = setTimeout(() => settle(false, new Error("timeout")), timeoutMs);
      sock.setEncoding("utf8");
      sock.once("connect", () => {
        try { sock.write(JSON.stringify(payload) + "\n"); } catch (e) { clearTimeout(timer); settle(false, e); }
      });
      sock.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        try {
          clearTimeout(timer);
          settle(true, JSON.parse(line));
        } catch (e) { settle(false, e); }
      });
      sock.once("error", (err) => { clearTimeout(timer); settle(false, err); });
    });
  }

  // ── probe ─────────────────────────────────────────────────────────────────

  async function probe(editorId: string): Promise<ProbeResult> {
    const sidecar = readSidecar(editorId);
    if (!sidecar) return { alive: false, editorId };
    if (!isAlive(sidecar.keeperPid)) return { alive: false, editorId };
    if (!isAlive(sidecar.childPid)) return { alive: false, editorId };

    const sockPath = sockPathFor(editorsDir, editorId, platform);
    try {
      const reply: any = await sendAndAwaitJsonLine(sockPath, { cmd: "getStatus" }, PROBE_TIMEOUT_MS);
      if (!reply || reply.event !== "status") return { alive: false, editorId };
    } catch {
      return { alive: false, editorId };
    }

    // TCP probe of the bound port.
    const tcpOk = await tcpProbe(sidecar.port, 250);
    if (!tcpOk) return { alive: false, editorId };

    return {
      alive: true,
      editorId,
      childPid: sidecar.childPid,
      port: sidecar.port,
      cwd: sidecar.cwd,
      dataDir: sidecar.dataDir,
    };
  }

  function tcpProbe(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const s = new net.Socket();
      let done = false;
      const settle = (ok: boolean): void => {
        if (done) return;
        done = true;
        try { s.destroy(); } catch { /* ignore */ }
        resolve(ok);
      };
      s.setTimeout(timeoutMs);
      s.once("connect", () => settle(true));
      s.once("error", () => settle(false));
      s.once("timeout", () => settle(false));
      s.connect(port, "127.0.0.1");
    });
  }

  // ── writeCommand ──────────────────────────────────────────────────────────

  async function writeCommand(editorId: string, cmd: object): Promise<void> {
    const sockPath = sockPathFor(editorsDir, editorId, platform);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let sock: net.Socket;
      try { sock = createConnection(sockPath); } catch (e) { reject(e); return; }
      const settle = (ok: boolean, err?: unknown): void => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        if (ok) resolve(); else reject(err);
      };
      const timer = setTimeout(() => settle(false, new Error("writeCommand timeout")), WRITE_CMD_TIMEOUT_MS);
      sock.once("connect", () => {
        sock.end(JSON.stringify(cmd) + "\n", "utf8", () => {
          clearTimeout(timer);
          settle(true);
        });
      });
      sock.once("error", (err) => { clearTimeout(timer); settle(false, err); });
    });
  }

  // ── onChildExit ───────────────────────────────────────────────────────────

  function onChildExit(editorId: string, handler: ChildExitHandler): () => void {
    const sockPath = sockPathFor(editorsDir, editorId, platform);
    let sock: net.Socket | null = null;
    let disposed = false;
    let buf = "";

    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      try { sock?.destroy(); } catch { /* ignore */ }
      sock = null;
    };

    try {
      sock = createConnection(sockPath);
    } catch {
      // Socket gone — assume already exited.
      setImmediate(() => { if (!disposed) { dispose(); handler({ code: null, signal: null }); } });
      return dispose;
    }

    sock.setEncoding("utf8");
    // Send a heartbeat so the keeper has a reason to send back data.
    sock.once("connect", () => {
      try { sock?.write(JSON.stringify({ cmd: "heartbeat" }) + "\n"); } catch { /* ignore */ }
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const msg = JSON.parse(line);
          if (msg && msg.event === "child_exit") {
            const code = typeof msg.code === "number" ? msg.code : null;
            const signal = typeof msg.signal === "string" ? msg.signal : null;
            dispose();
            handler({ code, signal });
            return;
          }
        } catch { /* ignore non-JSON */ }
      }
    });
    sock.once("close", () => {
      if (disposed) return;
      dispose();
      // Keeper closed without a child_exit — treat as exited unknown.
      handler({ code: null, signal: null });
    });
    sock.once("error", () => {
      if (disposed) return;
      dispose();
      handler({ code: null, signal: null });
    });

    return dispose;
  }

  // ── killKeeper ────────────────────────────────────────────────────────────

  async function killKeeper(editorId: string): Promise<void> {
    const sidecarBefore = readSidecar(editorId);
    try {
      await writeCommand(editorId, { cmd: "stop" });
    } catch { /* keeper may already be dead */ }

    // Wait up to KILL_WAIT_MS for sidecar to disappear (keeper unlinks on exit).
    const start = Date.now();
    while (Date.now() - start < KILL_WAIT_MS) {
      const p = pidPathFor(editorsDir, editorId, platform);
      if (!existsSync(p)) return;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Fallback: SIGTERM the keeper PID directly.
    if (sidecarBefore && Number.isFinite(sidecarBefore.keeperPid)) {
      kill(sidecarBefore.keeperPid, "SIGTERM");
    }
    // Best-effort artifact cleanup.
    unlinkQuiet(pidPathFor(editorsDir, editorId, platform));
    if (platform !== "win32") unlinkQuiet(sockPathFor(editorsDir, editorId, platform));
  }

  // ── discoverExistingKeepers ───────────────────────────────────────────────

  function listSidecarFiles(): string[] {
    if (!existsSync(editorsDir)) return [];
    try { return readdirSync(editorsDir); } catch { return []; }
  }

  function extractEditorId(filename: string): string | null {
    if (platform === "win32") {
      const m = filename.match(/^pi-editor-([0-9a-f]{12})\.pid$/);
      return m ? m[1] : null;
    }
    const m = filename.match(/^([0-9a-f]{12})\.sock\.pid$/);
    return m ? m[1] : null;
  }

  async function discoverExistingKeepers(): Promise<AdoptedEditor[]> {
    const out: AdoptedEditor[] = [];
    for (const name of listSidecarFiles()) {
      const editorId = extractEditorId(name);
      if (!editorId) continue;

      const sidecar = readSidecar(editorId);
      const pidFile = pidPathFor(editorsDir, editorId, platform);
      const sockPath = sockPathFor(editorsDir, editorId, platform);

      if (!sidecar) {
        // Unparsable / partial sidecar → clean up.
        unlinkQuiet(pidFile);
        if (platform !== "win32") unlinkQuiet(sockPath);
        continue;
      }

      const keeperAlive = isAlive(sidecar.keeperPid);
      const childAlive = isAlive(sidecar.childPid);

      if (keeperAlive && childAlive) {
        // Adoption candidate — verify socket + TCP.
        const result = await probe(editorId);
        if (result.alive) {
          out.push({
            editorId,
            keeperPid: sidecar.keeperPid,
            childPid: sidecar.childPid,
            port: sidecar.port,
            cwd: sidecar.cwd,
            dataDir: sidecar.dataDir,
            sockPath,
          });
          continue;
        }
        // Probe failed → fall through to cleanup paths below.
      }

      if (keeperAlive && !childAlive) {
        // Orphan keeper: signal stop, wait 1 s, SIGTERM keeperPid, unlink.
        try { await writeCommand(editorId, { cmd: "stop" }); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, KILL_WAIT_MS));
        if (isAlive(sidecar.keeperPid)) kill(sidecar.keeperPid, "SIGTERM");
        unlinkQuiet(pidFile);
        if (platform !== "win32") unlinkQuiet(sockPath);
        continue;
      }

      if (!keeperAlive && childAlive) {
        // Keeper crashed; child orphaned. SIGTERM child via pgroup.
        kill(sidecar.childPid, "SIGTERM");
        unlinkQuiet(pidFile);
        if (platform !== "win32") unlinkQuiet(sockPath);
        continue;
      }

      // Both dead.
      unlinkQuiet(pidFile);
      if (platform !== "win32") unlinkQuiet(sockPath);
    }
    return out;
  }

  return {
    spawnKeeperFor,
    probe,
    writeCommand,
    onChildExit,
    killKeeper,
    discoverExistingKeepers,
    editorsDir,
  };
}
