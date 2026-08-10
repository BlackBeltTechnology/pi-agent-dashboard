/**
 * QR / copy-string device pairing (D6, D12).
 *
 * Flow:
 *  1. Dashboard mints a short-lived (~60s) one-time pairing code + payload
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

const CODE_TTL_MS = 60_000; // ~60s one-time pairing code.
const CONFIRM_CODE_DIGITS = 8; // ~26.5 bits; short window + lockout.
const MAX_REDEEM_ATTEMPTS = 10; // per code, before lockout.
const MAX_APPROVE_ATTEMPTS = 5; // wrong-confirm-code attempts before lockout.

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
}

interface PendingDevice {
  pendingId: string;
  confirmCode: string;
  label: string;
  createdAt: number;
  approveAttempts: number;
  /** Set once approved; the device polls to collect it. */
  issuedToken: string | null;
}

export type RedeemResult =
  | { ok: true; pendingId: string; confirmCode: string }
  | { ok: false; error: "invalid_code" | "expired" | "rate_limited" };

export type ApproveResult =
  | { ok: true; device: PairedDeviceView }
  | { ok: false; error: "invalid_code" | "no_pending" | "mismatch" | "locked_out" | "expired" };

export type PollResult =
  | { status: "pending" }
  | { status: "approved"; token: string }
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

  constructor(deps: PairingManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private sweep(): void {
    const t = this.now();
    for (const [code, entry] of this.codes) {
      // Delete once past expiry. approve() extends expiresAt by 30s so an
      // approved device still has a window to poll its token; after that the
      // entry is swept whether or not it was ever polled (no unbounded growth
      // for approved-but-unpolled devices).
      if (entry.expiresAt < t) this.codes.delete(code);
    }
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

  /**
   * Device redeems a code → creates/refreshes the single pending slot and
   * returns the confirmation code to display on the device. Does NOT consume
   * the code (D12). Restarts the code's TTL from redeem time so the operator
   * approval countdown begins when the device presents itself, not at QR mint.
   */
  redeem(code: string): RedeemResult {
    // NB: do not sweep before lookup — an expired code must still be
    // distinguishable as `expired` rather than swept to `invalid_code`.
    const entry = this.codes.get(code);
    if (!entry) return { ok: false, error: "invalid_code" };
    // A code that already completed a pairing (token issued) is consumed and
    // cannot start a new pending flow.
    if (entry.pending?.issuedToken) return { ok: false, error: "invalid_code" };
    if (entry.expiresAt < this.now()) return { ok: false, error: "expired" };
    if (entry.redeemAttempts >= MAX_REDEEM_ATTEMPTS) {
      return { ok: false, error: "rate_limited" };
    }
    entry.redeemAttempts += 1;

    // At most ONE active pending device per code — a fresh redemption
    // overwrites the slot (bounded memory, no approval-prompt flood).
    const pending: PendingDevice = {
      pendingId: crypto.randomUUID(),
      confirmCode: makeConfirmCode(),
      label: "device",
      createdAt: this.now(),
      approveAttempts: 0,
      issuedToken: null,
    };
    entry.pending = pending;
    // Restart the approval window at redeem time. The one-time code's TTL is
    // minted with the QR, but the operator's read+type+approve countdown must
    // begin when the device actually presents itself — otherwise a QR left on
    // screen leaves the phone only the leftover seconds before sweep() deletes
    // the entry and poll() returns "unknown" ("Pairing expired" on the device).
    entry.expiresAt = this.now() + CODE_TTL_MS;
    return { ok: true, pendingId: pending.pendingId, confirmCode: pending.confirmCode };
  }

  /** List codes that have a pending (un-approved) device, for dashboard UX. */
  pendingForCode(code: string): { pendingId: string } | null {
    const entry = this.codes.get(code);
    if (entry?.pending && !entry.pending.issuedToken) {
      return { pendingId: entry.pending.pendingId };
    }
    return null;
  }

  /**
   * Operator approval by typing the confirmation code shown on the device.
   * On a match: consume the pairing code, mint a bearer token, record the
   * device. Wrong codes are rate-limited then locked out. MUST be called only
   * from an authenticated browser session (route-layer responsibility).
   */
  approve(code: string, typedConfirmCode: string, label?: string): ApproveResult {
    const entry = this.codes.get(code);
    if (!entry) return { ok: false, error: "invalid_code" };
    // Reject an expired entry explicitly — the server is the authority on code
    // validity (the operator UI no longer gates on its advisory countdown). This
    // must hold even when no poll()/createPayload() sweep has run, so mirror the
    // sweep's cleanup and drop the entry here.
    if (entry.expiresAt < this.now()) {
      this.codes.delete(code);
      return { ok: false, error: "expired" };
    }
    const pending = entry.pending;
    if (!pending || pending.issuedToken) return { ok: false, error: "no_pending" };
    if (pending.approveAttempts >= MAX_APPROVE_ATTEMPTS) {
      return { ok: false, error: "locked_out" };
    }
    pending.approveAttempts += 1;

    const a = Buffer.from(pending.confirmCode);
    const b = Buffer.from(String(typedConfirmCode));
    const match = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!match) return { ok: false, error: "mismatch" };

    // Match → consume the code (single successful pairing) and issue the token.
    const { device, token } = this.deps.registry.add(label ?? pending.label);
    pending.issuedToken = token;
    // Drop the code so it can never be reused; keep the pending slot so the
    // device's next poll collects the token, then it self-expires via sweep.
    entry.expiresAt = this.now() + 30_000;
    return { ok: true, device };
  }

  /** Device polls for its token after redemption. */
  poll(pendingId: string): PollResult {
    this.sweep();
    for (const entry of this.codes.values()) {
      if (entry.pending?.pendingId === pendingId) {
        if (entry.pending.issuedToken) {
          const token = entry.pending.issuedToken;
          // One-shot: clear so the token isn't re-served, drop the code.
          this.codes.delete(entry.code);
          return { status: "approved", token };
        }
        return { status: "pending" };
      }
    }
    return { status: "unknown" };
  }
}
