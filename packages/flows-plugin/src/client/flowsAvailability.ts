/**
 * Per-session sync availability cache for flows-plugin's
 * `shouldRenderFlowsSubcard` predicate.
 *
 * The MEMORY/honcho path uses a global boolean (extension installed or not).
 * Flow availability is per-session: session A may have `flowsList`, session
 * B may not. The cache is therefore keyed by sessionId.
 *
 * Population is driven by a module-level subscriber attached to the runtime's
 * `subscribeSessionDataKey` API at plugin-client-entry load. Each
 * `publishSessionData` for `flowsList` or `commandsList` recomputes
 * availability for that session and writes to the cache.
 *
 * The cache is closed-by-default: `getFlowsAvailabilitySync` returns `false`
 * for sessions the subscriber hasn't observed yet. This prevents a
 * subcard-flicker on first paint (hidden → visible is fine, visible → hidden
 * would be jarring). See change: add-flows-subcard (design.md Decision 3).
 */
import {
  getSessionData,
  getSessionEvents,
  subscribeSessionDataKey,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CommandInfo, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { isFlowEvent } from "../reducer.js";

const availability = new Map<string, boolean>();

// Per-session memo for "has this session seen any flow event?". Keyed on the
// session-events array reference (stable until the next publish) so the scan
// runs only when the event list grows; once true it stays true (flow events
// are append-only). Lets the FLOWS subcard reattach on cold load after replay,
// where the `flowsList`/`commandsList` availability signal is NOT replayed and
// is closed-by-default. See change: replay-persisted-flow-runs (task 5.5).
const flowEventMemo = new Map<string, { ref: readonly unknown[]; has: boolean }>();

/**
 * True when the session's replayed/live event stream contains any `flow_*`
 * event. Synchronous, cheap (ref-memoized + sticky-true), safe to call from
 * the `shouldRenderFlowsSubcard` predicate.
 */
export function sessionHasFlowEvents(sessionId: string): boolean {
  const events = getSessionEvents(sessionId);
  const cached = flowEventMemo.get(sessionId);
  if (cached && (cached.has || cached.ref === events)) return cached.has;
  const has = events.some((e) => isFlowEvent((e as { eventType: string }).eventType));
  flowEventMemo.set(sessionId, { ref: events, has });
  return has;
}

/**
 * Sync readable accessor for `shouldRenderFlowsSubcard`. Returns `false`
 * for sessions whose availability has not been observed yet.
 */
export function getFlowsAvailabilitySync(sessionId: string): boolean {
  return availability.get(sessionId) ?? false;
}

/**
 * Set the cached availability for a session. Exposed for tests and for the
 * module-level subscriber installed by `installFlowsAvailabilitySubscriber`.
 */
export function setFlowsAvailability(sessionId: string, has: boolean): void {
  availability.set(sessionId, has);
}

/**
 * Compute availability from the published per-session-data store values.
 * Pure helper — no side effects.
 */
function computeAvailability(
  flows: FlowInfo[] | undefined,
  commands: CommandInfo[] | undefined,
): boolean {
  const hasFlows = Array.isArray(flows) && flows.length > 0;
  const hasFlowsNew = Array.isArray(commands) && commands.some((c) => c.name === "flows:new");
  return hasFlows || hasFlowsNew;
}

let installed = false;
let unsubscribers: Array<() => void> = [];

/**
 * Install a module-level subscriber that updates the availability cache on
 * every `flowsList` / `commandsList` publish. Idempotent: subsequent calls
 * return the same unsubscribe function and do not multiply listeners.
 *
 * Called once at flows-plugin client-entry load.
 */
export function installFlowsAvailabilitySubscriber(): () => void {
  if (installed) {
    return uninstall;
  }
  installed = true;

  const recompute = (sessionId: string): void => {
    const flows = getSessionData<FlowInfo[]>(sessionId, "flowsList");
    const commands = getSessionData<CommandInfo[]>(sessionId, "commandsList");
    setFlowsAvailability(sessionId, computeAvailability(flows, commands));
  };

  unsubscribers.push(
    subscribeSessionDataKey("flowsList", (sessionId) => recompute(sessionId)),
  );
  unsubscribers.push(
    subscribeSessionDataKey("commandsList", (sessionId) => recompute(sessionId)),
  );

  return uninstall;
}

function uninstall(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  installed = false;
}

/**
 * Test-only: reset cache + install guard so test cases can re-install the
 * subscriber from scratch.
 *
 * @internal
 */
export function __resetFlowsAvailabilityForTests(): void {
  availability.clear();
  flowEventMemo.clear();
  uninstall();
}
