/**
 * Event reducer: builds session UI state from a stream of events.
 * (state, event) → new state
 */

import { USAGE_LIMIT_PATTERN } from "@blackbelt-technology/pi-dashboard-shared/error-patterns.js";
// Flow + architect state derivation moved into flows-plugin per change
// pluginize-flows-via-registry. The shell carries no flow knowledge.
// Plugins consume `useSessionEvents(sessionId)` from
// @blackbelt-technology/dashboard-plugin-runtime to derive their own
// state; useMessageHandler.ts mirrors every msg.event into the
// per-session-events store the plugin runtime owns.
import { parseSkillBlock, type SkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import type { DashboardEvent, ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface ChatImage {
  data: string;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "thinking" | "bashOutput" | "commandFeedback" | "interactiveUi" | "turnSeparator" | "rawEvent" | "inlineTerminal";
  content: string;
  images?: ChatImage[];
  toolName?: string;
  toolCallId?: string;
  isStreaming?: boolean;
  timestamp: number;
  args?: Record<string, unknown>;
  result?: string;
  toolStatus?: "running" | "complete" | "error";
  /** Epoch ms when the block started (for live elapsed counter) */
  startedAt?: number;
  /** Duration in ms (set when complete) */
  duration?: number;
  /** Turn index for scroll-to-turn navigation */
  turnIndex?: number;
  /** Structured metadata from tool (e.g. AgentDetails from pi-subagents) */
  toolDetails?: Record<string, unknown>;
  /** Session entry ID (for fork-from-message) */
  entryId?: string;
  /**
   * Bridge-stamped nonce that ties this ChatMessage to a later
   * entry_persisted event. Set on user message_start (where entryId is
   * not yet known) and on message_end. The reducer uses it to back-fill
   * `entryId` once persistence completes. See change: fix-per-message-fork.
   */
  nonce?: string;
  /**
   * Parsed skill-invocation metadata for user messages whose persisted
   * content matches the `<skill name=...>...</skill>\n\nargs` envelope (pi's
   * `_expandSkillCommand` output, also produced by the dashboard bridge).
   * `content` is preserved as the raw expanded string for copy semantics;
   * the renderer uses `skill` to produce a collapsible card.
   * See change: render-skill-invocations-collapsibly.
   */
  skill?: SkillBlock;
  /**
   * When set, this user message is a duplicate produced by the manual
   * "Retry after error" button: its text matches the immediately-preceding
   * user message in `state.messages` AND the turn between them ended in
   * `lastError`. The chat view SHALL skip rendering this bubble; the entry
   * remains in `state.messages` for `findLastUserPrompt` / fork-from-here
   * / persistence compatibility. The pi session JSONL still records both
   * user entries.
   * See change: unify-status-banner-and-terminal-limit-stop.
   */
  retriedFrom?: string;
  /**
   * Dashboard-local `/view` preview target. When set, ChatView renders the
   * message as a `PreviewCard` instead of the default bubble. Bridge filters
   * `view`-bearing messages out of the pi-bound stream so the agent never
   * observes them. See change: render-file-previews.
   */
  view?: ViewTarget;
  /**
   * How pi delivered this user message when it arrived mid-stream (pi 0.77+
   * `InputEvent.streamingBehavior`). `"steer"` = interrupted + steered the
   * current turn; `"followUp"` = queued for after the current turn. Absent
   * for idle inputs and non-interactive sources. Stamped onto the user row
   * via correlation: the preceding interactive `input` event sets
   * `SessionState.pendingInputBehavior`, the next user `message_start`
   * consumes it. Renders as an inline badge on the user bubble.
   * See change: surface-input-streaming-behavior.
   */
  streamingBehavior?: "steer" | "followUp";
  /**
   * True when this `thinking` message was produced by the live event path
   * (`case "event"`), not the batch replay path. Drives the per-block
   * auto-collapse timer: only live-streamed reasoning mounts expanded and
   * arms a timer. Replayed / rehydrated / cold-loaded blocks leave this
   * falsy and render collapsed with no timer.
   * See change: reasoning-auto-collapse-timer.
   */
  streamedLive?: boolean;
}

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: string;
  /**
   * Epoch ms when `tool_execution_start` fired. Used by the session
   * activity bar to compute elapsed time for in-flight bash tools.
   * See change: redesign-process-list-activity-bar.
   */
  startedAt?: number;
  /**
   * Value of `SessionState.assistantInferenceSeq` at this tool's
   * `tool_execution_start` (i.e. its own emitting inference index). The
   * supersede heal proof is `state.assistantInferenceSeq > emittedAtInferenceSeq`
   * — a strictly-later assistant `message_start`. See change:
   * fix-stuck-tool-card-superseded-heal.
   */
  emittedAtInferenceSeq?: number;
}

export interface TurnStat {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Index into user messages for click-to-scroll (-1 if no user message for this turn) */
  turnIndex: number;
}

const MAX_TURN_STATS = 50;

export interface PendingPrompt {
  text: string;
  images?: ChatImage[];
  /** Delivery mode set by the sender. "steer" = after current turn, "followUp" = after agent finishes. See change: add-steering-message. */
  delivery?: "steer" | "followUp";
  /**
   * Progress state of the optimistic (idle-scoped) prompt bubble.
   * "sending" on write; "sent" once the bridge acks a fresh-turn receipt.
   * Cleared entirely (→ confirmed) when the user `message_start` lands.
   * See change: optimistic-prompt-progress.
   */
  status: "sending" | "sent";
}

/**
 * Apply a bridge `prompt_received` ack to a session's optimistic
 * `pendingPrompt`. `fresh:true` (idle/fresh-turn send) promotes the bubble to
 * `status:"sent"`; `fresh:false` (raced into a mid-turn queue entry) drops
 * `pendingPrompt` so the authoritative `queue_update` chip takes over with no
 * double render. No-op when no `pendingPrompt` exists.
 * See change: optimistic-prompt-progress.
 */
export function applyPromptReceived(state: SessionState, fresh: boolean): SessionState {
  if (!state.pendingPrompt) return state;
  if (!fresh) return { ...state, pendingPrompt: undefined };
  if (state.pendingPrompt.status === "sent") return state;
  return { ...state, pendingPrompt: { ...state.pendingPrompt, status: "sent" } };
}

export interface InteractiveUiRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
  status: "pending" | "resolved" | "cancelled" | "dismissed";
  result?: unknown;
}

/**
 * Per-step timeline entry for a subagent's run. Populated by the
 * `pi-dashboard-subagents` extension via `details.entries[]` on every
 * `subagents:*` event.
 *
 * Shape mirrors `FlowDetailEntry` (see flows-plugin) for visual consistency.
 * See change: add-subagent-inspector.
 */
// Subagent timeline types now live in the subagents plugin so producers and
// consumers share a single canonical location. Re-exported here for shell-side
// consumers that still reference them via `../lib/event-reducer.js`.
// See change: add-subagent-inspector.
export type { SubagentState, SubagentTimelineEntry } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";

import type { SubagentState, SubagentTimelineEntry } from "@blackbelt-technology/pi-dashboard-subagents-plugin/client";

export interface SessionState {
  messages: ChatMessage[];
  toolCalls: Map<string, ToolCallState>;
  streamingText: string;
  streamingThinking: string;
  /**
   * True when the user manually collapsed the LIVE streaming reasoning block.
   * Lifts the collapse intent across the streaming→committed block swap so the
   * committed message is created with `streamedLive:false` (no hold-open timer).
   * Reset to `false` on `thinking_start` and after each `thinking_end` flush.
   * See change: reasoning-auto-collapse-timer.
   */
  streamingThinkingCollapsed: boolean;
  /** Epoch ms when current thinking block started (for live counter) */
  thinkingStartedAt?: number;
  isStreaming: boolean;
  model?: string;
  thinkingLevel?: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  currentTool?: string;
  status: "idle" | "streaming" | "ended";
  turnStats: TurnStat[];
  contextUsage?: { tokens: number | null; contextWindow: number };
  pendingPrompt?: PendingPrompt;
  interactiveRequests: InteractiveUiRequest[];
  /** Whether any Write/Edit tool calls have been seen (for Changed Files button) */
  hasFileChanges: boolean;
  /** Active subagents from pi-dashboard-subagents (foreground, in-memory). */
  subagents: Map<string, SubagentState>;
  /** Total turn count (for turnIndex assignment and sliding window offset) */
  turnCount: number;
  /**
   * Monotonic count of assistant inferences (incremented on each assistant
   * `message_start`). NOT `message_end` (which fires after its own inference's
   * tool) and NOT the coarse per-user-cycle `turnCount`. Sole proof primitive
   * for the supersede heal: a stuck tool is finalized only once this advances
   * past the tool's `emittedAtInferenceSeq`. See change:
   * fix-stuck-tool-card-superseded-heal.
   */
  assistantInferenceSeq: number;
  /**
   * Correlation slot for `InputEvent.streamingBehavior`. Set by an
   * interactive `input` event that arrived mid-stream (steer/followUp),
   * consumed by the next user `message_start` which stamps it onto the
   * created ChatMessage, then cleared. Undefined for idle / non-interactive
   * inputs. See change: surface-input-streaming-behavior.
   */
  pendingInputBehavior?: "steer" | "followUp";
  /** Last LLM provider error (set from agent_end, cleared on agent_start or dismiss) */
  lastError?: { message: string; timestamp: number };
  /**
   * Non-error notice: the model returned only reasoning, no answer
   * (empty-actionable turn surfaced by the bridge guard). Set from the
   * `empty_actionable_surface` event, cleared on the next `agent_start`.
   * Distinct from `lastError` — rendered as info, never as an error.
   * See change: fix-gemini-subagent-silent-tool-schema-failure.
   */
  notice?: { message: string; timestamp: number };
  /**
   * In-flight LLM-provider auto-retry state. Set on `auto_retry_start`,
   * cleared on `auto_retry_end` / `agent_start` / `agent_end`. Drives the
   * `SessionBanner` UI (retrying variant) and the session-card amber dot.
   * See change: fix-provider-retry-infinite-loop.
   */
  retryState?: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    reason: string;
    startedAt: number;
  };
  /**
   * True iff the current assistant message has already had its streaming
   * text flushed into messages[] via flushStreamingTextAsAssistantRow.
   * Reset to false on every assistant message_start AND on every assistant
   * message_end (R7 defense-in-depth: keeps the flag's lifecycle equal to
   * "between message_start and message_end" so a stray tool_execution_start
   * arriving outside that window cannot silently no-op the flush).
   * See change: fix-streaming-text-vs-interactive-ui-order.
   */
  streamingTextFlushed?: boolean;
}

