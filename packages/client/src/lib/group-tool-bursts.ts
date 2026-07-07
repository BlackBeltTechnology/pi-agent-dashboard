/**
 * Temporal (burst) grouping — the OUTER pass over the semantic (×N)
 * `groupConsecutiveToolCalls`. A run of consecutive tool-like items collapses
 * into ONE burst group so an investigation turn (grep → read → grep → read …)
 * renders as a single progress-aware block instead of a flat wall of rows.
 *
 * Composition — semantic INNER-first, burst OUTER-second (change:
 * collapse-tool-calls-across-narration). The semantic pass runs FIRST over the
 * ENTIRE message stream, so identical calls separated by narration prose fold
 * into a nested `×N` group BEFORE burst formation. The burst pass then walks
 * that `ChatItem[]`, treating a `×N` `ToolCallGroup` as ONE tool-like member.
 *
 * Why semantic-first: the semantic pass treats `assistant` as transparent, so a
 * narrated poll loop (`curl … "still starting" … curl`) folds into a `×N` pill
 * again — restoring the pre-#249 polling-loop behavior. Non-empty `assistant`
 * prose remains a HARD boundary for HETEROGENEOUS burst formation, so a turn's
 * substantive reply between distinct investigation steps stays visible at the
 * top level and splits bursts.
 */
import type { ChatMessage } from "./event-reducer.js";
import { type ChatItem, groupConsecutiveToolCalls, type ToolCallGroup } from "./group-tool-calls.js";

/**
 * Roles absorbed while walking a burst (never terminate it). Mirrors the
 * semantic pass's transparent set MINUS `assistant`, which the burst pass
 * discriminates by emptiness (empty = transparent, non-empty prose = HARD
 * boundary — the turn's actual reply).
 */
const BURST_TRANSPARENT_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
  "thinking",
  "turnSeparator",
  "rawEvent",
  "commandFeedback",
]);

/**
 * A temporal burst group. `items` is a slice of the semantic-pass output, so
 * nested `×N` groups (`ToolCallGroup`) sit alongside individual `ChatMessage`
 * rows (tool results + absorbed transparent narration). `id` = first tool-like
 * member's stable id (React key; survives event-trim head churn where a
 * positional index would bleed collapse state between bursts).
 */
export interface ToolBurstGroup {
  type: "burst";
  id: string;
  items: ChatItem[];
}

/**
 * Output row: a plain message, a bare semantic `×N` group (sub-threshold burst
 * that still folded a poll loop), or a temporal burst wrapping both.
 */
export type BurstItem = ChatItem | ToolBurstGroup;

/** A `×N` semantic group. */
function isGroup(item: ChatItem): item is ToolCallGroup {
  return (item as ToolCallGroup).type === "group";
}

/** A tool-like burst member: a `toolResult` row OR a `×N` group (one member). */
function isToolLike(item: ChatItem): boolean {
  if (isGroup(item)) return true;
  return (item as ChatMessage).role === "toolResult";
}

/** A row that does not terminate a burst run (walked across, absorbed). */
function isTransparentItem(item: ChatItem): boolean {
  if (isGroup(item)) return false; // tool-like, handled as a member
  const m = item as ChatMessage;
  if (BURST_TRANSPARENT_ROLES.has(m.role)) return true;
  // Empty assistant prose (tool-only turn filler) is transparent; non-empty
  // assistant prose is a HARD boundary (the turn's actual reply).
  if (m.role === "assistant" && m.content.trim() === "") return true;
  return false;
}

/** A `thinking` row — the only transparent whose absorption is worth wrapping a lone `×N` group for. */
function isThinking(item: ChatItem): boolean {
  return !isGroup(item) && (item as ChatMessage).role === "thinking";
}

/** Stable id of a tool-like item (a group → its first member's id). */
function firstId(item: ChatItem): string {
  if (isGroup(item)) return item.messages[0]?.id ?? item.toolName;
  return (item as ChatMessage).id;
}

/**
 * Walk the maximal burst window starting at a tool-like item `start`. Returns
 * the member count (tool-like items; a `×N` group is one) and `end` (exclusive)
 * past the final ABSORBED item. Interior transparents are walked across; TRAILING
 * transparents (after the last tool-like member, up to the next HARD row or end
 * of stream) are absorbed into the window so the turn's concluding reasoning
 * folds inside the group. Stops at the first HARD row.
 */
