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
 * On mixed versions there is no competitor: a dashboard predating this change
 * binds a TCP port and never touches a socket path at all.
 *
 * See change: add-pi-gateway-transport-identity (D9, defect B3).
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { isProcessAlive } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import properLockfile from "proper-lockfile";

/** Raised instead of capturing a path that may still be serving. */
export class GatewaySocketConflictError extends Error {
  readonly code = "E_GATEWAY_SOCKET_CONFLICT";
  constructor(
    readonly socketPath: string,
    readonly detail: string,
  ) {
    super(
      `gateway socket ${socketPath} is already in use (${detail}). ` +
        `Refusing to unlink it — another dashboard instance may be serving bridges there.`,
    );
  }
}

/** How long to wait for a probe connection before calling it indeterminate. */
const PROBE_TIMEOUT_MS = 500;

export type ProbeResult = "no-listener" | "live" | "indeterminate";

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
    sock.setTimeout(timeoutMs, () => done("indeterminate"));
    sock.on("connect", () => done("live"));
    sock.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return done("no-listener");
      // ECONNREFUSED is ambiguous (stale file vs saturated backlog) and every
      // other errno is simply unknown. Both fail closed.
      done("indeterminate");
    });
  });
}

export interface BindGatewaySocketOptions {
  socketPath: string;
  /** Injected server factory (test seam). */
  createServer?: () => http.Server;
  probe?: (socketPath: string) => Promise<ProbeResult>;
}

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

  const releaseLock = await acquireBindLock(socketPath);
  try {
    if (fs.existsSync(socketPath)) {
      const state = await probe(socketPath);
      // `live` is unambiguous and always wins: a recycled or hand-edited
      // pidfile must never authorise unlinking a path something answers on.
      if (state === "live") {
        throw new GatewaySocketConflictError(socketPath, "a live listener answered the probe");
      }
      if (state === "indeterminate" && !ownerIsProvablyDead(socketPath)) {
        throw new GatewaySocketConflictError(socketPath, "the probe was indeterminate");
      }
      // Proven dead while holding the lock: no other participant can bind
      // between here and our own bind.
      fs.unlinkSync(socketPath);
    }

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
    writeOwnerPid(socketPath);
    return server;
  } finally {
    await releaseLock();
  }
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
function writeOwnerPid(socketPath: string): void {
  try {
    fs.writeFileSync(`${socketPath}.pid`, `${process.pid}\n`, { mode: 0o600 });
  } catch {
    /* best-effort: absence only costs us the ability to reclaim */
  }
}

/**
 * Whether the pid recorded next to `socketPath` is provably gone.
 *
 * Fail-closed in every uncertain case — a missing, empty or unparseable
 * pidfile proves nothing, and only a *recorded* pid that is not alive
 * authorises reclaiming the path.
 */
function ownerIsProvablyDead(socketPath: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(`${socketPath}.pid`, "utf8");
  } catch {
    return false;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return !isProcessAlive(pid);
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
    fs.writeFileSync(lockTarget, "# pi-dashboard gateway socket bind lock\n");
  }
  return properLockfile.lock(lockTarget, {
    stale: 10_000,
    // A competitor is only ever inside the short probe/unlink/bind window;
    // waiting it out is correct, failing immediately is not.
    retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
  });
}

/**
 * Close a socket listener and remove its path, plus the companion bind-lock
 * sentinel (which would otherwise accumulate forever). Idempotent with respect
 * to a missing file — a stop() after a crash-cleanup must not throw (task 2.5).
 */
export async function unbindGatewaySocket(
  server: http.Server | null,
  socketPath: string,
): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const p of [socketPath, `${socketPath}.pid`, `${socketPath}.lock`]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* already gone */
    }
  }
}
