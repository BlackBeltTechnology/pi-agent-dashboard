/**
 * Pure list operations for NESTED tool calls (pi ≥0.99 codemode scripts and
 * `ctx.executeTool()`): calls a tool makes while it runs.
 *
 * Nested calls never enter the reducer's top-level `toolCalls` map or
 * `messages[]`; they live in a list owned by their ROOT (model-issued) call,
 * each entry keeping its direct `parentId` so the card can indent the tree.
 * Two sources feed the list: live `tool_execution_*` events carrying
 * `parentToolCallId`, and pi's bounded `nestedCalls` record on the root's
 * tool-result message (live toolResult `message_start`/`message_end`, or the
 * replay-synthesized top-level end).
 *
 * This module never imports the reducer (no cycle); result strings arrive
 * already display-truncated.
 *
 * See change: render-nested-tool-calls (design D1).
 */

/** `unfinished` = terminal + neutral: pi recorded no outcome (or the root ended first). */
type NestedCallStatus = "running" | "complete" | "error" | "unfinished";

export interface NestedCallState {
  id: string;
  /** Direct parent id: the live `parentToolCallId`, or the id minus its last `/` segment for record-sourced entries. */
  parentId: string;
  name: string;
  status: NestedCallStatus;
  startedAt?: number;
  durationMs?: number;
  args?: Record<string, unknown>;
  /** Set when pi omitted the arguments from the record (size cap). */
  argumentsBytes?: number;
  /** Display-truncated result text (same last-lines form as top-level results). */
  result?: string;
  /** Record-sourced error message (pi caps it at 500 chars). */
  error?: string;
}

/** A tool event is nested exactly when it carries a non-empty `parentToolCallId`. */
export function isNestedToolEvent(data: Record<string, unknown> | undefined): boolean {
  const parent = data?.parentToolCallId;
  return typeof parent === "string" && parent !== "";
}

/** Root of a nested id: its first `/` segment. */
export function rootIdOf(id: string): string {
  const i = id.indexOf("/");
  return i === -1 ? id : id.slice(0, i);
}

/** Record-sourced parent: the id minus its last `/` segment (`call_1/1/2` → `call_1/1`). */
function parentIdFromRecordId(id: string): string {
  const i = id.lastIndexOf("/");
  return i === -1 ? id : id.slice(0, i);
}

function replaceAt(list: NestedCallState[], idx: number, entry: NestedCallState): NestedCallState[] {
  const out = [...list];
  out[idx] = entry;
  return out;
}

/**
 * Live start. A start under a terminal root is created `unfinished`: nothing
 * else would ever close it (the heal and the reconcile both skip nested calls).
 * A repeated start (re-replay) refreshes name/args only.
 */
export function applyNestedStart(
  list: NestedCallState[],
  start: { id: string; parentId: string; name: string; args?: Record<string, unknown>; startedAt: number },
  rootTerminal: boolean,
): NestedCallState[] {
  const idx = list.findIndex((e) => e.id === start.id);
  if (idx !== -1) {
    return replaceAt(list, idx, { ...list[idx], name: start.name, ...(start.args ? { args: start.args } : {}) });
  }
  return [
    ...list,
    {
      id: start.id,
      parentId: start.parentId,
      name: start.name,
      status: rootTerminal ? "unfinished" : "running",
      startedAt: start.startedAt,
      ...(start.args ? { args: start.args } : {}),
    },
  ];
}

/** Live partial result. Unknown id → unchanged. */
export function applyNestedUpdate(list: NestedCallState[], id: string, result: string | undefined): NestedCallState[] {
  if (result === undefined) return list;
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return list;
  return replaceAt(list, idx, { ...list[idx], result });
}

/**
 * Live end. Always wins over `unfinished` (a late real end after the root
 * ended). An end whose start was never seen creates the entry.
 */
