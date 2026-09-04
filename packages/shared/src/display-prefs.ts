/**
 * Display preferences for the chat / stream view.
 *
 * Global prefs live in `~/.pi/dashboard/preferences.json#displayPrefs`.
 * Per-session sparse overrides live in `<session>.meta.json#displayPrefsOverride`.
 * Effective prefs = `mergeDisplayPrefs(global, override)`.
 *
 * See change: configurable-chat-display.
 */
import { normalizeNotifyLevel } from "./notify.js";
import type { NotifyLevel } from "./protocol.js";
import {
  defaultCustomEventGroupPrefs,
  SHIPPED_CUSTOM_EVENT_GROUPS,
} from "./custom-event-groups.js";

/**
 * Minimum `ctx.ui.notify` level that renders as a chat row.
 *
 * The ladder is `info < success < warning < error`. `success` deliberately
 * ranks ABOVE `info`: a success notify reports an outcome, whereas info is
 * chatter — so `"success"` reads as "outcomes and problems, no chatter". That
 * ordering is a product decision, NOT a property of the level; do not "fix" it
 * into alphabetical or emission order.
 *
 * There is deliberately no `"off"` value. `"errors"` is the floor of the axis,
 * so a failing extension can always say so.
 *
 * See change: gate-notify-rows-by-level.
 */
export type NotifyMinLevel = "all" | "success" | "warnings" | "errors";

/** The four stops, in ladder order — for rendering the settings controls. */
export const NOTIFY_MIN_LEVELS: readonly NotifyMinLevel[] = [
  "all",
  "success",
  "warnings",
  "errors",
];

// Two SEPARATE rank maps, keyed by two different vocabularies. The row's level
// is singular (`warning`/`error`); the floor is plural (`warnings`/`errors`)
// and adds `all`. Only `success` is spelled the same in both. A single shared
// map keyed by a union of both would typo-pass. See design D2.
const LEVEL_RANK: Record<NotifyLevel, number> = {
  info: 0,
  success: 1,
  warning: 2,
  error: 3,
};
const FLOOR_RANK: Record<NotifyMinLevel, number> = {
  all: 0,
  success: 1,
  warnings: 2,
  errors: 3,
};

/**
 * The minimum shape both chat-view gate sites can supply.
 *
 * `shared` cannot import the client's `ChatMessage`, and the two sites do not
 * hold the same object — `isRowVisible` reads `msg.args.method` while the
 * render branch reads the built `request.method`. Each site adapts its local
 * object to this descriptor so the two can never drift.
 */
export interface NotifyRowDescriptor {
  /** `ChatMessage.content` — `"notify"` for a notify row. */
  content: unknown;
  /** `args.method` / `request.method` — `"notify"` for a notify row. */
  method: unknown;
  /** `params.level`; may legitimately be absent. */
  level: unknown;
}

/**
 * Unrecognized floor → `"all"`. Neither write path validates the value.
 *
 * OWN-property check, deliberately. The earlier `value in FLOOR_RANK` also
 * matched every inherited `Object.prototype` name, so a floor of `"toString"`
 * resolved its rank to a FUNCTION and made every `>=` comparison false —
 * silently hiding even `error`, the one thing this axis promises never to hide.
 * `Object.hasOwn` consults own properties only, so those names now fall through
 * to the `"all"` fallback.
 *
 * Exported so the two SELECT controls render the EFFECTIVE floor. Persistence
 * deliberately round-trips arbitrary strings (validation lives here, not in the
 * store), so a controlled `<select>` could otherwise hold a value matching no
 * `<option>` — which renders as no selection at all.
 */
export function normalizeNotifyMinLevel(value: unknown): NotifyMinLevel {
  return typeof value === "string" && Object.hasOwn(FLOOR_RANK, value)
    ? (value as NotifyMinLevel)
    : "all";
}

/**
 * Decide whether ONE row renders under ONE `notifyMinLevel`.
 *
 * Fail-open on BOTH inputs:
 * - A row not positively identified as a notify renders. An ask misclassified
 *   as a notify would deadlock the session with no visible cause; a notify
 *   misclassified as an ask is a cosmetic miss. The discriminator therefore
 *   requires BOTH markers `addNotify` stamps, never `role === "interactiveUi"`
 *   and never the mere presence of a level.
 * - An unrecognized floor is treated as `"all"`. Without that clause a garbage
 *   persisted value would make every comparison `NaN` and hide even `error`,
 *   breaking the one guarantee this axis makes.
 *
 * See change: gate-notify-rows-by-level.
 */
