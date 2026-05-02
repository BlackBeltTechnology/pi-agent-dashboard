/**
 * Event reducer: builds session UI state from a stream of events.
 * (state, event) → new state
 */
import type { DashboardEvent, FlowState, ArchitectState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { isFlowEvent, reduceFlowEvent } from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer";
import { isArchitectEvent, reduceArchitectEvent } from "@blackbelt-technology/pi-dashboard-flows-plugin/reducer";

export interface ChatImage {
  data: string;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "thinking" | "bashOutput" | "commandFeedback" | "interactiveUi" | "turnSeparator" | "rawEvent";
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
}

export interface ToolCallState {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: string;
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
}

export interface InteractiveUiRequest {
  requestId: string;
  method: string;
  params: Record<string, unknown>;
  status: "pending" | "resolved" | "cancelled" | "dismissed";
  result?: unknown;
}

export interface SubagentState {
  id: string;
  type: string;
  description: string;
  status: "created" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  durationMs?: number;
  tokens?: { input: number; output: number; total: number };
  toolUses?: number;
}

export interface SessionState {
  messages: ChatMessage[];
  toolCalls: Map<string, ToolCallState>;
  streamingText: string;
  streamingThinking: string;
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
  flowState: FlowState | null;
  /** All flow states seen during execution (main + subflows), keyed by flowName */
  flowStates: Map<string, FlowState>;
  architectState: ArchitectState | null;
  /** Whether any Write/Edit tool calls have been seen (for Changed Files button) */
  hasFileChanges: boolean;
  /** Active subagents from @tintinweb/pi-subagents */
  subagents: Map<string, SubagentState>;
  /** Total turn count (for turnIndex assignment and sliding window offset) */
  turnCount: number;
  /** Last LLM provider error (set from agent_end, cleared on agent_start or dismiss) */
  lastError?: { message: string; timestamp: number };
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

export function createInitialState(): SessionState {
  return {
    messages: [],
    toolCalls: new Map(),
    streamingText: "",
    streamingThinking: "",
    isStreaming: false,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    status: "idle",
    turnStats: [],
    interactiveRequests: [],
    flowState: null,
    flowStates: new Map(),
    architectState: null,
    hasFileChanges: false,
    subagents: new Map(),
    turnCount: 0,
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

/** Extract error info from agent_end event's messages array. */
export function extractAgentEndError(data: Record<string, unknown>): string | undefined {
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last || last.stopReason !== "error") return undefined;
  return (last.errorMessage as string) || "An unknown error occurred";
}

export function reduceEvent(state: SessionState, event: DashboardEvent): SessionState {
  const next = { ...state, toolCalls: new Map(state.toolCalls) };
  const data = event.data;

  switch (event.eventType) {
    case "agent_start":
      next.isStreaming = true;
      next.status = "streaming";
      next.streamingText = "";
      next.pendingPrompt = undefined;
      next.lastError = undefined;
      break;

    case "agent_end": {
      next.isStreaming = false;
      next.status = "idle";
      next.streamingText = "";
      next.currentTool = undefined;
      next.pendingPrompt = undefined;
      const errorMsg = extractAgentEndError(data);
      if (errorMsg) {
        next.lastError = { message: errorMsg, timestamp: event.timestamp };
      }
      break;
    }

    case "message_start": {
      const msg = data.message as any;
      if (msg?.role === "assistant") {
        // Reset the per-message flush flag at the start of every assistant
        // message. See change: fix-streaming-text-vs-interactive-ui-order.
        next.streamingTextFlushed = false;
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
        next.messages = [
          ...next.messages,
          {
            id: `msg-${next.messages.length}`,
            role: "user",
            content: text,
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
          },
        ];
      }
      break;
    }

    case "message_update": {
      const assistantEvent = data.assistantMessageEvent as any;

      // Handle thinking events from assistantMessageEvent
      if (assistantEvent) {
        if (assistantEvent.type === "thinking_start") {
          next.streamingThinking = "";
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
              },
            ];
          }
          next.streamingThinking = "";
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
              content: next.streamingText,
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
      const toolName = data.toolName as string;

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
              ...(text != null ? { result: truncateLines(text, 30) } : {}),
              ...(details ? { toolDetails: details } : {}),
            };
          } else {
            // Plain string partialResult (standard tools)
            next.messages[idx] = {
              ...next.messages[idx],
              result: truncateLines(partialResult as string, 30),
            };
          }
        }
      }
      break;
    }

    case "tool_execution_end": {
      const toolCallId = data.toolCallId as string;
      const existing = next.toolCalls.get(toolCallId);
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
        next.messages[idx] = {
          ...next.messages[idx],
          toolStatus: isError ? "error" : "complete",
          result: result ? truncateLines(result, 30) : next.messages[idx].result,
          duration: msgStartedAt ? event.timestamp - msgStartedAt : undefined,
          ...(images ? { images } : {}),
          ...(mergedDetails ? { toolDetails: mergedDetails } : {}),
        };
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
      next.pendingPrompt = undefined;
      next.messages = [
        ...next.messages,
        {
          id: `bash-${next.messages.length}`,
          role: "bashOutput" as any,
          content: output,
          timestamp: event.timestamp,
          args: { command, exitCode, excludeFromContext } as any,
        },
      ];
      break;
    }

    case "command_feedback": {
      const command = data.command as string;
      const status = data.status as string;
      const message = data.message as string | undefined;
      next.pendingPrompt = undefined;
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
      next.subagents = new Map(next.subagents);
      next.subagents.set(id, {
        id,
        type: data.type as string ?? "unknown",
        description: data.description as string ?? "",
        status: "created",
      });
      break;
    }

    case "subagent_started": {
      const id = data.id as string;
      next.subagents = new Map(next.subagents);
      const existing = next.subagents.get(id);
      next.subagents.set(id, {
        ...(existing ?? { id, type: data.type as string ?? "unknown", description: data.description as string ?? "" }),
        status: "running",
      });
      break;
    }

    case "subagent_completed":
    case "subagent_failed": {
      const id = data.id as string;
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
      // Delegate flow events to flow reducer
      if (isFlowEvent(event.eventType)) {
        next.flowState = reduceFlowEvent(next.flowState, event);
        // Keep flowStates map in sync — store each flow by name
        if (next.flowState) {
          next.flowStates = new Map(next.flowStates);
          next.flowStates.set(next.flowState.flowName, next.flowState);
        } else if (event.eventType === "flow_summary_dismissed") {
          next.flowStates = new Map();
        }
      } else {
        // Unknown event type — render as expandable raw JSON
        next.messages = [...next.messages, {
          id: `raw-${event.eventType}-${event.timestamp}-${next.messages.length}`,
          role: "rawEvent" as const,
          content: JSON.stringify(event.data, null, 2),
          timestamp: event.timestamp,
          toolName: event.eventType,
        }];
      }
      // Delegate architect events to architect reducer
      if (isArchitectEvent(event.eventType)) {
        next.architectState = reduceArchitectEvent(next.architectState, event);
      }
      break;
    }
  }

  return next;
}
