/**
 * Local credential proof of possession (pure; `node:crypto` + `node:net` only).
 *
 * A caller that can read this HOME's local token proves it WITHOUT sending it:
 * the proof is an HMAC, keyed from the token, over the dialled endpoint binding
 * (an address literal + port, never a host name), a millisecond timestamp, a
 * random nonce and the request purpose. The server verifies it against the
 * connection's own local address/port, so a proof relayed to another endpoint
 * earns nothing. The server answers a verified bridge proof with a counter-proof
 * so a spawned bridge can tell the genuine dashboard from a port squatter.
 *
 * Wire grammar: `v1.<13-digit ts>.<22 b64url nonce>.<43 b64url mac>`; the
 * counter-proof is `v1.<43 b64url>`. Anything else is malformed and is rejected
 * before any HMAC is computed.
 *
 * Used by extension, server, CLI, Electron main and `scripts/reload-all.sh`
 * (which carries a byte-identical inline copy guarded by a shared test vector).
 *
 * See change: loopback-credential-proof (D1).
 */
import crypto from "node:crypto";
import net from "node:net";

/** Request header carrying the client proof. */
export const LOCAL_PROOF_HEADER = "X-Pi-Local-Proof";
/** Response header carrying the server counter-proof. */
export const LOCAL_PROOF_SERVER_HEADER = "X-Pi-Local-Proof-Server";
/** Env var marking a spawned bridge that must verify the server at this endpoint. */
export const REQUIRE_SERVER_PROOF_ENV = "PI_DASHBOARD_REQUIRE_SERVER_PROOF";

/** Freshness window on either side of the verifier's clock (ms). */
export const PROOF_WINDOW_MS = 30_000;

const KEY_LABEL = "pi-dashboard/local-credential-proof/v1";
const CLIENT_LABEL = "pi-lcp/v1/client\n";
const SERVER_LABEL = "pi-lcp/v1/server\n";

const PROOF_RE = /^v1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const COUNTER_RE = /^v1\.([A-Za-z0-9_-]{43})$/;

export interface ParsedProof {
  /** ms since epoch, decimal digits as sent (exactly 13). */
  ts: string;
  nonce: string;
  mac: string;
}

/** Derive the proof key from the (trimmed) token. */
export function deriveKey(token: string): Buffer {
  return crypto.createHmac("sha256", Buffer.from(token.trim(), "utf8")).update(KEY_LABEL).digest();
}

/** HTTP purpose: binds method + request-target (`pathname + search`). */
export function httpPurpose(method: string, target: string): string {
  return `http ${method.toUpperCase()} ${target}`;
}

/** Purpose used on the pi gateway. */
export const BRIDGE_PURPOSE = "bridge";

/**
 * Canonical `<addr>:<port>`: IPv4 dotted; IPv4-mapped IPv6 → IPv4; IPv6
 * lowercase in brackets. Throws for anything that is not an address literal
 * (a host name must never be the binding).
 */
export function canonicalBinding(address: string, port: number): string {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${port}`);
  let a = address.trim();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  if (net.isIPv4(a)) return `${a}:${port}`;
  if (net.isIPv6(a)) {
    const lower = a.toLowerCase();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    if (mapped && net.isIPv4(mapped[1])) return `${mapped[1]}:${port}`;
    return `[${lower}]:${port}`;
  }
  throw new Error(`not an address literal: ${address}`);
}

function clientMac(key: Buffer, binding: string, ts: string, nonce: string, purpose: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${CLIENT_LABEL}${binding}\n${ts}\n${nonce}\n${purpose}`)
    .digest("base64url");
}

export interface MintInput {
  token: string;
  binding: string;
  purpose: string;
  now?: number;
  nonce?: string;
}

export interface MintedProof {
  /** The `X-Pi-Local-Proof` header value. */
  header: string;
  ts: string;
  nonce: string;
  mac: string;
}