export function isNotifyRowVisible(row: NotifyRowDescriptor, minLevel: unknown): boolean {
  const isNotify = row.content === "notify" && row.method === "notify";
  if (!isNotify) return true;
  return LEVEL_RANK[normalizeNotifyLevel(row.level)] >= FLOOR_RANK[normalizeNotifyMinLevel(minLevel)];
}

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
  /**
   * When true, the session card's PROCESS subcard reserves one line of height
   * even while the session is idle (both the in-flight activity list and the
   * background-process list empty), showing `⏵ idle`. When false (default for
   * `simple`/`standard`), the subcard mounts on the first tool of a run — one
   * jump, then stable for the run — and unmounts back to zero height at idle.
   * ON (default for `everything`) trades a permanent thin line on quiet cards
   * for zero grid reflow ever. Only affects the desktop subcard; mobile keeps
   * its chip/sheet. Default `false`.
   * See change: stable-process-line.
   */
  reserveProcessLineAtIdle: boolean;
  /**
   * When true, the change-summary block lists files this session wrote OUTSIDE
   * its workspace (out-of-cwd), rendered from the captured Write/Edit payload
   * (the server never reads the out-of-cwd file). When false (default), those
   * rows are suppressed — today's safe behavior (no dead diff tab). Display gate
   * only; there is no server read surface for it to gate.
   * See change: opt-in-out-of-cwd-session-diffs.
   */
  showOutOfCwdSessionDiffs: boolean;
  /**
   * Minimum `ctx.ui.notify` level that renders as a chat row. `"all"` (default)
   * preserves today's behavior. `error` is never suppressed at any value.
   * Blocking asks are unaffected at every value — the gate keys on the notify
   * discriminator, never on the row's role.
   * See change: gate-notify-rows-by-level.
   */
  notifyMinLevel: NotifyMinLevel;
  /**
   * When true, a reasoning block's body renders with NO vertical height cap
   * and NO inner vertical scrollbar, flowing down the chat transcript like
   * any other row. When false (default), the body is capped at 400px with an
   * inner vertical scrollbar (today's behavior). HEIGHT ONLY — open/closed
   * state stays owned by the collapse machinery (auto-collapse timer,
   * turn-scoped hold, manual toggle).
   * See change: render-inline-reasoning-and-custom-entries.
   */
  reasoningInlineFlow: boolean;
  /**
   * Per-group visibility for custom chat rows, keyed by custom event group id
   * (see `custom-event-groups.ts`). Shallow-merged field-by-field exactly like
   * `toolCalls`: a group id present in a per-session override wins for that
   * group only; every absent id falls through to the global value, and a
   * group id absent from BOTH resolves to the group's configured `default`
   * (the server backfill seeds every configured group so the lookup is total).
   * Replaces the removed single-switch `customEntryFallback`; the catch-all
   * `other` group's toggle carries its behavior. `flow-event` keeps its
   * dedicated rendering at every value. Render-time gate only: rows still
   * exist in state, so toggling never replays anything.
   * See change: add-custom-event-group-filters.
   */
  customEventGroups: Record<string, boolean>;
}

/**
 * Sparse override over `DisplayPrefs`. Every top-level field is optional,
 * AND `toolCalls` is itself sparse (per-kind boolean may be omitted).
 * Distinct from `Partial<DisplayPrefs>`, which would require `toolCalls`
 * to be a full `ToolCallPrefs` whenever present.
 */
export type PartialDisplayPrefs = {
  [K in keyof DisplayPrefs]?: K extends "toolCalls" | "customEventGroups"
    ? Partial<DisplayPrefs[K]>
    : DisplayPrefs[K];
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
    reserveProcessLineAtIdle: false,
    showOutOfCwdSessionDiffs: false,
    notifyMinLevel: "all",
    reasoningInlineFlow: false,
    customEventGroups: defaultCustomEventGroupPrefs(),
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
    reserveProcessLineAtIdle: false,
    showOutOfCwdSessionDiffs: false,
    notifyMinLevel: "all",
    reasoningInlineFlow: false,
    customEventGroups: defaultCustomEventGroupPrefs(),
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
    reserveProcessLineAtIdle: true,
    showOutOfCwdSessionDiffs: false,
    notifyMinLevel: "all",
    reasoningInlineFlow: false,
    customEventGroups: defaultCustomEventGroupPrefs(),
  },
};

