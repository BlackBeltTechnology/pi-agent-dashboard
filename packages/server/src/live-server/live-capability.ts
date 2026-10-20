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
import { isGenuinelyLocal } from "../auth/localhost-guard.js";
import { CAPABILITY_SEGMENT, redactCapability } from "./capability-redact.js";

// Lifetime note: a capability's life is bounded by its own idle/absolute limits and
// by revocation (target removed, device revoked, logout / passkey revoke, restart).
// It is deliberately independent of the minting session JWT's natural `exp`.
export const CAPABILITY_IDLE_MS = 30 * 60_000;
export const CAPABILITY_MAX_MS = 12 * 60 * 60_000;
/** Static-target tokens live shorter: 10 min idle / 2 h absolute. See change: improve-canvas-html-and-url-ux (D3). */
export const STATIC_CAPABILITY_IDLE_MS = 10 * 60_000;
export const STATIC_CAPABILITY_MAX_MS = 2 * 60 * 60_000;
/** Allow-once origins kept per viewer, and viewers kept (oldest viewer dropped first). */
const MAX_ALLOW_ONCE_PER_VIEWER = 32;
const MAX_ALLOW_ONCE_VIEWERS = 256;
/** Hard cap on live tokens (oldest dropped): a loop minting tokens cannot grow memory. */
const MAX_TOKENS = 1024;
/** Live tokens per minting principal: one caller's mint loop evicts only ITS OWN oldest tokens. */
const MAX_TOKENS_PER_PRINCIPAL = 64;
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

/** Egress policy a token carries. Fail-closed default: `restricted`, scripts off. */
export interface LivePolicy {
  egress: "open" | "restricted";
  scripts: boolean;
}

/** Whether the target is a loopback port target or a static document root. */
export type LiveTargetKind = "port" | "static";

/** Dashboard exposure when a token was minted. */
export type LiveExposure = "local-only" | "exposed";

/** Opaque id for a client-generated viewer instance (carries allow-once sets across re-mints). */
const VIEWER_ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
export const isViewerId = (v: unknown): v is string => typeof v === "string" && VIEWER_ID_SHAPE.test(v);

interface Entry {
  targetId: string;
  principal: CapabilityPrincipal;
  mintedAt: number;
  lastUsedAt: number;
  /** Non-secret handle distinct from the token (touch / egress / allow-once address tokens by it). */
  tokenId: string;
  kind: LiveTargetKind;
  policy: LivePolicy;
  viewerId?: string;
  /** Identity of the minting principal ({@link principalKeyOf}); egress/touch/allow-once check it. */
  minterKey: string;
  /** Exposure at mint time (a restricted scripted token minted `local-only` dies on the flip to `exposed`). */
  mintExposure: LiveExposure;
  /** Minted by a genuinely local caller: valid only from genuinely local requests. */
  localBound: boolean;
  idleMs: number;
  maxMs: number;
}

/** What the capability hook / proxy learn about a validated token. Never contains the secret. */
export interface LiveCapabilityGrant {
  targetId: string;
  tokenId: string;
  kind: LiveTargetKind;
  policy: LivePolicy;
  viewerId?: string;
  minterKey: string;
  principal: CapabilityPrincipal;
}

export interface MintOptions {
  kind?: LiveTargetKind;
  policy?: Partial<LivePolicy>;
  viewerId?: string;
  exposure?: LiveExposure;
  /**
   * The minting request was genuinely local (loopback peer, no forwarding header) and the
   * minter held no revocable credential: the token then works only from genuinely local
   * requests. Decided by the mint route from the request — never inferred from the principal
   * kind, which is also `local` for an identity principal reaching the dashboard remotely.
   */
  localBound?: boolean;
}

