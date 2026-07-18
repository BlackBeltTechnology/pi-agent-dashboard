/**
 * Wire-protocol types consumed by the subagents plugin.
 *
 * Producer of this contract: pi-dashboard-subagents extension
 *   (https://github.com/BlackBeltTechnology/pi-dashboard-agents)
 *
 * Lives in the plugin so producers can import from a single canonical
 * location and so the shell's event-reducer.ts can re-export from here.
 * Eventually (via extract-subagents-as-plugin) the reducer slice for
 * subagent_* events also moves here.
 */

/** A single entry in a subagent's run timeline. */
export type SubagentTimelineEntry =
  | { kind: "tool"; toolName: string; input: unknown; output?: unknown; isError?: boolean; ts: number }
  | { kind: "text"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "error"; text: string; ts: number };

/** Per-subagent state held in SessionState.subagents. */
export interface SubagentState {
  id: string;
  /**
   * Runner session id (v7) minted by the producer for the in-memory subagent
   * session, distinct from the v4 `id` (agentId). Optional: absent with an
   * older producer (< 0.2.3). When present, the reducer dual-indexes the state
   * under both this id and `id`. See change: resolve-subagent-inspector-by-session-id.
   */
  agentSessionId?: string;
  type: string;
  description: string;
  status: "created" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  durationMs?: number;
  tokens?: { input: number; output: number; total: number };
  toolUses?: number;
  /** Full per-step timeline. Producer: pi-dashboard-subagents extension. */
  entries?: SubagentTimelineEntry[];
  /** Live current-activity string (e.g. "reading src/foo.ts"). */
  activity?: string;
  /** Display name for the agent (e.g. "code-reviewer"). Falls back to `type`. */
  displayName?: string;
  /** Short model name if different from parent. */
  modelName?: string;
  /** Subagent type (e.g. "general-purpose"). May duplicate `type`. */
  subagentType?: string;
  /** Started-at epoch ms (set on subagent_started). */
  startedAt?: number;
  /**
   * Absolute filesystem path to the agent's `.md` definition file
   * (e.g. `~/.pi/agent/agents/Explore.md`). Producer sets it when the
   * subagent was sourced from a file. Rendered read-only in the inspector
   * header. See change: add-subagent-inspector §15.
   */
  agentMdPath?: string;
}
