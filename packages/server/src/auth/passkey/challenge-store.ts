/**
 * Stateless, HMAC-signed WebAuthn challenge slots (design D5 / Risks B).
 *
 * `issue(kind, data)` returns an opaque id `<b64url(JSON{k,d,e})>.<hmac>` the
 * browser echoes back. Nothing is stored at issue time, so an anonymous flood
 * of `.../options` calls can neither grow memory nor evict a real
 * user's in-flight challenge (the DoS a bounded FIFO store had).
 *
 * `open(id, kind)` verifies the MAC (per-process random key — ids die with the
 * process), the ceremony kind, the expiry, and that the id was not consumed.
 * `consume(id)` marks it used and is called ONLY after a successful
 * verification: replay is refused, a failed attempt does not burn the
 * challenge, and the used-set grows only with real ceremonies (bounded by TTL
 * purge). The check-then-consume is synchronous, so two concurrent successful
 * verifications of one assertion cannot both consume it.
 *
 * `data` is visible to the client (signed, not encrypted): never put a secret
 * in it. See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";

const CHALLENGE_TTL_MS = 5 * 60_000;

interface Payload<T> {
  k: string;
  d: T;
  e: number;
}

export class SignedChallenges<T> {
  private readonly key = crypto.randomBytes(32);
  /** consumed id → its expiry (purged once expired). */
  private readonly used = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = CHALLENGE_TTL_MS,
  ) {}

  private mac(body: string): string {
    return crypto.createHmac("sha256", this.key).update(body).digest("base64url");
  }

  issue(kind: string, data: T): string {
    const body = Buffer.from(JSON.stringify({ k: kind, d: data, e: this.now() + this.ttlMs } satisfies Payload<T>)).toString("base64url");
    return `${body}.${this.mac(body)}`;
  }

  private parse(id: unknown): Payload<T> | null {
    if (typeof id !== "string" || id.length > 4096) return null;
    const dot = id.indexOf(".");
    if (dot <= 0) return null;
    const body = id.slice(0, dot);
    const given = Buffer.from(id.slice(dot + 1));
    const want = Buffer.from(this.mac(body));
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload<T>;
    } catch {
      return null;
    }
  }

  /** Verified slot data, or null (bad MAC, wrong kind, expired, consumed). */
  open(id: unknown, kind: string): T | null {
    const p = this.parse(id);
    if (!p || p.k !== kind || p.e <= this.now() || this.used.has(id as string)) return null;
    return p.d;
  }

  /** Mark used after a successful ceremony. False when already consumed. */
  consume(id: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.used) if (exp <= t) this.used.delete(k);
    if (this.used.has(id)) return false;
    const p = this.parse(id);
    this.used.set(id, p ? p.e : t + this.ttlMs);
    return true;
  }

  /** Test seam: consumed ids currently tracked. */
  usedCount(): number {
    return this.used.size;
  }
}
