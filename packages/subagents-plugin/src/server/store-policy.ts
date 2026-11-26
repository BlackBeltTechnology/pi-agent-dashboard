/**
 * Subagents store policy: every subagent rule the core event store used to
 * hold, expressed through the generic `PluginStorePolicy` hooks. Registered by
 * `registerPlugin` for the `subagent_*` event types and the `Agent` tool.
 *
 *  - `bound`        stream-delta bound + under-ceiling timeline frames stay unchanged
 *  - `elide`        streamed-entries elision (resident-step, valid-count, no-mutation rules)
 *  - `onStored`     finished-block / terminal-agent delta collapse
 *  - `retain`       pins each open agent's created + latest started frame
 *  - `vetoSupersede` Agent tail-subsumption guard (identity + resident-pin rules)
 *  - `isCarrier`    the identity-creating `Agent` update tick (`details.agentId`)
 *  - `identity`     `id`, `agentId`, `status`, `details.status` for placeholders and the heal
 *
 * See change: move-subagents-to-plugin (D3).
 */
import type {
  PluginStorePolicy,
  StorePolicyView,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

type Rec = Record<string, unknown>;

interface Timeline {
  /** The resolved `details` object carrying `entries[]` (+ `entryCount`). */
  details: Rec;
  /** Whether `details` sits under `data.partialResult` (live) vs `data`. */
  underPartialResult: boolean;
}

const asRec = (v: unknown): Rec | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;

/** `data.partialResult.details` ONLY — mirrors the reducer's update branch. */
function resolveUpdateDetails(event: DashboardEvent): Rec | undefined {
  const pr = asRec(asRec(event.data)?.partialResult);
  return asRec(pr?.details);
}

/** Top-level `data.details` — mirrors the reducer's `tool_execution_end` branch. */
function resolveEndDetails(event: DashboardEvent): Rec | undefined {
  return asRec(asRec(event.data)?.details);
}

/**
 * Type-scoped timeline detector: the resolved `details` ONLY when the event is
 * a subagent carrier — `data.toolName === "Agent"`, an update/end with
 * `details.agentId`, or a `subagent_*` type — AND an array sits at
 * `partialResult.details.entries` (live) or `data.details.entries`. Shape alone
 * (a bare array) never matches.
 */
function locateTimeline(event: DashboardEvent): Timeline | undefined {
  const data = asRec(event.data);
  if (!data) return undefined;
  const pr = asRec(data.partialResult);
  let details: Rec | undefined;
  let underPartialResult = false;
  if (pr && asRec(pr.details)) {
    details = asRec(pr.details);
    underPartialResult = true;
  } else if (asRec(data.details)) {
    details = asRec(data.details);
  }
  if (!details || !Array.isArray(details.entries)) return undefined;
  const isAgentTool = data.toolName === "Agent";
  const isUpdateOrEnd = event.eventType === "tool_execution_update" || event.eventType === "tool_execution_end";
  const hasAgentId = typeof details.agentId === "string";
  const isSubagentCarrier = event.eventType.startsWith("subagent_");
  if (!isAgentTool && !isSubagentCarrier && !(isUpdateOrEnd && hasAgentId)) return undefined;
  return { details, underPartialResult };
}

/** True when every step `0..entryCount-1` of `agentId` is resident as a `subagent_entry`. */
function residentTimelineComplete(view: StorePolicyView, agentId: string, entryCount: number): boolean {
  if (entryCount === 0) return true;
  if (entryCount > view.size) return false;
  const seen = new Set<number>();
  for (const { event } of view.resident()) {
    if (event.eventType !== "subagent_entry") continue;
    const d = asRec(event.data);
    if (!d || d.agentId !== agentId) continue;
    const i = d.index;
    if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < entryCount) seen.add(i);
  }
  return seen.size === entryCount;
}

/**
 * Clone an over-ceiling frame with `details.entries` replaced by `[]` (keeping
 * `entryCount`) ONLY when `entryCount` is a safe integer `>= 0` and every step
 * is resident. Never mutates the in-flight event.
 */
function elideStreamedEntries(event: DashboardEvent, loc: Timeline, view: StorePolicyView): DashboardEvent | undefined {
  const entryCount = loc.details.entryCount;
  if (typeof entryCount !== "number" || !Number.isSafeInteger(entryCount) || entryCount < 0) return undefined;
  const origData = event.data as Rec;
  const agentId =
    typeof loc.details.agentId === "string"
      ? loc.details.agentId
      : typeof origData.id === "string"
        ? origData.id
        : undefined;
  if (!agentId || !residentTimelineComplete(view, agentId, entryCount)) return undefined;
  const details = { ...loc.details, entries: [] };
  const data: Rec = { ...origData };
  if (loc.underPartialResult) data.partialResult = { ...(origData.partialResult as Rec), details };
  else data.details = details;
  return { ...event, data };
}

/**
 * `subagent_delta` text carries offsets, so it is EXEMPT from the per-string
 * cap. Over the per-event ceiling it keeps its envelope with `text: ""` +
 * `omittedLength`; the client's offset rule then marks the gap.
 */