/**
 * Shallow field-by-field merge of two group-id → boolean records — the
 * `customEventGroups` arm shared by `mergeDisplayPrefs` (per-session merge)
 * and the server's PATCH arm. An override key present wins for that group id
 * only; undefined-valued keys are ignored (they mean "not specified").
 * See change: add-custom-event-group-filters.
 */
export function mergeCustomEventGroupPrefs(
  global: Record<string, boolean>,
  override?: Partial<Record<string, boolean>>,
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...global };
  if (override) {
    for (const [k, v] of Object.entries(override)) {
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

/**
 * Merge a sparse per-session override over global prefs.
 *
 * - Top-level boolean fields: override.value ?? global.value.
 * - `toolCalls` and `customEventGroups`: shallow merge of the override's
 *   object onto the global's, field by field.
 * - `undefined` override returns `{ ...global }` (defensive copy).
 */
export function mergeDisplayPrefs(
  global: DisplayPrefs,
  override?: PartialDisplayPrefs,
): DisplayPrefs {
  if (!override) {
    return { ...global, toolCalls: { ...global.toolCalls }, customEventGroups: { ...global.customEventGroups } };
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
    reserveProcessLineAtIdle:
      override.reserveProcessLineAtIdle ?? global.reserveProcessLineAtIdle,
    showOutOfCwdSessionDiffs:
      override.showOutOfCwdSessionDiffs ?? global.showOutOfCwdSessionDiffs,
    notifyMinLevel: override.notifyMinLevel ?? global.notifyMinLevel,
    reasoningInlineFlow: override.reasoningInlineFlow ?? global.reasoningInlineFlow,
    customEventGroups: mergeCustomEventGroupPrefs(global.customEventGroups, override.customEventGroups),
  };
}

/**
 * One-shot migration (design D7): map a persisted `customEntryFallback` onto
 * `customEventGroups`, then drop the legacy field. Idempotent — once the
 * field is absent, no further action. Non-destructive: explicit
 * `customEventGroups` keys are never overwritten.
 *
 * The old switch gated EVERY non-`flow-event` custom row. A legacy `false`
 * therefore hides the WHOLE gated population, not just the catch-all: every
 * shipped group seeds `false` (plus `other`), so the user's exact prior
 * visible-set survives the upgrade — "custom entries that were hidden do not
 * reappear" (spec requirement). A legacy `true` (the old default) forces no
 * keys at all: absent keys resolve to configured defaults, and the one
 * intended behavior change (memory/om.* ships hidden) is the CHANGELOG'd
 * default flip, not a migration artifact.
 *
 * Typed loosely over the prefs shape so it runs over the global prefs, a
 * per-session override, or a raw legacy file object alike.
 * See change: add-custom-event-group-filters.
 */
export function migrateLegacyCustomEntryFallback<
  T extends { customEntryFallback?: unknown; customEventGroups?: unknown },
>(prefs: T): T {
  if (!prefs || typeof prefs !== "object") return prefs;
  const legacy = prefs.customEntryFallback;
  if (typeof legacy !== "boolean") {
    // Corrupt value: the field is unused either way, and the contract is
    // "the field does not survive" — drop it rather than migrate it.
    const next = { ...prefs } as T;
    delete (next as { customEntryFallback?: unknown }).customEntryFallback;
    return next;
  }
  const next = { ...prefs } as T & { customEventGroups?: Record<string, boolean> };
  if (legacy === false) {
    const groups = {
      ...(typeof next.customEventGroups === "object" && next.customEventGroups !== null
        ? next.customEventGroups
        : {}),
    };
    if (groups.other === undefined) groups.other = false;
    for (const g of SHIPPED_CUSTOM_EVENT_GROUPS) {
      if (groups[g.id] === undefined) groups[g.id] = false;
    }
    next.customEventGroups = groups;
  }
  delete (next as { customEntryFallback?: unknown }).customEntryFallback;
  return next;
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
