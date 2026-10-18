/**
 * Per-preview CAPABILITY PATH for `/live/<id>/`.
 *
 * The preview frame is sandboxed without `allow-same-origin` (opaque origin), so
 * its subresource, `fetch` and WebSocket requests carry no dashboard cookie (a
 * real-browser spike confirmed: only the frame navigation carried one). The only
 * same-origin credential such a document can hold is one in its own URL. So an
 * authenticated `control`-tier caller mints `/live/<id>/~c/<token>/`; the token
 * admits ONLY that preview, is stored server-side as a hash, expires after 30
 * minutes idle / 12 hours absolute, and dies with its target, its minting
 * device/session, or a restart.
 *
 * Matching is segment-exact on the RAW pathname: no dot-segment and no
 * percent-encoded `/`, `~` or `.` anywhere, no query-string tricks, and a
 * trailing segment separator is required after the token.
 *
 * See change: retire-trusted-networks-bypass (design D5).
 */
import crypto from "node:crypto";
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { TokenPayload } from "../auth/auth.js";

// Lifetime note: a capability's life is bounded by its own idle/absolute limits and
// by revocation (target removed, device revoked, logout / passkey revoke, restart).
// It is deliberately independent of the minting session JWT's natural `exp`.
export const CAPABILITY_IDLE_MS = 30 * 60_000;
export const CAPABILITY_MAX_MS = 12 * 60 * 60_000;
/** Hard cap on live tokens (oldest dropped): a loop minting tokens cannot grow memory. */
const MAX_TOKENS = 1024;
/** Live tokens per minting principal: one caller's mint loop evicts only ITS OWN oldest tokens. */
const MAX_TOKENS_PER_PRINCIPAL = 64;
/** `/~c/<token>` anywhere in a path or `Referer`. Tokens are base64url. */
const CAPABILITY_SEGMENT = /\/~c\/[A-Za-z0-9_-]+/g;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22,}$/;

/** Who minted a capability — the identity and tier an accepted request carries. */
export interface CapabilityPrincipal {
  /**
   * `device` (paired device), `session` (login/passkey session), `local` (genuine
   * same-host caller), `network` (admitted by network trust only — `legacy` mode;
   * dies when the mode becomes `pair`).
   */
  kind: "device" | "session" | "local" | "network";
  /** Tier the minter held at mint time (absent for `local`). */
  tier?: Tier;
  deviceId?: string;
  /** The verified session payload (re-checked for liveness at every use). */
  session?: TokenPayload;
  /** sha256 of the session cookie value — lets logout revoke exactly this session's tokens. */
  sessionKey?: string;
  /** Identity-plane principal, when the minter had one (satisfies the identity floor). */
  identity?: Principal;
  identityExpiresAt?: number;
}

interface Entry {
  targetId: string;
  principal: CapabilityPrincipal;
  mintedAt: number;
  lastUsedAt: number;
}

export interface LiveCapabilityStoreOptions {
  now?: () => number;
  /** Is the minting principal still valid (device not revoked, session alive, identity unexpired)? */
  isPrincipalLive?: (principal: CapabilityPrincipal) => boolean;
  /** Is the target still registered? */
  isTargetLive?: (targetId: string) => boolean;
}

/** Stable identity of a minting principal (device id, session key, else the shared "local"/"network" bucket). */
const principalKey = (p: CapabilityPrincipal): string =>
  p.deviceId ? `device:${p.deviceId}` : p.sessionKey ? `session:${p.sessionKey}` : p.kind;

const hash = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

/** sha256 of a session cookie value, for {@link CapabilityPrincipal.sessionKey}. */
export function sessionKeyOf(cookieValue: string): string {
  return hash(cookieValue);
}

export class LiveCapabilityStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly isPrincipalLive: (p: CapabilityPrincipal) => boolean;
  private readonly isTargetLive: (id: string) => boolean;

  constructor(opts: LiveCapabilityStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.isPrincipalLive = opts.isPrincipalLive ?? (() => true);
    this.isTargetLive = opts.isTargetLive ?? (() => true);
  }

  /** Mint a token for `targetId`. Only its hash is kept. */
  mint(targetId: string, principal: CapabilityPrincipal): { token: string; expiresAt: number } {
    const now = this.now();
    this.sweep(now);
    const token = crypto.randomBytes(32).toString("base64url");
    this.entries.set(hash(token), { targetId, principal, mintedAt: now, lastUsedAt: now });
    // Evict within the minting principal first, so a mint loop cannot push out
    // another user's active preview tokens.
    const who = principalKey(principal);
    let mine = [...this.entries].filter(([, e]) => principalKey(e.principal) === who);
    while (mine.length > MAX_TOKENS_PER_PRINCIPAL) {
      this.entries.delete(mine[0][0]);
      mine = mine.slice(1);
    }
    while (this.entries.size > MAX_TOKENS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { token, expiresAt: now + CAPABILITY_MAX_MS };
  }

  /**
   * Validate `token` for `targetId`. A hit extends the idle expiry. A missing,
   * unknown, wrong-target, expired or no-longer-live token returns `null` — the
   * caller cannot tell which.
   */
  validate(targetId: string, token: string): CapabilityPrincipal | null {
    if (!TOKEN_SHAPE.test(token)) return null;
    const key = hash(token);
    const entry = this.entries.get(key);
    if (!entry || entry.targetId !== targetId) return null;
    const now = this.now();
    if (now - entry.lastUsedAt >= CAPABILITY_IDLE_MS || now - entry.mintedAt >= CAPABILITY_MAX_MS) {
      this.entries.delete(key);
      return null;
    }
    if (!this.isTargetLive(entry.targetId) || !this.isPrincipalLive(entry.principal)) {
      this.entries.delete(key);
      return null;
    }
    entry.lastUsedAt = now;
    return entry.principal;
  }

  revokeByTarget(targetId: string): void {
    for (const [key, e] of this.entries) if (e.targetId === targetId) this.entries.delete(key);
  }

  revokeByDevice(deviceId: string): void {
    for (const [key, e] of this.entries) if (e.principal.deviceId === deviceId) this.entries.delete(key);
  }

  revokeBySessionKey(sessionKey: string): void {
    for (const [key, e] of this.entries) if (e.principal.sessionKey === sessionKey) this.entries.delete(key);
  }

  /** Count of live tokens (tests, diagnostics). Never exposes a token or its hash. */
  size(): number {
    return this.entries.size;
  }

  /** True when no stored key equals the plaintext token (hash-only storage check). */
  holdsPlaintext(token: string): boolean {
    return this.entries.has(token);
  }

  private sweep(now: number): void {
    for (const [key, e] of this.entries) {
      if (now - e.lastUsedAt >= CAPABILITY_IDLE_MS || now - e.mintedAt >= CAPABILITY_MAX_MS) this.entries.delete(key);
    }
  }
}

