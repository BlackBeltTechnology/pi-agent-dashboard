/**
 * Opt-in strict local proof (`requireLocalProof`).
 *
 * Bare loopback (no forwarding header) is indistinguishable from a marker-less
 * relay (`ssh -R`, `socat`). Under strict mode a genuinely-local request must
 * additionally present PROOF: the `X-Pi-Local-Token` header or a `pi_dash_local`
 * cookie bootstrapped from the local token (`pi-dashboard open` / Electron).
 *
 * Cookie value: `<id>.<expiresAt>.<HMAC(k_local, "<id>.<expiresAt>")>` with
 * `k_local = HMAC(localToken, "pi-dashboard/local-proof/v1")`. Rotating the local
 * token invalidates every proof cookie.
 * See change: harden-trust-and-credential-boundaries (D2).
 */
import crypto from "node:crypto";
import { verifyLocalToken } from "./local-token.js";

export const LOCAL_PROOF_COOKIE = "pi_dash_local";
export const LOCAL_PROOF_MAX_AGE_S = 30 * 24 * 60 * 60;
const CODE_TTL_MS = 60_000;

export interface LocalTrustContext {
  /** Live read of `requireLocalProof`. */
  strict: () => boolean;
  localToken: string;
  /** `HMAC(localToken, "pi-dashboard/local-proof/v1")`. */
  proofKey: Buffer;
}

export function createLocalTrustContext(localToken: string, strict: () => boolean): LocalTrustContext {
  return {
    strict,
    localToken,
    proofKey: crypto.createHmac("sha256", localToken).update("pi-dashboard/local-proof/v1").digest(),
  };
}

function mac(key: Buffer, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

/** Mint a `pi_dash_local` cookie value. */
export function signLocalProof(ctx: LocalTrustContext, now = Date.now(), maxAgeS = LOCAL_PROOF_MAX_AGE_S): string {
  const payload = `${crypto.randomBytes(12).toString("base64url")}.${now + maxAgeS * 1000}`;
  return `${payload}.${mac(ctx.proofKey, payload)}`;
}

/** Valid, unexpired, correctly signed proof cookie value? */
export function verifyLocalProofCookie(value: string | undefined, ctx: LocalTrustContext, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts as [string, string, string];
  const expiresAt = Number(exp);
  if (!id || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const want = Buffer.from(mac(ctx.proofKey, `${id}.${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** Read one cookie from a raw `Cookie` header (works on WS upgrade paths). */
function readCookie(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  const raw = headers?.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : raw;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Local proof = valid proof cookie OR valid `X-Pi-Local-Token`. */
export function hasLocalProof(headers: Record<string, unknown> | undefined, ctx: LocalTrustContext): boolean {
  if (verifyLocalToken(headers, ctx.localToken)) return true;
  return verifyLocalProofCookie(readCookie(headers, LOCAL_PROOF_COOKIE), ctx);
}

/** One-time bootstrap codes (32 random bytes, 60 s TTL, single use). */
export class LocalProofCodeStore {
  private codes = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

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