/** Mint a proof. `now`/`nonce` are injectable for tests and vectors. */
export function mintProof(input: MintInput): MintedProof {
  const ts = String(input.now ?? Date.now()).padStart(13, "0");
  const nonce = input.nonce ?? crypto.randomBytes(16).toString("base64url");
  const mac = clientMac(deriveKey(input.token), input.binding, ts, nonce, input.purpose);
  return { header: `v1.${ts}.${nonce}.${mac}`, ts, nonce, mac };
}

/** Parse a client proof header value; `undefined` = malformed (no HMAC computed). */
export function parseProof(value: unknown): ParsedProof | undefined {
  if (typeof value !== "string") return undefined;
  const m = PROOF_RE.exec(value);
  return m ? { ts: m[1], nonce: m[2], mac: m[3] } : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Constant-time check of a parsed client proof's MAC. */
export function verifyProofMac(
  key: Buffer,
  proof: ParsedProof,
  binding: string,
  purpose: string,
): boolean {
  return safeEqual(clientMac(key, binding, proof.ts, proof.nonce, purpose), proof.mac);
}

/** `X-Pi-Local-Proof-Server` header value answering a verified client proof. */
export function serverCounterProof(input: {
  token: string;
  binding: string;
  nonce: string;
  mac: string;
}): string {
  const smac = crypto
    .createHmac("sha256", deriveKey(input.token))
    .update(`${SERVER_LABEL}${input.binding}\n${input.nonce}\n${input.mac}`)
    .digest("base64url");
  return `v1.${smac}`;
}

/** Verify a counter-proof header value (first value only) for this dial. */
export function verifyCounterProof(input: {
  token: string;
  binding: string;
  nonce: string;
  mac: string;
  header: unknown;
}): boolean {
  const raw = Array.isArray(input.header) ? input.header[0] : input.header;
  if (typeof raw !== "string" || !COUNTER_RE.test(raw)) return false;
  return safeEqual(serverCounterProof(input), raw);
}

/** True for an IPv4 `127/8` or IPv6 `::1` address literal (optionally bracketed). */
export function isLoopbackLiteral(host: string): boolean {
  let h = host.trim();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (net.isIPv4(h)) return h.split(".")[0] === "127";
  if (net.isIPv6(h)) {
    const lower = h.toLowerCase();
    if (lower === "::1") return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
    return !!mapped && mapped[1].split(".")[0] === "127";
  }
  return false;
}

/**
 * Map the gateway bind host to the literal a local caller should dial:
 * wildcard / `localhost` → `127.0.0.1`; `::1` → `[::1]`; a specific address →
 * itself (IPv6 bracketed).
 */
export function localDialHost(bindHost: string | undefined): string {
  const h = (bindHost ?? "").trim();
  if (h === "" || h === "0.0.0.0" || h === "::" || h === "[::]" || h.toLowerCase() === "localhost") {
    return "127.0.0.1";
  }
  if (h === "::1" || h === "[::1]") return "[::1]";
  if (net.isIPv6(h)) return `[${h}]`;
  return h;
}

/**
 * `X-Pi-Local-Proof` header for ONE HTTP request to `url`: the binding is the
 * address literal + port the URL names (a host name throws — local callers must
 * dial `localDialHost(...)`), the purpose is `http <METHOD> <pathname+search>` of
 * the WHATWG URL, which is byte-for-byte the request-target `fetch`/`ws` write.
 * A proof is good for exactly one request, so call this per request.
 */
export function httpProofHeaders(
  token: string,
  url: string,
  method: string,
  over?: { now?: number; nonce?: string },
): Record<string, string> {
  const u = new URL(url);
  const port = u.port ? Number(u.port) : u.protocol === "https:" || u.protocol === "wss:" ? 443 : 80;
  const minted = mintProof({
    token,
    binding: canonicalBinding(u.hostname, port),
    purpose: httpPurpose(method, u.pathname + u.search),
    now: over?.now,
    nonce: over?.nonce,
  });
  return { [LOCAL_PROOF_HEADER]: minted.header };
}
