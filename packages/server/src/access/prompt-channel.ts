/**
 * Per-connection prompt capabilities (design D1, D1a, D2; tasks 3.1, 3.3, 3.4).
 *
 * A denial may raise a dialog only when the server can attribute it to an
 * already-authenticated operator channel. This module is that attribution: the
 * browser gateway issues each browser socket a high-entropy **prompt
 * capability**, the browser echoes it in a header, and a request becomes
 * prompt-eligible by resolving back to the issuing socket.
 *
 * Invariants, each a test:
 *   - High-entropy, per connection, and **memory only** — never persisted, so a
 *     restart issues fresh values and a stale one can never be replayed.
 *   - Invalidated by `releasePromptChannel` on socket close, so a capability
 *     dies with its connection.
 *   - Compared in **constant time** and treated identically when absent, empty,
 *     or wrong: a guessed value must learn nothing from the timing or from the
 *     denial it receives.
 *   - Eligibility consults the capability and NOTHING ELSE. Not the auth
 *     credential, not the CORS decision, not `Sec-Fetch-*`, not an
 *     `Origin`/`Host` comparison — those are the four recorded defeats.
 *
 * `maySuspend` additionally requires the live Host-admission mode to be
 * `enforce`: a rebound page can obtain a capability by the same means as a
 * legitimate client, so the mode is the only control that separates them (D2).
 * The mode is PASSED IN, never read from or written to config here, so this
 * module cannot mutate it (task 3.4).
 *
 * See change: add-access-grant-dialog.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

/** The header a request echoes its capability in. */
export const GRANT_CHANNEL_HEADER = "x-pi-grant-channel";

/** Host-admission modes that gate suspension (mirrors `HostGateMode`). */
export type HostGateMode = "report" | "enforce";

/** Bytes of entropy per capability. 32 bytes = 256 bits, base64url-encoded. */
const CAPABILITY_BYTES = 32;

/** socket id → capability. Insertion order is irrelevant; lookup is a scan. */
const channels = new Map<string, string>();

/** Minimal request shape — enough to read one header, nothing more. */
export interface HeaderCarrier {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Constant-time string comparison. Length is allowed to short-circuit: the
 * length of a fixed-format token is not the secret, and `timingSafeEqual`
 * throws on a length mismatch.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Read a header that may arrive as a repeated header. */
function readHeader(request: HeaderCarrier, name: string): string | undefined {
  const raw = request.headers[name];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
}

/**
 * Issue a fresh capability to `socketId`, replacing any existing one. Returns
 * the value the caller sends over that socket. Never persisted.
 */
export function issuePromptChannel(socketId: string): string {
  const capability = randomBytes(CAPABILITY_BYTES).toString("base64url");
  channels.set(socketId, capability);
  return capability;
}

/**
 * Resolve a presented value to its issuing socket id, or `null`.
 *
 * Every stored capability is compared in constant time, so no value can be
 * distinguished from another by how long the lookup took. An absent, empty,
 * non-string, or wrong value resolves to `null` — the SAME answer in every
 * case, so a caller cannot tell "you sent nothing" from "you guessed wrong".
 */
export function resolvePromptChannel(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  let found: string | null = null;
  for (const [socketId, capability] of channels) {
    // No `break`: the scan's cost must not depend on where the match is.
    if (safeEqual(capability, value)) found = socketId;
  }
  return found;
}

/** Drop a socket's capability. Called on socket close, so it dies with the connection. */
export function releasePromptChannel(socketId: string): void {
  channels.delete(socketId);
}

/** Live capability count (diagnostics and tests only). */
export function promptChannelCount(): number {
  return channels.size;
}

/** Test-only: clear all issued capabilities. */
export function __resetPromptChannels(): void {
  channels.clear();
}

/**
 * Whether a denied request may raise a dialog at all.
 *
 * Reads the capability header and nothing else. A header that is present but
 * wrong is treated EXACTLY as one that is absent — same answer, same denial.
 */
export function isPromptEligible(request: HeaderCarrier): boolean {
  return resolvePromptChannel(readHeader(request, GRANT_CHANNEL_HEADER)) !== null;
}

/**
 * Whether a denied request may additionally be **suspended** while the operator
 * decides. Requires prompt-eligibility AND enforcing Host admission.
 *
 * `mode` is passed in so this cannot mutate it; the caller resolves the live
 * mode with `resolveHostGateMode` at the denial site (design D2, D6).
 */
export function maySuspend(request: HeaderCarrier, mode: HostGateMode): boolean {
  return mode === "enforce" && isPromptEligible(request);
}
