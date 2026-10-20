/**
 * Per-socket locality bit. Computed ONCE at the `/ws` upgrade with
 * `isLocallyTrusted` over the upgrade request and stamped on the socket (like
 * `principal`), so handlers never re-derive it from a frame. An unstamped socket
 * (in-process / virtual connections) is NOT local: fail closed.
 * See change: harden-server-capability-bounds (D1b).
 */
import type { IncomingMessage } from "node:http";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { isLocallyTrusted } from "../auth/localhost-guard.js";

interface LocalitySocket {
  locallyTrusted?: boolean;
}

export function stampSocketLocality(
  ws: object,
  request: Pick<IncomingMessage, "headers"> & { socket: { remoteAddress?: string } },
  ctx?: LocalTrustContext,
): boolean {
  const local = isLocallyTrusted({ ip: request.socket.remoteAddress ?? "", headers: request.headers }, ctx);
  (ws as LocalitySocket).locallyTrusted = local;
  return local;
}

export const isSocketLocallyTrusted = (ws: object): boolean => (ws as LocalitySocket).locallyTrusted === true;
