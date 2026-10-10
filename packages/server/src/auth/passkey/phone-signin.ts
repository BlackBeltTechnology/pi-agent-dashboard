/**
 * Sign-in-with-phone requests (design D5).
 *
 * The desktop calls `start` and gets three distinct secrets-by-role:
 *  - `requestId` — the desktop's poll handle; never leaves the desktop.
 *  - `approvalToken` — rides the QR (URL fragment) to the phone; lets the
 *    phone VIEW and APPROVE/DENY, never collect the session.
 *  - `shortCode` — 40-bit typed fallback for `approvalToken`, rate-limited
 *    per client key and globally.
 *
 * States: pending → approved{sub} | rejected | expired. Approval is
 * single-use: the first successful desktop poll consumes the request.
 * TTL 5 min. Outstanding requests are bounded (unauthenticated `start`):
 * ≤3 pending per client key, ≤1000 overall.
 *
 * In-memory only: a restart drops pending requests (they are 5-min, cheap to
 * restart). See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";
import { logPasskey } from "./passkey-log.js";
import type { RequesterView } from "./requester.js";

const PHONE_REQUEST_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_PENDING = 1000;
/** Pending requests per client key — one flooder cannot exhaust the global cap for everyone. */
const MAX_PENDING_PER_CLIENT = 3;
/** Failed short-code lookups per client key per window. */
const MAX_FAILS_PER_CLIENT = 5;
/** Failed short-code lookups across all clients per window. */
const MAX_FAILS_GLOBAL = 50;
const FAIL_WINDOW_MS = 60_000;
/** Hard cap on tracked client keys (the global counter still applies). */
const MAX_FAIL_KEYS = 1000;

/** Crockford base32 (no I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type State = "pending" | "approved" | "rejected" | "expired";

interface PhoneRequest {
  requestId: string;
  approvalToken: string;
  shortCode: string;
  requester: RequesterView;
  createdAt: number;
  expiresAt: number;
  state: State;
  sub?: string;
  /** Rate-limit key of the requesting desktop. */
  clientKey: string;
}

export type PollResult =
  | { status: "pending" | "rejected" | "expired" | "unknown" }
  | { status: "approved"; sub: string };

function makeShortCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i]! & 31];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Normalise user-typed input: drop separators/spaces, uppercase, I/L→1, O→0. */
function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}

export class PhoneSigninManager {
  private readonly byRequest = new Map<string, PhoneRequest>();
  private readonly byToken = new Map<string, PhoneRequest>();
  private readonly byCode = new Map<string, PhoneRequest>();
  private readonly fails = new Map<string, { n: number; windowStart: number }>();
  private globalFails = { n: 0, windowStart: 0 };
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly maxPending: number;

