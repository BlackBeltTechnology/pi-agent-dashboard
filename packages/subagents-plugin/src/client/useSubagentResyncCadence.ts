/**
 * useSubagentResyncCadence — open-inspector liveness for a RUNNING subagent
 * (D4 v1).
 *
 * The bridge no longer pushes the cumulative timeline on intermediate frames,
 * so a mounted inspector must pull. This re-fires the EXISTING
 * `subagent_resync_request` — no new protocol, no watch signal — while a detail
 * view is mounted, and only for the agent someone is actually watching.
 *
 * Two deliberate departures from `requestResyncIfStale`:
 *  - **no `emptyTimeline` precondition.** That precondition is exactly why a
 *    mounted view watching a GROWING timeline never re-fires today. The
 *    open-time trigger keeps it; this one must not have it.
 *  - **one timer per subagent, not per view.** The inline inspector and the
 *    popout route can both be mounted on the same agent; a per-view interval
 *    would double the pull rate. Views subscribe to a shared per-key group, the
 *    group owns the single timer, and only its first subscriber fires.
 *
 * Cadence (C1): backoff scaled by how quiet the timeline is — base 2 s,
 * doubling on every tick that brought no new entries, capped at 30 s, reset to
 * base the moment the timeline grows. A busy subagent is polled tightly; an
 * idle one costs almost nothing.
 *
 * See change: reduce-subagent-details-payload.
 */
import { useEffect, useRef } from "react";

/** First interval after mount or after the timeline grew. */
export const CADENCE_BASE_MS = 2_000;
/** Ceiling the idle backoff never exceeds. */
export const CADENCE_MAX_MS = 30_000;

interface Subscriber {
  onResync: () => void;
  getCount: () => number;
}

interface CadenceGroup {
  subs: Subscriber[];
  timer: ReturnType<typeof setTimeout> | undefined;
  delay: number;
  lastCount: number;
}

/** key (`sessionId:agentId`) → the one timer driving every view of that agent. */
const groups = new Map<string, CadenceGroup>();

/** Highest entry count any mounted view of this subagent currently renders. */
function currentCount(group: CadenceGroup): number {
  let max = 0;
  for (const sub of group.subs) max = Math.max(max, sub.getCount());
  return max;
}

function schedule(key: string, group: CadenceGroup): void {
  group.timer = setTimeout(() => {
    // Only the first subscriber fires: one request per tick regardless of how
    // many views are open on this subagent.
    group.subs[0]?.onResync();
    const count = currentCount(group);
    const grew = count > group.lastCount;
    group.lastCount = count;
    group.delay = grew ? CADENCE_BASE_MS : Math.min(group.delay * 2, CADENCE_MAX_MS);
    schedule(key, group);
  }, group.delay);
}

function subscribe(key: string, sub: Subscriber): () => void {
  let group = groups.get(key);
  if (!group) {
    group = { subs: [], timer: undefined, delay: CADENCE_BASE_MS, lastCount: sub.getCount() };
    groups.set(key, group);
  }
  group.subs.push(sub);
  if (group.timer === undefined) schedule(key, group);

  return () => {
    const g = groups.get(key);
    if (!g) return;
    const i = g.subs.indexOf(sub);
    if (i !== -1) g.subs.splice(i, 1);
    if (g.subs.length === 0) {
      if (g.timer) clearTimeout(g.timer);
      groups.delete(key);
    }
  };
}

/** Growth resets the backoff AND the pending tick, so new entries land fast. */
function resetBackoff(key: string): void {
  const group = groups.get(key);
  if (!group || group.timer === undefined) return;
  clearTimeout(group.timer);
  group.delay = CADENCE_BASE_MS;
  group.lastCount = currentCount(group);
  schedule(key, group);
}

export interface SubagentResyncCadenceOptions {
  /** `${sessionId}:${agentId}` — undefined disables the cadence entirely. */
  key: string | undefined;
  /** Whether the subagent is still running (queued counts as running). */
  running: boolean;
  /** Current rendered entry count; growth resets the backoff. */
  entryCount: number;
  /** Fire one `subagent_resync_request`. */
  onResync: () => void;
}

export function useSubagentResyncCadence({
  key,
  running,
  entryCount,
  onResync,
}: SubagentResyncCadenceOptions): void {
  // Read through refs so a changing callback never restarts the shared timer —
  // only mount, liveness, and the key do.
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;
  const entryCountRef = useRef(entryCount);
  entryCountRef.current = entryCount;

  useEffect(() => {
    if (!key || !running) return;
    return subscribe(key, {
      onResync: () => onResyncRef.current(),
      getCount: () => entryCountRef.current,
    });
  }, [key, running]);

  // A grown timeline means the pull is paying off — go back to the tight
  // interval instead of continuing to back off.
  const prevCount = useRef(entryCount);
  useEffect(() => {
    if (!key || !running) return;
    if (entryCount > prevCount.current) resetBackoff(key);
    prevCount.current = entryCount;
  }, [key, running, entryCount]);
}
