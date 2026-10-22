/**
 * Server-signed navigation intents (change: harden-client-sinks, design D10).
 *
 * `ni = base64url(e) "." base64url(HMAC-SHA256(key, p \0 k \0 canon(target) \0 e))`
 *
 * Only the expiry `e` (epoch seconds, exactly {@link NAV_INTENT_TTL_S} after
 * minting) and the MAC travel in the URL. The principal `p`, the kind `k`
 * (`url-view` | `file-view`) and the canonical target are NOT in the value —
 * the verifier takes them from its own request context and the route, then
 * recomputes the MAC (constant-time compare). The key is a per-process random
 * 32 bytes (the `SignedChallenges` pattern): a restart invalidates every
 * intent, by design. An intent only upgrades a route-backed overlay's
 * provenance from `agent` to `operator`; without one, the overlay keeps
 * today's fail-closed agent provenance.
 */
import crypto from "node:crypto";

export const NAV_INTENT_TTL_S = 600;
const MAX_NI_LENGTH = 256;

export type NavIntentKind = "url-view" | "file-view";
export type NavIntentTarget = { url: string } | { cwd: string; path: string };

export function isNavIntentKind(v: unknown): v is NavIntentKind {
  return v === "url-view" || v === "file-view";
}

/** Canonical target bytes for the MAC; `null` when `target` does not fit `kind`. */
export function canonicalNavTarget(kind: NavIntentKind, target: unknown): string | null {
  if (!target || typeof target !== "object") return null;
  const t = target as Record<string, unknown>;
  if (kind === "url-view") return typeof t.url === "string" && t.url.length > 0 && t.url.length <= 4096 ? t.url : null;
  if (typeof t.cwd !== "string" || typeof t.path !== "string" || !t.cwd || !t.path) return null;
  if (t.cwd.length > 4096 || t.path.length > 4096) return null;
  return `${t.cwd}\u0000${t.path}`;
}

export class NavIntents {
  private readonly key: Buffer;
  private readonly now: () => number;

  constructor(now: () => number = Date.now, key: Buffer = crypto.randomBytes(32)) {
    this.now = now;
    this.key = key;
  }

  private mac(principal: string, kind: NavIntentKind, canon: string, e: number): Buffer {
    return crypto.createHmac("sha256", this.key).update(`${principal}\u0000${kind}\u0000${canon}\u0000${e}`).digest();
  }

  /** Mint an intent for `principal` opening `target`. Throws on a target that does not fit `kind`. */
  mint(principal: string, kind: NavIntentKind, target: NavIntentTarget): string {
    const canon = canonicalNavTarget(kind, target);
    if (canon === null) throw new TypeError("nav-intent: target does not match kind");
    const e = Math.floor(this.now() / 1000) + NAV_INTENT_TTL_S;
    return `${Buffer.from(String(e)).toString("base64url")}.${this.mac(principal, kind, canon, e).toString("base64url")}`;
  }

  /** True only for an unexpired intent minted by this process for exactly this principal, kind and target. */
  verify(ni: unknown, principal: string, kind: NavIntentKind, target: unknown): boolean {
    if (typeof ni !== "string" || ni.length > MAX_NI_LENGTH) return false;
    const parts = ni.split(".");
    if (parts.length !== 2) return false;
    const e = Number(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!Number.isSafeInteger(e) || e * 1000 <= this.now()) return false;
    const canon = canonicalNavTarget(kind, target);
    if (canon === null) return false;
    const given = Buffer.from(parts[1], "base64url");
    const want = this.mac(principal, kind, canon, e);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }
}