function burstWindow(items: ChatItem[], start: number): { members: number; end: number } {
  let members = 1;
  let lastToolEnd = start + 1; // exclusive past the last tool-like member
  for (let j = start + 1; j < items.length; j++) {
    const next = items[j];
    if (isTransparentItem(next)) continue;
    if (!isToolLike(next)) break; // HARD boundary
    members++;
    lastToolEnd = j + 1;
  }
  // Absorb trailing transparents between the last tool member and the next HARD
  // row (or end of stream). The next non-transparent past here is guaranteed to
  // be a HARD row — any tool-like would have been counted as a member above.
  let end = lastToolEnd;
  for (let k = lastToolEnd; k < items.length; k++) {
    if (isTransparentItem(items[k])) end = k + 1;
    else break;
  }
  return { members, end };
}

/**
 * Group consecutive tool-like runs into burst groups over the semantic-pass
 * output.
 *
 * The semantic pass runs first over the FULL stream; the burst pass walks its
 * `ChatItem[]`. A burst is a maximal run of tool-like items (each `toolResult`
 * row or `×N` group counts as ONE member) walked across transparent rows (see
 * `isTransparentItem`); any HARD row (`user`, non-empty `assistant`,
 * `interactiveUi`, `bashOutput`, `inlineTerminal`, …) terminates it.
 *
 * Grouping is TURN-SCOPED and UNIVERSAL (threshold 1): every run of ≥ 1
 * tool-like member forms a group, and the window absorbs BOTH leading
 * transparents (buffered in `pending` until a tool-like item confirms the run)
 * AND trailing transparents (`burstWindow`), so a turn's opening plan reasoning
 * and concluding reasoning fold INSIDE the group. The one exception: a single
 * bare `×N` group whose absorbed transparents are all STRUCTURAL (rawEvent /
 * turnSeparator / commandFeedback / empty assistant — NOT reasoning) stays a
 * bare group (it already carries its own frame; wrapping it around only debug
 * rows would double-frame with no gain). A lone `×N` that absorbed real
 * `thinking` DOES wrap, so its reasoning folds inside.
 */
/**
 * Emit a single tool run into `result`. A lone `×N` group whose absorbed
 * transparents are all STRUCTURAL (no `thinking`) stays a bare group with its
 * surrounding transparents standalone; every other run wraps into a burst that
 * folds `pending` (leading) + the window slice (interior + trailing).
 */
function emitToolRun(
  result: BurstItem[],
  items: ChatItem[],
  start: number,
  end: number,
  members: number,
  pending: ChatItem[],
): void {
  const item = items[start];
  const absorbedThinking =
    pending.some(isThinking) || items.slice(start + 1, end).some(isThinking);
  const bareGroup = members === 1 && isGroup(item) && !absorbedThinking;
  if (bareGroup) {
    // Flush leading transparents standalone, the bare `×N`, then trailing
    // transparents — preserving original order (no double-frame).
    for (const p of pending) result.push(p);
    result.push(item);
    for (let k = start + 1; k < end; k++) result.push(items[k]);
    return;
  }
  result.push({ type: "burst", id: firstId(item), items: [...pending, ...items.slice(start, end)] });
}

export function groupToolBursts(messages: ChatMessage[]): BurstItem[] {
  const items = groupConsecutiveToolCalls(messages);
  const result: BurstItem[] = [];
  // Leading transparents buffered ahead of a possible burst. Flushed verbatim
  // if a HARD row (not a tool-like item) follows instead.
  let pending: ChatItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    // Transparent: buffer as a potential leading absorption for an upcoming run.
    if (isTransparentItem(item)) {
      pending.push(item);
      i++;
      continue;
    }

    // HARD row (non-transparent, non-tool-like): flush buffered transparents
    // verbatim, then emit the HARD row. Leading transparents never cross a HARD
    // boundary into a later group.
    if (!isToolLike(item)) {
      for (const p of pending) result.push(p);
      pending = [];
      result.push(item);
      i++;
      continue;
    }

    // Tool-like: start of a run. Absorb interior + trailing transparents.
    const { members, end } = burstWindow(items, i);
    emitToolRun(result, items, i, end, members, pending);
    pending = [];
    i = end;
  }

  // Trailing transparents with no following tool run (e.g. end-of-stream
  // reasoning after a HARD row) emit verbatim.
  for (const p of pending) result.push(p);

  return result;
}