/** A parsed capability URL. `rest` starts with `/` (or is `/`); `prefix` is `/live/<id>/~c/<token>`. */
export interface CapabilityPath {
  targetId: string;
  token: string;
  prefix: string;
  /** Path (and query) the upstream should see, always beginning with `/`. */
  rest: string;
}

/**
 * Parse `/live/<id>/~c/<token>/<rest…>` from a raw request URL, or `null`.
 *
 * Compared segment by segment on the RAW pathname (never dot-resolved), and any
 * dot-segment or percent-encoded `/`, `~` or `.` anywhere in the pathname makes
 * it not a capability path. The token must be followed by `/`.
 */
export function parseCapabilityPath(url: string | undefined): CapabilityPath | null {
  if (typeof url !== "string" || !url.startsWith("/")) return null;
  let end = url.length;
  for (const sep of ["?", "#"] as const) {
    const i = url.indexOf(sep);
    if (i >= 0 && i < end) end = i;
  }
  const pathname = url.slice(0, end);
  const query = url.slice(end);
  if (/%2f|%7e|%2e|%5c/i.test(pathname) || pathname.includes("\\")) return null;
  const segments = pathname.split("/");
  // ["", "live", id, "~c", token, <at least one more: the separator>]
  if (segments.length < 6) return null;
  if (segments[0] !== "" || segments[1] !== "live" || segments[3] !== "~c") return null;
  const [, , targetId, , token] = segments;
  if (!targetId || !TOKEN_SHAPE.test(token)) return null;
  if (segments.some((s) => s === "." || s === "..")) return null;
  const prefix = `/live/${targetId}/~c/${token}`;
  const rest = pathname.slice(prefix.length) + query;
  return { targetId, token, prefix, rest: rest.startsWith("/") ? rest : `/${rest}` };
}

/** Replace any `/~c/<token>` in a log field / path with a redaction marker. */
export function redactCapability(text: string): string {
  return text.replace(CAPABILITY_SEGMENT, "/~c/<redacted>");
}

/** Remove any `/~c/<token>` segment (forwarded `Referer`). */
export function stripCapabilitySegment(text: string): string {
  return text.replace(CAPABILITY_SEGMENT, "");
}

/** The slice of a Fastify request the capability hook sets. */
interface CapabilityRequestState {
  isAuthenticated?: boolean;
  authVia?: string;
  principalTier?: Tier;
  principalDeviceId?: string;
  principal?: Principal | null;
  principalExpiresAt?: number | null;
  liveCapabilityPrefix?: string;
}

/**
 * `onRequest` hook: authenticate a request whose RAW path carries a valid
 * capability, for that prefix only. Registered BEFORE the bearer / OAuth /
 * identity hooks (they would otherwise refuse a cookie-less preview request),
 * and ahead of the universal guard. A request without a valid capability is
 * left untouched — the normal admission rules decide, and cannot tell a bad
 * token from none.
 */
export function createLiveCapabilityHook(store: LiveCapabilityStore) {
  return async function liveCapabilityHook(request: { url: string }): Promise<void> {
    if (!request.url.startsWith("/live/")) return;
    const cap = parseCapabilityPath(request.url);
    if (!cap) return;
    const principal = store.validate(cap.targetId, cap.token);
    if (!principal) return;
    const r = request as unknown as CapabilityRequestState;
    r.isAuthenticated = true;
    r.authVia = "live-capability";
    if (principal.tier) r.principalTier = principal.tier;
    if (principal.deviceId) r.principalDeviceId = principal.deviceId;
    if (principal.identity) {
      r.principal = principal.identity;
      r.principalExpiresAt = principal.identityExpiresAt ?? null;
    }
    r.liveCapabilityPrefix = cap.prefix;
  };
}