/**
 * Pull optional Phase-2 fields (`entries`, `activity`, `displayName`, model,
 * etc.) from a streamed `AgentDetails`-shaped object. Returns a partial that
 * spreads into a `SubagentState`. All fields are optional; absent keys yield
 * `undefined` which leaves any existing value intact when used as a `...spread`.
 *
 * See change: add-subagent-inspector.
 */
function readSubagentDetails(
  details: Record<string, unknown> | undefined,
): Partial<SubagentState> {
  if (!details) return {};
  const out: Partial<SubagentState> = {};
  if (Array.isArray(details.entries)) {
    out.entries = details.entries as SubagentTimelineEntry[];
  }
  if (typeof details.activity === "string") out.activity = details.activity;
  if (typeof details.displayName === "string") out.displayName = details.displayName;
  if (typeof details.modelName === "string") out.modelName = details.modelName;
  if (typeof details.subagentType === "string") out.subagentType = details.subagentType;
  if (typeof details.toolUses === "number") out.toolUses = details.toolUses;
  if (typeof details.durationMs === "number") out.durationMs = details.durationMs;
  if (typeof details.agentMdPath === "string") out.agentMdPath = details.agentMdPath;
  return out;
}

export function createInitialState(): SessionState {
  return {
    messages: [],
    toolCalls: new Map(),
    streamingText: "",
    streamingThinking: "",
    streamingThinkingCollapsed: false,
    isStreaming: false,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    status: "idle",
    turnStats: [],
    interactiveRequests: [],
    hasFileChanges: false,
    subagents: new Map(),
    turnCount: 0,
    assistantInferenceSeq: 0,
  };
}

/**
 * Sentinel body written into a supersede-healed tool row. Deliberately loud so
 * a real result loss reads as a visible "recovered" state, never a silent
 * bodyless success. See change: fix-stuck-tool-card-superseded-heal.
 */
export const SUPERSEDE_SENTINEL_BODY = "result unavailable — recovered by supersede heal";

/**
 * Proof-of-completion selector for the supersede heal. True iff `toolCallId` is
 * a still-`running` row AND a strictly-later assistant inference (a later
 * assistant `message_start`, tracked by `assistantInferenceSeq`) has been
 * applied than the one that emitted it. `message_end` and `turnCount` are NOT
 * used — see design D1. False for terminal or unknown rows.
 */
export function hasLaterAssistantInference(state: SessionState, toolCallId: string): boolean {
  const tc = state.toolCalls.get(toolCallId);
  if (!tc || tc.status !== "running" || tc.emittedAtInferenceSeq === undefined) return false;
  return state.assistantInferenceSeq > tc.emittedAtInferenceSeq;
}

/**
 * Build the synthetic `tool_execution_end` that finalizes a stuck card via the
 * existing toolCallId-keyed reducer path. Carries `isError:false`, the loud
 * sentinel body, and `healedBy:"superseded"`. A later REAL end overwrites it
 * (D4). See change: fix-stuck-tool-card-superseded-heal.
 */
export function synthesizeSupersededEnd(toolCallId: string, now: number): DashboardEvent {
  return {
    eventType: "tool_execution_end",
    timestamp: now,
    data: {
      toolCallId,
      result: SUPERSEDE_SENTINEL_BODY,
      isError: false,
      healedBy: "superseded",
    },
  };
}



/**
 * Hard turn boundaries in `messages[]`. Any row with one of these roles
 * terminates the backwards walk that builds the reorder window. Roles
 * not in this set (`assistant`, `toolResult`, `thinking`, `interactiveUi`,
 * `bashOutput`) belong to the current assistant turn and are reorderable.
 *
 * If a future row role is added, it MUST be classified — add it here if
 * it terminates a turn, otherwise leave it out and it will be reorderable.
 *
 * See change: fix-interactive-ui-reorder.
 */
const TURN_BOUNDARY_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
  "user",
  "turnSeparator",
  "commandFeedback",
  "rawEvent",
]);

/**
 * Flush the current `streamingText` into a permanent assistant ChatMessage
 * row. Called from `tool_execution_start` when streamingText is non-empty so
 * that any subsequent toolResult / interactiveUi rows pushed during the same
 * message land BELOW the assistant text in messages[], not above it.
 *
 * The pushed row's `id` is `flush-${toolCallId}` — content-stable across
 * replay so re-running the same `tool_execution_start` event does NOT push
 * a duplicate row. The third parameter `toolCallId` is the id of the tool
 * whose start triggered the flush (already in scope at the single caller
 * inside the `tool_execution_start` reducer arm).
 *
 * Idempotent guards:
 *   - `state.streamingTextFlushed === true`           → return state unchanged
 *   - `state.streamingText` empty                      → return state unchanged
 *   - a row with id `flush-${toolCallId}` already exists → return state unchanged
 *
 * Returns a new state with:
 *   - messages: [...state.messages, new assistant row (id = flush-${toolCallId},
 *     entryId/nonce both undefined; will be stamped at message_end via
 *     findFlushedAssistantRowIndex)]
 *   - streamingText: ""
 *   - streamingTextFlushed: true
 *
 * Pure: input is not mutated.
 *
 * See changes: fix-streaming-text-vs-interactive-ui-order,
 * fix-replay-duplicates-tool-and-flushed-rows.
 *
 * @param state Current session state
 * @param timestamp Event timestamp (used as the row's `timestamp`)
 * @param toolCallId Id of the upcoming tool — used as the row's stable id anchor
 */
export function flushStreamingTextAsAssistantRow(
  state: SessionState,
  timestamp: number,
  toolCallId: string,
): SessionState {
  if (state.streamingTextFlushed) return state;
  if (!state.streamingText) return state;
  // Replay safety: if a flush row already exists for this toolCallId, do not
  // push again. The reducer arm calling us is unconditional on every
  // tool_execution_start; this guard makes it idempotent.
  // See change: fix-replay-duplicates-tool-and-flushed-rows.
  const flushId = `flush-${toolCallId}`;
  const existingIdx = state.messages.findLastIndex(
    (m) => m.role === "assistant" && m.id === flushId,
  );
  if (existingIdx !== -1) {
    // Mark the flag so message_update stops re-populating streamingText
    // for this message; the row already exists.
    return { ...state, streamingText: "", streamingTextFlushed: true };
  }
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: flushId,
        role: "assistant",
        content: state.streamingText,
        timestamp,
        // entryId/nonce intentionally undefined — message_end stamps both
        // via findFlushedAssistantRowIndex below.
      },
    ],
    streamingText: "",
    streamingTextFlushed: true,
  };
}

/**
 * Find the most recent assistant row in `messages[]` whose `entryId` AND
 * `nonce` are both undefined — i.e. a row pushed by
 * `flushStreamingTextAsAssistantRow` that has not yet been stamped by its
 * `message_end`.
 *
 * Hard upper bound on the scan: stop at the first row whose role is in
 * `TURN_BOUNDARY_ROLES`. This clamp prevents R3 cross-message pollution
 * — a prior message's orphan flushed row (e.g. R2 disconnect dropped its
 * `message_end`) cannot be matched by a later message's stamp because the
 * `turnSeparator` / `user` row between them terminates the scan.
 *
 * Returns -1 if no unstamped flushed row is found in the current message's
 * window.
 *
 * See change: fix-streaming-text-vs-interactive-ui-order.
 */
export function findFlushedAssistantRowIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (TURN_BOUNDARY_ROLES.has(m.role)) return -1;
    if (m.role !== "assistant") continue;
    if (m.entryId === undefined && m.nonce === undefined) return i;
  }
  return -1;
}

/**
 * Derive the assistant text the UI should display for a finalized
 * `message_end`. Pi 0.71+ lets extensions REPLACE the finalized message
 * content (cost footers, redactions); the replacement lives on
 * `msg.content`. Array content concatenates `type: "text"` parts; string
 * content is used directly; missing content falls through to `fallback`
 * (the delta-derived `streamingText`), preserving pre-0.71 behavior.
 * See change: adopt-pi-071-072-073-features.
 */
