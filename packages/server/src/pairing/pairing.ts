/**
 * QR / copy-string device pairing (D6, D12).
 *
 * Flow:
 *  1. Dashboard mints a short-lived (~300s) one-time pairing code + payload
 *     `{ v, id, code, urls[] }` (QR + copy-string).
 *  2. A device REDEEMS the code → creates a PENDING device with a
 *     server-generated numeric confirmation code shown on BOTH the device and
 *     the dashboard. Redemption does NOT consume the code (premature redemption
 *     cannot lock out the legitimate device). At most ONE pending device per
 *     code (redemption flood cannot exhaust memory / flood approval prompts).
 *  3. The operator APPROVES by TYPING the confirmation code shown on the
 *     physical device into the dashboard (active compare-and-match, not a
 *     one-click approve). Only on approval is the code consumed and an opaque
 *     bearer token minted + recorded in the registry.
 *
 * The approval endpoint requires a genuine authenticated browser session and
 * must NOT honor the loopback/tunnel exemption (enforced at the route layer).
 */
import crypto from "node:crypto";
import type { PairingProvenance } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { INVISIBLE_OR_SEPARATOR } from "@blackbelt-technology/pi-dashboard-shared/terminal-safe.js";
import {
  defaultTierForSource,
  isTier,
  type Tier,
} from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { KnockOutcome } from "./knock-admission.js";
import type { PairedDeviceRegistry, PairedDeviceView } from "./paired-devices.js";

/** Current pairing protocol version (D9). */
export const PAIRING_PROTOCOL_VERSION = 1;

/** Versions this server can pair with (highest mutually supported wins). */
export const SUPPORTED_PAIRING_VERSIONS = [1];

/**
 * Test-only: is `url` a loopback http origin the e2e harness may pair over?
 * Gated by `PI_E2E_SEED` — never true in a normal/prod server. localhost /
 * 127.0.0.1 over http is a genuine browser secure context (crypto.subtle runs),
 * so the Playwright/Docker harness exercises the real handshake without TLS.
 * See change: make-pairing-qr-camera-scannable.
 */
function isTestLoopbackOrigin(url: string): boolean {
  return (
    process.env.PI_E2E_SEED === "1" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)
  );
}

// ~300s one-time pairing code: long enough to copy the deep link into another
// browser. Still single-use, fragment-only, and gated by the typed 8-digit
// confirm code (D12). Mirrored by the client countdown (GatewayPairQR.tsx
// PAIRING_CODE_TTL_MS), so keep the two in step.
const CODE_TTL_MS = 300_000;
const CONFIRM_CODE_DIGITS = 8; // ~26.5 bits; short window + lockout.
const MAX_REDEEM_ATTEMPTS = 10; // per code, before lockout.
const MAX_APPROVE_ATTEMPTS = 5; // wrong-confirm-code attempts before lockout.
/** Grace after expiry before the pushed-expiry timer fires (D4b). */
const EXPIRY_TIMER_SLACK_MS = 50;
/** How long a denied entry stays pollable as `rejected` (mirrors approve's window). */
const RESOLVED_POLL_WINDOW_MS = 30_000;
/** Redeemer-metadata bounds (D4) — untrusted display text only. */
const MAX_UA_CHARS = 256;
const MAX_HOST_CHARS = 253;
const MAX_ADDR_CHARS = 64;
/** Requester-name cap in UTF-8 bytes — mirrors approve-pending's 1..64-byte label rule (D16). */
const MAX_REQUESTER_NAME_BYTES = 64;

/**
 * Raw redeemer request context as the route layer sees it. Every field is
 * attacker-controlled: bounded here, rendered as text only, never used for a
 * decision, never logged (D4/D7).
 */
export interface RedeemMeta {
  userAgent?: string;
  host?: string;
  remoteAddress?: string;
  /** Raw `X-Forwarded-For` header; only the first hop is kept. */
  forwardedFor?: string;
  /**
   * Holder declaration from the redeem / knock body. Only the exact string
   * `"browser"` counts (anything else = no declaration): it makes the issued
   * bearer expiring. Never displayed, never logged.
   * See change: harden-auth-credentials (D5).
   */
  holder?: unknown;
}

