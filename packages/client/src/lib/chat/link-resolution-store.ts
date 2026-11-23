/**
 * Keyed store behind transcript file-link pre-confirmation (design D1/D2 of rich-chat-links).
 *
 * A link that is settled (no running tool, no streaming text) AND in view `register`s itself; registrations are
 * collected into batches and resolved with one `POST /api/file/resolve-mentions` per session per flush window.
 * The store never touches React: `LinkResolutionProvider` adapts it (IntersectionObserver, session events) and
 * `FileLink` subscribes per key through `useSyncExternalStore`.
 *
 * Timing (the starting values of design D2):
 *  - flush 250 ms after the last registration, never later than 1 s after the first pending one, and never
 *    sooner than 1 s after the previous flush (design budget: at most 1 batch flush per second, test-plan P3);
 *  - at most {@link MAX_BATCH_ITEMS} items per request; the overflow waits for the next window;
 *  - a mention / toolCwd / reRooted over {@link MAX_FIELD_CHARS} is never sent (that link stays unknown);
 *  - a 429 retries with exponential back-off, 1 s → 30 s; any other failure leaves the links unknown;
 *  - an entry lives {@link CACHE_TTL_MS}; a later tool call of the session or a grant change drops it.
 *
 * Dropped entries that are still in view keep showing their previous state until the re-request lands (no flicker);
 * entries that are not in view are deleted. A response that was in flight when its session was invalidated is
 * discarded, so a result computed before the tool finished never overwrites a fresher one.
 */
import { ApiHttpError } from "../api/fetch-json.js";
import { type BatchMentionResult, resolveFileMentionsBatch } from "../api/resolve-mention-api.js";

export const MAX_BATCH_ITEMS = 200;
export const MAX_FIELD_CHARS = 1024;
export const CACHE_TTL_MS = 60_000;
const FLUSH_DEBOUNCE_MS = 250;
const FLUSH_MAX_WAIT_MS = 1000;
const FLUSH_MIN_INTERVAL_MS = 1000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

/** `window` event fired when the access grants change (a grant answered, or the access store edited). */
export const LINK_GRANTS_CHANGED_EVENT = "pi-dashboard:access-grants-changed";

/** Tell every mounted transcript that the grants changed, so gated / missing links are re-resolved. */
export function notifyAccessGrantsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LINK_GRANTS_CHANGED_EVENT));
}

/** Store key: `(sessionId, toolCwd, mention, reRooted?)`. */
export function makeLinkKey(sessionId: string, toolCwd: string | undefined, mention: string, reRooted?: string): string {
  return [sessionId, toolCwd ?? "", mention, reRooted ?? ""].join("\u0000");
}

/** What a link asks to have pre-confirmed. */
export interface LinkRequest {
  key: string;
  sessionId: string;
  cwd: string;
  mention: string;
  toolCwd?: string;
  reRooted?: string;
}

/** A cached, non-unknown state. An absent entry IS the unknown state. */
export interface LinkEntry extends Omit<BatchMentionResult, "state"> {
  state: Exclude<BatchMentionResult["state"], "unknown">;
}

interface Stored {
  entry: LinkEntry;
  expiresAt: number;
}

function isSendable(r: LinkRequest): boolean {
  return r.mention.length <= MAX_FIELD_CHARS && (r.toolCwd?.length ?? 0) <= MAX_FIELD_CHARS && (r.reRooted?.length ?? 0) <= MAX_FIELD_CHARS;
}

export class LinkResolutionStore {
  private readonly entries = new Map<string, Stored>();
  /** key → the link request and how many mounted, settled, in-view links hold it. */
  private readonly registered = new Map<string, { req: LinkRequest; count: number }>();
  private readonly pending = new Map<string, LinkRequest>();
  /** key → token of the request carrying it (an invalidation clears the mark, so a late reply cannot unmark a newer request). */
  private readonly inFlight = new Map<string, symbol>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly sessionGen = new Map<string, number>();
  private globalGen = 0;
  private firstPendingAt: number | null = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 0;
  private blockedUntil = 0;