/** Request-boundary facts the store cannot know itself. */
export interface ValidateContext {
  /** Is the request genuinely local (loopback peer, no forwarding header)? */
  genuinelyLocal: boolean;
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

/** Stable identity of a minting principal; the egress / touch / allow-once routes compare it. */
export const principalKeyOf = principalKey;

const hash = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

/** sha256 of a session cookie value, for {@link CapabilityPrincipal.sessionKey}. */
export function sessionKeyOf(cookieValue: string): string {
  return hash(cookieValue);
}

export class LiveCapabilityStore {
  private readonly entries = new Map<string, Entry>();
  /** viewerId → allow-once origins (insertion-ordered, bounded). */
  private readonly allowOnce = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly isPrincipalLive: (p: CapabilityPrincipal) => boolean;
  private readonly isTargetLive: (id: string) => boolean;

  constructor(opts: LiveCapabilityStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.isPrincipalLive = opts.isPrincipalLive ?? (() => true);
    this.isTargetLive = opts.isTargetLive ?? (() => true);
  }

  /**
   * Mint a token for `targetId`. Only its hash is kept. The policy is fail-closed
   * (`restricted`, scripts off) unless the caller states otherwise; static targets
   * get the shorter 10 min / 2 h lifetime.
   */
  mint(
    targetId: string,
    principal: CapabilityPrincipal,
    opts: MintOptions = {},
  ): { token: string; tokenId: string; expiresAt: number; policy: LivePolicy } {
    const now = this.now();
    this.sweep(now);
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenId = crypto.randomBytes(16).toString("base64url");
    const kind: LiveTargetKind = opts.kind === "static" ? "static" : "port";
    const policy: LivePolicy = {
      egress: opts.policy?.egress === "open" ? "open" : "restricted",
      scripts: opts.policy?.scripts === true,
    };
    const idleMs = kind === "static" ? STATIC_CAPABILITY_IDLE_MS : CAPABILITY_IDLE_MS;
    const maxMs = kind === "static" ? STATIC_CAPABILITY_MAX_MS : CAPABILITY_MAX_MS;
    this.entries.set(hash(token), {
      targetId,
      principal,
      mintedAt: now,
      lastUsedAt: now,
      tokenId,
      kind,
      policy,
      ...(isViewerId(opts.viewerId) ? { viewerId: opts.viewerId } : {}),
      minterKey: principalKey(principal),
      mintExposure: opts.exposure ?? "exposed",
      localBound: opts.localBound === true,
      idleMs,
      maxMs,
    });
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
    return { token, tokenId, expiresAt: now + maxMs, policy };
  }

  /**
   * Validate `token` for `targetId`. A hit extends the idle expiry. A missing,
   * unknown, wrong-target, expired or no-longer-live token returns `null` — the
   * caller cannot tell which.
   *
   * `ctx` carries request-boundary facts: a token minted by a genuinely local
   * caller is refused when `ctx.genuinelyLocal` is false. Every request-facing
   * caller (HTTP hook, WS upgrade) MUST pass it; only store-level unit tests omit it.
   */
  validate(targetId: string, token: string, ctx?: ValidateContext): CapabilityPrincipal | null {
    return this.validateGrant(targetId, token, ctx)?.principal ?? null;
  }

  /** {@link validate}, returning everything the proxy needs to apply the token's policy. */
  validateGrant(targetId: string, token: string, ctx?: ValidateContext): LiveCapabilityGrant | null {
    if (!TOKEN_SHAPE.test(token)) return null;
    const key = hash(token);
    const entry = this.entries.get(key);
    if (!entry || entry.targetId !== targetId) return null;
    const now = this.now();
    if (now - entry.lastUsedAt >= entry.idleMs || now - entry.mintedAt >= entry.maxMs) {
      this.entries.delete(key);
      return null;
    }
    if (!this.isTargetLive(entry.targetId) || !this.isPrincipalLive(entry.principal)) {
      this.entries.delete(key);
      return null;
    }
    // Bound to the local machine: a leaked local token is useless from anywhere else.
    // Refused, not deleted — the genuine local holder keeps a working token.
    if (entry.localBound && ctx && !ctx.genuinelyLocal) return null;
    entry.lastUsedAt = now;
    return grantOf(entry);
  }

