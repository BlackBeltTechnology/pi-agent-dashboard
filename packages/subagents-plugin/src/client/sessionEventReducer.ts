/**
 * Session event reducer slice of the subagents plugin.
 *
 * Folds the producer's `subagent_created|started|entry|delta` frames into
 * `SessionState.subagents`. The shell registers this slice on the plugin's
 * behalf (the client entry exports it as `sessionEventReducer`) and applies it
 * in the pure event reducer before the default branch; with the plugin
 * disabled the slice does not run and the events fold into the owned-event
 * group row instead.
 *
 * Pure: returns the SAME state when a frame changes nothing, otherwise a new
 * state with a fresh `subagents` Map (the previous Map is never mutated).
 *
 * `subagent_completed|failed` are OWNED here too (listed in `eventTypes`, so with
 * the plugin off they fold into the owned group row) but written by the Agent
 * tool-row finalizer (`./toolRowFinalizer.ts`, `onSessionEvent`), which also owns
 * the `partialResult` hydration and the `/resume` backfill. This slice leaves
 * them untouched.
 *
 * See change: decouple-plugins-from-core (D5 item 6); add-plugin-bridge-contributions (D7).
 */
import type { SessionEventReducerSlice } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  applyLiveBlockPiece,
  readSubagentDetails,
  type SubagentState,
  type SubagentTimelineEntry,
  setSubagentState,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/subagent-types.js";

/** The part of the shell's session state this slice reads and writes. */
export interface SubagentSessionSlice {
  subagents: Map<string, SubagentState>;
}

function withSubagents<S extends SubagentSessionSlice>(
  state: S,
  write: (map: Map<string, SubagentState>) => void,
): S {
  const subagents = new Map(state.subagents);
  write(subagents);
  return { ...state, subagents };
}

type Data = Record<string, unknown>;
type Reduce = (state: SubagentSessionSlice, data: Data, timestamp: number) => SubagentSessionSlice;

const detailsOf = (data: Data): Record<string, unknown> | undefined =>
  (data.details as Record<string, unknown> | undefined) ?? undefined;

const created: Reduce = (state, data) => {
  const id = data.id as string;
  return withSubagents(state, (subagents) => {
    setSubagentState(subagents, {
      id,
      type: (data.type as string) ?? "unknown",
      description: (data.description as string) ?? "",
      status: "created",
      ...readSubagentDetails(detailsOf(data)),
    });
  });
};

const started: Reduce = (state, data, timestamp) => {
  const id = data.id as string;
  return withSubagents(state, (subagents) => {
    const existing = subagents.get(id);
    setSubagentState(subagents, {
      ...(existing ?? { id, type: (data.type as string) ?? "unknown", description: (data.description as string) ?? "" }),
      status: "running",
      healedBy: undefined,
      startedAt: existing?.startedAt ?? (typeof timestamp === "number" ? timestamp : Date.now()),
      ...readSubagentDetails(detailsOf(data)),
    });
  });
};

// One finished timeline step from the producer's entry stream (≥ 0.3.0),
// forwarded by this plugin's bridge declaration. Placed at its stable `index`
// (duplicate index ignored); a `blockId` closes that in-progress block.
// See change: add-plugin-bridge-contributions (D7).
const entryFrame: Reduce = (state, data) => {
  const { agentId, index, entry } = data;
  if (typeof agentId !== "string" || typeof index !== "number" || !Number.isInteger(index) || index < 0) return state;
  if (!entry || typeof entry !== "object") return state;
  const existing = state.subagents.get(agentId);
  const blockId = typeof data.blockId === "number" ? data.blockId : undefined;
  if (existing?.entries?.[index] && blockId === undefined) return state; // duplicate
  return withSubagents(state, (subagents) => {
    const entries = existing?.entries ? [...existing.entries] : [];
    if (!entries[index]) entries[index] = entry as SubagentTimelineEntry;
    let liveBlock = existing?.liveBlock;
    let closedBlockMax = existing?.closedBlockMax;
    if (blockId !== undefined) {
      closedBlockMax = Math.max(closedBlockMax ?? -1, blockId);
      if (liveBlock && liveBlock.blockId <= blockId) liveBlock = undefined;
    }
    setSubagentState(subagents, {
      ...(existing ?? { id: agentId, type: "unknown", description: "", status: "running" }),
      entries,
      liveBlock,
      closedBlockMax,
    });
  });
};

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

// One append-only piece of the subagent's in-progress block (producer ≥ 0.4.0).
// See change: add-plugin-bridge-contributions (D7).
const deltaFrame: Reduce = (state, data) => {
  const { agentId, blockId, offset, kind } = data;
  if (typeof agentId !== "string" || !isIndex(blockId) || !isIndex(offset)) return state;
  if (kind !== "thinking" && kind !== "text") return state;
  const text = typeof data.text === "string" ? data.text : "";
  const existing = state.subagents.get(agentId);
  const liveBlock = applyLiveBlockPiece(existing, { blockId, kind, offset, text });
  if (!liveBlock || liveBlock === existing?.liveBlock) return state;
  return withSubagents(state, (subagents) => {
    setSubagentState(subagents, {
      ...(existing ?? { id: agentId, type: "unknown", description: "", status: "running" }),
      liveBlock,
    });
  });
};

const ARMS: Record<string, Reduce> = {
  subagent_created: created,
  subagent_started: started,
  subagent_entry: entryFrame,
  subagent_delta: deltaFrame,
};

export const sessionEventReducer: SessionEventReducerSlice<SubagentSessionSlice> = {
  // `subagent_completed|failed`: owned for the plugin-off group row; the finalizer writes them.
  eventTypes: [...Object.keys(ARMS), "subagent_completed", "subagent_failed"],
  reduce: (state, event) =>
    Object.hasOwn(ARMS, event.eventType) ? ARMS[event.eventType](state, event.data, event.timestamp) : state,
};
