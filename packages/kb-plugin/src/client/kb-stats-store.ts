/**
 * Module-level per-cwd KB stats store — ONE shared state + ONE poll loop per
 * folder, subscribed by every `useKbStats(cwd)` consumer.
 *
 * Hoists the whole fetch/poll/pending/error state machine out of the hook so a
 * reindex triggered in the settings panel is observed live by the folder
 * section (and vice versa) without a remount or a page reload.
 *
 * Lifecycle (design D2):
 *   - first subscriber for a cwd → store fetches immediately (`loading` true);
 *   - a later subscriber       → retained snapshot served synchronously plus a
 *     background revalidate, COALESCED with any fetch already in flight;
 *   - last unsubscribe         → poll stopped; the in-flight fetch is NOT
 *     aborted (its result writes into the retained snapshot, which also makes
 *     StrictMode's subscribe/unsubscribe churn harmless) and the optimistic
 *     guard stays armed — bounded, and it self-clears `pending` WITHOUT
 *     fetching when it fires at zero subscribers.
 *   - the `Map<cwd, store>` entry is never evicted (a handful of scalars).
 *
 * Fetch ordering is epoch-guarded: a new non-poll epoch aborts/supersedes the
 * previous fetch and stale-epoch responses are discarded, so an out-of-order
 * poll/revalidate/refetch response can never overwrite newer state.
 *
 * `loading` tracks initial / revalidate / refetch epochs only — poll ticks
 * never toggle it, so a live walk does not flap the consumers' `busy` gate.
 *
 * The two error channels keep their existing semantics (see change:
 * fix-kb-index-feedback) but are now folder state shared by every consumer.
 * See change: fix-kb-card-refresh-and-shared-stats.
 *
 * Cwd refusal (`403 { error: "cwd not allowed" }`, typed `code:"cwd_not_allowed"`)
 * is DEFINITIVE, not a miss: it sets `denied`, stops polling, and clears both
 * error channels + `pending`. `beginPinWait()` arms a bounded `pinPending`
 * window (never `pending`, so reindex is not disabled in other consumers). A
 * 409 precondition refusal (`folder_missing` / `no_sources`) clears `pending`
 * and refetches instead of setting `reindexError`.
 * See change: kb-denied-folder-pin-state (design D2, D5, D11).
 */
import type { KbStats } from "../shared/kb-plugin-types.js";
import { fetchKbStats, reindexKb } from "./kb-api.js";

export const POLL_MS = 1000;
/** Consecutive `/stats` failures tolerated before giving up + surfacing `error`. */
export const MAX_POLL_MISSES = 3;
/**
 * Bounded guard after which an unacknowledged optimistic `pending` clears (and
 * refetches, when still observed) so a job that settled before the first poll
 * can never wedge a row on a permanent spinner.
 */
export const REINDEX_GUARD_MS = 4000;
/** Bounded wait after a Pin click for the `pinned_dirs_updated` refetch to admit the folder. */
export const PIN_GUARD_MS = 3000;

export interface KbStatsSnapshot {
  stats: KbStats | null;
  loading: boolean;
  /** `/stats` poll outage, surfaced only after MAX_POLL_MISSES consecutive misses. */
  error: string | null;
  /** The reindex trigger POST was rejected (no job started). */
  reindexError: string | null;
  /** Optimistic click acknowledgement — see {@link REINDEX_GUARD_MS}. */
  pending: boolean;
  /** The folder's KB requests were refused by the cwd guard (not an error; pin is the remedy). */
  denied: boolean;
  /** Server `reason` of the refusal — diagnostics only, never rendered. */
  deniedReason: string | null;
  /** A Pin was sent; waiting for admission — see {@link PIN_GUARD_MS}. */
  pinPending: boolean;
}

export const EMPTY_SNAPSHOT: KbStatsSnapshot = {
  stats: null,
  loading: false,
  error: null,
  reindexError: null,
  pending: false,
  denied: false,
  deniedReason: null,
  pinPending: false,
};

type FetchKind = "initial" | "revalidate" | "refetch" | "poll";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Typed-refusal discriminator (`kb-api.ts`): `code`, not `instanceof`. */
const codeOf = (e: unknown): string | undefined =>
  e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : undefined;
const isPreconditionCode = (c: string | undefined): boolean => c === "folder_missing" || c === "no_sources";

