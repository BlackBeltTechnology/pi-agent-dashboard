/**
 * The pending access-request registry (design D4, D8, D9, D11; tasks 4.1-4.4,
 * 2b.6).
 *
 * One bounded registry correlates a denial, the prompt it may raise, and the
 * first reply. Modelled on `ResyncRequesterRegistry` (record / take / forget,
 * TTL, take-once) with two deliberate departures:
 *
 *   - **Overflow fails closed.** The precedent evicts its oldest entry; here a
 *     full registry refuses the NEW denial (no entry, no prompt) and never
 *     evicts a live one, because a live entry may hold a suspended request.
 *   - **Expiry is surfaced, never silent.** An expired HELD entry still has a
 *     request waiting on it, so every removal-by-time goes through `onExpire`,
 *     where the caller answers that request with its original denial.
 *
 * The registry owns only its OWN volume controls (capacity, per-channel share,
 * backoff, rates, concurrent dialogs). Eligibility, Host-admission mode, the
 * prompting switch and audience are decided by the caller at the denial site,
 * from the live request (design D6), and passed in as a `precondition`. Every
 * outcome returns the denial the guard would have returned today; nothing here
 * can produce an allow on its own.
 *
 * Keys are `(plane, subject)`, never the bare subject. The subject arrives
 * already normalised by its plane (design D5).
 *
 * See change: add-access-grant-dialog.
 */
