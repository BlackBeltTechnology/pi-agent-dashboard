/**
 * The subagents plugin's slot in the shell's generic per-session plugin state
 * (`SessionState.pluginState`, keyed by plugin id). Every reader and writer of the
 * plugin's `Map<id, SubagentState>` goes through here, so the slot key and shape live
 * in one place. Pure; never mutates its input.
 *
 * See change: move-subagents-to-plugin (D8).
 */
import { useSessionPluginState } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { SubagentState } from "../subagent-types.js";

/** Plugin id this slot is stored under in `SessionState.pluginState`. */
export const SUBAGENTS_PLUGIN_ID = "subagents";

/** The part of the shell's session state this plugin reads and writes. */
export interface PluginStateSlice {
  pluginState: Map<string, unknown>;
}

/** Shared frozen empty map: stable reference for a session with no subagents. */
export const EMPTY_SUBAGENTS: ReadonlyMap<string, SubagentState> = Object.freeze(new Map());

/** A `pluginState` map holding only the subagent slot (seeds a session state, mostly in tests). */
export const subagentSlot = (subagents: ReadonlyMap<string, SubagentState>): Map<string, unknown> =>
  new Map<string, unknown>([[SUBAGENTS_PLUGIN_ID, subagents]]);

/** The subagent map of a session (any shape carrying `pluginState`), empty when unset. */
export function subagentsOf(
  session: { pluginState?: ReadonlyMap<string, unknown> } | null | undefined,
): Map<string, SubagentState> {
  return ((session?.pluginState?.get(SUBAGENTS_PLUGIN_ID) as Map<string, SubagentState> | undefined) ??
    (EMPTY_SUBAGENTS as Map<string, SubagentState>));
}

/** A copy of `state` whose subagent slot is `subagents` (the previous state and map are untouched). */
export function withSubagentMap<S extends PluginStateSlice>(state: S, subagents: Map<string, SubagentState>): S {
  return { ...state, pluginState: new Map(state.pluginState).set(SUBAGENTS_PLUGIN_ID, subagents) };
}

/** Reactive read of a session's subagent map (the plugin's own hook over `useSessionPluginState`). */
export function useSessionSubagents(sessionId: string): ReadonlyMap<string, SubagentState> {
  return (useSessionPluginState(SUBAGENTS_PLUGIN_ID, sessionId) as ReadonlyMap<string, SubagentState> | undefined) ?? EMPTY_SUBAGENTS;
}
