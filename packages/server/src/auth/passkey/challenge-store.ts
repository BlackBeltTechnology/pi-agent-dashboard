/**
 * Single-use, short-lived WebAuthn challenge slots (design D5 / Risks B).
 *
 * `issue(kind, data)` returns an opaque id the browser echoes back; `take`
 * removes it on first use (so a replayed assertion finds nothing), checks the
 * ceremony kind, and refuses an expired slot. Bounded: the oldest slot is
 * evicted when full, so an unauthenticated flood cannot grow memory.
 *
 * See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";

const CHALLENGE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX = 1000;

interface Slot<T> {
  kind: string;
  data: T;
  expiresAt: number;
}

export class ChallengeStore<T> {
  private readonly slots = new Map<string, Slot<T>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = CHALLENGE_TTL_MS,
    private readonly max = DEFAULT_MAX,
  ) {}

  issue(kind: string, data: T): string {
    const t = this.now();
    for (const [id, s] of this.slots) if (s.expiresAt <= t) this.slots.delete(id);
    while (this.slots.size >= this.max) {
      const oldest = this.slots.keys().next().value;
      if (oldest === undefined) break;
      this.slots.delete(oldest);
    }
    const id = crypto.randomBytes(16).toString("hex");
    this.slots.set(id, { kind, data, expiresAt: t + this.ttlMs });
    return id;
  }

  take(id: unknown, kind: string): T | null {
    if (typeof id !== "string") return null;
    const slot = this.slots.get(id);
    if (!slot || slot.kind !== kind) return null;
    this.slots.delete(id);
    if (slot.expiresAt <= this.now()) return null;
    return slot.data;
  }
}