/** Operator-facing view of one pending device — never carries a code (R5). */
export interface PendingDeviceView {
  pendingId: string;
  /** How the device entered the flow. Clients treat an absent value as `qr`. */
  provenance: PairingProvenance;
  /** Knock only: bounded, untrusted, display text. Never an authorization input. */
  requesterName?: string;
  /** Knock only: the request arrived over a connection without TLS. */
  unencrypted?: boolean;
  userAgent?: string;
  viaHost?: string;
  remoteAddress?: string;
  forwardedFor?: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
}

export interface PairingPayload {
  /** Protocol version. */
  v: number;
  /** Server identity fingerprint (pinned by the client). */
  id: string;
  /** One-time pairing code. */
  code: string;
  /** Publicly-trusted wss/https-reachable base URLs (D14). */
  urls: string[];
}

interface PairingCodeEntry {
  code: string;
  v: number;
  expiresAt: number;
  redeemAttempts: number;
  /** At most one pending device per code. */
  pending: PendingDevice | null;
  /** Pushed-expiry timer for the live pending device (D4b). */
  timer?: ReturnType<typeof setTimeout>;
  /** Present only for a device-initiated knock; the code is then internal and never returned. */
  knock?: { sourceKey: string; unencrypted: boolean; requesterName?: string };
}

interface PendingDevice {
  pendingId: string;
  confirmCode: string;
  label: string;
  createdAt: number;
  approveAttempts: number;
  /** Set once approved; the device polls to collect it. */
  issuedToken: string | null;
  /** The device declared `holder:"browser"` at redeem / knock time. */
  browserHolder: boolean;
  /** Registry id of the row minted at approval (poll reads its expiry). */
  deviceId?: string;
  /** Set once an operator denied it; the code is dead (D3). */
  rejected: boolean;
  userAgent?: string;
  viaHost?: string;
  remoteAddress?: string;
  forwardedFor?: string;
}

/**
 * Requester-name normaliser (design D16): non-string → absent; strip
 * {@link INVISIBLE_OR_SEPARATOR}, trim, truncate to <= 64 UTF-8 bytes on
 * a code-point boundary; empty → absent. Never refuses a knock.
 */
function normalizeRequesterName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(INVISIBLE_OR_SEPARATOR, "").trim();
  let out = "";
  let bytes = 0;
  for (const ch of cleaned) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > MAX_REQUESTER_NAME_BYTES) break;
    out += ch;
    bytes += n;
  }
  out = out.trim();
  return out.length === 0 ? undefined : out;
}

function bound(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t.slice(0, max);
}

/** First 8 chars of a pendingId — the only identifier ever logged (D7). */
function shortId(pendingId: string): string {
  return pendingId.slice(0, 8);
}

export type RedeemResult =
  | { ok: true; pendingId: string; confirmCode: string }
  | { ok: false; error: "invalid_code" | "expired" | "rate_limited" };

export type ApproveResult =
  | { ok: true; device: PairedDeviceView }
  | { ok: false; error: "mismatch"; attemptsLeft: number }
  | { ok: false; error: "invalid_code" | "no_pending" | "locked_out" | "expired" };

export type KnockResult =
  | { ok: true; pendingId: string; confirmCode: string; expiresAt: number };

export interface KnockRequest {
  /** Admission's source key (full peer address) — stored for the cooldown callback. */
  sourceKey: string;
  /** Raw requester name; normalised here. */
  name?: unknown;
  unencrypted: boolean;
  meta: RedeemMeta;
}

export type DenyResult = { ok: true } | { ok: false; error: "no_pending" };

export type PollResult =
  | { status: "pending" }
  | { status: "approved"; token: string; expiresAt?: number }
  | { status: "rejected" }
  | { status: "unknown" };

/** Generate a numeric confirmation code with leading-zero padding. */
function makeConfirmCode(): string {
  // crypto.randomInt is uniform over [0, max).
  const max = 10 ** CONFIRM_CODE_DIGITS;
  return String(crypto.randomInt(0, max)).padStart(CONFIRM_CODE_DIGITS, "0");
}

export interface PairingManagerDeps {
  registry: PairedDeviceRegistry;
  /** Server identity fingerprint (payload `id`). */
  getFingerprint: () => string;
  /** Compute the currently-reachable, publicly-trusted URLs (D14). */
  getReachableUrls: () => string[];
  /** Overridable clock for tests. */
  now?: () => number;
}

export class PairingManager {
  private readonly deps: PairingManagerDeps;
  private readonly now: () => number;
  private codes = new Map<string, PairingCodeEntry>();
  private listeners = new Set<() => void>();
  private resolvedListeners = new Set<(sourceKey: string, outcome: KnockOutcome) => void>();

