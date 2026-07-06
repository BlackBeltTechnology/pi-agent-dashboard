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

/** Stable id of a tool-like item (a group → its first member's id). */
function firstId(item: ChatItem): string {
  if (isGroup(item)) return item.messages[0]?.id ?? item.toolName;
  return (item as ChatMessage).id;
}

/**
 * Walk the maximal burst window starting at a tool-like item `start`. Returns
 * the member count (tool-like items; a `×N` group is one) and `end` (exclusive)
 * past the final tool-like member — trailing transparents are left for the next
 * iteration. Stops at the first HARD row.
 */
function burstWindow(items: ChatItem[], start: number): { members: number; end: number } {
  let members = 1;
  let end = start + 1;
  for (let j = start + 1; j < items.length; j++) {
    const next = items[j];
    if (isTransparentItem(next)) continue;
    if (!isToolLike(next)) break; // HARD boundary
    members++;
    end = j + 1;
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
 * `interactiveUi`, `bashOutput`, `inlineTerminal`, …) terminates it. A run of
 * ≥ 3 members forms a burst; otherwise every consumed item — including
 * intermediate transparents — is emitted verbatim (so a pure `×24` poll stays a
 * bare group, and a sub-threshold heterogeneous run stays flat).
 */
export function groupToolBursts(messages: ChatMessage[]): BurstItem[] {
  const items = groupConsecutiveToolCalls(messages);
  const result: BurstItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    // Non-tool-like item (transparent or HARD): emit standalone.
    if (!isToolLike(item)) {
      result.push(item);
      i++;
      continue;
    }

    // Maximal burst window starting at a tool-like item. `end` (exclusive) sits
    // past the final tool-like member, so trailing transparents after it belong
    // to the next iteration and render at the top level.
    const { members, end } = burstWindow(items, i);
    if (members >= 3) {
      result.push({ type: "burst", id: firstId(item), items: items.slice(i, end) });
    } else {
      for (let k = i; k < end; k++) result.push(items[k]);
    }
    i = end;
  }

  return result;
}
