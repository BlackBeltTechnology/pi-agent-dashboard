/**
 * Bind the gateway's unix-domain socket without ever destroying a live one.
 *
 * The naive sequence — "unlink any pre-existing socket file, then bind" — is a
 * silent takeover primitive, and `EADDRINUSE` cannot be used to guard it:
 * `bind()` raises `EADDRINUSE` only when the path EXISTS, so a process binding
 * inside the `[probe → unlink]` window has its live socket unlinked and our
 * bind then *succeeds* with no error to catch (defect B3):
 *
 *   A: connect()  → ECONNREFUSED   (concludes stale)
 *   B: bind()                       (live listener)
 *   A: unlink()                     (destroys B's path)
 *   A: bind()                       (SUCCEEDS — silent capture)
 *
 * So the sequence is SERIALIZED, not guarded: probe, unlink and bind all run
 * while holding an exclusive lock on a companion file (a socket cannot itself
 * be locked). The lock covers only that sequence, never the listener's
 * lifetime.
 *
 * The probe is also not a liveness oracle — a live listener with a saturated
 * backlog also answers `ECONNREFUSED`. Only `ENOENT` (no file) and a refusal
 * on a path whose file exists but has *no* listener authorise an unlink, and
 * anything indeterminate fails closed with a conflict (D9, task 2.4c).
 *
 * Fail-closed alone, however, makes a stale path UNRECLAIMABLE — `ENOENT` and
 * "the file exists" are mutually exclusive, so a SIGKILLed dashboard wedges its
 * own path forever. The discriminator is a companion `<socketPath>.pid`: an
 * indeterminate probe may unlink only when that pid is recorded and provably
 * dead. A `live` probe always wins over it.
 *
 * The pidfile records `"<pid> <ownerStartMs>"`: a pid that is alive but whose
 * start time differs names a DIFFERENT process (reboot / pid reuse, #744), so
 * the previous owner is provably gone. A refusal alone never reclaims, and a
 * path that is not a socket is never removed.
 *
 * On mixed versions there is no competitor: a dashboard predating this change
 * binds a TCP port and never touches a socket path at all.
 *
 * See change: add-pi-gateway-transport-identity (D9, defect B3).
 * See change: fix-gateway-socket-stale-owner (D1, D2, D4).
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { isProcessAlive, processStartedAt } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import properLockfile from "proper-lockfile";

/** Raised instead of capturing a path that may still be serving. */
export class GatewaySocketConflictError extends Error {
  readonly code = "E_GATEWAY_SOCKET_CONFLICT";
  constructor(
    readonly socketPath: string,
    readonly detail: string,
    /** What the refusal rested on, for the server log (never for health). */
    readonly info: { verdict?: string; ownerPid?: number | null } = {},
  ) {
    super(
      `gateway socket ${socketPath} is already in use (${detail}). ` +
        `Refusing to unlink it — another dashboard instance may be serving bridges there.`,
    );
  }
}

/** How long to wait for a probe connection before calling it indeterminate. */
const PROBE_TIMEOUT_MS = 500;

/**
 * `refused` and `timeout` are deliberately NOT one verdict.
 *
 * A refusal means the kernel answered: nothing is accepting on that path.
 * A timeout means nothing answered at all — which is exactly what a LIVE
 * listener with a saturated accept backlog looks like. Collapsing them let a
 * same-uid process (every pi session shares the uid and the `0700` dir) plant
 * a dead pid, load the incumbent's backlog, and legitimately unlink a live
 * socket (@review Audit, major).
 */
export type ProbeResult = "no-listener" | "live" | "refused" | "timeout" | "indeterminate";

/**
 * Connect to `socketPath` to find out whether anything is serving there.
 *
 * `ECONNREFUSED` means "the file exists but nobody is accepting" — which is
 * what a leftover socket looks like, AND what a live listener with a full
 * backlog looks like. It is therefore reported as `indeterminate` on its own;
 * only `ENOENT` is unambiguous.
 */
export function probeSocket(
  socketPath: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(r);
    };
    const sock = net.connect(socketPath);
    sock.setTimeout(timeoutMs, () => done("timeout"));
    sock.on("connect", () => done("live"));
    sock.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return done("no-listener");
      if (err.code === "ECONNREFUSED") return done("refused");
      // Every other errno is simply unknown, and fails closed.
      done("indeterminate");
    });
  });
}

export interface BindGatewaySocketOptions {
  socketPath: string;
  /** Injected server factory (test seam). */
  createServer?: () => http.Server;
  probe?: (socketPath: string) => Promise<ProbeResult>;
  /** Test seam for the owner start-time probe (D3). */
  startedAt?: (pid: number) => number | null;
}

/** Slack when comparing process start times (D1): `ps`/`/proc` granularity. */
const START_SLACK_MS = 2000;

