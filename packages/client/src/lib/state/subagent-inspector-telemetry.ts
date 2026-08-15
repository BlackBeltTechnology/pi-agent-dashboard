/**
 * subagent-inspector-telemetry — how much of a subagent's runtime has a detail
 * view MOUNTED.
 *
 * This is the signal the design's kill switch needs (D1/P5) and the one thing
 * the dashboard never recorded: stripping the timeline off intermediate frames
 * only wins while nobody is watching, because a mounted inspector pulls the fat
 * payload back on a cadence. If inspectors are open for most of a run, the fat
 * payload flows anyway and the change buys little — C4 fixes the abort
 * threshold at > 50 %.
 *
 * Measured client-side because "is a view mounted" exists nowhere else. Kept as
 * a pure in-memory aggregate with an explicit clock argument so it is testable
 * and costs nothing at runtime; the reading is also hung off `globalThis` so a
 * Playwright/harness run can read it out of the page.
 *
 * See change: reduce-subagent-details-payload.
 */

export interface InspectorTelemetry {
  /** Total observed subagent runtime (ms), summed across agents. */
  runtimeMs: number;
  /** Total time (ms) at least one detail view was mounted on a running agent. */
  inspectorOpenMs: number;
  /** `inspectorOpenMs / runtimeMs`, clamped to [0, 1]. */
  share: number;
}

interface AgentRecord {
  startedAt: number;
  endedAt?: number;
  /** Mounted views right now — inline + popout count ONCE, not twice. */
  mounted: number;
  /** When the current open window began (undefined = nothing mounted). */
  openedAt?: number;
  /** Accrued mounted time for this agent. */
  openMs: number;
}

const agents = new Map<string, AgentRecord>();

/** A subagent is running (or was observed running) at `now`. */
export function noteSubagentRunning(agentId: string, now: number = Date.now()): void {
  if (!agents.has(agentId)) {
    agents.set(agentId, { startedAt: now, mounted: 0, openMs: 0 });
  }
}

/** A subagent reached a terminal status; closes any still-open view window. */
export function noteSubagentTerminal(agentId: string, now: number = Date.now()): void {
  const rec = agents.get(agentId);
  if (!rec || rec.endedAt !== undefined) return;
  if (rec.openedAt !== undefined) {
    rec.openMs += now - rec.openedAt;
    rec.openedAt = undefined;
  }
  rec.endedAt = now;
}

/**
 * Record that a detail view mounted for `agentId`. Returns the unmount hook;
 * overlapping views of the same subagent form ONE open window, so inline +
 * popout can never double-count.
 */
export function trackInspectorMounted(
  agentId: string,
  now: number = Date.now(),
): (at?: number) => void {
  const rec = agents.get(agentId);
  if (!rec) return () => {};
  if (rec.mounted === 0) rec.openedAt = now;
  rec.mounted += 1;
  let released = false;
  return (at: number = Date.now()) => {
    if (released) return;
    released = true;
    rec.mounted = Math.max(0, rec.mounted - 1);
    if (rec.mounted === 0 && rec.openedAt !== undefined) {
      rec.openMs += Math.max(0, at - rec.openedAt);
      rec.openedAt = undefined;
    }
  };
}

/** Current aggregate reading. Pure; safe to call at any time. */
export function readInspectorTelemetry(now: number = Date.now()): InspectorTelemetry {
  let runtimeMs = 0;
  let inspectorOpenMs = 0;
  for (const rec of agents.values()) {
    runtimeMs += (rec.endedAt ?? now) - rec.startedAt;
    inspectorOpenMs += rec.openMs + (rec.openedAt !== undefined ? now - rec.openedAt : 0);
  }
  const share = runtimeMs > 0 ? Math.min(1, inspectorOpenMs / runtimeMs) : 0;
  return { runtimeMs, inspectorOpenMs, share };
}

/** The kill-switch number: inspector-open share of subagent runtime (C4). */
export function inspectorOpenShare(now: number = Date.now()): number {
  return readInspectorTelemetry(now).share;
}

/** Drop every recorded agent (tests, session switch). */
export function resetInspectorTelemetry(): void {
  agents.clear();
}

// Readable from a harness/Playwright run without any UI affordance.
(globalThis as Record<string, unknown>).__piSubagentInspectorTelemetry = () =>
  readInspectorTelemetry();
