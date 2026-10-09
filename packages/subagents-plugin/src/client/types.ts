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

/**
 * Bounded tail of a subagent's currently streaming block. `kind: "none"` means
 * nothing is streaming. See change: stream-subagent-reasoning-and-stable-card.
 */
export type SubagentLiveTail = { kind: "thinking" | "text" | "none"; text: string };

/** In-progress block from the delta stream. See change: add-plugin-bridge-contributions. */
export type SubagentLiveBlock = {
  blockId: number;
  kind: "thinking" | "text";
  text: string;
  end: number;
  gap: boolean;
};

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
  /** Live tail of the streaming thinking/text block (producer ≥ 0.2.7). */
  liveTail?: SubagentLiveTail;
  /**
   * In-progress block assembled from `subagent_delta` pieces (producer ≥ 0.4.0).
   * `text` is the display text (may carry gap markers); `end` is the LOGICAL
   * block offset reached, so offsets stay exact across gaps. Cleared by the
   * block's `subagent_entry` (same `blockId`) or a terminal state.
   * See change: add-plugin-bridge-contributions (D7).
   */
  liveBlock?: SubagentLiveBlock;
  /** Highest `blockId` already finished — later pieces of it are ignored (D7 tombstone). */
  closedBlockMax?: number;
  /** Producer step count (`details.entryCount`, ≥ 0.3.0); stream-complete when filled steps reach it. */
  entryCount?: number;
  /** Display name for the agent (e.g. "code-reviewer"). Falls back to `type`. */
  displayName?: string;
  /** Short model name if different from parent. */
  modelName?: string;
  /** Effective thinking level of the child (producer ≥ 0.2.7), e.g. "high". */
  thinkingLevel?: string;
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