export function deriveEffectiveAssistantText(msg: any, fallback: string): string {
  // Check shape, not truthiness: an extension may finalize the message to an
  // empty string (`""`) for redaction. Treating `""` as "missing" would
  // re-surface the streamed (un-redacted) text — a content leak. Only an
  // absent/non-string/non-array content falls through to `fallback`.
  const content = msg?.content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  if (typeof content === "string") return content;
  return fallback;
}

/**
 * Reorder the suffix of `messages` so that rows belonging to a single
 * assistant message_end land in the same order as the model's content
 * array. Without this, an assistant message of shape `[text, toolCall]`
 * renders the running tool card BEFORE its own text bubble — because
 * `tool_execution_start` pushes immediately while the assistant text
 * only lands at `message_end`.
 *
 * The reorder operates on a **turn-boundary anchored window**: walk
 * `messages[]` backwards from the tail collecting every row whose role
 * is not in `TURN_BOUNDARY_ROLES`, stopping at the first hard-boundary
 * row. The window is exactly "every row pushed during this assistant
 * turn" — prior turns cannot leak in.
 *
 * Matching rules (per content-array order):
 * - `text` block        → unclaimed `role:"assistant"` row in the window
 * - `toolCall` block    → `role:"toolResult"` row whose `toolCallId` matches,
 *                          PLUS any `role:"interactiveUi"` row whose `toolCallId`
 *                          matches (paired together as `[toolResult, interactiveUi]`)
 * - `thinking` block    → unclaimed `role:"thinking"` row in the window
 *
 * Window rows not matched by any content block ("unclaimed") are emitted
 * AFTER all claimed rows in their original relative order. This is safe
 * because the window is bounded by a hard turn boundary — prior-turn rows
 * cannot leak in. Free-floating `interactiveUi` rows (no `toolCallId`),
 * `bashOutput`, etc. follow this trailing path.
 *
 * Pure: returns a new array; the input is not mutated.
 * Preserves React keyed reconciliation: row `id` fields are unchanged
 * (`tool-${toolCallId}`, `ui-${requestId}`).
 *
 * See changes: fix-text-tool-render-order, fix-interactive-ui-reorder.
 */
function reorderToolCardsForAssistantMessage(
  messages: ChatMessage[],
  assistantContent: unknown[],
): ChatMessage[] {
  if (!Array.isArray(assistantContent)) return messages;
  // Fast path: nothing to reorder if there are no tool calls in this message.
  const hasToolCall = assistantContent.some(
    (b: any) => b && typeof b === "object" && b.type === "toolCall",
  );
  if (!hasToolCall) return messages;

  const relevant = assistantContent.filter(
    (b: any) =>
      b &&
      typeof b === "object" &&
      (b.type === "text" || b.type === "toolCall" || b.type === "thinking"),
  ) as Array<{ type: string; id?: string }>;
  if (relevant.length === 0) return messages;

  // Build the turn-boundary anchored window: walk backwards from the tail
  // including every row whose role is NOT a hard boundary; stop at the
  // first hard boundary row. Hard boundaries are `user`, `turnSeparator`,
  // `commandFeedback`, `rawEvent`. Roles included in the window are
  // `assistant`, `toolResult`, `thinking`, `interactiveUi`, `bashOutput`.
  //
  // The window is exactly "every row pushed during the current assistant
  // turn (and any preceding consecutive assistant turns without a user
  // response in between)". Unclaimed rows from prior consecutive
  // assistant turns are protected by the `original-index` guard below —
  // they stay in place and never migrate past the just-ended message.
  //
  // See change: fix-interactive-ui-reorder.
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (TURN_BOUNDARY_ROLES.has(messages[i].role)) {
      start = i + 1;
      break;
    }
  }
  const suffix = messages.slice(start);
  if (suffix.length === 0) return messages;

  // Helper: scan the suffix from the tail backwards for the most-recent
  // unclaimed row matching `pred`. We prefer the most-recent match
  // because back-to-back assistant messages without a user response in
  // between produce a window that includes both messages' rows; the
  // current-message row is always the more recent one of any matching pair.
  const claimedSuffixIdxs = new Set<number>();
  const findLastUnclaimed = (
    pred: (m: ChatMessage) => boolean,
  ): number => {
    for (let i = suffix.length - 1; i >= 0; i--) {
      if (!claimedSuffixIdxs.has(i) && pred(suffix[i])) return i;
    }
    return -1;
  };

  // Pass 1: walk content blocks in order, claim suffix indices.
  // For toolCall blocks, claim BOTH the toolResult and (if present) the
  // matching interactiveUi row, emitting them as `[toolResult, ui]`.
  const claimedInContentOrder: ChatMessage[] = [];
  for (const block of relevant) {
    if (block.type === "text") {
      const si = findLastUnclaimed((m) => m.role === "assistant");
      if (si >= 0) {
        claimedSuffixIdxs.add(si);
        claimedInContentOrder.push(suffix[si]);
      }
    } else if (block.type === "toolCall") {
      const id = block.id;
      const toolIdx = findLastUnclaimed(
        (m) => m.role === "toolResult" && m.toolCallId === id,
      );
      if (toolIdx >= 0) {
        claimedSuffixIdxs.add(toolIdx);
        claimedInContentOrder.push(suffix[toolIdx]);
        // Pair with an interactiveUi row carrying the same toolCallId.
        const uiIdx = findLastUnclaimed(
          (m) => m.role === "interactiveUi" && m.toolCallId === id,
        );
        if (uiIdx >= 0) {
          claimedSuffixIdxs.add(uiIdx);
          claimedInContentOrder.push(suffix[uiIdx]);
        }
      }
    } else if (block.type === "thinking") {
      const si = findLastUnclaimed((m) => m.role === "thinking");
      if (si >= 0) {
        claimedSuffixIdxs.add(si);
        claimedInContentOrder.push(suffix[si]);
      }
    }
    // else: block has no corresponding row in the window — skip silently.
  }

  // Pass 2: build the new suffix.
  //
  // Two kinds of unclaimed rows need different handling:
  //   (A) "Reorderable" roles (`assistant`, `toolResult`, `thinking`) that
  //       could in principle map to a content block. If they didn't get
  //       claimed, they likely belong to a PRIOR message that bled into
  //       the boundary-walked window (no `user` row between two assistant
  //       turns). Keep them at their **original suffix index** so they
  //       don't migrate past the just-ended message.
  //   (B) "Trailing" roles (`interactiveUi`, `bashOutput`) that NEVER map
  //       to a content block. The design says these trail AFTER claimed
  //       rows in their original relative order. This puts a free-floating
  //       `interactiveUi` (no `toolCallId`) after the just-rendered tool
  //       card instead of stranding it ahead of the assistant text.
  //
  // Construction strategy: walk the original suffix; emit each row in
  // place, replacing claimed rows with the next claimedInContentOrder
  // entry, dropping trailing-role unclaimed rows here so we can append
  // them after the loop. This keeps slot positions stable for unclaimed
  // "reorderable" rows.
  //
  // See change: fix-interactive-ui-reorder.
  const TRAILING_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
    "interactiveUi",
    "bashOutput",
  ]);
  const newSuffix: ChatMessage[] = [];
  const trailingUnclaimed: ChatMessage[] = [];
  let claimedCursor = 0;
  for (let i = 0; i < suffix.length; i++) {
    if (claimedSuffixIdxs.has(i)) {
      // This index belongs to a claimed row — fill from the
      // content-ordered queue (in order).
      if (claimedCursor < claimedInContentOrder.length) {
        newSuffix.push(claimedInContentOrder[claimedCursor++]);
      }
    } else if (TRAILING_ROLES.has(suffix[i].role)) {
      // Trailing-role unclaimed: drop here, append later.
      trailingUnclaimed.push(suffix[i]);
    } else {
      // Reorderable-role unclaimed: keep in place.
      newSuffix.push(suffix[i]);
    }
  }
  // Any leftover claimed rows (e.g. when toolCall + interactiveUi pair
  // has no matching ui slot in the original suffix because the ui row
  // came in after — shouldn't happen with current arrival order, but
  // defensively): append before trailing.
  while (claimedCursor < claimedInContentOrder.length) {
    newSuffix.push(claimedInContentOrder[claimedCursor++]);
  }
  // Trailing-role unclaimed go AFTER all claimed rows (rule B).
  for (const m of trailingUnclaimed) {
    newSuffix.push(m);
  }

  // Optimisation: if the new suffix is identical to the old suffix
  // (already in correct order) skip the array rebuild.
  if (newSuffix.length === suffix.length) {
    let changed = false;
    for (let i = 0; i < suffix.length; i++) {
      if (suffix[i] !== newSuffix[i]) {
        changed = true;
        break;
      }
    }
    if (!changed) return messages;
  }

  return [...messages.slice(0, start), ...(newSuffix as ChatMessage[])];
}

/** Extract text from content blocks: [{ type: "text", text: "..." }, ...] */
function extractContentBlockText(blocks: unknown[]): string | null {
  const texts = blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text);
  return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * Extract image attachments from tool_execution_end event data.
 * Handles two sources:
 * - Live events: data.result is {content: [{type:"image", data, mimeType}, ...]}
 * - Replayed events: data.images is already extracted by state-replay
 */
