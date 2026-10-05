/**
 * Start the bridge gateway's listeners per the listener policy, degrading to an
 * authenticated loopback listener when the unix socket cannot be used.
 *
 * Extracted from `server.ts` so the refusal paths are testable without booting
 * the whole server.
 *
 * See change: fix-gateway-socket-stale-owner (D5).
 */
import { GatewaySocketConflictError } from "./gateway-socket-bind.js";
import type { ListenerPolicy } from "./gateway-transport-policy.js";
import type { PiGateway } from "./pi-gateway.js";

/** Errnos meaning "this filesystem cannot host a unix socket". */
const UNSUPPORTED_SOCKET_ERRNOS = new Set(["EOPNOTSUPP", "ENOTSUP", "EAFNOSUPPORT"]);

/** Why a failed socket bind may fall back to loopback; `null` = it may not. */
function fallbackReasonFor(err: unknown): "occupied" | "unsupported" | null {
  if (err instanceof GatewaySocketConflictError) return "occupied";
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code && UNSUPPORTED_SOCKET_ERRNOS.has(code)) return "unsupported";
  return null;
}

export async function startGatewayListeners(
  gateway: PiGateway,
  policy: ListenerPolicy,
  opts: { piPort: number; log?: Pick<Console, "warn" | "error"> },
): Promise<void> {
  const log = opts.log ?? console;
  // TCP first: `startOnSocket` installs the shared WebSocketServer, and
  // `start()` refuses to run after it rather than orphan the listener.
  if (policy.tcp) {
    gateway.start(policy.tcp.port, policy.tcp.host, {
      kind: policy.socketPath ? "tcp" : "loopback",
    });
  }
  if (!policy.socketPath) return;
  const socketPath = policy.socketPath;
  try {
    await gateway.startOnSocket(socketPath);
  } catch (err) {
    const detail =
      err instanceof GatewaySocketConflictError
        ? ` verdict=${err.info.verdict ?? "unknown"} recordedOwnerPid=${err.info.ownerPid ?? "none"}`
        : "";
    log.error(`[pi-gateway] socket bind failed for ${socketPath}:${detail} ${String(err)}`);
    // The explicit TCP opt-in keeps serving whatever happened to the socket.
    if (policy.tcp) return;
    await serveLoopbackFallback(gateway, socketPath, opts.piPort, err, log);
  }
}

async function serveLoopbackFallback(
  gateway: PiGateway,
  socketPath: string,
  piPort: number,
  cause: unknown,
  log: Pick<Console, "warn" | "error">,
): Promise<void> {
  const reason = fallbackReasonFor(cause);
  if (!reason) {
    throw new Error(`gateway socket ${socketPath} could not be bound: ${String(cause)}`, { cause });
  }
  log.warn(`[pi-gateway] falling back to 127.0.0.1:${piPort} (${reason}); local token required`);
  try {
    await gateway.startLoopbackFallback(piPort, reason);
  } catch (fallbackErr) {
    throw new Error(
      `gateway socket ${socketPath} is unavailable (${reason}) and the loopback fallback ` +
        `port ${piPort} could not be bound: ${String(fallbackErr)}`,
      { cause: fallbackErr },
    );
  }
}
