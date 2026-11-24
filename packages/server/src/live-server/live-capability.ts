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
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import type { ResolvedPreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { CAPABILITY_SEGMENT, redactCapability } from "./capability-redact.js";
import { generatePreviewLabel, hashPreviewKey, splitCanonicalHost } from "./preview-origin.js";

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
/** A mint for tiers 1-4 returns the live entry only while MORE than this remains: twice the 10-minute client re-mint lead (D2). */
const REUSE_MIN_REMAINING_MS = 20 * 60_000;
/** The store owns an `unref()`'d sweep so idle entries (and their pool ports) release without waiting for a mint (Q12). */
const SWEEP_INTERVAL_MS = 60_000;
/** Attempts to find a label not already in the index before the mint fails. */
const LABEL_RETRIES = 8;

/** Capability tier: 1-4 are origin-bound previews (D1); `legacy` is the `/live/<id>/~c/<token>/` path. */
export type CapabilityTier = 1 | 2 | 3 | 4 | "legacy";

/** Why an entry left the store — the `onDelete` reason (D5, D13). */
export type CapabilityDeleteReason =
  | "idle"
  | "max"
  | "revoked"
  | "evicted"
  | "disabled"
  | "shutdown"
  | "config-changed"
  | "listener-error";

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

export interface LiveCapabilityEntry {
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
  /** `legacy` for a `/live/<id>/~c/<token>/` path; 1-4 for an origin-bound preview (D2). */
  tier: CapabilityTier;
  /** Canonical `host[:port]` of the preview origin (tiers 1-4). Lookup key together with the label hash. */
  originHost?: string;
  /** Full origin (`scheme://originHost`). CSP sources come from here, never from the request (D6). Memory only. */
  origin?: string;
  /** Plaintext label (tiers 1, 2, 4). Memory only: never persisted, never logged unredacted. */
  label?: string;
  /** Canonical `Origin` of the mint request (fallback `scheme://Host`): who may frame this origin. */
  ancestors: string[];
  /** Tier 3: the pool port the listener is bound to. */
  poolPort?: number;
}
type Entry = LiveCapabilityEntry;

/** What the capability hook / proxy learn about a validated token. Never contains the secret. */
export interface LiveCapabilityGrant {
  targetId: string;
  tokenId: string;
  kind: LiveTargetKind;
  policy: LivePolicy;
  viewerId?: string;
  minterKey: string;
  principal: CapabilityPrincipal;
  tier: CapabilityTier;
  origin?: string;
  originHost?: string;
  poolPort?: number;
  ancestors: string[];
}

/** Origin binding of a mint for tiers 1-4 (D1, D2). */
export interface PreviewMintBinding {
  tier: 1 | 2 | 3 | 4;
  /** Canonical `Origin` of the mint request (fallback `scheme://Host`). */
  ancestors: string[];
  /** Tiers 1, 2, 4: builds the origin from a freshly generated label. */
  buildOrigin?: (label: string) => { origin: string; originHost: string };
  /** Tier 3: the bound listener's origin (`http://<ip>:<port>`), `host:port`, and port. */
  fixed?: { origin: string; originHost: string; poolPort: number };
}

export interface MintOptions {
  /** Origin binding for tiers 1-4; absent = legacy path token. */
  preview?: PreviewMintBinding;
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
  /**
   * Called ONCE per entry, after it has left every index, on every deletion path
   * (idle/max, revoke, eviction, `enabled` flip, shutdown, listener error). Closes pool listeners.
   * A throwing hook is logged (redacted) and never blocks the other deletions.
   */
  onDelete?: (entry: Readonly<LiveCapabilityEntry>, reason: CapabilityDeleteReason) => void;
  /** Resolved preview-origin config; entries it no longer covers are revoked on every sweep (D12, Q8). */
  getPreviewConfig?: () => ResolvedPreviewOrigins | undefined;
  /** Random bytes source for labels (tests inject collisions). */
  labelBytes?: (n: number) => Buffer;
  /** Sweep interval; default 60 s (tests drive it with fake timers). */
  sweepIntervalMs?: number;
}

/** A host-keyed lookup result. Refusals carry the ONLY detail logs may show; the HTTP answer is identical for all. */
export type HostLookup =
  | { ok: true; grant: LiveCapabilityGrant }
  | { ok: false; reason: "unknown" | "expired" | "wrong-host" | "wrong-port" };

/** Stable identity of a minting principal (device id, session key, else the shared "local"/"network" bucket). */
const principalKey = (p: CapabilityPrincipal): string =>
  p.deviceId ? `device:${p.deviceId}` : p.sessionKey ? `session:${p.sessionKey}` : p.kind;

/** Stable identity of a minting principal; the egress / touch / allow-once routes compare it. */
export const principalKeyOf = principalKey;

const hash = hashPreviewKey;

/** sha256 of a session cookie value, for {@link CapabilityPrincipal.sessionKey}. */
export function sessionKeyOf(cookieValue: string): string {
  return hash(cookieValue);
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Does `entry` still fall under the tier's CURRENT resolved config? (Tier 1 needs none.) */
function entryMatchesConfig(e: Entry, cfg: ResolvedPreviewOrigins): boolean {
  if (e.tier === "legacy" || e.tier === 1) return true;
  if (e.tier === 3) return !!cfg.pool && e.poolPort !== undefined && e.poolPort >= cfg.pool.from && e.poolPort <= cfg.pool.to;
  const host = e.originHost ? splitCanonicalHost(e.originHost) : undefined;
  if (!host) return false;
  if (e.tier === 2) {
    const w = cfg.wildcard;
    if (!w || !e.label) return false;
    return host.hostname === `${e.label}.${w.suffix}` && host.port === w.port && !!e.origin?.startsWith(`${w.scheme}://`);
  }
  // tier 4
  return !!cfg.ipDnsSuffix && host.hostname.endsWith(`.${cfg.ipDnsSuffix}`);
}

export class LiveCapabilityStore {
  /** `hash(secret)` → entry. The secret is the label (tiers 1, 2, 4) or a random token (tier 3, legacy). */
  private readonly entries = new Map<string, Entry>();
  /** `hash(originHost)` → entry key (tiers 1-4): the dynamic admission set; holds no plaintext label. */
  private readonly byOriginHost = new Map<string, string>();
  /** viewerId → allow-once origins (insertion-ordered, bounded). */
  private readonly allowOnce = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly isPrincipalLive: (p: CapabilityPrincipal) => boolean;
  private readonly isTargetLive: (id: string) => boolean;
  private readonly onDelete?: LiveCapabilityStoreOptions["onDelete"];
  private readonly getPreviewConfig?: () => ResolvedPreviewOrigins | undefined;
  private readonly labelBytes?: (n: number) => Buffer;
  private readonly sweepIntervalMs: number;
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(opts: LiveCapabilityStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.isPrincipalLive = opts.isPrincipalLive ?? (() => true);
    this.isTargetLive = opts.isTargetLive ?? (() => true);
    this.onDelete = opts.onDelete;
    this.getPreviewConfig = opts.getPreviewConfig;
    this.labelBytes = opts.labelBytes;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  }

  /**
   * A live entry a new mint for tiers 1-4 may be answered with (D2 re-mint reuse): same target, minter,
   * policy, tier and ancestors (never `viewerId`: the viewer mints a fresh id per mount), with MORE than
   * 20 minutes of absolute lifetime left. Never resurrects an expired / revoked entry. Tier 3 callers
   * check this BEFORE allocating a pool port.
   */
  findReusable(
    targetId: string,
    principal: CapabilityPrincipal,
    opts: MintOptions,
  ): { entry: Readonly<Entry>; grant: LiveCapabilityGrant } | null {
    const b = opts.preview;
    if (!b) return null;
    const now = this.now();
    const kind: LiveTargetKind = opts.kind === "static" ? "static" : "port";
    const egress = opts.policy?.egress === "open" ? "open" : "restricted";
    const scripts = opts.policy?.scripts === true;
    const who = principalKey(principal);
    for (const [key, e] of this.entries) {
      if (e.tier !== b.tier || e.targetId !== targetId || e.minterKey !== who || e.kind !== kind) continue;
      if (e.policy.egress !== egress || e.policy.scripts !== scripts) continue;
      if (e.localBound !== (opts.localBound === true) || e.mintExposure !== (opts.exposure ?? "exposed")) continue;
      if (!sameList(e.ancestors, b.ancestors)) continue;
      if (this.expiryReason(e, now)) continue;
      if (e.mintedAt + e.maxMs - now <= REUSE_MIN_REMAINING_MS) continue;
      if (!this.isTargetLive(e.targetId) || !this.isPrincipalLive(e.principal)) {
        this.remove(key, "revoked");
        continue;
      }
      return { entry: e, grant: grantOf(e) };
    }
    return null;
  }

  /**
   * Mint a capability for `targetId`. Only a hash is kept. The policy is fail-closed
   * (`restricted`, scripts off) unless the caller states otherwise; static targets
   * get the shorter 10 min / 2 h lifetime.
   *
   * With `opts.preview` (tiers 1-4) the entry is bound to its origin: tiers 1, 2, 4 generate a
   * 128-bit label (re-drawn on a collision) and `token` is that label; a mint that matches a live
   * entry (see {@link findReusable}) returns it with `reused: true`.
   */
  mint(
    targetId: string,
    principal: CapabilityPrincipal,
    opts: MintOptions = {},
  ): {
    token: string;
    tokenId: string;
    expiresAt: number;
    policy: LivePolicy;
    tier: CapabilityTier;
    origin?: string;
    originHost?: string;
    poolPort?: number;
    reused: boolean;
  } {
    const now = this.now();
    this.sweep(now);
    const binding = opts.preview;
    const reusable = this.findReusable(targetId, principal, opts);
    if (reusable) {
      const e = reusable.entry as Entry;
      e.lastUsedAt = now;
      return {
        token: e.label ?? "",
        tokenId: e.tokenId,
        expiresAt: e.mintedAt + e.maxMs,
        policy: { ...e.policy },
        tier: e.tier,
        origin: e.origin,
        originHost: e.originHost,
        poolPort: e.poolPort,
        reused: true,
      };
    }
    const kind: LiveTargetKind = opts.kind === "static" ? "static" : "port";
    const policy: LivePolicy = {
      egress: opts.policy?.egress === "open" ? "open" : "restricted",
      scripts: opts.policy?.scripts === true,
    };
    const idleMs = kind === "static" ? STATIC_CAPABILITY_IDLE_MS : CAPABILITY_IDLE_MS;
    const maxMs = kind === "static" ? STATIC_CAPABILITY_MAX_MS : CAPABILITY_MAX_MS;
    const tokenId = crypto.randomBytes(16).toString("base64url");

    let secret: string;
    let preview: Pick<Entry, "tier" | "originHost" | "origin" | "label" | "poolPort" | "ancestors"> = {
      tier: "legacy",
      ancestors: [],
    };
    if (!binding) {
      secret = crypto.randomBytes(32).toString("base64url");
    } else if (binding.tier === 3) {
      if (!binding.fixed) throw new Error("tier 3 mint needs the bound listener");
      secret = crypto.randomBytes(32).toString("base64url");
      preview = { tier: 3, ...binding.fixed, ancestors: [...binding.ancestors] };
    } else {
      if (!binding.buildOrigin) throw new Error(`tier ${binding.tier} mint needs buildOrigin`);
      let label = "";
      for (let i = 0; i < LABEL_RETRIES; i++) {
        label = generatePreviewLabel(this.labelBytes);
        if (!this.entries.has(hash(label))) break;
        label = "";
      }
      if (!label) throw new Error("could not allocate a unique preview label");
      secret = label;
      const built = binding.buildOrigin(label);
      preview = { tier: binding.tier, ...built, label, ancestors: [...binding.ancestors] };
    }

    const key = hash(secret);
    const entry: Entry = {
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
      ...preview,
    };
    this.entries.set(key, entry);
    if (entry.originHost) this.byOriginHost.set(hash(entry.originHost), key);
    this.ensureSweeper();
    // Evict within the minting principal first, so a mint loop cannot push out
    // another user's active preview capabilities.
    const who = entry.minterKey;
    const mine = [...this.entries].filter(([, e]) => e.minterKey === who);
    for (let i = 0; i < mine.length - MAX_TOKENS_PER_PRINCIPAL; i++) this.remove(mine[i][0], "evicted");
    while (this.entries.size > MAX_TOKENS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest, "evicted");
    }
    return {
      token: secret,
      tokenId,
      expiresAt: now + maxMs,
      policy,
      tier: entry.tier,
      origin: entry.origin,
      originHost: entry.originHost,
      poolPort: entry.poolPort,
      reused: false,
    };
  }

  /**
   * Validate a LEGACY `/live/<id>/~c/<token>/` token for `targetId`. A hit extends the idle expiry.
   * A missing, unknown, wrong-target, expired or no-longer-live token returns `null` — the
   * caller cannot tell which. Origin-bound entries (tiers 1-4) never validate here: their label has
   * the token's shape but must not open a `/live/` path.
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
    if (!entry || entry.tier !== "legacy" || entry.targetId !== targetId) return null;
    const now = this.now();
    const expired = this.expiryReason(entry, now);
    if (expired) {
      this.remove(key, expired);
      return null;
    }
    if (!this.isTargetLive(entry.targetId) || !this.isPrincipalLive(entry.principal)) {
      this.remove(key, "revoked");
      return null;
    }
    // Bound to the local machine: a leaked local token is useless from anywhere else.
    // Refused, not deleted — the genuine local holder keeps a working token.
    if (entry.localBound && ctx && !ctx.genuinelyLocal) return null;
    entry.lastUsedAt = now;
    return grantOf(entry);
  }

  /**
   * Look an origin-bound entry up by `hash(label)` and the request's canonical Host (D2, D3).
   * The Host must equal `entry.originHost` exactly (no tier crossing, no port crossing); a tier-1
   * or local-bound entry is served only to a genuinely local peer (`peerLocal`). A hit extends the
   * idle expiry. `expired` is reported only while the entry still exists between expiry and sweep;
   * afterwards the entry is gone and the answer is `unknown` (no tombstones, Q25).
   */
  lookupByHost(labelHash: string, canonicalHost: string, peerLocal: boolean): HostLookup {
    const entry = this.entries.get(labelHash);
    if (!entry || entry.tier === "legacy" || entry.tier === 3 || !entry.originHost) return { ok: false, reason: "unknown" };
    const now = this.now();
    const expired = this.expiryReason(entry, now);
    if (expired) {
      this.remove(labelHash, expired);
      return { ok: false, reason: "expired" };
    }
    if (!this.isTargetLive(entry.targetId) || !this.isPrincipalLive(entry.principal)) {
      this.remove(labelHash, "revoked");
      return { ok: false, reason: "unknown" };
    }
    if (canonicalHost !== entry.originHost) {
      const want = splitCanonicalHost(entry.originHost);
      const got = splitCanonicalHost(canonicalHost);
      return { ok: false, reason: want.hostname === got.hostname ? "wrong-port" : "wrong-host" };
    }
    if ((entry.tier === 1 || entry.localBound) && !peerLocal) return { ok: false, reason: "wrong-host" };
    entry.lastUsedAt = now;
    return { ok: true, grant: grantOf(entry) };
  }

  /** Tier 3: the live entry bound to pool `port`, or `null`. Does not touch. */
  findByPoolPort(port: number): LiveCapabilityGrant | null {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.tier !== 3 || e.poolPort !== port) continue;
      const expired = this.expiryReason(e, now);
      if (expired) {
        this.remove(key, expired);
        return null;
      }
      return grantOf(e);
    }
    return null;
  }

  /** Is `canonicalHost` the origin host of a live (unexpired) entry? The dynamic admission set; never enumerates labels. */
  isAdmittedHost(canonicalHost: string): boolean {
    const key = this.byOriginHost.get(hash(canonicalHost));
    const e = key ? this.entries.get(key) : undefined;
    return !!e && !this.expiryReason(e, this.now());
  }

  /** The live capability behind a non-secret `tokenId`, or `null` (expired / unknown). Does not extend idle. */
  findByTokenId(tokenId: string): LiveCapabilityGrant | null {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.tokenId !== tokenId) continue;
      const expired = this.expiryReason(e, now);
      if (expired) {
        this.remove(key, expired);
        return null;
      }
      return grantOf(e);
    }
    return null;
  }

  /**
   * Extend a capability's idle expiry (keepalive) without a request through its path.
   * Only the minting principal may: `minterKey` must equal the entry's. Never
   * extends past the absolute lifetime. Returns whether a live capability was touched.
   */
  touch(tokenId: string, minterKey: string): boolean {
    const now = this.now();
    for (const [key, e] of this.entries) {
      if (e.tokenId !== tokenId) continue;
      if (e.minterKey !== minterKey) return false;
      const expired = this.expiryReason(e, now);
      if (expired) {
        this.remove(key, expired);
        return false;
      }
      if (!this.isTargetLive(e.targetId) || !this.isPrincipalLive(e.principal)) {
        this.remove(key, "revoked");
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

  /** Revoke every capability whose record matches `pred`. Returns how many died. Never exposes a secret. */
  revokeWhere(
    pred: (e: Readonly<{ kind: LiveTargetKind; policy: LivePolicy; mintExposure: LiveExposure; targetId: string }>) => boolean,
    reason: CapabilityDeleteReason = "revoked",
  ): number {
    let n = 0;
    for (const [key, e] of [...this.entries]) {
      if (pred(e)) {
        this.remove(key, reason);
        n++;
      }
    }
    return n;
  }

  revokeByTarget(targetId: string): void {
    for (const [key, e] of [...this.entries]) if (e.targetId === targetId) this.remove(key, "revoked");
  }

  revokeByDevice(deviceId: string): void {
    for (const [key, e] of [...this.entries]) if (e.principal.deviceId === deviceId) this.remove(key, "revoked");
  }

  revokeBySessionKey(sessionKey: string): void {
    for (const [key, e] of [...this.entries]) if (e.principal.sessionKey === sessionKey) this.remove(key, "revoked");
  }

  /**
   * Delete the entry bound to pool `port` (its listener errored or closed outside the store's control,
   * Q36). The next mint reallocates; no rebind, so no zombie entry holds a listener-cap slot.
   */
  revokeByPoolPort(port: number, reason: CapabilityDeleteReason = "listener-error"): void {
    for (const [key, e] of [...this.entries]) if (e.tier === 3 && e.poolPort === port) this.remove(key, reason);
  }

  /**
   * Reconcile with the resolved preview-origin config (D12, Q8): `enabled:false` revokes every
   * origin-bound entry (`disabled`); otherwise an entry whose `originHost` no longer matches its
   * tier's current resolved config is revoked (`config-changed`). Legacy entries are untouched.
   */
  reconcilePreviewConfig(cfg: ResolvedPreviewOrigins): number {
    let n = 0;
    for (const [key, e] of [...this.entries]) {
      if (e.tier === "legacy") continue;
      if (!cfg.enabled) {
        this.remove(key, "disabled");
        n++;
      } else if (!entryMatchesConfig(e, cfg)) {
        this.remove(key, "config-changed");
        n++;
      }
    }
    return n;
  }

  /** Delete everything (dashboard close) and stop the sweeper. */
  close(reason: CapabilityDeleteReason = "shutdown"): void {
    for (const key of [...this.entries.keys()]) this.remove(key, reason);
    this.stopSweeper();
  }

  /** Count of live capabilities (tests, diagnostics). Never exposes a secret or its hash. */
  size(): number {
    return this.entries.size;
  }

  /** Size of the dynamic admission index (tests, leak soak). */
  admittedHostCount(): number {
    return this.byOriginHost.size;
  }

  /** Live per-viewer allow-once sets (tests, leak soak). */
  allowOnceSize(): number {
    return this.allowOnce.size;
  }

  /** True when no stored key equals the plaintext secret (hash-only storage check). */
  holdsPlaintext(token: string): boolean {
    return this.entries.has(token) || this.byOriginHost.has(token);
  }

  /** `max` / `idle` when the entry's lifetime is over, else `null`. */
  private expiryReason(e: Entry, now: number): "max" | "idle" | null {
    if (now - e.mintedAt >= e.maxMs) return "max";
    if (now - e.lastUsedAt >= e.idleMs) return "idle";
    return null;
  }

  /**
   * Delete one entry from every index, THEN run the hook: a hook that throws or mints leaves a
   * consistent store (X6). Exactly once per entry.
   */
  private remove(key: string, reason: CapabilityDeleteReason): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    if (e.originHost) {
      const hk = hash(e.originHost);
      if (this.byOriginHost.get(hk) === key) this.byOriginHost.delete(hk);
    }
    try {
      this.onDelete?.(e, reason);
    } catch (err) {
      console.error(redactCapability(`[live-preview] onDelete hook failed reason=${reason}: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (this.entries.size === 0) this.stopSweeper();
  }

  private sweep(now: number): void {
    for (const [key, e] of [...this.entries]) {
      const reason = this.expiryReason(e, now);
      if (reason) this.remove(key, reason);
    }
    const cfg = this.getPreviewConfig?.();
    if (cfg) this.reconcilePreviewConfig(cfg);
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(this.now()), this.sweepIntervalMs);
    this.sweeper.unref?.();
  }

  private stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = undefined;
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
  tier: e.tier,
  ...(e.origin ? { origin: e.origin } : {}),
  ...(e.originHost ? { originHost: e.originHost } : {}),
  ...(e.poolPort !== undefined ? { poolPort: e.poolPort } : {}),
  ancestors: [...e.ancestors],
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
      genuinelyLocal: isLocallyTrusted({ ip: request.ip ?? "", headers: request.headers ?? {} }),
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