  /** The live token behind a non-secret `tokenId`, or `null` (expired / unknown). Does not extend idle. */
  findByTokenId(tokenId: string): LiveCapabilityGrant | null {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.tokenId !== tokenId) continue;
      if (now - e.lastUsedAt >= e.idleMs || now - e.mintedAt >= e.maxMs) {
        this.entries.delete(key);
        return null;
      }
      return grantOf(e);
    }
    return null;
  }

  /**
   * Extend a token's idle expiry (keepalive) without a request through its path.
   * Only the minting principal may: `minterKey` must equal the entry's. Never
   * extends past the absolute lifetime. Returns whether a live token was touched.
   */
  touch(tokenId: string, minterKey: string): boolean {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.tokenId !== tokenId) continue;
      if (e.minterKey !== minterKey) return false;
      if (now - e.lastUsedAt >= e.idleMs || now - e.mintedAt >= e.maxMs) {
        this.entries.delete(key);
        return false;
      }
      if (!this.isTargetLive(e.targetId) || !this.isPrincipalLive(e.principal)) {
        this.entries.delete(key);
        return false;
      }
      e.lastUsedAt = now;
      return true;
    }
    return false;
  }

  /** Remember an allow-once origin for a viewer (bounded: 32 origins, 256 viewers). */
  addAllowOnce(viewerId: string, origin: string): void {
    if (!isViewerId(viewerId)) return;
    let set = this.allowOnce.get(viewerId);
    if (set) this.allowOnce.delete(viewerId); // re-insert: most recently used last
    else set = new Set<string>();
    set.delete(origin);
    set.add(origin);
    while (set.size > MAX_ALLOW_ONCE_PER_VIEWER) {
      const oldest = set.values().next().value;
      if (oldest === undefined) break;
      set.delete(oldest);
    }
    this.allowOnce.set(viewerId, set);
    while (this.allowOnce.size > MAX_ALLOW_ONCE_VIEWERS) {
      const oldest = this.allowOnce.keys().next().value;
      if (oldest === undefined) break;
      this.allowOnce.delete(oldest);
    }
  }

  /** The viewer's allow-once origins (a copy; empty when none). */
  getAllowOnce(viewerId: string | undefined): string[] {
    return viewerId ? [...(this.allowOnce.get(viewerId) ?? [])] : [];
  }

  /** Revoke every token whose record matches `pred`. Returns how many died. Never exposes a token. */
  revokeWhere(pred: (e: Readonly<{ kind: LiveTargetKind; policy: LivePolicy; mintExposure: LiveExposure; targetId: string }>) => boolean): number {
    let n = 0;
    for (const [key, e] of this.entries) {
      if (pred(e)) {
        this.entries.delete(key);
        n++;
      }
    }
    return n;
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
      if (now - e.lastUsedAt >= e.idleMs || now - e.mintedAt >= e.maxMs) this.entries.delete(key);
    }
  }
}

const grantOf = (e: Entry): LiveCapabilityGrant => ({
  targetId: e.targetId,
  tokenId: e.tokenId,
  kind: e.kind,
  policy: { ...e.policy },
  ...(e.viewerId ? { viewerId: e.viewerId } : {}),
  minterKey: e.minterKey,
  principal: e.principal,
});

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

export { redactCapability };

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
  /** Set with the prefix: the validated token's policy and ids (never the secret). */
  liveCapability?: LiveCapabilityGrant;
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
  return async function liveCapabilityHook(request: {
    url: string;
    ip?: string;
    headers?: Record<string, unknown>;
  }): Promise<void> {
    if (!request.url.startsWith("/live/")) return;
    const cap = parseCapabilityPath(request.url);
    if (!cap) return;
    // A token minted by a genuinely local caller works only from genuinely local requests.
    const grant = store.validateGrant(cap.targetId, cap.token, {
      genuinelyLocal: isGenuinelyLocal(request.ip ?? "", request.headers ?? {}),
    });
    if (!grant) return;
    const principal = grant.principal;
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
    r.liveCapability = grant;
  };
}
