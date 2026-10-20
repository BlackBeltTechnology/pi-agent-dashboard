/**
 * Session event reducer slices + tool-row finalizers a plugin contributes to
 * the shell's pure event reducer.
 *
 * Registration is DECLARATIVE (design D5 item 6): a plugin's client entry
 * exports `sessionEventReducer` / `toolRowFinalizers`; the generated registry
 * carries them and the shell calls `registerSessionEventReducer` /
 * `registerToolRowFinalizer` (`./host`) on the plugin's behalf — there is no
 * import side effect, and a test can build the same registry. The public
 * surface (`public.ts`) holds only the two TYPES; the registration functions
 * and the lookups the reducer reads are host-only.
 *
 * Slices and finalizers are filtered by the enabled-plugin set exactly like
 * slot claims (`setSessionReducerEnabledSet` mirrors `SlotRegistry.setEnabledSet`):
 * a disabled plugin's slice never runs, so its events reach the reducer's
 * default branch as owned events. An enable-set change applies to LATER events;
 * already-reduced state is never replayed.
 *
 * See change: decouple-plugins-from-core.
 */
import { matchesEventTypePattern } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Event shape a slice or finalizer reads (structurally the shell's `DashboardEvent`). */
export type SessionEventLike = DashboardEvent;

/**
 * A plugin's contribution to the session event reducer.
 *
 * `reduce` is pure: it returns the SAME state reference when the event changes
 * nothing, otherwise a new state object (never mutating its input). `state` is
 * the shell's per-session state; a slice reads/writes only the fields its
 * plugin owns (typed by `S`).
 */
export interface SessionEventReducerSlice<S = unknown> {
  /** Event types this slice reduces: exact names or `prefix_*` (single trailing `*`). */
  eventTypes: readonly string[];
  reduce(state: S, event: SessionEventLike, opts?: { isLive?: boolean }): S;
}

/** Options a finalizer hook receives from the shell's reducer. */
export interface ToolRowFinalizerOpts<S = unknown> {
  isLive?: boolean;
  /**
   * Re-enter the shell reducer with a synthesized event (e.g. the `tool_execution_end`
   * a finalizer reduces to stop a row). Always present when the shell calls a hook.
   */
  reduce?(state: S, event: SessionEventLike): S;
  /**
   * `tool_execution_update` only: the state BEFORE the shell touched the row for
   * this event (before its row-half reopen of a `session_ended`-healed row).
   * Lets the finalizer tell a reopened row from a running one and keep a
   * finished card terminal.
   */
  prior?: S;
}

/**
 * A plugin's finalizer for the chat rows of one tool. The reducer asks the
 * registered finalizer first at its tool-row heal sites; a missing finalizer, or
 * one that returns `undefined` (declines), leaves the neutral core heal to run.
 *
 * Contract (from `session-end-orphan-heal`): finalize only `running` rows; never
 * overwrite a real terminal row; on a synthesized (`healedBy`) event never change
 * a plugin state already terminal; record heal provenance on the plugin state.
 */
export interface ToolRowFinalizer<S = unknown> {
  /** Tool whose rows this finalizer owns (e.g. `"Agent"`). */
  toolName: string;
  /**
   * Called for `tool_execution_update` / `tool_execution_end` of `toolName`, AFTER the
   * shell applied its row-level change. Return the new state, or `undefined` to decline.
   */
  onToolExecution?(state: S, event: SessionEventLike, opts?: ToolRowFinalizerOpts<S>): S | undefined;
  /**
   * Called for session-level events that settle the tool's rows (`agent_settled`) and for
   * every event an enabled plugin slice owns (the finalizer ignores the types it does not
   * settle). Return the new state, or `undefined` to decline.
   */
  onSessionEvent?(state: S, event: SessionEventLike, opts?: ToolRowFinalizerOpts<S>): S | undefined;
}

interface SliceEntry {
  pluginId: string;
  slice: SessionEventReducerSlice<never>;
}
interface FinalizerEntry {
  pluginId: string;
  finalizer: ToolRowFinalizer<never>;
}

let slices: SliceEntry[] = [];
let finalizers: FinalizerEntry[] = [];
// `null` = filter inactive (every registration applies); matches `SlotRegistry`.
let enabledSet: ReadonlySet<string> | null = null;

/** Register (or replace) the slice a plugin contributes. One slice per plugin id. */
export function registerSessionEventReducer<S = unknown>(pluginId: string, slice: SessionEventReducerSlice<S>): void {
  slices = [...slices.filter((e) => e.pluginId !== pluginId), { pluginId, slice: slice as SessionEventReducerSlice<never> }];
}

/** Register (or replace) the finalizer a plugin contributes for `finalizer.toolName`. */
export function registerToolRowFinalizer<S = unknown>(pluginId: string, finalizer: ToolRowFinalizer<S>): void {
  finalizers = [
    ...finalizers.filter((e) => !(e.pluginId === pluginId && e.finalizer.toolName === finalizer.toolName)),
    { pluginId, finalizer: finalizer as ToolRowFinalizer<never> },
  ];
}

/** Drop every slice and finalizer a plugin registered (runtime plugin unload). */
export function unregisterSessionReducers(pluginId: string): void {
  slices = slices.filter((e) => e.pluginId !== pluginId);
  finalizers = finalizers.filter((e) => e.pluginId !== pluginId);
}

/**
 * Replace the enabled-plugins set (call it next to `SlotRegistry.setEnabledSet`
 * with the SAME set). `null` deactivates the filter.
 */
export function setSessionReducerEnabledSet(ids: ReadonlySet<string> | null): void {
  enabledSet = ids;
}

function isEnabled(pluginId: string): boolean {
  return enabledSet === null || enabledSet.has(pluginId);
}

/** The enabled plugin's slice that reduces `eventType`, or undefined (first registration wins). */
export function findSessionEventReducer<S = unknown>(eventType: string): SessionEventReducerSlice<S> | undefined {
  for (const entry of slices) {
    if (!isEnabled(entry.pluginId)) continue;
    if (entry.slice.eventTypes.some((p) => matchesEventTypePattern(p, eventType))) {
      return entry.slice as unknown as SessionEventReducerSlice<S>;
    }
  }
  return undefined;
}

/** The enabled plugin's finalizer for `toolName`, or undefined. */
export function findToolRowFinalizer<S = unknown>(toolName: string): ToolRowFinalizer<S> | undefined {
  for (const entry of finalizers) {
    if (entry.finalizer.toolName === toolName && isEnabled(entry.pluginId)) {
      return entry.finalizer as unknown as ToolRowFinalizer<S>;
    }
  }
  return undefined;
}

/** Test helper: forget every registration and the enabled set. */
export function __resetSessionReducersForTests(): void {
  slices = [];
  finalizers = [];
  enabledSet = null;
}