  constructor(opts: { now?: () => number; log?: (line: string) => void; maxPending?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((l) => console.log(l));
    this.maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING;
  }

  private drop(r: PhoneRequest): void {
    this.byRequest.delete(r.requestId);
    this.byToken.delete(r.approvalToken);
    this.byCode.delete(r.shortCode);
  }

  /** Mark expired requests; forget terminal ones older than their TTL. */
  private sweep(): void {
    const t = this.now();
    for (const r of this.byRequest.values()) {
      if (r.state === "pending" && r.expiresAt <= t) {
        r.state = "expired";
        logPasskey("phone_expired", r.requestId, this.log);
      }
      // Keep terminal rows one extra TTL so the desktop's poll can read them.
      if (r.state !== "pending" && r.expiresAt + PHONE_REQUEST_TTL_MS <= t) this.drop(r);
    }
  }

  start(requester: RequesterView, clientKey: string): { requestId: string; approvalToken: string; shortCode: string; expiresAt: number } | null {
    this.sweep();
    const pending = [...this.byRequest.values()].filter((r) => r.state === "pending");
    if (pending.length >= this.maxPending) return null;
    if (pending.filter((r) => r.clientKey === clientKey).length >= MAX_PENDING_PER_CLIENT) return null;
    let shortCode = makeShortCode();
    while (this.byCode.has(shortCode)) shortCode = makeShortCode();
    const createdAt = this.now();
    const r: PhoneRequest = {
      requestId: crypto.randomBytes(16).toString("hex"),
      approvalToken: crypto.randomBytes(32).toString("base64url"),
      shortCode,
      requester,
      createdAt,
      expiresAt: createdAt + PHONE_REQUEST_TTL_MS,
      state: "pending",
      clientKey,
    };
    this.byRequest.set(r.requestId, r);
    this.byToken.set(r.approvalToken, r);
    this.byCode.set(r.shortCode, r);
    logPasskey("phone_pending", r.requestId, this.log);
    return { requestId: r.requestId, approvalToken: r.approvalToken, shortCode, expiresAt: r.expiresAt };
  }

  /** Desktop poll. `approved` is returned exactly once (single-use). */
  poll(requestId: unknown): PollResult {
    this.sweep();
    const r = typeof requestId === "string" ? this.byRequest.get(requestId) : undefined;
    if (!r) return { status: "unknown" };
    if (r.state === "approved" && r.sub) {
      this.drop(r);
      return { status: "approved", sub: r.sub };
    }
    return { status: r.state === "approved" ? "unknown" : r.state };
  }

  /** Phone view of a PENDING request, or null. */
  view(approvalToken: unknown): { requester: RequesterView; expiresAt: number; shortCode: string } | null {
    this.sweep();
    const r = typeof approvalToken === "string" ? this.byToken.get(approvalToken) : undefined;
    if (!r || r.state !== "pending") return null;
    return { requester: { ...r.requester }, expiresAt: r.expiresAt, shortCode: r.shortCode };
  }

  private failKey(clientKey: string): boolean {
    const t = this.now();
    if (t - this.globalFails.windowStart > FAIL_WINDOW_MS) this.globalFails = { n: 0, windowStart: t };
    let f = this.fails.get(clientKey);
    if (!f || t - f.windowStart > FAIL_WINDOW_MS) {
      f = { n: 0, windowStart: t };
      this.fails.set(clientKey, f);
      if (this.fails.size > MAX_FAIL_KEYS) {
        for (const [k, v] of this.fails) if (t - v.windowStart > FAIL_WINDOW_MS) this.fails.delete(k);
        // Still full (spoofed client keys inside one window): evict oldest.
        for (const k of this.fails.keys()) {
          if (this.fails.size <= MAX_FAIL_KEYS) break;
          if (k !== clientKey) this.fails.delete(k);
        }
      }
    }
    return f.n >= MAX_FAILS_PER_CLIENT || this.globalFails.n >= MAX_FAILS_GLOBAL;
  }

  /** Typed short code → approval token. Rate-limited on failures. */
  lookupCode(code: unknown, clientKey: string): { ok: true; approvalToken: string } | { ok: false; error: "invalid" | "rate_limited" } {
    this.sweep();
    if (this.failKey(clientKey)) return { ok: false, error: "rate_limited" };
    const norm = normaliseCode(code);
    const r = norm ? this.byCode.get(norm) : undefined;
    if (!r || r.state !== "pending") {
      this.fails.get(clientKey)!.n += 1;
      this.globalFails.n += 1;
      return { ok: false, error: "invalid" };
    }
    return { ok: true, approvalToken: r.approvalToken };
  }

  approve(approvalToken: unknown, sub: string): { ok: true } | { ok: false; error: "invalid" | "expired" } {
    const r = typeof approvalToken === "string" ? this.byToken.get(approvalToken) : undefined;
    if (!r) return { ok: false, error: "invalid" };
    if (r.state === "pending" && r.expiresAt <= this.now()) {
      r.state = "expired";
      logPasskey("phone_expired", r.requestId, this.log);
    }
    if (r.state === "expired") return { ok: false, error: "expired" };
    if (r.state !== "pending") return { ok: false, error: "invalid" };
    r.state = "approved";
    r.sub = sub;
    // The phone's token and code are spent; only the desktop poll remains.
    this.byToken.delete(r.approvalToken);
    this.byCode.delete(r.shortCode);
    logPasskey("phone_approved", r.requestId, this.log);
    return { ok: true };
  }

  deny(approvalToken: unknown): { ok: true } | { ok: false; error: "invalid" } {
    const r = typeof approvalToken === "string" ? this.byToken.get(approvalToken) : undefined;
    if (!r || r.state !== "pending" || r.expiresAt <= this.now()) return { ok: false, error: "invalid" };
    r.state = "rejected";
    this.byToken.delete(r.approvalToken);
    this.byCode.delete(r.shortCode);
    logPasskey("phone_denied", r.requestId, this.log);
    return { ok: true };
  }
}
