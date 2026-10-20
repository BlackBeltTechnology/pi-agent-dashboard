/**
 * Subagent wire-contract types + the pure helpers that fold subagent frames
 * into a `SubagentState`. Lives in shared (a non-plugin package) so the core
 * client reducer and the subagents plugin read one definition without a
 * core→plugin import; the plugin re-exports it.
 *
 * Producer of the contract: pi-dashboard-subagents extension
 *   (https://github.com/BlackBeltTechnology/pi-dashboard-agents)
 *
 * See change: decouple-plugins-from-core (task 2.7); earlier: add-subagent-inspector.
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
  /**
   * Client-only (never sent by the producer): the heal marker that produced the
   * CURRENT terminal `status` (e.g. `"session_ended"`); absent for a real
   * terminal or a running state. Lets a live tick revive a subagent a
   * fabricated `session_ended` heal failed, without reviving a real failure.
   * See change: fix-replay-fabricates-orphan-end-for-live-calls (D5).
   */
  healedBy?: string;
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

/** Max chars of a subagent live tail kept in client state. */
const LIVE_TAIL_MAX = 280;
const CLEARED_LIVE_TAIL: SubagentLiveTail = { kind: "none", text: "" };

/**
 * Normalize a wire `details.liveTail`, never rejecting. Any plain object
 * overwrites: a valid thinking/text tail is kept (text capped at 280), every
 * other object — sentinel, malformed, future shape — becomes the cleared tail.
 * Non-objects return undefined (key ignored, prior state kept).
 * Also used by `AgentToolRenderer` for its session-less `details.liveTail`
 * fallback, so both paths normalize identically.
 * See change: stream-subagent-reasoning-and-stable-card (D8).
 */
export function readLiveTail(raw: unknown): SubagentLiveTail | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { kind, text } = raw as Record<string, unknown>;
  if ((kind === "thinking" || kind === "text") && typeof text === "string") {
    return { kind, text: text.length > LIVE_TAIL_MAX ? text.slice(-LIVE_TAIL_MAX) : text };
  }
  return CLEARED_LIVE_TAIL;
}

/**
 * Pull optional Phase-2 fields (`entries`, `activity`, `displayName`, model,
 * etc.) from a streamed `AgentDetails`-shaped object. Returns a partial that
 * spreads into a `SubagentState`. All fields are optional; absent keys yield
 * `undefined` which leaves any existing value intact when used as a `...spread`.
 *
 * See change: add-subagent-inspector.
 */
export function readSubagentDetails(
  details: Record<string, unknown> | undefined,
): Partial<SubagentState> {
  if (!details) return {};
  const out: Partial<SubagentState> = {};
  // D3 empty-array overwrite guard: only replace `entries` when the incoming
  // array is non-empty. An incoming `[]` (initial subagent_started, or a
  // late/reordered frame) omits the key so the `...spread` merge preserves any
  // already-populated timeline. Entries only ever grow within a run, so a
  // legitimate transition to zero entries never occurs.
  // See change: fix-subagent-live-detail-reliability (D3).
  if (Array.isArray(details.entries) && details.entries.length > 0) {
    out.entries = details.entries as SubagentTimelineEntry[];
  }
  if (typeof details.entryCount === "number" && Number.isSafeInteger(details.entryCount) && details.entryCount >= 0) {
    out.entryCount = details.entryCount;
  }
  if (typeof details.activity === "string") out.activity = details.activity;
  const liveTail = readLiveTail(details.liveTail);
  if (liveTail) out.liveTail = liveTail;
  if (typeof details.displayName === "string") out.displayName = details.displayName;
  if (typeof details.modelName === "string") out.modelName = details.modelName;
  if (typeof details.thinkingLevel === "string" && details.thinkingLevel) out.thinkingLevel = details.thinkingLevel;
  if (typeof details.subagentType === "string") out.subagentType = details.subagentType;
  if (typeof details.toolUses === "number") out.toolUses = details.toolUses;
  if (typeof details.durationMs === "number") out.durationMs = details.durationMs;
  if (typeof details.agentMdPath === "string") out.agentMdPath = details.agentMdPath;
  // Runner session id (v7): when the producer supplies it, persist it so the
  // reducer can dual-index the state under both the agentId and this id.
  // Absent with an older producer (< 0.2.3) → single-key, as today.
  // See change: resolve-subagent-inspector-by-session-id (D1/D2).
  if (typeof details.agentSessionId === "string") out.agentSessionId = details.agentSessionId;
  return out;
}

/** Filled step count of a (possibly sparse) streamed timeline. */
export function countSteps(entries: SubagentTimelineEntry[] | undefined): number {
  if (!entries) return 0;
  let n = 0;
  for (const e of entries) if (e) n++;
  return n;
}

/** Display marker inserted where a streamed block lost a piece. */
export const LIVE_BLOCK_GAP_MARKER = " … ";

/**
 * Apply one `subagent_delta` piece to the in-progress block (D7): append when
 * contiguous, ignore a fully covered duplicate, append the uncovered tail of a
 * partial overlap, and mark a gap when the piece starts past the logical end.
 * Returns undefined when the piece must be ignored (closed block / stale id).
 */
export function applyLiveBlockPiece(
  prev: SubagentState | undefined,
  piece: { blockId: number; kind: "thinking" | "text"; offset: number; text: string },
): SubagentLiveBlock | undefined {
  if (prev?.status === "completed" || prev?.status === "failed") return undefined;
  if (prev?.closedBlockMax !== undefined && piece.blockId <= prev.closedBlockMax) return undefined;
  let lb = prev?.liveBlock;
  if (lb && piece.blockId < lb.blockId) return undefined;
  if (!lb || lb.blockId !== piece.blockId) lb = { blockId: piece.blockId, kind: piece.kind, text: "", end: 0, gap: false };
  const { offset, text } = piece;
  const pieceEnd = offset + text.length;
  if (pieceEnd <= lb.end) return lb; // covered duplicate
  if (offset > lb.end) {
    return { ...lb, text: lb.text + (lb.text ? LIVE_BLOCK_GAP_MARKER : "") + text, end: pieceEnd, gap: true };
  }
  return { ...lb, text: lb.text + text.slice(lb.end - offset), end: pieceEnd };
}

/**
 * Dual-index a subagent state into the `subagents` map. Always sets the
 * canonical `state.id` (v4 agentId) key; when `state.agentSessionId` (v7) is
 * present, ALSO sets that key to the SAME reference so a lookup by either id
 * resolves the run. Both keys are a PAIR pointing at one object — any future
 * change deleting one on completion MUST delete the other (paired-key
 * invariant, design N1). Do NOT enumerate this map with `.values()/.entries()`
 * without de-duping by `state.id`: a dual-indexed agent appears under two keys.
 * See change: resolve-subagent-inspector-by-session-id (D2).
 */
export function setSubagentState(map: Map<string, SubagentState>, state: SubagentState): void {
  // A streamed timeline (subagent_entry) never shrinks: a later tick or terminal
  // frame whose `entries` is empty or holds fewer steps keeps the resident list.
  // A legacy frame with at least as many steps still replaces it.
  // See change: add-plugin-bridge-contributions (D7).
  const prev = map.get(state.id);
  if (prev?.entries && prev.entries !== state.entries && countSteps(state.entries) < countSteps(prev.entries)) {
    state = { ...state, entries: prev.entries };
  }
  map.set(state.id, state);
  if (state.agentSessionId) map.set(state.agentSessionId, state);
}
