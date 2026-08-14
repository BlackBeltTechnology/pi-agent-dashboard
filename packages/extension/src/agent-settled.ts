/**
 * `agent_settled` normalization — bridge-side.
 *
 * pi ≥ 0.80.4 emits `agent_settled` exactly once per run (in the `finally` of
 * `_runAgentPrompt`, AFTER the retry/compact/continue loop drains). Floor pi
 * (0.78.0–0.80.3) never emits it. Native pi forwards its real terminal settle.
 * Floor pi emits a compatibility settle after each `agent_end`; the bridge marks
 * per-attempt settles `retryPending:true` and later sends an unmarked terminal
 * settle when no matching retry start arrives or the retry budget is exhausted.
 * The reducer therefore distinguishes compatibility from terminal convergence.
 *
 * Pure decision logic lives here so it is unit-testable without instantiating
 * the bridge. See change: adopt-pi-074-080-features.
 */

/** pi version at/above which `agent_settled` is emitted natively. */
export const NATIVE_AGENT_SETTLED_FLOOR = "0.80.4";
export const FLOOR_RETRY_UNKNOWN_DELAY_MS = 2000;
export const FLOOR_RETRY_GRACE_MS = 1000;

/** Delay before a floor-pi waiting attempt is reconciled as terminal when no
 * matching agent_start arrives. */
export function floorRetryReconcileDelay(delayMs: number): number {
  return (delayMs > 0 ? delayMs : FLOOR_RETRY_UNKNOWN_DELAY_MS) + FLOOR_RETRY_GRACE_MS;
}

/** Parse a semver-ish string to `[major, minor, patch]`, ignoring any
 * pre-release / build suffix. Missing / non-numeric parts read as 0. */
function parseVersion(v: string): [number, number, number] {
  const core = v.split("-")[0].split("+")[0];
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * True when the running pi emits `agent_settled` natively (≥ 0.80.4). An
 * unknown / unparseable version returns `false` — the safe default is to
 * synthesize so the dashboard still gets its one terminal settle.
 */
export function nativeAgentSettledSupported(piVersion: string | undefined): boolean {
  if (!piVersion) return false;
  const [a, b, c] = parseVersion(piVersion);
  const [x, y, z] = parseVersion(NATIVE_AGENT_SETTLED_FLOOR);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

/** Minimal shape of a forwarded `agent_settled` event (no payload). */
export interface SettleEvent {
  eventType: "agent_settled";
  timestamp: number;
  data: Record<string, unknown>;
}

/** Build a synthetic terminal `agent_settled` for floor pi. */
export function synthesizeAgentSettledEvent(timestamp: number): SettleEvent {
  return { eventType: "agent_settled", timestamp, data: {} };
}

/** Mark a floor-pi settle as per-attempt compatibility rather than terminal.
 * The reducer preserves retry/cancellation state for this shape. */
export function markFloorSettle(
  event: SettleEvent,
  terminal: boolean,
): SettleEvent {
  if (terminal) return event;
  return { ...event, data: { ...event.data, retryPending: true } };
}

/**
 * After the bridge forwards `eventType`, return the synthetic `agent_settled`
 * it must ALSO forward, or `null`. Only an `agent_end` on floor pi
 * (`nativeSupported === false`) produces a synth; a real `agent_settled`
 * (native pi) is forwarded on its own and needs no follow-up. This is the
 * single decision the bridge wiring calls.
 */
export function settleFollowUp(
  eventType: string,
  nativeSupported: boolean,
  timestamp: number,
): SettleEvent | null {
  if (eventType === "agent_end" && !nativeSupported) {
    return synthesizeAgentSettledEvent(timestamp);
  }
  return null;
}