import { randomUUID } from "node:crypto";
import type {
  AccessPlaneId,
  GrantSettlementMode,
  GrantVerdict,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

/** Resolved constants (design D4, D9). */
export const GRANT_ENTRY_TTL_MS = 120_000;
export const GRANT_REGISTRY_CAPACITY = 64;
export const GRANT_BACKOFF_MS = 120_000;
export const GRANT_PLANE_PROMPTS_PER_MINUTE = 5;
export const GRANT_MAX_CONCURRENT_DIALOGS = 2;
/** 20% of capacity (design D9). */
export const GRANT_CHANNEL_MAX_ENTRIES = 12;
/** Per-channel dialog budget, split by trust (design D9, resolved). */
const GRANT_CHANNEL_MAX_DIALOGS = 1;
const GRANT_DEFERRED_CHANNEL_PROMPTS_PER_MINUTE = 1;
/**
 * Most entries all DEFERRED planes together may hold (25% of capacity). Remote
 * sources are untrusted and cheap to rotate; this keeps the rest of the
 * registry for held prompts the operator raised (design D9, resolved).
 */
export const GRANT_DEFERRED_MAX_ENTRIES = 16;
const RATE_WINDOW_MS = 60_000;
/** How many settled prompt ids are remembered to tell a duplicate from junk. */
const SETTLED_MEMORY = GRANT_REGISTRY_CAPACITY * 4;

/** Ladder conditions the CALLER decides, from the live request (D3, D6). */
type PreconditionReason = "ineligible" | "report-mode" | "disabled" | "no-audience";
/** Why a denial got no entry at all. */
export type RefusalReason = "capacity" | "channel-share" | "deferred-share";
/** Why an entry was recorded but not prompted, by the registry's own controls. */
export type FloodReason =
  | "backoff"
  | "plane-rate"
  | "channel-rate"
  | "concurrent-cap"
  | "channel-concurrent";

/** The denial being recorded. `subject` is already plane-normalised. */
export interface DenialInput {
  plane: AccessPlaneId;
  subject: string;
  mode: GrantSettlementMode;
  /**
   * Who is asking: the capability's socket id on a held plane, the remote
   * source on a deferred one. The per-channel bounds key on this.
   */
  channel: string;
  /** The grant store an allow-always answer would write. */
  store: string;
  /** Offered ancestors (filesystem ladder); a verdict may name one of these. */
  ancestors?: readonly string[];
}

/** Whether the caller's ladder permits a prompt at all. */
export type Precondition = { promptable: true } | { promptable: false; reason: PreconditionReason };

export interface PendingGrant {
  promptId: string;
  plane: AccessPlaneId;
  subject: string;
  mode: GrantSettlementMode;
  channel: string;
  store: string;
  ancestors: readonly string[];
  recordedAt: number;
  expiresAt: number;
  prompted: boolean;
  /** Why this entry was not prompted, when it was not. */
  suppressedBy?: PreconditionReason | FloodReason;
  /** How many denials coalesced into this entry. */
  hits: number;
}

export type RecordOutcome =
  | { kind: "prompt"; entry: PendingGrant }
  | { kind: "recorded"; entry: PendingGrant; reason: PreconditionReason | FloodReason }
  | { kind: "joined"; entry: PendingGrant }
  | { kind: "refused"; reason: RefusalReason };

export type SettleOutcome =
  | {
      ok: true;
      entry: PendingGrant;
      verdict: GrantVerdict;
      /** The subject the verdict applies to: the denied one or an offered rung. */
      subject: string;
      /** Set when the verdict names an offered ancestor instead (E48). */
      widenedFrom?: string;
    }
  | { ok: false; reason: "malformed" | "duplicate" | "unknown" | "expired" | "unoffered-subject" };

export type TransitionName =
  | "recorded"
  | "joined"
  | "prompted"
  | "degraded"
  | "flooded"
  | "settled"
  | "refused"
  | "expired"
  | "aborted";

/** One diagnosable transition (design D11). */
export interface GrantTransition {
  transition: TransitionName;
  plane: AccessPlaneId;
  subject: string;
  mode: GrantSettlementMode;
  promptId?: string;
  reason?: PreconditionReason | FloodReason | RefusalReason | "unoffered-subject";
  verdict?: GrantVerdict;
  /** The store an allow-always verdict wrote. */
  store?: string;
}

export interface GrantRegistryStats {
  recorded: number;
  prompted: number;
  settled: number;
  expired: number;
  aborted: number;
  duplicates: number;
  malformed: number;
  degraded: Partial<Record<PreconditionReason | RefusalReason, number>>;
  flooded: Partial<Record<FloodReason | "channel-share" | "deferred-share", number>>;
}

export interface PendingGrantRegistryOptions {
  /** Transition sink. Defaults to one `[access-grant]` line on stderr. */
  onTransition?: (t: GrantTransition) => void;
  /** Called for every entry removed by expiry, so a held request gets its denial. */
  onExpire?: (entry: PendingGrant) => void;
}

const VERDICTS: ReadonlySet<string> = new Set(["allow-once", "allow-always", "deny"]);

/** Render a transition as one log line. Subjects are JSON-quoted: they can be attacker-shaped. */
export function formatTransition(t: GrantTransition): string {
  const label =
    t.transition === "degraded" || t.transition === "flooded" || t.transition === "refused"
      ? `${t.transition}:${t.reason}`
      : t.transition === "settled"
        ? `settled:${t.verdict}`
        : t.transition;
  const store = t.store ? ` store=${t.store}` : "";
  return `[access-grant] ${label} plane=${t.plane} subject=${JSON.stringify(t.subject)} mode=${t.mode}${store}`;
}

const keyOf = (plane: string, subject: string): string => `${plane}\u0000${subject}`;

export class PendingGrantRegistry {
  private readonly byId = new Map<string, PendingGrant>();
  private readonly byKey = new Map<string, string>();
  /** key → epoch ms until which a settled key does not re-prompt. */
  private readonly backoffUntil = new Map<string, number>();
  /** Prompt timestamps per plane, and per (plane, channel), for the rate windows. */
  private readonly planePrompts = new Map<string, number[]>();
  private readonly channelPrompts = new Map<string, number[]>();
  private readonly settledIds: string[] = [];
  private readonly stats: GrantRegistryStats = {
    recorded: 0,
    prompted: 0,
    settled: 0,
    expired: 0,
    aborted: 0,
    duplicates: 0,
    malformed: 0,
    degraded: {},
    flooded: {},
  };
  private readonly emit: (t: GrantTransition) => void;
  private readonly onExpire?: (entry: PendingGrant) => void;

  constructor(opts: PendingGrantRegistryOptions = {}) {
    this.emit = opts.onTransition ?? ((t) => console.error(formatTransition(t)));
    this.onExpire = opts.onExpire;
  }

  get size(): number {
    return this.byId.size;
  }

  /** Pending entries, oldest first (the Access surface's pending list). */
  list(now: number = Date.now()): PendingGrant[] {
    this.expire(now);
    return [...this.byId.values()];
  }

  get(promptId: string): PendingGrant | undefined {
    return this.byId.get(promptId);
  }

  /** A copy of the counters (for `/api/health`). */
  snapshotStats(): GrantRegistryStats {
    return { ...this.stats, degraded: { ...this.stats.degraded }, flooded: { ...this.stats.flooded } };
  }

  /**
   * Record a denial. At most one entry, and so at most one dialog, per
   * `(plane, subject)`; a repeat joins the existing entry.
   */
  record(input: DenialInput, precondition: Precondition, now: number = Date.now()): RecordOutcome {
    this.expire(now);
    const key = keyOf(input.plane, input.subject);

    const existingId = this.byKey.get(key);
    const existing = existingId ? this.byId.get(existingId) : undefined;
    if (existing) {
      existing.hits += 1;
      this.transition("joined", existing);
      // A still-unprompted entry is re-evaluated: the condition that suppressed
      // it (backoff, a full dialog slot, an ineligible first requester) may have
      // cleared. Still at most one dialog per key: a prompted entry never
      // prompts twice.
      if (!existing.prompted && precondition.promptable && !this.floodReason(existing, key, now)) {
        return this.promote(existing, now);
      }
      return { kind: "joined", entry: existing };
    }

    // Refusals: no entry at all. Neither may evict a live entry.
    if (this.byId.size >= GRANT_REGISTRY_CAPACITY) return this.refuse(input, "capacity");
    if (this.countChannelEntries(input.channel) >= GRANT_CHANNEL_MAX_ENTRIES) {
      return this.refuse(input, "channel-share");
    }
    if (input.mode === "deferred" && this.countDeferredEntries() >= GRANT_DEFERRED_MAX_ENTRIES) {
      return this.refuse(input, "deferred-share");
    }

    const entry: PendingGrant = {
      promptId: randomUUID(),
      plane: input.plane,
      subject: input.subject,
      mode: input.mode,
      channel: input.channel,
      store: input.store,
      ancestors: [...(input.ancestors ?? [])],
      recordedAt: now,
      expiresAt: now + GRANT_ENTRY_TTL_MS,
      prompted: false,
      hits: 1,
    };
    this.byId.set(entry.promptId, entry);
    this.byKey.set(key, entry.promptId);
    this.stats.recorded += 1;
    this.transition("recorded", entry);

    if (!precondition.promptable) {
      entry.suppressedBy = precondition.reason;
      this.stats.degraded[precondition.reason] = (this.stats.degraded[precondition.reason] ?? 0) + 1;
      this.transition("degraded", entry, { reason: precondition.reason });
      return { kind: "recorded", entry, reason: precondition.reason };
    }

    const flood = this.floodReason(entry, key, now);
    if (flood) {
      entry.suppressedBy = flood;
      this.stats.flooded[flood] = (this.stats.flooded[flood] ?? 0) + 1;
      this.transition("flooded", entry, { reason: flood });
      return { kind: "recorded", entry, reason: flood };
    }

    return this.promote(entry, now);
  }

  /** Mark an entry prompted and charge the rate windows. */
  private promote(entry: PendingGrant, now: number): RecordOutcome {
    entry.prompted = true;
    entry.suppressedBy = undefined;
    this.stats.prompted += 1;
    this.pushWindow(this.planePrompts, entry.plane, now);
    this.pushWindow(this.channelPrompts, keyOf(entry.plane, entry.channel), now);
    this.transition("prompted", entry);
    return { kind: "prompt", entry };
  }

  /**
   * Settle an entry from an untrusted `grant_response`. First well-formed
   * answer wins (take-once); anything else is discarded and counted (D8).
   */
  settle(response: unknown, now: number = Date.now()): SettleOutcome {
    const r = response as Record<string, unknown> | null;
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.promptId !== "string" ||
      typeof r.plane !== "string" ||
      typeof r.subject !== "string" ||
      typeof r.verdict !== "string" ||
      !VERDICTS.has(r.verdict)
    ) {
      this.stats.malformed += 1;
      return { ok: false, reason: "malformed" };
    }
    const verdict = r.verdict as GrantVerdict;

    const entry = this.byId.get(r.promptId);
    if (!entry) {
      if (this.settledIds.includes(r.promptId)) {
        this.stats.duplicates += 1;
        return { ok: false, reason: "duplicate" };
      }
      this.stats.malformed += 1;
      return { ok: false, reason: "unknown" };
    }
    if (now > entry.expiresAt) {
      this.expire(now);
      return { ok: false, reason: "expired" };
    }
    // A verdict must name the entry's own plane, and allow-once is meaningless
    // on a deferred plane: nothing is suspended for it to release.
    if (r.plane !== entry.plane || (verdict === "allow-once" && entry.mode === "deferred")) {
      this.stats.malformed += 1;
      return { ok: false, reason: "malformed" };
    }
    // Only the denied subject or an OFFERED rung. The entry stays pending: a
    // refused answer is not an answer (E47).
    if (r.subject !== entry.subject && !entry.ancestors.includes(r.subject)) {
      this.transition("refused", entry, { reason: "unoffered-subject" });
      return { ok: false, reason: "unoffered-subject" };
    }

    this.remove(entry);
    this.backoffUntil.set(keyOf(entry.plane, entry.subject), now + GRANT_BACKOFF_MS);
    this.settledIds.push(entry.promptId);
    if (this.settledIds.length > SETTLED_MEMORY) this.settledIds.shift();
    this.stats.settled += 1;
    this.transition("settled", entry, {
      verdict,
      store: verdict === "allow-always" ? entry.store : undefined,
    });
    return {
      ok: true,
      entry,
      verdict,
      subject: r.subject,
      widenedFrom: r.subject !== entry.subject ? entry.subject : undefined,
    };
  }

  /** Release an entry whose requester went away (client abort of a held request). */
  forget(promptId: string): PendingGrant | undefined {
    const entry = this.byId.get(promptId);
    if (!entry) return undefined;
    this.remove(entry);
    this.stats.aborted += 1;
    this.transition("aborted", entry);
    return entry;
  }

  /** Remove every expired entry, reporting each through `onExpire`. */
  expire(now: number = Date.now()): PendingGrant[] {
    const gone: PendingGrant[] = [];
    for (const entry of this.byId.values()) {
      if (now > entry.expiresAt) gone.push(entry);
    }
    for (const entry of gone) {
      this.remove(entry);
      this.stats.expired += 1;
      this.transition("expired", entry);
      this.onExpire?.(entry);
    }
    for (const [key, until] of this.backoffUntil) if (until <= now) this.backoffUntil.delete(key);
    return gone;
  }

  // ---------------------------------------------------------------------------

  /** Per-channel checks first, so starvation is attributed to the requester (E23). */
  private floodReason(entry: PendingGrant, key: string, now: number): FloodReason | undefined {
    const until = this.backoffUntil.get(key);
    if (until !== undefined && now < until) return "backoff";
    if (this.countChannelDialogs(entry.channel, entry) >= GRANT_CHANNEL_MAX_DIALOGS) return "channel-concurrent";
    if (this.countDialogs(entry) >= GRANT_MAX_CONCURRENT_DIALOGS) return "concurrent-cap";
    if (
      entry.mode === "deferred" &&
      this.windowCount(this.channelPrompts, keyOf(entry.plane, entry.channel), now) >=
        GRANT_DEFERRED_CHANNEL_PROMPTS_PER_MINUTE
    ) {
      return "channel-rate";
    }
    if (this.windowCount(this.planePrompts, entry.plane, now) >= GRANT_PLANE_PROMPTS_PER_MINUTE) return "plane-rate";
    return undefined;
  }

  private refuse(input: DenialInput, reason: RefusalReason): RecordOutcome {
    if (reason === "capacity") this.stats.degraded.capacity = (this.stats.degraded.capacity ?? 0) + 1;
    else this.stats.flooded[reason] = (this.stats.flooded[reason] ?? 0) + 1;
    this.emit({ transition: "refused", plane: input.plane, subject: input.subject, mode: input.mode, reason });
    return { kind: "refused", reason };
  }

  private remove(entry: PendingGrant): void {
    this.byId.delete(entry.promptId);
    const key = keyOf(entry.plane, entry.subject);
    if (this.byKey.get(key) === entry.promptId) this.byKey.delete(key);
  }

  private countChannelEntries(channel: string): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.channel === channel) n += 1;
    return n;
  }

  private countDeferredEntries(): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.mode === "deferred") n += 1;
    return n;
  }

  private countDialogs(except: PendingGrant): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.prompted && e !== except) n += 1;
    return n;
  }

  private countChannelDialogs(channel: string, except: PendingGrant): number {
    let n = 0;
    for (const e of this.byId.values()) if (e.prompted && e.channel === channel && e !== except) n += 1;
    return n;
  }

  private pushWindow(map: Map<string, number[]>, key: string, now: number): void {
    const list = map.get(key) ?? [];
    list.push(now);
    map.set(key, list);
  }

  private windowCount(map: Map<string, number[]>, key: string, now: number): number {
    const list = map.get(key);
    if (!list) return 0;
    while (list.length > 0 && now - list[0] >= RATE_WINDOW_MS) list.shift();
    if (list.length === 0) map.delete(key);
    return list.length;
  }

  private transition(
    name: TransitionName,
    entry: PendingGrant,
    extra: Pick<GrantTransition, "reason" | "verdict" | "store"> = {},
  ): void {
    this.emit({
      transition: name,
      plane: entry.plane,
      subject: entry.subject,
      mode: entry.mode,
      promptId: entry.promptId,
      ...extra,
    });
  }
}
