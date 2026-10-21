/**
 * `resultPending` predicate of the `Agent` tool-renderer claim.
 *
 * The shell's tool row calls it (resolved from the claim's `resultPending`
 * export name, synchronously) to decide whether to show the neutral
 * "recovered" badge. Lives in its own module so the eager client entry exports
 * it without pulling the lazy `AgentToolRenderer` chunk.
 *
 * See change: decouple-plugins-from-core (task 4.5); finalize-agent-card-on-subagent-stop (D6).
 */

/**
 * The "recovered" badge condition for an Agent card whose real result never
 * reached this browser: a neutral settle heal (`resultMissing`) while no
 * subagent result is known, or a server `session_ended` orphan-close. A
 * `subagent_stopped` heal or a settle with a known result carries the real
 * result and is not badged. `session` is the tool context's session (only its
 * `subagents` map is read).
 */
export function isAgentResultNotReceived(toolDetails: Record<string, unknown> | undefined, session: unknown): boolean {
  if (!toolDetails) return false;
  if (toolDetails.healedBy === "session_ended") return true;
  if (toolDetails.resultMissing !== true) return false;
  const subagents = (session as { subagents?: ReadonlyMap<string, { result?: string }> } | undefined)?.subagents;
  const agentId = typeof toolDetails.agentId === "string" ? toolDetails.agentId : undefined;
  return !(agentId && subagents?.get(agentId)?.result);
}
