/**
 * `project_trust` auto-decision — pure gate + defensive cwd read.
 *
 * A dashboard-spawned headless RPC session has no human at pi's TUI to answer
 * `project_trust`, so pi leaves the no-UI decision un-trusted and the session
 * can stall. The bridge auto-decides "trust" ONLY for the exact dir the
 * dashboard spawned into — never an arbitrary tree.
 *
 * pi emits `project_trust` during resource-loader reload, BEFORE `session_start`
 * reaches extension handlers, so the gate compares the event cwd to the
 * ACTIVATION cwd (captured at bridge module scope, not session_start — a cwd
 * captured at session_start is still undefined when this fires: the cycle-2
 * dead-on-arrival bug).
 *
 * pi's handler contract: return `{ trusted: "yes" }` to trust (with
 * `remember:false` = this run only), `{ trusted: "undecided" }` to defer to
 * pi's default. Pure decision logic lives here so it is unit-testable without
 * the bridge. See change: adopt-pi-074-080-features (A.3).
 */

export interface ProjectTrustDecisionInput {
  /** True when this pi was spawned by the dashboard (PI_DASHBOARD_SPAWN_TOKEN). */
  dashboardSpawned: boolean;
  /** True for a headless RPC session (no TTY, bridge over WebSocket). */
  isHeadless: boolean;
  /** cwd carried by the project_trust event (undefined when unreadable). */
  eventCwd: string | undefined;
  /** cwd captured at bridge activation (the dashboard-provided spawn cwd). */
  activationCwd: string;
}

export type ProjectTrustDecision = "trust" | "defer";

/**
 * Deny-by-default gate. Trust ONLY when ALL hold: dashboard-spawned AND
 * headless AND the event cwd still equals the activation cwd. Any other case
 * — interactive/TUI, non-dashboard-spawn, a differing/unknown cwd — defers to
 * pi's default.
 */
export function decideProjectTrust(input: ProjectTrustDecisionInput): ProjectTrustDecision {
  if (!input.dashboardSpawned) return "defer";
  if (!input.isHeadless) return "defer";
  if (input.eventCwd === undefined || input.eventCwd !== input.activationCwd) return "defer";
  return "trust";
}

/**
 * Read the trust-decision cwd from the `project_trust` event (authoritative)
 * or, failing that, its per-event context — defensively. The read is wrapped
 * in try/catch so a stale/replaced ctx whose `cwd` getter throws yields
 * `undefined` (→ the gate defers, no crash). NEVER reads a cached ctx.
 */
export function readEventCwd(event: unknown, ctx: unknown): string | undefined {
  try {
    const fromEvent = (event as { cwd?: unknown } | null | undefined)?.cwd;
    if (typeof fromEvent === "string") return fromEvent;
    const fromCtx = (ctx as { cwd?: unknown } | null | undefined)?.cwd;
    if (typeof fromCtx === "string") return fromCtx;
    return undefined;
  } catch {
    return undefined;
  }
}