export class KbStatsStore {
  private snapshot: KbStatsSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private refs = 0;
  private epoch = 0;
  private ac: AbortController | null = null;
  private inFlight = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private guard: ReturnType<typeof setTimeout> | null = null;
  private pinGuard: ReturnType<typeof setTimeout> | null = null;
  private misses = 0;
  private initialized = false;
  private disposed = false;

  constructor(private readonly cwd: string) {}

  getSnapshot = (): KbStatsSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.refs += 1;
    // Deferred: starting a fetch mutates the snapshot (`loading`), which must
    // not notify while React is still inside its subscribe call.
    queueMicrotask(() => this.onSubscribed());
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners.delete(listener);
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this.stopPoll();
    };
  };

  /** Consumer-facing refetch (a mounted consumer asked for fresh stats). */
  refetch = (): void => {
    if (this.disposed) return;
    this.startFetch("refetch");
  };

  reindex = (): void => {
    if (this.disposed) return;
    // Defense-in-depth behind the consumers' `busy` guards: a reindex already
    // in flight must never produce a second POST from another surface.
    if (this.snapshot.pending || this.snapshot.stats?.indexing === true) return;
    this.update({ reindexError: null, error: null, pending: true });
    this.clearGuard();
    this.guard = setTimeout(() => {
      // No reject and no observed indexing:true — the job likely settled before
      // the first poll. Clear + (when still observed) refetch, never wedge.
      this.guard = null;
      this.update({ pending: false });
      this.refetchIfObserved();
    }, REINDEX_GUARD_MS);
    reindexKb(this.cwd)
      .then(() => this.refetchIfObserved()) // 202 → engage the /stats poll
      .catch((e) => {
        if (this.disposed) return;
        this.clearGuard();
        const code = codeOf(e);
        if (code === "cwd_not_allowed") return this.applyDenied(e);
        if (isPreconditionCode(code)) {
          // Folder missing / no sources: not a reindex failure (a Retry would
          // always 409) — fresh stats render the honest state instead.
          this.update({ pending: false });
          this.refetchIfObserved();
          return;
        }
        this.update({ pending: false, reindexError: message(e) });
      });
  };

  /**
   * A Pin was sent for this denied folder: show `pinPending` for at most
   * PIN_GUARD_MS. A `pinned_dirs_updated` refetch that succeeds clears it
   * earlier; on elapse it clears and (when observed) refetches once.
   */
  beginPinWait = (): void => {
    if (this.disposed || this.snapshot.pinPending || !this.snapshot.denied) return;
    this.update({ pinPending: true });
    this.pinGuard = setTimeout(() => {
      this.pinGuard = null;
      this.update({ pinPending: false });
      this.refetchIfObserved();
    }, PIN_GUARD_MS);
  };

  /** Test-only teardown hook (see {@link resetKbStatsStores}). */
  dispose(): void {
    this.disposed = true;
    this.stopPoll();
    this.clearGuard();
    this.clearPinGuard();
    this.listeners.clear();
    this.refs = 0;
  }

  // ── internals ───────────────────────────────────────────────────

  private onSubscribed(): void {
    if (this.disposed || this.refs === 0) return;
    if (!this.initialized) {
      this.initialized = true;
      this.startFetch("initial");
      return;
    }
    if (this.inFlight) return; // coalesced into the fetch already running
    this.startFetch("revalidate");
  }

  /** Internal refetch that never issues a request at zero subscribers. */
  private refetchIfObserved(): void {
    if (this.disposed || this.refs === 0) return;
    this.startFetch("refetch");
  }

  private startFetch(kind: FetchKind): void {
    // A poll tick NEVER stacks on a request still in flight: a slow or hung
    // `/stats` would otherwise accumulate one request per second. The next tick
    // after it settles resumes the loop.
    if (kind === "poll" && this.inFlight) return;
    if (kind !== "poll") {
      this.ac?.abort(); // supersede the in-flight epoch
      // Parity with the old effect body, which reset the miss run on every
      // mount / `nonce` refetch: a deliberate initial/revalidate/refetch starts
      // a FRESH consecutive-miss run, so a recovered outage gets the full
      // MAX_POLL_MISSES tolerance again instead of erroring on the next blip.
      this.misses = 0;
    }
    const epoch = ++this.epoch;
    const ac = new AbortController();
    this.ac = ac;
    this.inFlight = true;
    if (kind !== "poll") this.update({ loading: true, error: null });
    fetchKbStats(this.cwd, ac.signal)
      .then((s) => this.onStats(epoch, s))
      .catch((e) => this.onStatsError(epoch, e));
  }

  private onStats(epoch: number, s: KbStats): void {
    if (this.disposed || epoch !== this.epoch) return; // stale response
    this.inFlight = false;
    this.misses = 0; // a success resets the miss run
    // Real job now owns the spinner — hand off from the optimistic `pending`
    // in the SAME snapshot so `pending || indexing` never has a false/false gap.
    if (s.indexing) this.clearGuard();
    this.clearPinGuard(); // admitted — the pin wait (if any) is over
    this.update({
      stats: s,
      error: null,
      loading: false,
      denied: false,
      deniedReason: null,
      pinPending: false,
      ...(s.indexing ? { pending: false } : {}),
    });
    if (s.indexing) this.startPoll();
    else this.stopPoll();
  }

  private onStatsError(epoch: number, e: unknown): void {
    if (this.disposed || epoch !== this.epoch) return; // stale / aborted
    this.inFlight = false; // BEFORE the refusal branch, or revalidation wedges
    if (codeOf(e) === "cwd_not_allowed") {
      this.applyDenied(e); // definitive — never counts as a miss
      return;
    }
    this.misses += 1;
    if (this.misses >= MAX_POLL_MISSES) {
      // Genuine outage — give up and surface a persistent "stats unavailable".
      this.stopPoll();
      this.update({ error: message(e), loading: false });
      return;
    }
    // Transient miss: keep retrying (the spinner survives because `stats` is
    // left untouched). A lone initial-load blip schedules its own retry.
    this.update({ loading: false });
    this.startPoll();
  }

  /** Cwd refusal: definitive. Clears both error channels + optimism; stops polling. */
  private applyDenied(e: unknown): void {
    // Invalidate any OLDER stats response still in flight (e.g. a GET started
    // before a reindex POST established the denial): its late 200 must not clear
    // `denied` through `onStats`. `onSubscribed` reads `inFlight`, so reset it.
    this.ac?.abort();
    this.epoch += 1;
    this.inFlight = false;
    this.stopPoll();
    this.clearGuard();
    this.clearPinGuard();
    this.misses = 0;
    const reason = (e as { reason?: unknown }).reason;
    this.update({
      denied: true,
      deniedReason: typeof reason === "string" ? reason : null,
      loading: false,
      pending: false,
      pinPending: false,
      error: null,
      reindexError: null,
    });
  }

  private startPoll(): void {
    if (this.poll || this.refs === 0 || this.disposed) return;
    this.poll = setInterval(() => this.startFetch("poll"), POLL_MS);
  }

  private stopPoll(): void {
    if (!this.poll) return;
    clearInterval(this.poll);
    this.poll = null;
  }

  private clearPinGuard(): void {
    if (!this.pinGuard) return;
    clearTimeout(this.pinGuard);
    this.pinGuard = null;
  }

  private clearGuard(): void {
    if (!this.guard) return;
    clearTimeout(this.guard);
    this.guard = null;
  }

  /**
   * Commit a snapshot change. The object identity is load-bearing for
   * `useSyncExternalStore`: it is replaced ONLY when a field actually changes,
   * otherwise the hook re-render-loops.
   */
  private update(patch: Partial<KbStatsSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const prev = this.snapshot;
    if (
      next.stats === prev.stats &&
      next.loading === prev.loading &&
      next.error === prev.error &&
      next.reindexError === prev.reindexError &&
      next.pending === prev.pending &&
      next.denied === prev.denied &&
      next.deniedReason === prev.deniedReason &&
      next.pinPending === prev.pinPending
    ) {
      return;
    }
    this.snapshot = next;
    for (const l of [...this.listeners]) l();
  }
}

const stores = new Map<string, KbStatsStore>();

export function getKbStatsStore(cwd: string): KbStatsStore {
  let store = stores.get(cwd);
  if (!store) {
    store = new KbStatsStore(cwd);
    stores.set(cwd, store);
  }
  return store;
}

/**
 * Test-only: drop every store so module-singleton state never leaks between
 * tests. ALL `useKbStats` / section / panel tests must call this in `beforeEach`.
 */
export function resetKbStatsStores(): void {
  for (const store of stores.values()) store.dispose();
  stores.clear();
}