function extractToolResultImages(data: Record<string, unknown>): ChatImage[] | undefined {
  // Check pre-extracted images (from state-replay)
  if (Array.isArray(data.images) && data.images.length > 0) {
    return data.images
      .filter((img: any) => img?.data && img?.mimeType)
      .map((img: any) => ({ data: img.data as string, mimeType: img.mimeType as string }));
  }
  // Check live event: result.content array with image blocks
  const result = data.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const imageBlocks = content.filter(
        (c: any) => c?.type === "image" && c?.data && c?.mimeType,
      );
      if (imageBlocks.length > 0) {
        return imageBlocks.map((c: any) => ({ data: c.data as string, mimeType: c.mimeType as string }));
      }
    }
  }
  return undefined;
}

/** Convert an unknown value to a display string (handles objects/arrays). */
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    // Handle content-block arrays: [{ type: "text", text: "..." }, ...]
    if (Array.isArray(value)) {
      return extractContentBlockText(value) ?? JSON.stringify(value, null, 2);
    }
    // Handle wrapper object: { content: [{ type: "text", text: "..." }] }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return extractContentBlockText(obj.content) ?? JSON.stringify(value, null, 2);
    }
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function truncateLines(text: string | unknown, maxLines: number): string {
  const str = toDisplayString(text);
  const lines = str.split("\n");
  if (lines.length <= maxLines) return str;
  return lines.slice(0, maxLines).join("\n");
}

/** Marker prefix prepended to truncated tool output. U+00AB is visually
 * distinct from literal tool text, so the UI can detect truncation by
 * checking `result.startsWith("«")`. See change:
 * adopt-pi-071-072-073-features. */
export const TRUNCATION_MARKER_PREFIX = "«";

/**
 * Truncate tool output for display keeping the LAST N lines (default 200).
 * Bash/test/install output puts the summary, error, and totals at the BOTTOM,
 * so trailing lines carry the signal. Prepends a `«N earlier lines hidden»`
 * marker when truncating; returns text unchanged when within the cap.
 * See change: adopt-pi-071-072-073-features.
 */
export function truncateOutputForDisplay(
  text: string | unknown,
  opts?: { maxLines?: number },
): string {
  const maxLines = opts?.maxLines ?? 200;
  const str = toDisplayString(text);
  // Idempotency: a result already in the display form (server pre-truncated it
  // on replay to trim bytes — see change: reduce-session-replay-traffic) starts
  // with the FULL marker header. Match the exact header (not just a leading «,
  // which a raw tool result could legitimately start with) so we never skip
  // truncating genuine output. Re-truncating the display form would corrupt the
  // "N earlier lines hidden" count, so pass it through unchanged.
  if (/^«\d+ earlier lines hidden»\n/.test(str)) return str;
  const lines = str.split("\n");
  if (lines.length <= maxLines) return str;
  const dropped = lines.length - maxLines;
  return `${TRUNCATION_MARKER_PREFIX}${dropped} earlier lines hidden»\n${lines.slice(-maxLines).join("\n")}`;
}

/**
 * Add a new interactive UI request to session state.
 *
 * `toolCallId` (optional): when this prompt was emitted from inside a tool
 * execution (e.g. `ask_user`), the originating tool call's id flows through
 * `prompt_request.metadata.toolCallId` and is stamped onto the pushed
 * `role:"interactiveUi"` ChatMessage so the assistant `message_end` reorder
 * helper can pair it with its parent `toolResult` row. Free-floating prompts
 * (architect mode, slash commands) leave it undefined.
 *
 * See change: fix-interactive-ui-reorder.
 */
export function addInteractiveRequest(
  state: SessionState,
  requestId: string,
  method: string,
  params: Record<string, unknown>,
  toolCallId?: string,
): SessionState {
  // Architect suppression logic REMOVED — the PromptBus now ensures each prompt
  // is sent to the dashboard exactly once, with the correct component.
  // No more client-side guessing about which prompts to suppress.

  // Deduplicate by requestId (re-sent on reconnect) or by content
  // (recursive proxy generates multiple requestIds for the same dialog)
  if (state.interactiveRequests.some((r) =>
    r.requestId === requestId ||
    (r.status === "pending" && r.method === method && r.params.title === params.title),
  )) {
    return state;
  }
  const request: InteractiveUiRequest = { requestId, method, params, status: "pending" };
  return {
    ...state,
    interactiveRequests: [...state.interactiveRequests, request],
    messages: [
      ...state.messages,
      {
        id: `ui-${requestId}`,
        role: "interactiveUi",
        content: method,
        timestamp: Date.now(),
        toolCallId,
        args: { requestId, method, params, status: "pending" } as any,
      },
    ],
  };
}

/** Resolve an interactive UI request in session state */
export function resolveInteractiveRequest(
  state: SessionState,
  requestId: string,
  result?: unknown,
  cancelled?: boolean,
): SessionState {
  const newStatus = cancelled ? "cancelled" as const : "resolved" as const;
  return {
    ...state,
    interactiveRequests: state.interactiveRequests.map((req) =>
      req.requestId === requestId
        ? { ...req, status: newStatus, result }
        : req,
    ),
    messages: state.messages.map((msg) =>
      msg.id === `ui-${requestId}`
        ? { ...msg, args: { ...msg.args as any, status: newStatus, result } }
        : msg,
    ),
  };
}

/** Dismiss an interactive UI request (answered in TUI, not via dashboard) */
export function dismissInteractiveRequest(
  state: SessionState,
  requestId: string,
): SessionState {
  // Only dismiss pending requests
  const existing = state.interactiveRequests.find((r) => r.requestId === requestId);
  if (!existing || existing.status !== "pending") return state;

  return {
    ...state,
    interactiveRequests: state.interactiveRequests.map((req) =>
      req.requestId === requestId
        ? { ...req, status: "dismissed" as const }
        : req,
    ),
    messages: state.messages.map((msg) =>
      msg.id === `ui-${requestId}`
        ? { ...msg, args: { ...msg.args as any, status: "dismissed" } }
        : msg,
    ),
  };
}

/**
 * Find the most recent `user`-role ChatMessage and return its content + images
 * mapped to the wire-format `ImageContent[]` shape (adds `type: "image"`).
 *
 * Used by the Retry-after-error button to re-send the failed turn via
 * `send_prompt` (which routes to `pi.sendUserMessage` in the bridge). Skips
 * non-user roles like `interactiveUi`, so an `ask_user` response cannot be
 * mistaken for a prompt.
 *
 * Returns `null` when no user message exists in history.
 *
 * See change: fix-retry-resends-last-user-message.
 */
export function findLastUserPrompt(
  messages: readonly ChatMessage[],
): { text: string; images?: { type: "image"; data: string; mimeType: string }[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const images = m.images?.map((img) => ({
      type: "image" as const,
      data: img.data,
      mimeType: img.mimeType,
    }));
    return { text: m.content, ...(images && images.length > 0 ? { images } : {}) };
  }
  return null;
}

/** Extract error info from agent_end event's messages array. */
export function extractAgentEndError(data: Record<string, unknown>): string | undefined {
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last || last.stopReason !== "error") return undefined;
  return (last.errorMessage as string) || "An unknown error occurred";
}

/**
 * Terminal-success stop reasons. pi-ai emits `"stop"` for a normal completion
 * (verified against the published union — see
 * `packages/server/src/model-proxy/convert/anthropic-out.ts`, which maps pi-ai
 * `"toolUse"`/`"length"` and otherwise to the Anthropic wire value). `"end_turn"`
 * is accepted too because the repo's own fixtures / any Anthropic-normalized
 * path use it. Mid-turn / non-success reasons (`"toolUse"`, `"error"`,
 * `"aborted"`, `"length"`) are deliberately EXCLUDED so a tool-use pause, an
 * error, or a user abort never clears the persistent error anchor.
 * See change: unify-error-retry-lifecycle.
 */
const CONFIRMED_GOOD_STOP_REASONS: ReadonlySet<string> = new Set(["stop", "end_turn"]);

/**
 * True iff an `agent_end` event is a confirmed-good terminal: it has a last
 * message AND that message completed with a terminal SUCCESS stop
 * (`CONFIRMED_GOOD_STOP_REASONS`). Deliberately NOT "any non-error stop": pi
 * fires an `agent_end` whose last message is a `toolUse` stop when a turn yields
 * at an interactive tool (e.g. `ask_user`) — a mid-turn pause, not a successful
 * response, and must NOT clear the persistent error anchor. An agent_end with
 * NO messages (e.g. a bare abort) is likewise not clean.
 * See change: unify-error-retry-lifecycle.
 */
export function isCleanAgentEnd(data: Record<string, unknown>): boolean {
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  return !!last && CONFIRMED_GOOD_STOP_REASONS.has(last.stopReason as string);
}

/**
 * Derived banner state for the unified `SessionBanner` component. ONE
 * composed error-lifecycle surface per session: an optional persistent
 * error anchor (from `lastError`) AND an optional live retry sub-status
 * (from `retryState`). The previous "retrying XOR error" precedence is
 * replaced by composition — when both are set, the error anchor renders
 * as the header AND the retry status renders as a sub-line in the same
 * surface. Returns `{ variant: "hidden" }` only when BOTH are undefined.
 *
 * `error.kind` is `"limit-exceeded"` when `USAGE_LIMIT_PATTERN` matches,
 * else `"error"`.
 *
 * See change: unify-error-retry-lifecycle.
 */
