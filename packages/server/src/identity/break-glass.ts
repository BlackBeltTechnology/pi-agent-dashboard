/**
 * D23 break-glass: a one-time code, redeemed for a short-lived operator bearer.
 *
 * `pi-dashboard login --local` proves control of the HOST (it reads the 0600
 * local token) and asks the running server for a code; the browser exchanges it
 * like `#pi_handoff` and keeps the bearer in memory only (no cookies, D22). The
 * bearer resolves to the reserved `LOCAL_OPERATOR` principal, which sees
 * everything — so an IdP outage never locks the operator out.
 *
 * In-memory and per instance: a restart invalidates every code and bearer, and
 * a code cannot be redeemed by another instance. Secrets are 256-bit random;
 * only their SHA-256 is stored, so a memory read of the maps yields no usable
 * credential. See change: add-multi-user-identity-plane (D23, tasks 18.23).
 */
import { createHash, randomBytes } from "node:crypto";
import type { PrincipalResolution } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { LOCAL_OPERATOR } from "./session-access.js";

/** Single-use code lifetime (design D23: ≤ 60 s). */
export const BREAK_GLASS_CODE_TTL_MS = 60_000;
/** Operator bearer lifetime — short, logged on issue + use. */
export const BREAK_GLASS_BEARER_TTL_MS = 60 * 60_000;
/** Distinct prefix: a foreign JWT is never looked up here. */
export const BREAK_GLASS_BEARER_PREFIX = "pi_op_";
/** Bound on outstanding codes (oldest evicted) so issuing cannot grow memory. */
const MAX_OUTSTANDING_CODES = 32;
const MAX_LIVE_BEARERS = 64;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

export class BreakGlass {
  private readonly codes = new Map<string, number>(); // sha(code) → expiresAt
  private readonly bearers = new Map<string, number>(); // sha(token) → expiresAt

  issueCode(now: number = Date.now()): { code: string; expiresInSeconds: number } {
    const code = randomBytes(32).toString("base64url");
    this.codes.set(sha(code), now + BREAK_GLASS_CODE_TTL_MS);
    while (this.codes.size > MAX_OUTSTANDING_CODES) {
      const oldest = this.codes.keys().next().value as string;
      this.codes.delete(oldest);
    }
    return { code, expiresInSeconds: BREAK_GLASS_CODE_TTL_MS / 1000 };
  }

  /** Redeem a code once. Unknown / used / expired / non-string ⇒ null (burns nothing else). */
  redeem(code: unknown, now: number = Date.now()): { accessToken: string; expiresIn: number } | null {
    if (typeof code !== "string" || code.length === 0) return null;
    const key = sha(code);
    const expiresAt = this.codes.get(key);
    if (expiresAt === undefined) return null;
    this.codes.delete(key); // single-use even when expired
    if (now > expiresAt) return null;
    const accessToken = BREAK_GLASS_BEARER_PREFIX + randomBytes(32).toString("base64url");
    this.bearers.set(sha(accessToken), now + BREAK_GLASS_BEARER_TTL_MS);
    while (this.bearers.size > MAX_LIVE_BEARERS) {
      const oldest = this.bearers.keys().next().value as string;
      this.bearers.delete(oldest);
    }
    return { accessToken, expiresIn: BREAK_GLASS_BEARER_TTL_MS / 1000 };
  }

  /** `Authorization` header → the operator resolution, or null (not ours / dead). */
  resolveBearer(authorization: string | undefined, now: number = Date.now()): PrincipalResolution | null {
    if (typeof authorization !== "string") return null;
    const m = /^Bearer (\S+)$/.exec(authorization);
    if (!m || !m[1].startsWith(BREAK_GLASS_BEARER_PREFIX)) return null;
    const key = sha(m[1]);
    const expiresAt = this.bearers.get(key);
    if (expiresAt === undefined) return null;
    if (now > expiresAt) {
      this.bearers.delete(key);
      return null;
    }
    return Object.freeze({ principal: LOCAL_OPERATOR, expiresAt });
  }
}
