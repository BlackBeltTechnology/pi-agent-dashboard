/**
 * One per-request "is this origin secure?" predicate for every cookie the
 * dashboard sets with a `Secure` attribute: the OAuth state cookie, the
 * `pi_dash_token` session cookie and the `pi_dash_device` cookie.
 *
 * `isSecureOrigin(request, baseIsHttps)` is true when ANY of:
 *  1. the socket itself is TLS;
 *  2. the resolved redirect base is https (`resolveRedirectBase`) — passed in as
 *     `baseIsHttps` so this module stays a leaf with no `auth.ts` import;
 *  3. the SOCKET peer is loopback AND the request `Host` equals (host AND port,
 *     compared with `canonicalOrigin`) an **https** entry of `liveTunnelOrigins()`.
 *     An `http:` tunnel origin never qualifies.
 *
 * It keys on the socket peer, never a forwarding header: Fastify runs with
 * `trustProxy` OFF on purpose, and header-injecting tunnels (zrok, cloudflared)
 * still arrive from a loopback socket. A forged `Host` can only make a cookie
 * STRICTER (`Secure`), never weaker. Any malformed `Host` or tunnel list yields
 * `false` — the predicate never throws.
 *
 * See change: harden-auth-credentials (D3, B16r).
 */
import type { TLSSocket } from "node:tls";
import type { FastifyRequest } from "fastify";
import { liveTunnelOrigins } from "../tunnel/tunnel.js";
import { canonicalOrigin } from "./cors-origin.js";
import { isLoopbackRange } from "./loopback.js";

/** A `Host` is only host[:port]: letters, digits, `.`, `-`, IPv6 `[]:`. Positive allowlist so `a@b`, `a/x`, `a#`… never parse into a bare host. */
const HOST_CHARS = /^[A-Za-z0-9.\-[\]:]+$/;

function hostIsLiveHttpsTunnel(request: FastifyRequest): boolean {
  try {
    const peer = request.raw.socket?.remoteAddress;
    if (!peer || !isLoopbackRange(peer)) return false;
    const host = request.headers.host;
    if (typeof host !== "string" || !HOST_CHARS.test(host)) return false;
    const requestOrigin = canonicalOrigin(`https://${host}`);
    if (!requestOrigin) return false;
    const origins = liveTunnelOrigins();
    if (!Array.isArray(origins)) return false;
    return origins.some((raw) => {
      if (typeof raw !== "string") return false;
      const origin = canonicalOrigin(raw);
      return origin?.startsWith("https://") === true && origin === requestOrigin;
    });
  } catch {
    // A throwing tunnel module / odd socket means "no live tunnel", never a 500.
    return false;
  }
}

export function isSecureOrigin(request: FastifyRequest, baseIsHttps: boolean): boolean {
  if ((request.raw.socket as TLSSocket | undefined)?.encrypted) return true;
  if (baseIsHttps) return true;
  return hostIsLiveHttpsTunnel(request);
}