export interface BannerRetry {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  startedAt: number;
  reason: string;
}
export type BannerState =
  | { variant: "hidden" }
  | {
      error?: { kind: "error" | "limit-exceeded"; message: string };
      retry?: BannerRetry;
    };

export function deriveBannerState(state: SessionState): BannerState {
  if (!state.lastError && !state.retryState) return { variant: "hidden" };
  const out: { error?: { kind: "error" | "limit-exceeded"; message: string }; retry?: BannerRetry } = {};
  if (state.lastError) {
    const limit = USAGE_LIMIT_PATTERN.test(state.lastError.message);
    out.error = { kind: limit ? "limit-exceeded" : "error", message: state.lastError.message };
  }
  if (state.retryState) {
    out.retry = {
      attempt: state.retryState.attempt,
      maxAttempts: state.retryState.maxAttempts,
      delayMs: state.retryState.delayMs,
      startedAt: state.retryState.startedAt,
      reason: state.retryState.reason,
    };
  }
  return out;
}

export function reduceEvent(
  state: SessionState,
  event: DashboardEvent,
  opts?: { isLive?: boolean },
): SessionState {
  const isLive = opts?.isLive === true;
  const next = { ...state, toolCalls: new Map(state.toolCalls) };
  const data = event.data;

  switch (event.eventType) {
    case "agent_start":
      next.isStreaming = true;
      next.status = "streaming";
      next.streamingText = "";
      next.pendingPrompt = undefined;
      // lastError is NOT cleared here. The error anchor persists across the
      // start of a retry/continuation turn and clears only on a confirmed
      // non-error response (message_end end_turn / clean agent_end). This
      // removes the optimistic-clear desync where the error vanished before
      // the retry was confirmed good. See change: unify-error-retry-lifecycle.
      next.retryState = undefined;
      // A fresh turn clears any stale empty-actionable notice.
      // See change: fix-gemini-subagent-silent-tool-schema-failure.
      next.notice = undefined;
      break;

    case "empty_actionable_surface": {
      // Non-error status: the model returned only reasoning, no answer. Set a
      // notice distinct from lastError so the card renders info, not an error.
      // See change: fix-gemini-subagent-silent-tool-schema-failure.
      const message =
        typeof data.message === "string" && data.message.length > 0
          ? data.message
          : "model returned only reasoning, no answer";
      next.notice = { message, timestamp: event.timestamp };
      break;
    }

    case "agent_end": {
      next.isStreaming = false;
      next.status = "idle";
      next.streamingText = "";
      next.currentTool = undefined;
      next.pendingPrompt = undefined;
      const errorMsg = extractAgentEndError(data);
      if (errorMsg) {
        next.lastError = { message: errorMsg, timestamp: event.timestamp };
      } else if (isCleanAgentEnd(data)) {
        // Confirmed-good clear: a terminal agent_end whose last message is a
        // non-error stop clears the persistent error anchor.
        // See change: unify-error-retry-lifecycle.
        next.lastError = undefined;
      }
      next.retryState = undefined;
      break;
    }

    case "auto_retry_start": {
      // Defensive guard: drop the event when a fresh same-turn lastError is
      // already set and the session is not streaming. This prevents the
      // (yellow + red) banner-overlap state if any future bridge ordering
      // bug ever delivers an `auto_retry_start` AFTER `agent_end` for the
      // same terminal turn. Existing carry-over behavior (stale red from a
      // prior turn + fresh yellow on a new turn) is preserved because by
      // the time the new turn's `auto_retry_start` arrives, `agent_start`
      // has already cleared `lastError` (so the guard's first precondition
      // is false). See change: fix-retry-banner-stuck-on-limit-exceeded.
      const FRESH_ERROR_WINDOW_MS = 1500;
      if (
        state.lastError &&
        !state.isStreaming &&
        event.timestamp - state.lastError.timestamp <= FRESH_ERROR_WINDOW_MS
      ) {
        break;
      }
      const attempt = typeof data.attempt === "number" ? data.attempt : 1;
      const maxAttempts = typeof data.maxAttempts === "number" ? data.maxAttempts : 1;
      const delayMs = typeof data.delayMs === "number" ? data.delayMs : 0;
      const reason = typeof data.errorMessage === "string" ? data.errorMessage : "Provider error";
      next.retryState = { attempt, maxAttempts, delayMs, reason, startedAt: event.timestamp };
      break;
    }

    case "auto_retry_end": {
      // No-op if no retry was tracked (covers stale events / multi-call turns).
      if (!state.retryState) {
        break;
      }
      next.retryState = undefined;
      // Surface terminal error early when no other lastError has fired yet.
      if (data.success === false && typeof data.finalError === "string" && !state.lastError) {
        next.lastError = { message: data.finalError, timestamp: event.timestamp };
      }
      break;
    }

    case "message_start": {
      const msg = data.message as any;
      if (msg?.role === "assistant") {
        // Reset the per-message flush flag at the start of every assistant
        // message. See change: fix-streaming-text-vs-interactive-ui-order.
        next.streamingTextFlushed = false;
        // Advance the inference counter. A new assistant message can only begin
        // after every prior tool result is in hand, so this is the supersede
        // heal's proof-of-completion boundary. See change:
        // fix-stuck-tool-card-superseded-heal.
        next.assistantInferenceSeq = next.assistantInferenceSeq + 1;
      }
      if (msg?.role === "user") {
        next.pendingPrompt = undefined;
        let text = "";
        let images: ChatImage[] | undefined;
        if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          const imgBlocks = msg.content.filter(
            (c: any) => c.type === "image" && c.data && c.mimeType,
          );
          if (imgBlocks.length > 0) {
            images = imgBlocks.map((c: any) => ({
              data: c.data,
              mimeType: c.mimeType,
            }));
          }
        } else {
          text = String(msg.content ?? "");
        }
        // Detect a wrapped <skill>...</skill> envelope so the renderer can show
        // a collapsible card and ArrowUp recall can return the slash form.
        // See change: render-skill-invocations-collapsibly.
        const skill = parseSkillBlock(text) ?? undefined;

        // Visual-dedup for manual retry: if the new user text matches the
        // immediately-preceding user message AND the assistant turn between
        // them ended in an error, flag `retriedFrom`. The chat view skips
        // rendering flagged duplicates. The entry stays in `state.messages`
        // for findLastUserPrompt / fork-from-here / persistence parity.
        // See change: unify-status-banner-and-terminal-limit-stop.
        let retriedFrom: string | undefined;
        const trimmedText = text.trim();
        if (trimmedText.length > 0) {
          // Walk back to the most recent user message.
          let lastErrorBetween = false;
          let prevUserIdx = -1;
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const m = state.messages[i]!;
            if (m.role === "assistant" && m.toolStatus === "error") {
              lastErrorBetween = true;
            }
            if (m.role === "user") {
              prevUserIdx = i;
              break;
            }
          }
          // Also accept `state.lastError` (set by agent_end / auto_retry_end
          // arms) as evidence of an error between the two user messages.
          // This covers the common case where the error sits on lastError
          // rather than on an assistant ChatMessage with toolStatus.
          if (state.lastError) lastErrorBetween = true;
          if (prevUserIdx >= 0 && lastErrorBetween) {
            const prev = state.messages[prevUserIdx]!;
            if (prev.content.trim() === trimmedText) {
              retriedFrom = prev.entryId ?? prev.id;
            }
          }
        }

        next.messages = [
          ...next.messages,
          {
            id: `msg-${next.messages.length}`,
            role: "user",
            content: text,
            ...(skill ? { skill } : {}),
            ...(retriedFrom ? { retriedFrom } : {}),
            images,
            timestamp: event.timestamp,
            // entryId from data.entryId is correct ONLY for replayed events
            // (state-replay attaches the persisted id). For LIVE user
            // message_start the bridge no longer stamps entryId because
            // the user entry has not been persisted yet — it will arrive
            // via a later entry_persisted event keyed on `nonce`.
            // See change: fix-per-message-fork.
            entryId: data.entryId as string | undefined,
            nonce: data.nonce as string | undefined,
            // Stamp the mid-stream delivery mode captured from the preceding
            // interactive `input` event, then clear the correlation slot.
            // See change: surface-input-streaming-behavior.
            ...(state.pendingInputBehavior
              ? { streamingBehavior: state.pendingInputBehavior }
              : {}),
          },
        ];
        next.pendingInputBehavior = undefined;
      }
      break;
    }

    case "input": {
      // pi 0.77+ InputEvent. When an interactive user message arrives
      // mid-stream, pi sets `streamingBehavior` ("steer" | "followUp"); idle
      // inputs leave it undefined. We remember the behavior so the next user
      // `message_start` can stamp it onto the rendered bubble as a badge.
      // Non-interactive sources (rpc / extension) already surface via
      // command_feedback / extension messages, so we skip them to avoid
      // duplicate signal. See change: surface-input-streaming-behavior.
      const source = data.source as string | undefined;
      const behavior = data.streamingBehavior as "steer" | "followUp" | undefined;
      if (source === "interactive" && (behavior === "steer" || behavior === "followUp")) {
        next.pendingInputBehavior = behavior;
      }
      break;
    }

    case "message_update": {
      const assistantEvent = data.assistantMessageEvent as any;

      // Handle thinking events from assistantMessageEvent
      if (assistantEvent) {
        if (assistantEvent.type === "thinking_start") {
          next.streamingThinking = "";
          next.streamingThinkingCollapsed = false;
          next.thinkingStartedAt = event.timestamp;
          break;
        }
        if (assistantEvent.type === "thinking_delta") {
          next.streamingThinking = next.streamingThinking + (assistantEvent.delta ?? "");
          break;
        }
        if (assistantEvent.type === "thinking_end") {
          if (next.streamingThinking) {
            const startedAt = next.thinkingStartedAt;
            next.messages = [
              ...next.messages,
              {
                id: `thinking-${next.messages.length}`,
                role: "thinking",
                content: next.streamingThinking,
                timestamp: event.timestamp,
                startedAt,
                duration: startedAt ? event.timestamp - startedAt : undefined,
                streamedLive: next.streamingThinkingCollapsed ? false : isLive,
              },
            ];
          }
          next.streamingThinking = "";
          next.streamingThinkingCollapsed = false;
          next.thinkingStartedAt = undefined;
          break;
        }
      }

      // Handle text streaming
      const msg = data.message as any;
      if (msg?.role === "assistant") {
        // If streamingText was already flushed for this message,
        // re-populating it here would re-show the flushed prefix below the
        // messages list (or, for [text, toolCall, text]-shaped messages,
        // would resurrect text1 alongside text2). Skip the assignment;
        // any post-flush text content is committed at message_end via the
        // existing reorder pass. See change:
        // fix-streaming-text-vs-interactive-ui-order.
        if (!next.streamingTextFlushed) {
          const text = Array.isArray(msg.content)
            ? msg.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("")
            : String(msg.content ?? "");
          next.streamingText = text;
        }
      }
      break;
    }

    case "message_end": {
      const msg = data.message as any;
      if (msg?.role === "assistant") {
        // Confirmed-good clear: an assistant message that completed with a
        // terminal SUCCESS stop (pi-ai `"stop"`; `"end_turn"` accepted too)
        // clears the persistent error anchor. Mid-turn / non-success stops
        // (`toolUse`, `error`, `aborted`, `length`) do NOT clear — the turn can
        // still error afterward, and clearing on them would flicker / drop the
        // anchor across an interactive pause.
        // See change: unify-error-retry-lifecycle.
        if (CONFIRMED_GOOD_STOP_REASONS.has(msg.stopReason)) {
          next.lastError = undefined;
        }
        // Reasoning reconstruction on REPLAY. Live turns build `thinking` rows
        // from thinking_start/delta/end events (see message_update), but the
        // cold-load path (state-replay.ts) emits NO thinking_* events — the
        // reasoning lives inline in the finalized message's content as
        // `{ type: "thinking", thinking: "…" }` blocks. Rebuild the rows here so
        // reopened sessions show reasoning. Appended before the assistant text
        // row below → correct [thinking, text] order; for tool-bearing messages
        // the reorder pass repositions by content order.
        // See change: reconstruct-reasoning-on-replay.
        //
        // Dedupe guard: `!isLive` is the WRONG signal — a streamed turn can
        // reach a message_end whose opts.isLive is not true (the default), so
        // `!isLive` alone double-creates the row. The real condition is "does a
        // thinking row for the current assistant turn already exist?". Walk
        // back to the turn boundary and skip reconstruction when one does.
        // Real cold replay has no streamed thinking_* rows → none exists →
        // reconstruction still fires.
        // See change: fix-double-thinking-row-on-replay-reconstruction.
        let turnStart = 0;
        for (let i = next.messages.length - 1; i >= 0; i--) {
          if (TURN_BOUNDARY_ROLES.has(next.messages[i].role)) {
            turnStart = i + 1;
            break;
          }
        }
        const turnHasThinkingRow = next.messages
          .slice(turnStart)
          .some((m) => m.role === "thinking");
        if (!turnHasThinkingRow && Array.isArray(msg.content)) {
          const thinkingRows: ChatMessage[] = [];
          for (const block of msg.content as any[]) {
            if (block?.type !== "thinking") continue;
            const text = typeof block.thinking === "string" ? block.thinking
              : typeof block.text === "string" ? block.text : "";
            if (!text) continue;
            thinkingRows.push({
              id: `thinking-${next.messages.length + thinkingRows.length}`,
              role: "thinking",
              content: text,
              timestamp: event.timestamp,
              streamedLive: false,
            });
          }
          if (thinkingRows.length > 0) {
            next.messages = [...next.messages, ...thinkingRows];
          }
        }
        // Pi 0.71+ message_end may REPLACE the finalized content. Compute the
        // effective text once and apply uniformly across branches.
        // See change: adopt-pi-071-072-073-features.
        const effectiveContent = deriveEffectiveAssistantText(msg, next.streamingText);
        if (next.streamingTextFlushed) {
          // Streaming text was already flushed at tool_execution_start.
          // Locate the unstamped flushed row and stamp entryId / nonce in
          // place — do NOT push a duplicate. The reorder pass below still
          // runs against the existing row. See change:
          // fix-streaming-text-vs-interactive-ui-order.
          const flushedIdx = findFlushedAssistantRowIndex(next.messages);
          if (flushedIdx >= 0) {
            const stamped: ChatMessage = {
              ...next.messages[flushedIdx],
              entryId: data.entryId as string | undefined,
              nonce: data.nonce as string | undefined,
            };
            // Honor message_end content replacement: swap the flushed row's
            // content only when it differs (avoid object-identity churn).
            if (effectiveContent !== next.messages[flushedIdx].content) {
              stamped.content = effectiveContent;
            }
            next.messages = [
              ...next.messages.slice(0, flushedIdx),
              stamped,
              ...next.messages.slice(flushedIdx + 1),
            ];
          }
          // Note: streamingText is already "" because the flush cleared it.
          // We deliberately leave next.streamingText untouched here.
        } else if (next.streamingText) {
          next.messages = [
            ...next.messages,
            {
              id: `msg-${next.messages.length}`,
              role: "assistant",
              content: effectiveContent,
              timestamp: event.timestamp,
              entryId: data.entryId as string | undefined,
              nonce: data.nonce as string | undefined,
            },
          ];
          next.streamingText = "";
        } else {
          // Replay/fork scenario: streamingText is empty but message may have content
          const replayText = msg.content
            ? (Array.isArray(msg.content)
                ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
                : String(msg.content))
            : "";
          if (replayText) {
            next.messages = [
              ...next.messages,
              {
                id: `msg-${next.messages.length}`,
                role: "assistant",
                content: replayText,
                timestamp: event.timestamp,
                entryId: data.entryId as string | undefined,
                nonce: data.nonce as string | undefined,
              },
            ];
          } else {
            // Tool-only assistant turn (no prose) — add a thin separator
            // so consecutive tool call groups don't blend together
            const lastMsg = next.messages[next.messages.length - 1];
            if (lastMsg?.role === "toolResult") {
              next.messages = [
                ...next.messages,
                {
                  id: `sep-${next.messages.length}`,
                  role: "turnSeparator",
                  content: "",
                  timestamp: event.timestamp,
                },
              ];
            }
          }
        }

        // Reorder suffix so the assistant text bubble and its child tool
        // cards land in the order dictated by the model's content array.
        // Fast-path skipped inside the helper when no toolCall blocks.
        // See change: fix-text-tool-render-order.
        if (Array.isArray(msg?.content)) {
          next.messages = reorderToolCardsForAssistantMessage(next.messages, msg.content);
        }

        // R7 defense-in-depth: reset the flag at message_end so the flag's
        // lifecycle equals "between message_start and message_end". A stray
        // tool_execution_start arriving before the next message_start would
        // otherwise silently no-op the flush. See change:
        // fix-streaming-text-vs-interactive-ui-order.
        next.streamingTextFlushed = false;
      }
      break;
    }

    case "tool_execution_start": {
      const toolCallId = data.toolCallId as string;
      // A live tool_execution_start can arrive with an absent/non-string
      // toolName (pi core emits it that way for some tools; the bridge
      // forwards it verbatim). Coalesce to a stable fallback so the card
      // renders instead of throwing on `.toLowerCase()` below — the reducer
      // also runs at App level (rehydrate re-reduce) above every error
      // boundary, where a throw black-screens the whole app. Mirrors the
      // tool_execution_end `toolName ?? "unknown"` default in state-replay.
      // See change: fix-reducer-crash-undefined-toolname.
      const toolName = typeof data.toolName === "string" ? data.toolName : "unknown";

      // Flush any pending streamingText into a permanent assistant row
      // BEFORE pushing the new toolResult, so the message's content-array
      // order is preserved in messages[] for the entire tool runtime —
      // not just at message_end. The flush row's id is keyed on toolCallId
      // so replay is idempotent. See changes:
      // fix-streaming-text-vs-interactive-ui-order,
      // fix-replay-duplicates-tool-and-flushed-rows.
      if (next.streamingText && !next.streamingTextFlushed) {
        Object.assign(
          next,
          flushStreamingTextAsAssistantRow(next, event.timestamp, toolCallId),
        );
      }
      const args = data.args as Record<string, unknown> | undefined;
      next.toolCalls.set(toolCallId, {
        toolCallId,
        toolName,
        args,
        status: "running",
        startedAt: event.timestamp,
        // Stamp the emitting inference index; its own `message_start` has
        // already advanced the counter, so only a LATER inference satisfies the
        // supersede proof. See change: fix-stuck-tool-card-superseded-heal.
        emittedAtInferenceSeq: next.assistantInferenceSeq,
      });
      next.currentTool = toolName;

      // Track file-modifying tools
      const toolLower = toolName.toLowerCase();
      if (toolLower === "write" || toolLower === "edit") {
        next.hasFileChanges = true;
      }

      // Idempotency on toolCallId: if any row already exists for this
      // toolCallId (re-replay, reconnect re-replay), update it in place
      // instead of pushing a duplicate React key. The id `tool-${toolCallId}`
      // is the React key, so a fresh push would always collide — there's no
      // safe "fall-through to push" branch. We refresh args/toolName/timestamps
      // only; result/duration/toolDetails/images/toolStatus remain so terminal
      // rows keep their finalised data on re-replay of the start event.
      // See change: fix-replay-duplicates-tool-and-flushed-rows.
      const existingToolIdx = next.messages.findLastIndex(
        (m) => m.role === "toolResult" && m.toolCallId === toolCallId,
      );
      if (existingToolIdx !== -1) {
        next.messages = [...next.messages];
        next.messages[existingToolIdx] = {
          ...next.messages[existingToolIdx],
          toolName,
          args,
          // Keep startedAt/timestamp from the original row — the existing
          // values are already correct for terminal rows, and refreshing them
          // would invalidate `duration` derived from startedAt at end-time.
        };
        break;
      }

      // Add tool message immediately (visible while running)
      next.messages = [
        ...next.messages,
        {
          id: `tool-${toolCallId}`,
          role: "toolResult",
          content: toolName,
          toolName,
          toolCallId,
          args,
          toolStatus: "running",
          timestamp: event.timestamp,
          startedAt: event.timestamp,
        },
      ];
      break;
    }

    case "tool_execution_update": {
      const toolCallId = data.toolCallId as string;
      const partialResult = data.partialResult;
      if (partialResult) {
        const idx = next.messages.findLastIndex((m) => m.toolCallId === toolCallId);
        if (idx !== -1) {
          next.messages = [...next.messages];
          // Structured partialResult (e.g. Agent tool sends { content, details })
          if (typeof partialResult === "object" && partialResult !== null) {
            const structured = partialResult as Record<string, unknown>;
            const details = structured.details as Record<string, unknown> | undefined;
            // Extract text from content array or stringify
            let text: string | undefined;
            const content = structured.content;
            if (Array.isArray(content) && content.length > 0 && content[0]?.text) {
              text = content[0].text as string;
            } else if (content != null) {
              text = String(content);
            }
            next.messages[idx] = {
              ...next.messages[idx],
              ...(text != null ? { result: truncateOutputForDisplay(text) } : {}),
              ...(details ? { toolDetails: details } : {}),
            };
          } else {
            // Plain string partialResult (standard tools)
            next.messages[idx] = {
              ...next.messages[idx],
              result: truncateOutputForDisplay(partialResult as string),
            };
          }
        }
      }
      break;
    }

    case "tool_execution_end": {
      const toolCallId = data.toolCallId as string;
      // Supersede heal (`healedBy:"superseded"`) is a client-synthesized
      // placeholder. D4: it MUST NOT clobber a real terminal row nor another
      // superseded row — only a `running` row is eligible. A real end (no
      // `healedBy`) always proceeds and overwrites a superseded placeholder.
      // See change: fix-stuck-tool-card-superseded-heal.
      const healedBy = data.healedBy as string | undefined;
      const existing = next.toolCalls.get(toolCallId);
      // A superseded synth may only finalize a live `running` map entry. An
      // absent entry (`existing === undefined`) is also rejected so a stray
      // synth can never mutate a message row while leaving `toolCalls`
      // inconsistent. Real ends (no `healedBy`) are unaffected.
      if (healedBy === "superseded" && existing?.status !== "running") {
        break;
      }
      if (existing) {
        next.toolCalls.set(toolCallId, {
          ...existing,
          status: (data.isError as boolean) ? "error" : "complete",
        });
      }
      next.currentTool = undefined;

      // Extract images from tool result (live events have result.content, replayed have data.images)
      const images = extractToolResultImages(data);

      // Update existing tool message in-place
      const idx = next.messages.findLastIndex((m) => m.toolCallId === toolCallId);
      if (idx !== -1) {
        const result = data.result as string | undefined;
        const msgStartedAt = next.messages[idx].startedAt;
        next.messages = [...next.messages];
        // Extract tool details (e.g. AgentDetails from replayed sessions)
        const endDetails = data.details as Record<string, unknown> | undefined;
        // For live events (no endDetails), update existing toolDetails.status
        // so renderers (e.g. AgentToolRenderer) see the final status
        const isError = data.isError as boolean;
        let mergedDetails: Record<string, unknown> | undefined;
        if (endDetails) {
          mergedDetails = endDetails;
        } else if (next.messages[idx].toolDetails) {
          mergedDetails = {
            ...next.messages[idx].toolDetails,
            status: isError ? "error" : "completed",
          };
        }
        // Thread the supersede marker: set it on a synthesized heal; CLEAR it
        // when a real end (no `healedBy`) overwrites a prior superseded
        // placeholder, so the recovered badge disappears with the real body.
        // See change: fix-stuck-tool-card-superseded-heal.
        let finalDetails = mergedDetails;
        if (healedBy === "superseded") {
          finalDetails = { ...(finalDetails ?? {}), healedBy: "superseded" };
        } else if (finalDetails && "healedBy" in finalDetails) {
          const { healedBy: _dropped, ...rest } = finalDetails;
          finalDetails = rest;
        }
        next.messages[idx] = {
          ...next.messages[idx],
          toolStatus: isError ? "error" : "complete",
          result: result ? truncateOutputForDisplay(result) : next.messages[idx].result,
          duration: msgStartedAt ? event.timestamp - msgStartedAt : undefined,
          ...(images ? { images } : {}),
          ...(finalDetails ? { toolDetails: finalDetails } : {}),
        };
      }

      // Subagent backfill: when this tool_execution_end refers to a completed
      // Agent run (toolName === "Agent" + details.agentId), also write to
      // next.subagents so `/resume` and page-refresh re-hydrate the inspector
      // map. Live `subagent_*` events normally populate this map, but
      // state-replay.ts does NOT synthesize them — it only re-emits the
      // tool_execution_end. Without this branch, expand/popout for completed
      // subagents shows "Subagent not found" after refresh.
      //
      // Merge semantics preserve prior non-undefined fields (live
      // subagent_completed could arrive before or after this backfill),
      // making the two paths commutative.
      //
      // See change: add-subagent-inspector §12 and design.md Decision 7.
      {
        const toolName = data.toolName as string | undefined;
        const endDetails = data.details as Record<string, unknown> | undefined;
        const agentId =
          endDetails && typeof endDetails.agentId === "string" ? endDetails.agentId : undefined;
        if (toolName === "Agent" && agentId) {
          const isError = data.isError as boolean;
          const resultStr = typeof data.result === "string" ? (data.result as string) : undefined;
          const detailError =
            endDetails && typeof endDetails.error === "string"
              ? (endDetails.error as string)
              : undefined;
          const durationMs =
            endDetails && typeof endDetails.durationMs === "number"
              ? (endDetails.durationMs as number)
              : undefined;
          const tokensUsage = endDetails?.tokensUsage as SubagentState["tokens"] | undefined;
          const toolUses =
            endDetails && typeof endDetails.toolUses === "number"
              ? (endDetails.toolUses as number)
              : undefined;
          const detailsPatch = readSubagentDetails(endDetails);

          // Build the patch with the explicit-fields-take-precedence rule.
          const patch: Partial<SubagentState> = {
            status: isError ? "failed" : "completed",
            ...(resultStr && !isError ? { result: resultStr } : {}),
            ...(isError ? { error: resultStr ?? detailError } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(tokensUsage !== undefined ? { tokens: tokensUsage } : {}),
            ...(toolUses !== undefined ? { toolUses } : {}),
            ...detailsPatch,
          };

          next.subagents = new Map(next.subagents);
          const existingSub = next.subagents.get(agentId);
          // mergeNonUndefined semantics: preserve prior non-undefined fields
          // rather than overwrite with undefined. This makes live + replay
          // paths commutative regardless of arrival order.
          const merged: SubagentState = {
            id: agentId,
            type:
              existingSub?.type ??
              (typeof endDetails?.subagentType === "string"
                ? (endDetails.subagentType as string)
                : "unknown"),
            description:
              existingSub?.description ??
              (typeof endDetails?.description === "string"
                ? (endDetails.description as string)
                : ""),
            ...existingSub,
            ...Object.fromEntries(
              Object.entries(patch).filter(([, v]) => v !== undefined),
            ),
          } as SubagentState;
          next.subagents.set(agentId, merged);
        }
      }
      break;
    }

    case "turn_end":
      break;

    case "stats_update": {
      // Accumulate stats from stats_update events
      if (data.tokensIn) next.tokensIn += data.tokensIn as number;
      if (data.tokensOut) next.tokensOut += data.tokensOut as number;
      if (data.cost) next.cost += data.cost as number;

      // Extract per-turn usage and accumulate cache stats
      const turnUsage = data.turnUsage as Record<string, number> | undefined;
      if (turnUsage) {
        // Assign turnIndex to the last user message for scroll-to-turn navigation
        const lastUserIdx = next.messages.findLastIndex((m) => m.role === "user");
        let assignedTurnIndex = -1;
        if (lastUserIdx !== -1 && next.messages[lastUserIdx].turnIndex === undefined) {
          assignedTurnIndex = next.turnCount;
          next.messages = [...next.messages];
          next.messages[lastUserIdx] = { ...next.messages[lastUserIdx], turnIndex: next.turnCount };
          next.turnCount += 1;
        }

        const turnStat: TurnStat = {
          input: turnUsage.input ?? 0,
          output: turnUsage.output ?? 0,
          cacheRead: turnUsage.cacheRead ?? 0,
          cacheWrite: turnUsage.cacheWrite ?? 0,
          turnIndex: assignedTurnIndex,
        };
        next.turnStats = [...next.turnStats, turnStat].slice(-MAX_TURN_STATS);
        next.cacheRead += turnStat.cacheRead;
        next.cacheWrite += turnStat.cacheWrite;
      }

      // Extract context usage
      const ctxUsage = data.contextUsage as { tokens: number | null; contextWindow: number } | undefined;
      if (ctxUsage) {
        next.contextUsage = ctxUsage;
      }
      break;
    }

    case "model_select": {
      const model = data.model as any;
      if (model) {
        next.model = `${model.provider}/${model.id}`;
      }
      const thinkingLevel = data.thinkingLevel as string | undefined;
      if (thinkingLevel !== undefined) {
        next.thinkingLevel = thinkingLevel;
      }
      break;
    }

    case "session_compact": {
      next.messages = [
        ...next.messages,
        {
          id: `compact-${next.messages.length}`,
          role: "assistant",
          content: "── Session compacted ──",
          timestamp: event.timestamp,
        },
      ];
      break;
    }

    case "bash_output": {
      const command = data.command as string;
      const output = data.output as string;
      const exitCode = data.exitCode as number;
      const excludeFromContext = data.excludeFromContext as boolean;
      // Structured missing-tool marker (bash unresolved). Carried into the
      // message so ChatView renders MissingToolInlineError instead of the
      // plain output card. See change: register-bash-and-tool-install-help.
      const missingTool = (data as any).missingTool;
      // "slash-exec" marks output from an executable-mode slash template so
      // ChatView renders the "ran locally" footer. See change:
      // add-dashboard-slash-commands.
      const source = (data as any).source as "slash-exec" | undefined;
      next.pendingPrompt = undefined;
      next.messages = [
        ...next.messages,
        {
          id: `bash-${next.messages.length}`,
          role: "bashOutput" as any,
          content: output,
          timestamp: event.timestamp,
          args: { command, exitCode, excludeFromContext, missingTool, source } as any,
        },
      ];
      break;
    }

    // Inline interactive terminal card lifecycle. `open` appends a live card
    // keyed by terminalId (reattaches to /ws/terminal/:id on render). `close`
    // transitions that row in place to a frozen read-only transcript.
    // See change: add-inline-terminal-card.
    case "inline_terminal_open": {
      const terminalId = data.terminalId as string;
      next.pendingPrompt = undefined;
      next.messages = [
        ...next.messages,
        {
          id: `inlineterm-${terminalId}`,
          role: "inlineTerminal" as any,
          content: "",
          timestamp: event.timestamp,
          args: { terminalId, closed: false } as any,
        },
      ];
      break;
    }

    case "inline_terminal_close": {
      const terminalId = data.terminalId as string;
      const transcript = (data.transcript as string) ?? "";
      let replaced = false;
      const updated = next.messages.slice();
      for (let i = updated.length - 1; i >= 0; i--) {
        const m = updated[i] as any;
        if (m?.role === "inlineTerminal" && m?.args?.terminalId === terminalId) {
          updated[i] = {
            ...m,
            content: transcript,
            timestamp: event.timestamp,
            args: { terminalId, closed: true },
          };
          replaced = true;
          break;
        }
      }
      if (replaced) {
        next.messages = updated;
      } else {
        // Defensive: close without a matching open (e.g. partial replay).
        next.messages = [
          ...next.messages,
          {
            id: `inlineterm-${terminalId}`,
            role: "inlineTerminal" as any,
            content: transcript,
            timestamp: event.timestamp,
            args: { terminalId, closed: true } as any,
          },
        ];
      }
      break;
    }

    case "command_feedback": {
      const command = data.command as string;
      const status = data.status as string;
      const message = data.message as string | undefined;
      next.pendingPrompt = undefined;
      // Upsert: a terminal status (completed/error) for the same command
      // transitions the most recent matching started row in place, instead of
      // appending a duplicate. Keeps chat clean for started → terminal pairs.
      // See change: fix-extension-slash-commands-in-dashboard.
      if (status === "completed" || status === "error") {
        let replaced = false;
        const updated = next.messages.slice();
        for (let i = updated.length - 1; i >= 0; i--) {
          const m = updated[i] as any;
          if (
            m?.role === "commandFeedback" &&
            m?.args?.command === command &&
            m?.args?.status === "started"
          ) {
            updated[i] = {
              ...m,
              content: message ?? "",
              timestamp: event.timestamp,
              args: { command, status },
            };
            replaced = true;
            break;
          }
        }
        if (replaced) {
          next.messages = updated;
          break;
        }
      }
      next.messages = [
        ...next.messages,
        {
          id: `cmdfb-${next.messages.length}`,
          role: "commandFeedback" as any,
          content: message ?? "",
          timestamp: event.timestamp,
          args: { command, status } as any,
        },
      ];
      break;
    }

    case "subagent_created": {
      const id = data.id as string;
      const details = (data.details as Record<string, unknown> | undefined) ?? undefined;
      next.subagents = new Map(next.subagents);
      next.subagents.set(id, {
        id,
        type: data.type as string ?? "unknown",
        description: data.description as string ?? "",
        status: "created",
        ...readSubagentDetails(details),
      });
      break;
    }

    case "subagent_started": {
      const id = data.id as string;
      const details = (data.details as Record<string, unknown> | undefined) ?? undefined;
      next.subagents = new Map(next.subagents);
      const existing = next.subagents.get(id);
      next.subagents.set(id, {
        ...(existing ?? { id, type: data.type as string ?? "unknown", description: data.description as string ?? "" }),
        status: "running",
        startedAt: existing?.startedAt ?? (typeof event.timestamp === "number" ? event.timestamp : Date.now()),
        ...readSubagentDetails(details),
      });
      break;
    }

    case "subagent_completed":
    case "subagent_failed": {
      const id = data.id as string;
      const details = (data.details as Record<string, unknown> | undefined) ?? undefined;
      next.subagents = new Map(next.subagents);
      const existing = next.subagents.get(id);
      next.subagents.set(id, {
        ...(existing ?? { id, type: data.type as string ?? "unknown", description: data.description as string ?? "" }),
        status: event.eventType === "subagent_completed" ? "completed" : "failed",
        result: data.result as string | undefined,
        error: data.error as string | undefined,
        durationMs: data.durationMs as number | undefined,
        tokens: data.tokens as SubagentState["tokens"],
        toolUses: data.toolUses as number | undefined,
        ...readSubagentDetails(details),
      });
      break;
    }

    case "entry_persisted": {
      // Bridge-emitted back-fill: when pi persists a user/assistant entry
      // and assigns its id, the bridge sends entry_persisted { entryId, nonce }.
      // We find the ChatMessage created from the matching message_start /
      // message_end (by nonce) and stamp its entryId. This unlocks the
      // per-message Fork button. See change: fix-per-message-fork.
      const targetNonce = data.nonce as string | undefined;
      const persistedEntryId = data.entryId as string | undefined;
      if (targetNonce && persistedEntryId) {
        let mutated = false;
        const updated = next.messages.map((m) => {
          if (!m.entryId && m.nonce === targetNonce) {
            mutated = true;
            return { ...m, entryId: persistedEntryId };
          }
          return m;
        });
        if (mutated) next.messages = updated;
      }
      break;
    }

    default: {
      // Flow / architect events flow through the plugin's own reducer
      // via useSessionEvents in flows-plugin. The shell ignores them
      // here; the plugin runtime mirrors msg.event into the per-session
      // events store from useMessageHandler.ts so plugin contributions
      // re-render in response. Anything not recognised by any plugin's
      // reducer falls through to the rawEvent message rendering, which
      // shows up as an expandable JSON block in the chat. See change:
      // pluginize-flows-via-registry.
      const isFlow = event.eventType.startsWith("flow_");
      if (!isFlow) {
        next.messages = [...next.messages, {
          id: `raw-${event.eventType}-${event.timestamp}-${next.messages.length}`,
          role: "rawEvent" as const,
          content: JSON.stringify(event.data, null, 2),
          timestamp: event.timestamp,
          toolName: event.eventType,
        }];
      }
      break;
    }
  }

  return next;
}
