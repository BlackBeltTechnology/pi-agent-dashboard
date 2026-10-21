/**
 * Live-arrival detection for chat motion (design D2). Decides, per commit,
 * which transcript elements are NEW arrivals in a live-follow view and may play
 * an entry transition. Lives in the view layer, never the reducer: the reducer
 * stays pure and replay-equivalent.
 *
 * Two clocks, deliberately split so render stays pure:
 *  - `decide(input)` is a READ. It never mutates; calling it twice with the same
 *    input (React StrictMode, a re-render before commit) yields the same answer.
 *  - `commit(input)` records the commit AFTER it lands (layout effect), whether
 *    or not the row is mounted. An off-screen arrival is therefore recorded and
 *    never animates when it is later scrolled into view.
 *
 * Keyed elements (tool rows) use a seen-set re-seeded on every session switch-in
 * and on motion activation. Unkeyed ones (pending card, streaming answer,
 * streaming reasoning, steering) use edge detection against the previous commit
 * of the SAME session id. A commit adding more than `BULK_ARRIVAL_LIMIT` new
 * elements + status flips is bulk (replay-shaped) and animates nothing.
 *
 * See change: add-fluid-chat-motion.
 */

/** A commit adding more than this many new elements + status flips is treated as bulk. */
export const BULK_ARRIVAL_LIMIT = 4;

export interface ArrivalToolRow {
  /** `toolCallId` (falling back to the row id) — the stable identity of a tool row. */
  id: string;
  running: boolean;
}

export interface ArrivalInput {
  sessionId: string | undefined;
  /** UNFILTERED tool rows, in transcript order (display filters never affect arrival). */
  toolRows: readonly ArrivalToolRow[];
  hasPendingPrompt: boolean;
  /** The streaming answer bubble is on screen. */
  hasTail: boolean;
  /** The live reasoning block is on screen. */
  hasThinking: boolean;
  steering: readonly string[];
  /** Effective motion (pref ∧ ¬reduced-motion ∧ visible). */
  motionActive: boolean;
  /** The host supplies `replayInFlight`, so replay can be told from live. */
  replayAware: boolean;
  following: boolean;
  selecting: boolean;
  replayInFlight: boolean;
  loadingHistory: boolean;
}

export interface ArrivalDecision {
  /** Tool ids that are entering in this commit. */
  enteringToolIds: ReadonlySet<string>;
  pendingPrompt: boolean;
  tail: boolean;
  thinking: boolean;
  /** Per-index entering flag for the steering cards. */
  steering: readonly boolean[];
  /**
   * A running→done/error flip observed in this commit may play the completion
   * cue (live-follow, non-bulk, replay-aware, motion active).
   */
  cueAllowed: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_FLAGS: readonly boolean[] = [];

export const NO_ARRIVALS: ArrivalDecision = {
  enteringToolIds: EMPTY_SET,
  pendingPrompt: false,
  tail: false,
  thinking: false,
  steering: EMPTY_FLAGS,
  cueAllowed: false,
};

function steeringCounts(steering: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of steering) counts.set(text, (counts.get(text) ?? 0) + 1);
  return counts;
}

export class ArrivalTracker {
  private initialized = false;
  private sessionId: string | undefined;
  private motionActive = false;
  private seen = new Set<string>();
  private runningIds = new Set<string>();
  private committedRows: readonly ArrivalToolRow[] | null = null;
  private hadPendingPrompt = false;
  private hadTail = false;
  private hadThinking = false;
  private prevSteering = new Map<string, number>();

  /** True when this commit must re-seed instead of detecting arrivals. */
  private needsReseed(input: ArrivalInput): boolean {
    return !this.initialized || this.sessionId !== input.sessionId || !this.motionActive;
  }

  /** Pure read: which elements are entering in the commit about to land. */
  decide(input: ArrivalInput): ArrivalDecision {
    if (!input.motionActive || this.needsReseed(input)) return NO_ARRIVALS;

    // Same rows array as the last commit → no tool can be new and none can have flipped.
    const rowsUnchanged = input.toolRows === this.committedRows;
    const newToolIds: string[] = [];
    let flips = 0;
    if (!rowsUnchanged) {
      for (const row of input.toolRows) {
        if (!this.seen.has(row.id)) newToolIds.push(row.id);
        else if (!row.running && this.runningIds.has(row.id)) flips += 1;
      }
    }

    const newPendingPrompt = input.hasPendingPrompt && !this.hadPendingPrompt;
    const newTail = input.hasTail && !this.hadTail;
    const newThinking = input.hasThinking && !this.hadThinking;

    const steering: boolean[] = [];
    const occurrence = new Map<string, number>();
    let newSteering = 0;
    for (const text of input.steering) {
      const k = (occurrence.get(text) ?? 0) + 1;
      occurrence.set(text, k);
      const entering = k > (this.prevSteering.get(text) ?? 0);
      steering.push(entering);
      if (entering) newSteering += 1;
    }

    const newCount =
      newToolIds.length + flips + newSteering + (newPendingPrompt ? 1 : 0) + (newTail ? 1 : 0) + (newThinking ? 1 : 0);
    const bulk = newCount > BULK_ARRIVAL_LIMIT;
    const liveFollow =
      input.replayAware && input.following && !input.selecting && !input.replayInFlight && !input.loadingHistory;
    if (!liveFollow || bulk) return NO_ARRIVALS;

    return {
      enteringToolIds: newToolIds.length ? new Set(newToolIds) : EMPTY_SET,
      pendingPrompt: newPendingPrompt,
      tail: newTail,
      thinking: newThinking,
      steering: newSteering ? steering : EMPTY_FLAGS,
      cueAllowed: true,
    };
  }

  /** Record the commit that just landed (call from a layout effect). */
  commit(input: ArrivalInput): void {
    const reseed = this.needsReseed(input);
    this.initialized = true;
    this.sessionId = input.sessionId;
    this.motionActive = input.motionActive;
    if (!input.motionActive) {
      // Motion off costs nothing: drop the bookkeeping; activation re-seeds.
      this.seen = new Set();
      this.runningIds = new Set();
      this.committedRows = null;
      this.hadPendingPrompt = false;
      this.hadTail = false;
      this.hadThinking = false;
      this.prevSteering = new Map();
      return;
    }
    if (reseed) this.seen = new Set();
    if (reseed || input.toolRows !== this.committedRows) {
      const running = new Set<string>();
      for (const row of input.toolRows) {
        this.seen.add(row.id);
        if (row.running) running.add(row.id);
      }
      this.runningIds = running;
      this.committedRows = input.toolRows;
    }
    this.hadPendingPrompt = input.hasPendingPrompt;
    this.hadTail = input.hasTail;
    this.hadThinking = input.hasThinking;
    this.prevSteering = steeringCounts(input.steering);
  }

  /** Test seam. */
  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }
}

/** True when two decisions are interchangeable (keeps the context value stable across renders). */
export function sameDecision(a: ArrivalDecision, b: ArrivalDecision): boolean {
  if (a === b) return true;
  if (a.cueAllowed !== b.cueAllowed) return false;
  if (a.enteringToolIds.size !== b.enteringToolIds.size) return false;
  for (const id of a.enteringToolIds) if (!b.enteringToolIds.has(id)) return false;
  return true;
}