  // --- React adapter surface ------------------------------------------------------------------------------

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(key);
    };
  }

  /** The cached state of `key`, or `undefined` (= unknown). Referentially stable until the entry changes. */
  getSnapshot(key: string): LinkEntry | undefined {
    return this.entries.get(key)?.entry;
  }

  // --- registration ---------------------------------------------------------------------------------------

  /** A link became settled and in view. Idempotent per link via a reference count; pair with {@link unregister}. */
  register(req: LinkRequest): void {
    if (!isSendable(req)) return;
    const held = this.registered.get(req.key);
    if (held) held.count++;
    else this.registered.set(req.key, { req, count: 1 });
    this.enqueueIfStale(req);
  }

  /** The link left the viewport, unmounted or stopped being settled. */
  unregister(key: string): void {
    const held = this.registered.get(key);
    if (!held) return;
    if (--held.count > 0) return;
    this.registered.delete(key);
    this.pending.delete(key);
  }

  /** Record a result for `key` (the flush path and, for tests, a direct seed). Notifies subscribers. */
  apply(key: string, result: BatchMentionResult): void {
    if (result.state === "unknown") return;
    const { state, ...rest } = result;
    this.entries.set(key, { entry: { state, ...rest }, expiresAt: Date.now() + CACHE_TTL_MS });
    this.notify(key);
    this.scheduleSweep();
  }

  // --- invalidation ---------------------------------------------------------------------------------------

  /** A tool call of `sessionId` completed (live event or stale-tool reconcile): its cached states may be wrong. */
  invalidateSession(sessionId: string): void {
    this.sessionGen.set(sessionId, (this.sessionGen.get(sessionId) ?? 0) + 1);
    this.drop((key) => this.sessionOf(key) === sessionId);
  }

  /** The access grants changed: every session's cached states may be wrong. */
  invalidateAll(): void {
    this.globalGen++;
    this.drop(() => true);
  }

  // --- internals ------------------------------------------------------------------------------------------

  private sessionOf(key: string): string {
    return key.slice(0, key.indexOf("\u0000"));
  }

  private drop(match: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) {
      if (!match(key)) continue;
      if (this.registered.has(key)) {
        const stored = this.entries.get(key) as Stored;
        stored.expiresAt = 0; // keep showing it until the re-request lands
      } else {
        this.entries.delete(key);
        this.notify(key);
      }
    }
    for (const key of [...this.inFlight.keys()]) if (match(key)) this.inFlight.delete(key);
    for (const [key, { req }] of this.registered) if (match(key)) this.enqueueIfStale(req);
  }

  private enqueueIfStale(req: LinkRequest): void {
    const stored = this.entries.get(req.key);
    if (stored && stored.expiresAt > Date.now()) return;
    if (this.inFlight.has(req.key) || this.pending.has(req.key)) return;
    this.pending.set(req.key, req);
    this.schedule();
  }

  private notify(key: string): void {
    for (const l of this.listeners.get(key) ?? []) l();
  }

  private schedule(): void {
    const now = Date.now();
    if (this.firstPendingAt === null) this.firstPendingAt = now;
    const due = Math.min(now + FLUSH_DEBOUNCE_MS, this.firstPendingAt + FLUSH_MAX_WAIT_MS);
    const delay = Math.max(0, due - now, this.lastFlushAt + FLUSH_MIN_INTERVAL_MS - now);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    this.flushTimer = null;
    const now = Date.now();
    if (this.blockedUntil > now) {
      this.flushTimer = setTimeout(() => this.flush(), this.blockedUntil - now);
      return;
    }
    this.firstPendingAt = null;
    this.lastFlushAt = now;
    const groups = new Map<string, LinkRequest[]>();
    let overflow = false;
    for (const [key, req] of this.pending) {
      const group = groups.get(req.sessionId) ?? [];
      if (group.length >= MAX_BATCH_ITEMS) {
        overflow = true;
        continue;
      }
      group.push(req);
      groups.set(req.sessionId, group);
      this.pending.delete(key);
    }
    if (overflow) this.schedule();
    for (const [sessionId, group] of groups) void this.send(sessionId, group);
  }

  private async send(sessionId: string, group: LinkRequest[]): Promise<void> {
    const token = Symbol("batch");
    for (const r of group) this.inFlight.set(r.key, token);
    const unmark = () => {
      for (const r of group) if (this.inFlight.get(r.key) === token) this.inFlight.delete(r.key);
    };
    const gens = `${this.globalGen}:${this.sessionGen.get(sessionId) ?? 0}`;
    let results: BatchMentionResult[];
    try {
      results = await resolveFileMentionsBatch(
        group[0].cwd,
        group.map(({ mention, toolCwd, reRooted }) => ({ mention, ...(toolCwd ? { toolCwd } : {}), ...(reRooted ? { reRooted } : {}) })),
      );
    } catch (err) {
      unmark();
      if (err instanceof ApiHttpError && err.status === 429) this.backOff(group);
      return; // anything else: the links stay unknown and a click resolves as before
    }
    const fresh = gens === `${this.globalGen}:${this.sessionGen.get(sessionId) ?? 0}`;
    this.backoffMs = 0;
    unmark();
    group.forEach((req, i) => {
      const r = results[i];
      if (fresh && r && r.state !== "unknown") this.apply(req.key, r);
      else this.requeue(req); // past the server cap, or stale: ask again in a later window
    });
  }

  private backOff(group: LinkRequest[]): void {
    this.backoffMs = this.backoffMs === 0 ? BACKOFF_START_MS : Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.blockedUntil = Date.now() + this.backoffMs;
    for (const req of group) this.requeue(req);
  }

  private requeue(req: LinkRequest): void {
    if (!this.registered.has(req.key) || this.pending.has(req.key) || this.inFlight.has(req.key)) return;
    this.pending.set(req.key, req);
    this.schedule();
  }

  /** One timer at the earliest live expiry: an expired entry still in view is re-requested, any other is dropped. */
  private scheduleSweep(): void {
    if (this.sweepTimer) return;
    const now = Date.now();
    let earliest = Number.POSITIVE_INFINITY;
    for (const { expiresAt } of this.entries.values()) if (expiresAt > now) earliest = Math.min(earliest, expiresAt);
    if (earliest === Number.POSITIVE_INFINITY) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      const at = Date.now();
      for (const [key, stored] of [...this.entries]) {
        if (stored.expiresAt > at) continue;
        const held = this.registered.get(key);
        if (held) this.enqueueIfStale(held.req);
        else {
          this.entries.delete(key);
          this.notify(key);
        }
      }
      this.scheduleSweep();
    }, earliest - now);
  }
}

/** The store the dashboard transcript uses unless a test injects its own. */
export const sharedLinkResolutionStore = new LinkResolutionStore();