/**
 * Sockets THIS process bound and still serves, keyed by path (D4). Makes a
 * same-process re-bind (`/api/restart`) see its own dead path as free, and
 * stops a stopping owner deleting a successor's socket.
 */
const owned = new Map<string, http.Server>();

/** dev+ino of the socket inode each server bound, to tell it from a replacement. */
const boundInodes = new WeakMap<http.Server, string>();

const inodeKey = (st: fs.Stats): string => `${st.dev}:${st.ino}`;

/**
 * Bind an `http.Server` on `socketPath`, `0600` in a `0700` directory.
 *
 * Throws {@link GatewaySocketConflictError} rather than unlinking anything it
 * cannot prove is dead.
 */
export async function bindGatewaySocket(opts: BindGatewaySocketOptions): Promise<http.Server> {
  const { socketPath } = opts;
  const probe = opts.probe ?? probeSocket;
  const dir = path.dirname(socketPath);

  fs.mkdirSync(dir, { recursive: true });
  // mkdir's mode is masked by umask, so 0700 needs an explicit chmod (D5).
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort (chmod is a documented no-op on Windows) */
  }

  const startedAt = opts.startedAt ?? processStartedAt;
  const releaseLock = await acquireBindLock(socketPath);
  try {
    await clearReclaimablePath(socketPath, probe, startedAt);

    const server = (opts.createServer ?? (() => http.createServer()))();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      /* best-effort */
    }
    owned.set(socketPath, server);
    const bound = lstatOrNull(socketPath);
    if (bound) boundInodes.set(server, inodeKey(bound));
    writeOwnerPid(socketPath, startedAt);
    return server;
  } finally {
    await releaseLock();
  }
}

/**
 * Remove whatever occupies `socketPath` iff it is provably a dead socket;
 * otherwise throw {@link GatewaySocketConflictError}. A missing path is fine.
 * Must run under the bind lock.
 */
async function clearReclaimablePath(
  socketPath: string,
  probe: (socketPath: string) => Promise<ProbeResult>,
  startedAt: (pid: number) => number | null,
): Promise<void> {
  // `lstat`, not `existsSync`: a dangling symlink "does not exist" to the
  // latter, and a symlink to a stale socket must not be unlinked either.
  const st = lstatOrNull(socketPath);
  if (!st) return;
  const ownerPid = readOwnerRecord(socketPath).pid;
  if (!st.isSocket()) {
    throw new GatewaySocketConflictError(socketPath, "the path exists and is not a socket", {
      verdict: "not-a-socket",
      ownerPid,
    });
  }
  const state = await probe(socketPath);
  // `live` is unambiguous and always wins: a recycled or hand-edited
  // pidfile must never authorise unlinking a path something answers on.
  if (state === "live") {
    throw new GatewaySocketConflictError(socketPath, "a live listener answered the probe", {
      verdict: state,
      ownerPid,
    });
  }
  // Only a REFUSAL may be reconsidered against the pidfile. A timeout is
  // indistinguishable from a live listener whose backlog is full, so it
  // never authorises an unlink no matter what the pidfile claims.
  const reclaimable =
    state === "no-listener" || (state === "refused" && ownerIsProvablyGone(socketPath, startedAt));
  if (!reclaimable) {
    throw new GatewaySocketConflictError(
      socketPath,
      state === "timeout"
        ? "the probe timed out — a live listener with a full backlog looks exactly like this"
        : `the probe was ${state} and the previous owner is not provably gone`,
      { verdict: state, ownerPid },
    );
  }
  // Proven gone while holding the lock: no other participant can bind
  // between here and our own bind.
  fs.unlinkSync(socketPath);
}

/**
 * Record the listening process next to the socket, so a later starter can
 * DISTINGUISH a leftover path from a saturated live one.
 *
 * Without this the fail-closed rule of D9 is absolute and a `SIGKILL`ed
 * dashboard wedges the path permanently: `probeSocket` answers `no-listener`
 * only on `ENOENT`, which by definition cannot coincide with an existing file,
 * so the unlink branch is unreachable under the real probe (@review finding 1).
 */
