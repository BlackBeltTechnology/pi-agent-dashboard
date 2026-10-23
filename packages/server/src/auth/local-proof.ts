/**
 * Opt-in strict local proof (`requireLocalProof`).
 *
 * Bare loopback (no forwarding header) is indistinguishable from a marker-less
 * relay (`ssh -R`, `socat`). Under strict mode a genuinely-local request must
 * additionally present PROOF: the `X-Pi-Local-Token` header or a `pi_dash_local`
 * cookie bootstrapped from the local token (`pi-dashboard open` / Electron).
 *
 * Cookie value: `<id>.<issuedAt>.<lastUse>.<port>.<HMAC(k_local, "<id>.<issuedAt>.<lastUse>.<port>")>`
 * with `k_local = HMAC(localToken, "pi-dashboard/local-proof/v1")`. It is bound to the port
 * of the listener that issued it (a browser sends it to every `localhost:<port>` site, so a
 * cookie captured by another local web app only replays against the right port), expires
 * after 12 h idle (re-signed when a request arrives more than 1 h after the last refresh) and
 * has an absolute 30-day cap. Rotating the local token invalidates every proof cookie.
 * See change: harden-trust-and-credential-boundaries (D2); close-container-loopback-impersonation (D12).
 */
import crypto from "node:crypto";
import { hasLocalCredential } from "./local-credential.js";

export const LOCAL_PROOF_COOKIE = "pi_dash_local";
/** Absolute cap from `issuedAt`, and the cookie's browser `Max-Age`. */
export const LOCAL_PROOF_MAX_AGE_S = 30 * 24 * 60 * 60;
/** A cookie unused (never re-signed) for longer than this is no longer proof. */
const LOCAL_PROOF_IDLE_MS = 12 * 60 * 60 * 1000;
/** An admitted request this long after the last refresh gets a re-signed cookie. */
const LOCAL_PROOF_REFRESH_AFTER_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 60_000;

export interface LocalTrustContext {
  /** Live read of `requireLocalProof`. */
  strict: () => boolean;
  localToken: string;
  /** `HMAC(localToken, "pi-dashboard/local-proof/v1")`. */
  proofKey: Buffer;
  /** The listening port the cookie is bound to; absent ⇒ 0 (a context with no listener, e.g. `inject()`). */
  port?: () => number;
}

export function createLocalTrustContext(
  localToken: string,
  strict: () => boolean,
  port?: () => number,
): LocalTrustContext {
  return {
    strict,
    localToken,
    proofKey: crypto.createHmac("sha256", localToken).update("pi-dashboard/local-proof/v1").digest(),
    ...(port ? { port } : {}),
  };
}

function mac(key: Buffer, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

const ctxPort = (ctx: LocalTrustContext): number => ctx.port?.() ?? 0;

function seal(ctx: LocalTrustContext, id: string, issuedAt: number, lastUse: number): string {
  const payload = `${id}.${issuedAt}.${lastUse}.${ctxPort(ctx)}`;
  return `${payload}.${mac(ctx.proofKey, payload)}`;
}

/** Mint a `pi_dash_local` cookie value bound to this context's port. */
export function signLocalProof(ctx: LocalTrustContext, now = Date.now()): string {
  return seal(ctx, crypto.randomBytes(12).toString("base64url"), now, now);
}

export interface LocalProofCookieInfo {
  /** True when a request this long after `lastUse` should be given a re-signed cookie. */
  needsRefresh: boolean;
  /** A re-signed value (same id and `issuedAt`, `lastUse = now`). */
  refreshed: string;
  /** Seconds the re-signed cookie may live (remaining time to the absolute cap). */
  maxAgeS: number;
}

/**
 * `null` unless the cookie is correctly signed, bound to this port, within the idle window and
 * within the absolute cap. Otherwise what a refresh would look like.
 */
export function inspectLocalProofCookie(
  value: string | undefined,
  ctx: LocalTrustContext,
  now = Date.now(),
): LocalProofCookieInfo | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [id, issued, last, port, sig] = parts as [string, string, string, string, string];
  const issuedAt = Number(issued);
  const lastUse = Number(last);
  if (!id || !Number.isFinite(issuedAt) || !Number.isFinite(lastUse) || Number(port) !== ctxPort(ctx)) return null;
  const want = Buffer.from(mac(ctx.proofKey, `${id}.${issued}.${last}.${port}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (lastUse < issuedAt || now - lastUse > LOCAL_PROOF_IDLE_MS) return null;
  const absoluteEnd = issuedAt + LOCAL_PROOF_MAX_AGE_S * 1000;
  if (now > absoluteEnd) return null;
  return {
    needsRefresh: now - lastUse > LOCAL_PROOF_REFRESH_AFTER_MS,
    refreshed: seal(ctx, id, issuedAt, now),
    maxAgeS: Math.max(1, Math.floor((absoluteEnd - now) / 1000)),
  };
}

/** Valid, unexpired, port-bound, correctly signed proof cookie value? */
export function verifyLocalProofCookie(value: string | undefined, ctx: LocalTrustContext, now = Date.now()): boolean {
  return inspectLocalProofCookie(value, ctx, now) !== null;
}

/** Read one cookie from a raw `Cookie` header (works on WS upgrade paths). */
export function readCookie(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const raw = headers?.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : raw;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Local proof = valid proof cookie OR a verified local credential (proof / legacy token). */
export function hasLocalProof(headers: Record<string, unknown> | undefined, ctx: LocalTrustContext): boolean {
  if (hasLocalCredential(headers)) return true;
  return verifyLocalProofCookie(readCookie(headers, LOCAL_PROOF_COOKIE), ctx);
}

/** One-time bootstrap codes (32 random bytes, 60 s TTL, single use). */
export class LocalProofCodeStore {
  private now: () => number;
  private codes = new Map<string, number>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  mint(): string {
    this.sweep();
    const code = crypto.randomBytes(32).toString("base64url");
    this.codes.set(code, this.now() + CODE_TTL_MS);
    return code;
  }

  /** True exactly once per unexpired code. */
  redeem(code: unknown): boolean {
    this.sweep();
    if (typeof code !== "string") return false;
    const exp = this.codes.get(code);
    if (exp === undefined) return false;
    this.codes.delete(code);
    return exp > this.now();
  }

  private sweep(): void {
    const t = this.now();
    for (const [c, exp] of this.codes) if (exp <= t) this.codes.delete(c);
  }
}
