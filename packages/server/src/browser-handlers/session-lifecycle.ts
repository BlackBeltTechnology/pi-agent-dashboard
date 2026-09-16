/**
 * Session lifecycle verbs shared by the browser-WS gateway and the REST
 * lifecycle route (change: expand-mcp-tiered-surface, design D3).
 *
 * The four verbs below were originally handled only inside the browser gateway
 * switch. `stop_after_turn`/`retry`/`kill_process` are plain bridge forwards;
 * `force_kill` is a server-side kill ladder. Exposing them through
 * `POST /api/session/:id/lifecycle` gives MCP one code path instead of a second
 * implementation, and gives the REST tier gate an action the manifest can bind
 * to. The WS cases call the SAME functions here.
 *
 * The action string is a closed set; an unknown value is a client error, never
 * a silent no-op.
 */
import type { PiGateway } from "../pi/pi-gateway.js";

/** The lifecycle verbs reachable through the shared handler. */
export const LIFECYCLE_ACTIONS = ["stop_after_turn", "retry", "force_kill", "kill_process"] as const;

export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** Narrow an untrusted request value to a `LifecycleAction`. */
export function isLifecycleAction(value: unknown): value is LifecycleAction {
  return typeof value === "string" && (LIFECYCLE_ACTIONS as readonly string[]).includes(value);
}

export interface LifecycleDeps {
  /** Bridge forwarder for the three cooperative/kill verbs. */
  piGateway: Pick<PiGateway, "sendToSession">;
  /** Server-side kill ladder for `force_kill` (see `forceKillSession`). */
  forceKill: (sessionId: string) => Promise<unknown> | unknown;
}

/**
 * Run one lifecycle action for a session. The tier gate has already admitted
 * the caller (the REST route's in-handler `operate` check covers the two
 * destructive actions before this runs).
 */
export interface LifecycleResult {
  /** False when the bridge forward reached no live session (an honest no-op). */
  delivered: boolean;
}

export async function runLifecycleAction(
  action: LifecycleAction,
  sessionId: string,
  deps: LifecycleDeps,
  extras: { pgid?: number } = {},
): Promise<LifecycleResult> {
  switch (action) {
    case "stop_after_turn":
      return { delivered: deps.piGateway.sendToSession(sessionId, { type: "stop_after_turn", sessionId }) };
    case "retry":
      return { delivered: deps.piGateway.sendToSession(sessionId, { type: "retry_session", sessionId }) };
    case "kill_process":
      return {
        delivered: deps.piGateway.sendToSession(sessionId, {
          type: "kill_process",
          sessionId,
          ...(extras.pgid !== undefined ? { pgid: extras.pgid } : {}),
        }),
      };
    case "force_kill":
      await deps.forceKill(sessionId);
      return { delivered: true };
  }
}
