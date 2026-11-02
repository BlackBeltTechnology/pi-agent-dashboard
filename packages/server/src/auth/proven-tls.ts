/**
 * "Proven TLS" — the hub observed the encryption itself.
 *
 * A request is on a proven TLS channel only when it arrived on the hub's own
 * TLS socket (`socket.encrypted`) AND carries none of the forwarding headers
 * (the extended list, incl. `via`, `x-forwarded-server`, `x-forwarded-port`).
 * A header-asserted scheme is never evidence: any peer can set it.
 *
 * `bearerChannelOf` additionally recognises a valid local credential PROOF
 * (never the legacy raw token, never bare loopback) as a proven channel for
 * the bearer-exposure record.
 *
 * See change: prove-vault-bridge-tls (D3, D4).
 */
import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import { credentialVerdict } from "./local-credential.js";
import { PLUGIN_PROXY_FORWARDING_HEADERS } from "./localhost-guard.js";

/** Headers that disqualify a request from being proven TLS. Same list as the plugin-scope set. */
const PROVEN_TLS_DISQUALIFYING_HEADERS = PLUGIN_PROXY_FORWARDING_HEADERS;

/** The channel a bearer was presented on / handed out over. `tls` and `local-proof` are proven. */
export type BearerChannel = "tls" | "local-proof" | "plain";

/** Is `req` on the hub's own TLS socket with no forwarding header? */
export function isProvenTls(req: Pick<IncomingMessage, "socket" | "headers"> | undefined): boolean {
  if (!req) return false;
  if ((req.socket as TLSSocket | undefined)?.encrypted !== true) return false;
  const headers = (req.headers ?? {}) as Record<string, unknown>;
  return !PROVEN_TLS_DISQUALIFYING_HEADERS.some((h) => headers[h] != null);
}

/** Channel classification for the bearer-exposure record. No request → `plain` (fail closed). */
export function bearerChannelOf(req: Pick<IncomingMessage, "socket" | "headers"> | undefined): BearerChannel {
  if (!req) return "plain";
  if (isProvenTls(req)) return "tls";
  if (credentialVerdict(req.headers).kind === "proof") return "local-proof";
  return "plain";
}

/** True for a proven channel. */
export function isProvenChannel(channel: BearerChannel): boolean {
  return channel !== "plain";
}
