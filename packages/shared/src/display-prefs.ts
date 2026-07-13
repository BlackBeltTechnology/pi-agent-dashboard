/**
 * Display preferences for the chat / stream view.
 *
 * Global prefs live in `~/.pi/dashboard/preferences.json#displayPrefs`.
 * Per-session sparse overrides live in `<session>.meta.json#displayPrefsOverride`.
 * Effective prefs = `mergeDisplayPrefs(global, override)`.
 *
 * See change: configurable-chat-display.
 */

export interface ToolCallPrefs {
  read: boolean;
  bash: boolean;
  /** Includes Write (single mental category). */
  edit: boolean;
  agent: boolean;
  /** Catch-all renderer (anything not matching a specific renderer). */
  generic: boolean;
}

export interface DisplayPrefs {
  tokenStatsBar: boolean;
  contextUsageBar: boolean;
  reasoning: boolean;
  toolResults: boolean;
  turnMetadata: boolean;
  debugTools: boolean;
  toolCalls: ToolCallPrefs;
  /**
   * Milliseconds a live-streamed reasoning block stays open after it finishes
   * before auto-collapsing. `0` = never auto-collapse (stay open until clicked).
   * Only applies to reasoning streamed live in the current view; replayed /
   * cold-loaded blocks are unaffected. Default `30000`.
   * See change: reasoning-auto-collapse-timer.
   */
  reasoningAutoCollapseMs: number;
  /**
   * When true, a live-streamed reasoning block stays expanded for the whole
   * duration of the active turn (the per-block `reasoningAutoCollapseMs` timer
   * is suppressed while the turn runs) and collapses on the turn-end edge.
   * When false (default), behavior is unchanged: live blocks mount expanded and
   * the ms timer governs collapse per-block. Only affects live-streamed blocks;
   * replayed / cold-loaded blocks are unaffected. Default `false`.
   * See change: keep-reasoning-open-until-turn-ends.
   */
  keepReasoningOpenUntilTurnEnds: boolean;
  /**
   * When true, every tool-call GROUP defaults to COLLAPSED in all automatic
   * states — including while a member is running (the live header/animation
   * still renders; only the body starts closed). When false (default), a
   * group's automatic open state follows run status (expanded while running,
   * collapsed when done). A per-instance manual toggle always wins. Does NOT
   * affect reasoning-block collapse nor the nested `×N` `CollapsedToolGroup`.
   * Default `false`.
   * See change: enhance-tool-call-grouping.
   */
  toolGroupDefaultCollapsed: boolean;
  /**
   * When true (default), the per-turn change-summary block renders in the chat
   * stream at each assistant turn boundary that changed files (a compact table
   * of files + `+adds −dels`, derived client-side from Edit/Write events). When
   * false, no per-turn block renders. Only gates the per-turn block; the split
   * pane's Changes rail and the summary chip are unaffected.
   * See change: add-change-summary-table.
   */
  changeSummaryTable: boolean;
}

/**
 * Sparse override over `DisplayPrefs`. Every top-level field is optional,
 * AND `toolCalls` is itself sparse (per-kind boolean may be omitted).
 * Distinct from `Partial<DisplayPrefs>`, which would require `toolCalls`
 * to be a full `ToolCallPrefs` whenever present.
 */
export type PartialDisplayPrefs = {
  [K in keyof DisplayPrefs]?: K extends "toolCalls" ? Partial<ToolCallPrefs> : DisplayPrefs[K];
};

export const DISPLAY_PRESETS: Record<"simple" | "standard" | "everything", DisplayPrefs> = {
  simple: {
    tokenStatsBar: false,
    contextUsageBar: false,
    reasoning: false,
    toolResults: false,
    turnMetadata: false,
    debugTools: false,
    toolCalls: { read: false, bash: false, edit: true, agent: true, generic: false },
    reasoningAutoCollapseMs: 30000,
    keepReasoningOpenUntilTurnEnds: false,
    toolGroupDefaultCollapsed: false,
    changeSummaryTable: false,
  },
  standard: {
    tokenStatsBar: true,
    contextUsageBar: true,
    reasoning: false,
    toolResults: true,
    turnMetadata: true,
    debugTools: false,
    toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
    reasoningAutoCollapseMs: 30000,
    keepReasoningOpenUntilTurnEnds: false,
    toolGroupDefaultCollapsed: false,
    changeSummaryTable: true,
  },
  everything: {
    tokenStatsBar: true,
    contextUsageBar: true,
    reasoning: true,
    toolResults: true,
    turnMetadata: true,
    debugTools: true,
    toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
    reasoningAutoCollapseMs: 30000,
    keepReasoningOpenUntilTurnEnds: false,
    toolGroupDefaultCollapsed: false,
    changeSummaryTable: true,
  },
};

/**
 * Merge a sparse per-session override over global prefs.
 *
 * - Top-level boolean fields: override.value ?? global.value.
 * - `toolCalls`: shallow merge of override.toolCalls onto global.toolCalls.
 * - `undefined` override returns `{ ...global }` (defensive copy).
 */
export function mergeDisplayPrefs(
  global: DisplayPrefs,
  override?: PartialDisplayPrefs,
): DisplayPrefs {
  if (!override) {
    return { ...global, toolCalls: { ...global.toolCalls } };
  }
  return {
    tokenStatsBar: override.tokenStatsBar ?? global.tokenStatsBar,
    contextUsageBar: override.contextUsageBar ?? global.contextUsageBar,
    reasoning: override.reasoning ?? global.reasoning,
    toolResults: override.toolResults ?? global.toolResults,
    turnMetadata: override.turnMetadata ?? global.turnMetadata,
    debugTools: override.debugTools ?? global.debugTools,
    toolCalls: { ...global.toolCalls, ...(override.toolCalls ?? {}) },
    reasoningAutoCollapseMs:
      override.reasoningAutoCollapseMs ?? global.reasoningAutoCollapseMs,
    keepReasoningOpenUntilTurnEnds:
      override.keepReasoningOpenUntilTurnEnds ?? global.keepReasoningOpenUntilTurnEnds,
    toolGroupDefaultCollapsed:
      override.toolGroupDefaultCollapsed ?? global.toolGroupDefaultCollapsed,
    changeSummaryTable: override.changeSummaryTable ?? global.changeSummaryTable,
  };
}

/**
 * Map a tool renderer key (or raw tool name) to the corresponding
 * `DisplayPrefs.toolCalls.*` key. `ask_user` returns `null` — it is
 * never gated.
 *
 * Renderer key → bucket:
 *   read      → read
 *   bash      → bash
 *   edit      → edit
 *   write     → edit (single mental category)
 *   Agent     → agent
 *   ask_user  → null  (non-hidable)
 *   *         → generic
 */
export function toolCallPrefKey(toolName: string): keyof ToolCallPrefs | null {
  if (toolName === "ask_user") return null;
  if (toolName === "read") return "read";
  if (toolName === "bash") return "bash";
  if (toolName === "edit" || toolName === "write") return "edit";
  if (toolName === "Agent") return "agent";
  return "generic";
}
