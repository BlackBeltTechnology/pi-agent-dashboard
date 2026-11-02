/**
 * Where a `/ws/bridge` upgrade goes once the Host and Origin gates have passed.
 *
 * `bridge` belongs to the pi-gateway listener. It is handed to the gateway ONLY when all of these hold:
 * the socket is the native TLS socket, `tls.acceptBridges` is live-read true, and the gateway accepts
 * TLS upgrades. Every other case keeps the 400 WITHOUT consuming the single-use ticket (so a bridge that
 * dialled the dashboard port does not burn it), and a refusal on a TLS socket names its cause
 * `tls-bridges-off`.
 *
 * Extracted from `server.ts` `onUpgrade` so the routing is testable against a real TLS listener.
 *
 * See change: prove-vault-bridge-tls (D2).
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";

export interface TlsBridgeRouteDeps {
  /** Live read of `tls.enabled && tls.acceptBridges`. */
  acceptBridges: () => boolean;
  /** The pi gateway's TLS entry; absent → the 400 stands. */
  gateway?: { handleTlsUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void };
  /** Rate-limited, secret-free rejection log (`ws-upgrade-reject-log`). */
  rejectLog: (entry: { status: number; reason?: string }) => void;
}

/** Route one bridge-scope upgrade. Always takes ownership of the socket. */
export function routeBridgeUpgrade(
  deps: TlsBridgeRouteDeps,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): "tls-gateway" | "refused" {
  const onTlsSocket = (socket as TLSSocket).encrypted === true;
  if (onTlsSocket && deps.gateway && deps.acceptBridges()) {
    deps.gateway.handleTlsUpgrade(request, socket, head);
    return "tls-gateway";
  }
  deps.rejectLog({ status: 400, ...(onTlsSocket ? { reason: "tls-bridges-off" } : {}) });
  socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
  socket.destroy();
  return "refused";
}

export interface TlsBridgeSwitchDeps {
  /** Live read of `tls.enabled && tls.acceptBridges`. */
  acceptBridges: () => boolean;
  /** Re-evaluate and push to every connected session (a disabled switch denies TLS channels). */
  push: () => void;
  gateway: { closeTlsBridges(): void };
}

/**
 * After a `tls` config write (and the listener reconcile): when Accept bridges or the listener turned
 * off, withdraw values (`push` sends `denied` first) and then close every TLS-admitted socket. Upgraded
 * sockets are detached from the `https.Server`, so its own close does not reach them.
 */
export function onTlsBridgeSwitchChanged(deps: TlsBridgeSwitchDeps): void {
  deps.push();
  if (!deps.acceptBridges()) deps.gateway.closeTlsBridges();
}