function boundStreamDelta(event: DashboardEvent, exceeds: (v: unknown) => boolean): DashboardEvent {
  const data = event.data as Rec;
  if (!data || typeof data !== "object" || !exceeds(data)) return event;
  const text = typeof data.text === "string" ? data.text : "";
  const envelope: Rec = { text: "", omittedLength: text.length };
  for (const k of ["v", "agentId", "toolCallId", "blockId", "kind", "offset", "final"]) {
    if (k in data) envelope[k] = data[k];
  }
  return { ...event, data: envelope };
}

/**
 * Seqs of `subagent_delta` rows made redundant by `event`: the pieces of the
 * block a `subagent_entry` (with `blockId`) finishes, or every piece of an
 * agent that reached `subagent_completed` / `subagent_failed`.
 */
function redundantDeltaSeqs(event: DashboardEvent, view: StorePolicyView): number[] {
  const t = event.eventType;
  const d = asRec(event.data);
  if (!d) return [];
  let agentId: unknown;
  let blockId: number | undefined;
  if (t === "subagent_entry") {
    if (typeof d.blockId !== "number") return [];
    agentId = d.agentId;
    blockId = d.blockId;
  } else if (t === "subagent_completed" || t === "subagent_failed") {
    agentId = typeof d.id === "string" ? d.id : asRec(d.details)?.agentId;
  } else {
    return [];
  }
  if (typeof agentId !== "string") return [];
  const out: number[] = [];
  // Whole resident set: a retransmitted (reconnect flush) or replayed piece can
  // sit before the block's offset-0 piece.
  for (const { seq, event: e } of view.resident()) {
    if (e.eventType !== "subagent_delta") continue;
    const ed = asRec(e.data);
    if (!ed || ed.agentId !== agentId) continue;
    if (blockId !== undefined && ed.blockId !== blockId) continue;
    out.push(seq);
  }
  return out;
}

/**
 * Events to pin for one trim pass: the latest `subagent_created` and the latest
 * `subagent_started` of every agent with no terminal frame resident. Memoized
 * per view (one view per trim pass).
 */
const pinCache = new WeakMap<StorePolicyView, Set<DashboardEvent>>();
function pinnedFor(view: StorePolicyView): Set<DashboardEvent> {
  const cached = pinCache.get(view);
  if (cached) return cached;
  const terminal = new Set<string>();
  const candidates: Array<{ id: string; type: string; event: DashboardEvent }> = [];
  for (const { event } of view.resident()) {
    const id = asRec(event.data)?.id;
    if (typeof id !== "string") continue;
    if (event.eventType === "subagent_completed" || event.eventType === "subagent_failed") terminal.add(id);
    else if (event.eventType === "subagent_created" || event.eventType === "subagent_started") {
      candidates.push({ id, type: event.eventType, event });
    }
  }
  const pinned = new Set<DashboardEvent>();
  const seen = new Set<string>();
  // `resident()` is newest-first: the first hit per (id, type) is the latest.
  for (const c of candidates) {
    const key = `${c.id}\u0000${c.type}`;
    if (terminal.has(c.id) || seen.has(key)) continue;
    seen.add(key);
    pinned.add(c.event);
  }
  pinCache.set(view, pinned);
  return pinned;
}

export function createSubagentsStorePolicy(): PluginStorePolicy {
  return {
    identity(event) {
      const d = asRec(event.data);
      if (!d) return undefined;
      if (event.eventType.startsWith("subagent_")) {
        return { id: d.id, agentId: d.agentId, status: d.status, details: { status: asRec(d.details)?.status } };
      }
      if (event.eventType === "tool_execution_update") {
        const agentId = resolveUpdateDetails(event)?.agentId;
        return typeof agentId === "string" ? { details: { agentId } } : undefined;
      }
      if (event.eventType === "tool_execution_end") {
        const agentId = resolveEndDetails(event)?.agentId;
        return typeof agentId === "string" ? { details: { agentId } } : undefined;
      }
      return undefined;
    },

    bound(event, ctx) {
      if (!event.data || typeof event.data !== "object") return undefined;
      if (event.eventType === "subagent_delta") return boundStreamDelta(event, ctx.exceeds);
      // Under the ceiling a timeline frame is stored UNCHANGED: the generic
      // `obj.length > 20` array clobber must never reach `entries[]`.
      if (ctx.maxEventDataSize > 0 && locateTimeline(event) && !ctx.exceeds(event.data)) return event;
      return undefined;
    },

    elide(event, view) {
      const loc = locateTimeline(event);
      return loc ? elideStreamedEntries(event, loc, view) : undefined;
    },

    onStored(event, view) {
      return redundantDeltaSeqs(event, view);
    },

    retain(event, view) {
      return pinnedFor(view).has(event);
    },

    vetoSupersede(end, tail, ctx) {
      const pd = resolveUpdateDetails(tail);
      // Only an Agent-shaped tail (one carrying `details.agentId`) is guarded.
      if (!pd || typeof pd.agentId !== "string") return false;
      // No resident creating tick: this tail would be the first hydrating event.
      if (!ctx.pinResident) return true;
      const toolName = asRec(end.data)?.toolName;
      if (toolName !== "Agent") return true;
      const sd = resolveEndDetails(end);
      if (sd?.agentId !== pd.agentId) return true;
      if (pd.agentSessionId !== undefined && sd?.agentSessionId !== pd.agentSessionId) return true;
      return false;
    },

    isCarrier(event) {
      return typeof resolveUpdateDetails(event)?.agentId === "string";
    },
  };
}