export function applyNestedEnd(
  list: NestedCallState[],
  end: { id: string; parentId: string; name: string; isError: boolean; result?: string; endedAt: number },
): NestedCallState[] {
  const status: NestedCallStatus = end.isError ? "error" : "complete";
  const idx = list.findIndex((e) => e.id === end.id);
  if (idx === -1) {
    return [
      ...list,
      {
        id: end.id,
        parentId: end.parentId,
        name: end.name,
        status,
        ...(end.result !== undefined ? { result: end.result } : {}),
      },
    ];
  }
  const prev = list[idx];
  return replaceAt(list, idx, {
    ...prev,
    status,
    ...(end.result !== undefined ? { result: end.result } : {}),
    ...(prev.startedAt !== undefined ? { durationMs: end.endedAt - prev.startedAt } : {}),
  });
}

/** Enforce the invariant: no entry stays `running` under a terminal root. */
export function closeRunningNested(list: NestedCallState[]): NestedCallState[] {
  if (!list.some((e) => e.status === "running")) return list;
  return list.map((e) => (e.status === "running" ? { ...e, status: "unfinished" } : e));
}

const RECORD_STATUS: Record<string, NestedCallStatus> = {
  ok: "complete",
  error: "error",
  unfinished: "unfinished",
};

/** pi's `NestedToolCalls` envelope, validated structurally. */
export function readNestedCallsEnvelope(value: unknown): { calls: unknown[]; complete: boolean } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.calls)) return undefined;
  return { calls: v.calls, complete: v.complete === true };
}

/**
 * Merge a `nestedCalls` record. A record id with a live entry replaces its
 * status/duration and keeps the live result; an unknown id is created from the
 * record; live entries absent from the record are kept. Malformed records are
 * skipped. The caller applies `closeRunningNested` afterwards.
 */
export function mergeNestedRecord(list: NestedCallState[], calls: unknown[]): NestedCallState[] {
  let out = list;
  for (const raw of calls) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || r.id === "") continue;
    const status = RECORD_STATUS[r.status as string] ?? "unfinished";
    const durationMs = typeof r.durationMs === "number" ? r.durationMs : undefined;
    const error = typeof r.error === "string" ? r.error : undefined;
    const idx = out.findIndex((e) => e.id === r.id);
    if (idx !== -1) {
      // pi re-sends the same record on toolResult message_start AND
      // message_end; its `unfinished` is stale once a real end arrived in
      // between. Never downgrade a live complete/error to `unfinished`.
      const prev = out[idx];
      const keepLive = status === "unfinished" && (prev.status === "complete" || prev.status === "error");
      out = replaceAt(out, idx, {
        ...prev,
        status: keepLive ? prev.status : status,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(error !== undefined ? { error } : {}),
      });
      continue;
    }
    const args =
      r.arguments && typeof r.arguments === "object" && !Array.isArray(r.arguments)
        ? (r.arguments as Record<string, unknown>)
        : undefined;
    out = [
      ...out,
      {
        id: r.id,
        parentId: parentIdFromRecordId(r.id),
        name: typeof r.name === "string" && r.name !== "" ? r.name : "unknown",
        status,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(args ? { args } : {}),
        ...(typeof r.argumentsBytes === "number" ? { argumentsBytes: r.argumentsBytes } : {}),
        ...(error !== undefined ? { error } : {}),
      },
    ];
  }
  return out;
}

/** Depth of an entry below its root (1 = direct child), derived from `parentId` chain within the list. */
export function nestedDepth(list: NestedCallState[], entry: NestedCallState, rootId: string): number {
  let depth = 1;
  let parent = entry.parentId;
  const seen = new Set<string>([entry.id]);
  while (parent !== rootId && !seen.has(parent)) {
    seen.add(parent);
    const p = list.find((e) => e.id === parent);
    if (!p) {
      // Parent not listed (dropped from a record): fall back to id segments.
      depth += parent.split("/").length - 1;
      break;
    }
    depth++;
    parent = p.parentId;
  }
  return depth;
}