function writeOwnerPid(socketPath: string, startedAt: (pid: number) => number | null): void {
  const p = `${socketPath}.pid`;
  try {
    // `writeFileSync` FOLLOWS a symlink and leaves a pre-existing file's mode
    // alone, so a planted symlink would be clobbered through and a loose mode
    // would persist. Unlink first, then create exclusively (@review Audit).
    try {
      fs.unlinkSync(p);
    } catch {
      /* nothing there */
    }
    const started = startedAt(process.pid);
    fs.writeFileSync(p, started == null ? `${process.pid}\n` : `${process.pid} ${started}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (err) {
    // Not fatal, but the path becomes unreclaimable after a crash — say so.
    console.warn(`[gateway] could not record the socket owner in ${p}: ${String(err)}`);
  }
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

interface OwnerRecord {
  pid: number | null;
  /** `undefined` = legacy bare pid; `null` = malformed second field. */
  startMs: number | null | undefined;
}

/** Digits-only token → safe integer, else null (never Infinity / imprecise). */
function parseSafeUint(tok: string | undefined): number | null {
  if (!tok || !/^\d+$/.test(tok)) return null;
  const n = Number(tok);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse `<socketPath>.pid` — `"<pid>"` (legacy) or `"<pid> <ownerStartMs>"`. */
function readOwnerRecord(socketPath: string): OwnerRecord {
  let raw: string;
  try {
    raw = fs.readFileSync(`${socketPath}.pid`, "utf8");
  } catch {
    return { pid: null, startMs: null };
  }
  const [pidTok, startTok, ...rest] = raw.trim().split(/\s+/);
  const pid = parseSafeUint(pidTok);
  if (pid === null || pid <= 0) return { pid: null, startMs: null };
  if (startTok === undefined) return { pid, startMs: undefined };
  const startMs = rest.length > 0 ? null : parseSafeUint(startTok);
  return { pid, startMs };
}

/**
 * Whether the dashboard that last bound `socketPath` is provably gone (D1).
 * Fail-closed in every uncertain case.
 */
function ownerIsProvablyGone(
  socketPath: string,
  startedAt: (pid: number) => number | null,
): boolean {
  const { pid, startMs } = readOwnerRecord(socketPath);
  if (pid === null) return false;
  // A malformed second field is "not proven", before ANY positive rule.
  if (startMs === null) return false;
  // 1. Not alive.
  if (!isProcessAlive(pid)) return true;
  // 4. Our own pid: nothing in this process serves the path (#744's
  //    deterministic self-collision), whatever the start-time probe says.
  if (pid === process.pid) return !(owned.get(socketPath)?.listening ?? false);
  const started = startedAt(pid);
  if (started === null) return false;
  // 2. Alive, but a different process than the one that recorded itself.
  if (startMs !== undefined) return Math.abs(started - startMs) > START_SLACK_MS;
  // 3. Legacy bare pid: the pid started after the pidfile was last written.
  try {
    return started > fs.statSync(`${socketPath}.pid`).mtimeMs + START_SLACK_MS;
  } catch {
    return false;
  }
}

/**
 * Take the exclusive companion lock covering probe/unlink/bind.
 *
 * `proper-lockfile` needs a real file to lock, and a socket is not one, so the
 * lock lives on `<socketPath>.lock`.
 */
async function acquireBindLock(socketPath: string): Promise<() => Promise<void>> {
  const lockTarget = `${socketPath}.lock`;
  if (!fs.existsSync(lockTarget)) {
    try {
      fs.writeFileSync(lockTarget, "# pi-dashboard gateway socket bind lock\n", {
        mode: 0o600,
        flag: "wx",
      });
    } catch {
      /* raced with another starter creating it — that is fine, we lock it below */
    }
  }
  return properLockfile.lock(lockTarget, {
    stale: 10_000,
    // A competitor is only ever inside the short probe/unlink/bind window;
    // waiting it out is correct, failing immediately is not.
    retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
  });
}

/**
 * Close a socket listener and remove its path and pidfile — but only while we
 * still own them (D4). libuv already unlinks the path on `close()`; by the
 * time we get the bind lock a successor may have bound the same path, so the
 * follow-up removal happens only when nothing else in this process serves it
 * AND the pidfile still names this process. The `.lock` sentinel is left in
 * place (deleting it while a competitor holds it breaks mutual exclusion).
 * Idempotent and never throws (task 2.5).
 */
export async function unbindGatewaySocket(
  server: http.Server | null,
  socketPath: string,
): Promise<void> {
  if (server && owned.get(socketPath) === server) owned.delete(socketPath);
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  let release: (() => Promise<void>) | null = null;
  try {
    release = await acquireBindLock(socketPath);
  } catch (err) {
    console.warn(`[gateway] could not lock ${socketPath}.lock to clean up: ${String(err)}`);
    return;
  }
  try {
    if (!owned.has(socketPath) && readOwnerRecord(socketPath).pid === process.pid) {
      // Only the very socket inode WE bound is ours to remove: after close
      // another actor may have put a file, symlink or a different socket there.
      const now = lstatOrNull(socketPath);
      const still = server !== null && now?.isSocket() && boundInodes.get(server) === inodeKey(now);
      const targets = still ? [socketPath, `${socketPath}.pid`] : [`${socketPath}.pid`];
      for (const p of targets) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* already gone */
        }
      }
    }
  } finally {
    await release().catch(() => undefined);
  }
}