  constructor(deps: PairingManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Subscribe to pending-set changes (add / approve / deny / lockout / expire).
   * Fired AFTER state commits, carrying nothing — callers re-read via
   * `listPending()` (D1). Returns an unsubscribe.
   */
  onPendingChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Subscribe to knock resolutions (denied / locked_out / approved / expired),
   * carrying the entry's `sourceKey`. QR redemptions never fire it. Returns an
   * unsubscribe. See change: add-lan-knock-pairing (D12).
   */
  onKnockResolved(cb: (sourceKey: string, outcome: KnockOutcome) => void): () => void {
    this.resolvedListeners.add(cb);
    return () => this.resolvedListeners.delete(cb);
  }

  private emitKnockResolved(entry: PairingCodeEntry, outcome: KnockOutcome): void {
    if (!entry.knock) return;
    for (const cb of this.resolvedListeners) {
      try {
        cb(entry.knock.sourceKey, outcome);
      } catch {
        // A listener must never break the pairing state machine.
      }
    }
  }

  /**
   * Knocks an operator can still act on. Compares `expiresAt` itself: `isLive`
   * ignores expiry until `sweep()` runs, so an expired-unswept knock would
   * otherwise hold a slot. A resolved knock that is still pollable is NOT live.
   */
  liveKnocks(): Array<{ sourceKey: string; pendingId: string; expiresAt: number }> {
    const t = this.now();
    const out: Array<{ sourceKey: string; pendingId: string; expiresAt: number }> = [];
    for (const entry of this.codes.values()) {
      if (entry.knock && PairingManager.isLive(entry.pending) && entry.expiresAt >= t) {
        out.push({ sourceKey: entry.knock.sourceKey, pendingId: entry.pending.pendingId, expiresAt: entry.expiresAt });
      }
    }
    return out;
  }

  private emitChanged(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // A listener must never break the pairing state machine.
      }
    }
  }

  /** A pending device an operator can still act on (not approved/denied/locked). */
  private static isLive(p: PendingDevice | null): p is PendingDevice {
    return !!p && !p.issuedToken && !p.rejected && p.approveAttempts < MAX_APPROVE_ATTEMPTS;
  }

  private clearTimer(entry: PairingCodeEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  /** Arm the pushed-expiry timer for this entry's live pending device (D4b). */
  private armTimer(entry: PairingCodeEntry): void {
    this.clearTimer(entry);
    const delay = Math.max(0, entry.expiresAt - this.now()) + EXPIRY_TIMER_SLACK_MS;
    const t = setTimeout(() => {
      entry.timer = undefined;
      this.sweep();
    }, delay);
    t.unref?.();
    entry.timer = t;
  }

  private sweep(): void {
    const t = this.now();
    let changed = false;
    for (const [code, entry] of this.codes) {
      // Delete once past expiry. approve() extends expiresAt by 30s so an
      // approved device still has a window to poll its token; after that the
      // entry is swept whether or not it was ever polled (no unbounded growth
      // for approved-but-unpolled devices).
      if (entry.expiresAt < t) {
        const wasLive = PairingManager.isLive(entry.pending);
        this.expireEntry(entry);
        this.codes.delete(code);
        if (wasLive) this.emitKnockResolved(entry, "expired");
        if (wasLive) changed = true;
      }
    }
    if (changed) this.emitChanged();
  }

  /** Clear the timer and log the expiry of a live pending device (no emit). */
  private expireEntry(entry: PairingCodeEntry): void {
    this.clearTimer(entry);
    if (PairingManager.isLive(entry.pending)) {
      console.log(`[pairing] expired id=${shortId(entry.pending.pendingId)}`);
    }
  }

  /** Stop every pushed-expiry timer and drop listeners (server shutdown / tests). */
  dispose(): void {
    for (const entry of this.codes.values()) this.clearTimer(entry);
    this.listeners.clear();
    this.resolvedListeners.clear();
  }

  /** Compute the reachable, publicly-trusted URLs, deduplicated. */
  reachableUrls(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of this.deps.getReachableUrls()) {
      const url = raw.trim().replace(/\/+$/, "");
      // D4/D14: only secure origins (https/wss). Never advertise plain http.
      // EXCEPTION (test-only, PI_E2E_SEED): a loopback http origin is a genuine
      // browser secure context (crypto.subtle works), so the Playwright/Docker
      // e2e harness can run the FULL real pairing handshake without TLS. Every
      // non-localhost origin stays TLS-gated. See change: make-pairing-qr-camera-scannable.
      if (!/^https:\/\//i.test(url) && !/^wss:\/\//i.test(url) && !isTestLoopbackOrigin(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  /**
   * Mint a payload with a fresh one-time code. Called from the authenticated
   * dashboard. Returns null when no reachable endpoint exists (caller shows the
   * "start a tunnel / enable TLS" empty state).
   */
  createPayload(v = PAIRING_PROTOCOL_VERSION): PairingPayload | null {
    this.sweep();
    const urls = this.reachableUrls();
    if (urls.length === 0) return null;
    const negotiated = SUPPORTED_PAIRING_VERSIONS.includes(v)
      ? v
      : Math.max(...SUPPORTED_PAIRING_VERSIONS);
    const code = crypto.randomBytes(16).toString("base64url");
    this.codes.set(code, {
      code,
      v: negotiated,
      expiresAt: this.now() + CODE_TTL_MS,
      redeemAttempts: 0,
      pending: null,
    });
    return { v: negotiated, id: this.deps.getFingerprint(), code, urls };
  }

  private newPending(meta: RedeemMeta): PendingDevice {
    return {
      pendingId: crypto.randomUUID(),
      confirmCode: makeConfirmCode(),
      label: "device",
      createdAt: this.now(),
      approveAttempts: 0,
      issuedToken: null,
      browserHolder: meta.holder === "browser",
      rejected: false,
      userAgent: bound(meta.userAgent, MAX_UA_CHARS),
      viaHost: bound(meta.host, MAX_HOST_CHARS),
      remoteAddress: bound(meta.remoteAddress, MAX_ADDR_CHARS),
      forwardedFor: bound(meta.forwardedFor?.split(",")[0], MAX_ADDR_CHARS),
    };
  }

  /**
   * Device-initiated request ("knock"): mints an INTERNAL code entry exactly like
   * `createPayload()` (the code is never returned or listed) and fills its single
   * pending slot like `redeem()`, so approve / deny / lockout / expiry / poll are
   * the shared lifecycle. Admission (gates, limits) is the caller's job — see
   * `admitKnock`. See change: add-lan-knock-pairing (D1).
   */
  knock(req: KnockRequest): KnockResult {
    this.sweep();
    const code = crypto.randomBytes(16).toString("base64url");
    const pending = this.newPending(req.meta);
    const expiresAt = this.now() + CODE_TTL_MS;
    const entry: PairingCodeEntry = {
      code,
      v: PAIRING_PROTOCOL_VERSION,
      expiresAt,
      redeemAttempts: 0,
      pending,
      knock: { sourceKey: req.sourceKey, unencrypted: req.unencrypted, requesterName: normalizeRequesterName(req.name) },
    };
    this.codes.set(code, entry);
    this.armTimer(entry);
    console.log(`[pairing] knock admitted id=${shortId(pending.pendingId)}`);
    this.emitChanged();
    return { ok: true, pendingId: pending.pendingId, confirmCode: pending.confirmCode, expiresAt };
  }

  /**
   * Device redeems a code → creates/refreshes the single pending slot and
   * returns the confirmation code to display on the device. Does NOT consume
   * the code (D12). Restarts the code's TTL from redeem time so the operator
   * approval countdown begins when the device presents itself, not at QR mint.
   */
  redeem(code: string, meta: RedeemMeta = {}): RedeemResult {
    // NB: do not sweep before lookup — an expired code must still be
    // distinguishable as `expired` rather than swept to `invalid_code`.
    const entry = this.codes.get(code);
    if (!entry) return { ok: false, error: "invalid_code" };
    // A code that already completed a pairing (token issued) is consumed and
    // cannot start a new pending flow.
    // A denied code is equally dead (D3): no device can redeem it again.
    if (entry.pending?.issuedToken || entry.pending?.rejected) return { ok: false, error: "invalid_code" };
    if (entry.expiresAt < this.now()) return { ok: false, error: "expired" };
    if (entry.redeemAttempts >= MAX_REDEEM_ATTEMPTS) {
      return { ok: false, error: "rate_limited" };
    }
    entry.redeemAttempts += 1;

    // At most ONE active pending device per code — a fresh redemption
    // overwrites the slot (bounded memory, no approval-prompt flood).
    const pending = this.newPending(meta);
    entry.pending = pending;
    // Restart the approval window at redeem time. The one-time code's TTL is
    // minted with the QR, but the operator's read+type+approve countdown must
    // begin when the device actually presents itself — otherwise a QR left on
    // screen leaves the phone only the leftover seconds before sweep() deletes
    // the entry and poll() returns "unknown" ("Pairing expired" on the device).
    entry.expiresAt = this.now() + CODE_TTL_MS;
    this.armTimer(entry);
    console.log(`[pairing] pending id=${shortId(pending.pendingId)}`);
    this.emitChanged();
    return { ok: true, pendingId: pending.pendingId, confirmCode: pending.confirmCode };
  }

  /** List codes that have a pending (un-approved) device, for dashboard UX. */
  pendingForCode(code: string): { pendingId: string } | null {
    const entry = this.codes.get(code);
    if (entry?.pending && !entry.pending.issuedToken && !entry.pending.rejected) {
      return { pendingId: entry.pending.pendingId };
    }
    return null;
  }

  /**
   * Operator-facing list of pending devices an operator can still act on,
   * oldest first. NEVER includes the pairing code or the confirmation code (R5).
   */
  listPending(): PendingDeviceView[] {
    this.sweep();
    const out: PendingDeviceView[] = [];
    for (const entry of this.codes.values()) {
      if (PairingManager.isLive(entry.pending)) out.push(PairingManager.toView(entry, entry.pending));
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  private static toView(entry: PairingCodeEntry, p: PendingDevice): PendingDeviceView {
    const view: PendingDeviceView = {
      pendingId: p.pendingId,
      provenance: entry.knock ? "knock" : "qr",
      createdAt: p.createdAt,
      expiresAt: entry.expiresAt,
      attemptsLeft: MAX_APPROVE_ATTEMPTS - p.approveAttempts,
    };
    if (p.userAgent !== undefined) view.userAgent = p.userAgent;
    if (p.viaHost !== undefined) view.viaHost = p.viaHost;
    if (p.remoteAddress !== undefined) view.remoteAddress = p.remoteAddress;
    if (p.forwardedFor !== undefined) view.forwardedFor = p.forwardedFor;
    if (entry.knock) {
      if (entry.knock.requesterName !== undefined) view.requesterName = entry.knock.requesterName;
      view.unencrypted = entry.knock.unencrypted;
    }
    return view;
  }

  private findByPendingId(pendingId: string): PairingCodeEntry | undefined {
    for (const entry of this.codes.values()) {
      if (entry.pending?.pendingId === pendingId) return entry;
    }
    return undefined;
  }

  /**
   * Approve by pendingId (the app-wide dialog never holds the pairing code).
   * Delegates to `approve()` so compare, lockout budget, expiry and tier are
   * shared, not reimplemented (D2).
   */
  approvePending(pendingId: string, typedConfirmCode: string, label?: string, tier?: Tier): ApproveResult {
    const entry = this.findByPendingId(pendingId);
    if (!entry) return { ok: false, error: "no_pending" };
    return this.approve(entry.code, typedConfirmCode, label, tier);
  }

  /**
   * Operator denies a pending device: no token is ever issued, the pairing code
   * is dead, and the device's next poll reports `rejected` (D3).
   */
  deny(pendingId: string): DenyResult {
    const entry = this.findByPendingId(pendingId);
    const pending = entry?.pending ?? null;
    // Only a live request can be denied: an approved, denied or locked-out one
    // is already resolved (a locked-out code stays re-redeemable, D8).
    if (!entry || !PairingManager.isLive(pending)) return { ok: false, error: "no_pending" };
    if (entry.expiresAt < this.now()) {
      this.sweep();
      return { ok: false, error: "no_pending" };
    }
    pending.rejected = true;
    this.clearTimer(entry);
    // Keep the entry briefly so the device's poll can learn `rejected`.
    entry.expiresAt = this.now() + RESOLVED_POLL_WINDOW_MS;
    console.log(`[pairing] denied id=${shortId(pending.pendingId)}`);
    this.emitKnockResolved(entry, "denied");
    this.emitChanged();
    return { ok: true };
  }

  /**
   * Operator approval by typing the confirmation code shown on the device.
   * On a match: consume the pairing code, mint a bearer token, record the
   * device. Wrong codes are rate-limited then locked out. MUST be called only
   * from an authenticated browser session (route-layer responsibility).
   */
  approve(code: string, typedConfirmCode: string, label?: string, tier?: Tier): ApproveResult {
    const entry = this.codes.get(code);
    if (!entry) return { ok: false, error: "invalid_code" };
    // Reject an expired entry explicitly — the server is the authority on code
    // validity (the operator UI no longer gates on its advisory countdown). This
    // must hold even when no poll()/createPayload() sweep has run, so mirror the
    // sweep's cleanup and drop the entry here.
    if (entry.expiresAt < this.now()) {
      this.sweep();
      return { ok: false, error: "expired" };
    }
    const pending = entry.pending;
    if (!pending || pending.issuedToken || pending.rejected) return { ok: false, error: "no_pending" };
    if (pending.approveAttempts >= MAX_APPROVE_ATTEMPTS) {
      return { ok: false, error: "locked_out" };
    }
    pending.approveAttempts += 1;

    const a = Buffer.from(pending.confirmCode);
    const b = Buffer.from(String(typedConfirmCode));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) {
      const attemptsLeft = MAX_APPROVE_ATTEMPTS - pending.approveAttempts;
      if (attemptsLeft <= 0) {
        // Budget exhausted by THIS failure → the request is blocked; it leaves
        // the operator list and its expiry timer is no longer needed.
        this.clearTimer(entry);
        console.log(`[pairing] locked_out id=${shortId(pending.pendingId)}`);
        this.emitKnockResolved(entry, "locked_out");
        this.emitChanged();
        return { ok: false, error: "locked_out" };
      }
      console.log(`[pairing] mismatch id=${shortId(pending.pendingId)} left=${attemptsLeft}`);
      return { ok: false, error: "mismatch", attemptsLeft };
    }

    // Match → consume the code (single successful pairing) and issue the token.
    // The approving browser chooses the tier; absent, the pairing source
    // default applies (`operate` — a phone browser drives the whole dashboard,
    // D1/D8).
    const { device, token } = this.deps.registry.add(
      label ?? pending.label,
      "pairing",
      isTier(tier) ? tier : defaultTierForSource("pairing"),
      pending.browserHolder ? "browser" : undefined,
    );
    pending.issuedToken = token;
    pending.deviceId = device.id;
    // Drop the code so it can never be reused; keep the pending slot so the
    // device's next poll collects the token, then it self-expires via sweep.
    entry.expiresAt = this.now() + RESOLVED_POLL_WINDOW_MS;
    this.clearTimer(entry);
    console.log(`[pairing] approved id=${shortId(pending.pendingId)} device=${String(device.id).slice(0, 8)}`);
    this.emitKnockResolved(entry, "approved");
    this.emitChanged();
    return { ok: true, device };
  }

  /** Expiry (epoch ms) for a collected token's row, converting it when `holder:"browser"` was declared late. */
  private browserExpiry(pending: PendingDevice, holder: unknown): number | undefined {
    if (pending.deviceId === undefined) return undefined;
    return this.deps.registry.browserExpiryFor(pending.deviceId, pending.browserHolder || holder === "browser");
  }

  /**
   * Device polls for its token after redemption. A `holder:"browser"` on the
   * poll body (exact string only) also counts when it was not declared at
   * redeem: the still-uncollected token's row becomes an expiring browser row.
   * `expiresAt` (epoch ms) is returned only for an expiring row.
   */
  poll(pendingId: string, holder?: unknown): PollResult {
    this.sweep();
    for (const entry of this.codes.values()) {
      if (entry.pending?.pendingId === pendingId) {
        if (entry.pending.issuedToken) {
          const token = entry.pending.issuedToken;
          const expiresAt = this.browserExpiry(entry.pending, holder);
          // One-shot: clear so the token isn't re-served, drop the code.
          this.codes.delete(entry.code);
          return expiresAt === undefined ? { status: "approved", token } : { status: "approved", token, expiresAt };
        }
        if (entry.pending.rejected) return { status: "rejected" };
        return { status: "pending" };
      }
    }
    return { status: "unknown" };
  }
}

/** The content-free pending-change hint (D1) — no identifier, address, UA or code. */
const PAIR_PENDING_CHANGED = { type: "pair_pending_changed" } as const;

/**
 * Wire the manager's change notifications to a browser broadcast. Every
 * emission sends a FRESH content-free frame (never a shared mutable object).
 */
export function wirePendingHint(
  mgr: PairingManager,
  broadcast: (msg: { type: "pair_pending_changed" }) => void,
): () => void {
  return mgr.onPendingChanged(() => broadcast({ ...PAIR_PENDING_CHANGED }));
}
