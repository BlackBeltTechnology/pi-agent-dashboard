/**
 * Pure helpers for the windowed (TanStack Virtual) chat transcript.
 *
 * `ChatView` renders a windowed list over the heterogeneous `displayRows`
 * (the prefs-filtered `groupToolBursts` output). These helpers are the pure,
 * unit-testable core of that windowing — the virtualizer key, the per-row-type
 * pre-measure size estimate, and the `turnIndex → first-row-index` map that
 * backs `ChatViewHandle.scrollToTurn`.
 *
 * See change: virtualize-chat-transcript-tanstack (Phase 2 Step B). Doubt-Review
 * corrections CR-3 (per-type key), CR-4 (turn map over the filtered rows).
 */
import type { ChatMessage } from "./event-reducer.js";
import type { BurstItem, ToolBurstGroup } from "./group-tool-bursts.js";
import type { ToolCallGroup } from "./group-tool-calls.js";

/** A temporal burst group row. */
export function isBurst(item: BurstItem): item is ToolBurstGroup {
  return (item as ToolBurstGroup).type === "burst";
}

/** A bare semantic ×N group row. */
export function isGroup(item: BurstItem): item is ToolCallGroup {
  return (item as ToolCallGroup).type === "group";
}

/**
 * Stable virtualizer/React key for a display row (CR-3). Mirrors the current
 * render keys per row type:
 *   burst  → `burst.id` (first tool-like member id; survives head-trim churn)
 *   group  → first member id, else `group-<index>` (never a bare `toolName`,
 *            which collides across two sub-threshold bursts of the same tool)
 *   message→ `msg.id`
 * Uniqueness is a hard precondition for measurement caching under windowing.
 */
export function virtualRowKey(item: BurstItem, index: number): string {
  if (isBurst(item)) return item.id;
  if (isGroup(item)) return item.messages[0]?.id ?? `group-${index}`;
  return (item as ChatMessage).id;
}

/**
 * Content-aware pre-measure size estimate (change: fix-chat-scroll-to-top-
 * estimate-drift, Decision 1). Only affects first-paint offset error —
 * `measureElement` caches each row's real rendered height after mount. A
 * STATIC per-role constant under-shot the largest rows by 10-50x (a pasted-
 * image user row, a 24k-char toolResult), so as they mounted during an upward
 * scroll `getTotalSize()` jumped and the top receded. Scaling the estimate by
 * the row's text payload shrinks that estimate error `delta`, which shrinks
 * TanStack's built-in above-viewport correction below perception.
 *
 * `textChars` is the row's precomputed aggregate rendered text length (see
 * `computeRowTextChars`), passed in so this stays **O(1) per row, pure, memo-
 * safe** — it is called during windowing on every scroll pass and MUST NOT
 * walk content blocks. Image presence is read O(1) from `item.images`.
 *
 * Constants derived from the repro height distribution (session `019f43e4`):
 * 9240 chars -> ~2300px and 24071 chars -> ~6000px both give ~0.25 px/char,
 * i.e. LINE_PX / CHARS_PER_LINE = 20 / 80. Acceptance is the convergence e2e,
 * not intuition (task 2.4).
 */
const CHARS_PER_LINE = 80;
const LINE_PX = 20;
/**
 * Upper bound on the pre-measure text reserve. Bounds the reserve for a
 * pathological 100k-char row (would otherwise reserve ~25000px of empty
 * spacer); the residual delta above the clamp is absorbed by the built-in
 * corrector + the scroll-to-top affordance. 8000px covers ~32k chars
 * accurately — above the largest observed row (24k chars / ~6000px).
 */
const TEXT_RESERVE_CLAMP = 8000;
/**
 * Per-renderer-kind image reserve. Caps differ by render path (verified):
 * user attachments `max-h-[300px]` (ChatView ImageAttachments), tool-result
 * images `max-h-[512px]` (ToolResultImages). NOT one global constant.
 */
const IMAGE_RESERVE_USER = 300;
const IMAGE_RESERVE_TOOL_RESULT = 512;

/** Base (chrome) height per row type, before the text/image reserve. */
function baseRowSize(role: ChatMessage["role"]): number {
  switch (role) {
    case "turnSeparator":
      return 24;
    case "commandFeedback":
      return 48;
    case "thinking":
      return 72;
    case "user":
      return 96;
    case "toolResult":
      return 120;
    case "rawEvent":
      return 120;
    case "custom":
      // Bounded generic custom-entry card: chrome + a visible (240px-capped)
      // body region — the 120 default arm is badly wrong for a 200-line JSON
      // body. See change: render-inline-reasoning-and-custom-entries (P2).
      return 160;
    case "assistant":
      return 140;
    case "bashOutput":
      return 160;
    case "interactiveUi":
      return 160;
    case "inlineTerminal":
      return 220;
    default:
      return 120;
  }
}

export function estimateVirtualRowSize(item: BurstItem, textChars = 0): number {
  // Burst/group rows keep type constants — their variance is small relative to
  // text rows and their aggregate text is folded into child cards.
  if (isBurst(item)) return 220;
  if (isGroup(item)) return 64;
  const msg = item as ChatMessage;
  let textReserve = Math.min(Math.ceil(textChars / CHARS_PER_LINE) * LINE_PX, TEXT_RESERVE_CLAMP);
  // The custom card's body region is height-CAPPED (max-h-[240px] in
  // CustomEntryCard), so a large text reserve would over-estimate by ~14× on a
  // 200-line JSON body and reintroduce first-paint scroll drift. Clamp the
  // reserve to the body cap. See change:
  // render-inline-reasoning-and-custom-entries (security pass, advisory #3).
  if (msg.role === "custom") textReserve = Math.min(textReserve, 240);
  const size = baseRowSize(msg.role) + textReserve;
  if (msg.images && msg.images.length > 0) {
    return size + (msg.role === "toolResult" ? IMAGE_RESERVE_TOOL_RESULT : IMAGE_RESERVE_USER);
  }
  return size;
}

/**
 * Aggregate rendered text length for a display row (change: fix-chat-scroll-to-
 * top-estimate-drift, task 2.1). Walks the row ONCE — call it when `displayRows`
 * is built (in the ChatView `useMemo`), cache the result, and feed it to
 * `estimateVirtualRowSize` so `estimateSize` never re-walks per scroll pass.
 * Burst/group rows sum their members so their (unused) reserve stays bounded.
 */
export function computeRowTextChars(item: BurstItem): number {
  if (isBurst(item)) {
    let sum = 0;
    for (const sub of item.items) {
      sum += isGroup(sub) ? groupTextChars(sub) : messageTextChars(sub as ChatMessage);
    }
    return sum;
  }
  if (isGroup(item)) return groupTextChars(item);
  return messageTextChars(item as ChatMessage);
}

function messageTextChars(m: ChatMessage): number {
  return m.content.length + (m.result?.length ?? 0);
}

function groupTextChars(g: ToolCallGroup): number {
  let sum = 0;
  for (const m of g.messages) sum += messageTextChars(m);
  return sum;
}

/**
 * Build `turnIndex → first display-row index` (CR-4, Decision 4).
 *
 * `turnIndex` is assigned only to the (last) user message of a turn, not to
 * burst/group rows. A turn's navigable rows are therefore the top-level
 * `ChatMessage` rows carrying `turnIndex` — the same rows that render
 * `data-turn` today. First row wins (a later duplicate turnIndex is ignored).
 * Built over the FILTERED `displayRows` so the resulting index feeds
 * `virtualizer.scrollToIndex` directly.
 */
export function buildTurnToFirstRowIndex(rows: BurstItem[]): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (isBurst(item) || isGroup(item)) continue;
    const turnIndex = (item as ChatMessage).turnIndex;
    if (turnIndex != null && !map.has(turnIndex)) {
      map.set(turnIndex, i);
    }
  }
  return map;
}

/**
 * `toolCallId → first display-row index` over the filtered rows: a plain tool
 * row, a bare `×N` group member, or a member of a temporal burst all resolve to
 * the row that renders them. Backs `ChatViewHandle.scrollToTool` (the composer
 * dock's Show). A tool whose row the display prefs hide is simply absent.
 * See change: add-composer-dock (task 3.1).
 */
export function buildToolCallToRowIndex(rows: BurstItem[]): Map<string, number> {
  const map = new Map<string, number>();
  const add = (toolCallId: string | undefined, index: number) => {
    if (toolCallId && !map.has(toolCallId)) map.set(toolCallId, index);
  };
  const visit = (item: BurstItem | ChatMessage | ToolCallGroup, index: number): void => {
    if (isBurst(item as BurstItem)) {
      for (const inner of (item as ToolBurstGroup).items) visit(inner, index);
    } else if (isGroup(item as BurstItem)) {
      for (const m of (item as ToolCallGroup).messages) add(m.toolCallId, index);
    } else {
      add((item as ChatMessage).toolCallId, index);
    }
  };
  rows.forEach((row, index) => visit(row, index));
  return map;
}

// --- Active-selection retention (change: preserve-chat-selection-during-churn) ---

/** Inclusive display-row index span [min..max] a selection intersects. */
export interface SelectionRowSpan {
  min: number;
  max: number;
}

/**
 * Resolve a Range endpoint node to its display-row index by walking up to the
 * nearest mounted `[data-index]` element. Returns `null` when the node is not
 * inside a virtual row (streaming tail, pending-steer/prompt, header/composer —
 * none carry `data-index`).
 */
function endpointRowIndex(node: Node | null, container: HTMLElement): number | null {
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const rowEl = el?.closest?.("[data-index]") ?? null;
  if (!rowEl || !container.contains(rowEl)) return null;
  const idx = Number(rowEl.getAttribute("data-index"));
  return Number.isInteger(idx) ? idx : null;
}

/**
 * Clamp a NON-virtual endpoint (no `[data-index]`) to the nearest virtual
 * boundary by document order: a node preceding the container clamps to the
 * first row (0); a node following/contained-below (streaming tail, pending)
 * clamps to the last row (`rowCount - 1`).
 */
function clampEndpointToBoundary(node: Node, container: HTMLElement, rowCount: number): number {
  const pos = container.compareDocumentPosition(node);
  return pos & Node.DOCUMENT_POSITION_PRECEDING ? 0 : rowCount - 1;
}

/**
 * Map a DOM `Range` to the inclusive display-row span it intersects (D3).
 *
 * Walks `startContainer`/`endContainer` up to the nearest `[data-index]` row.
 * Endpoints in a non-virtual region clamp to the nearest virtual boundary.
 * Reversed and same-row selections normalize via `min`/`max`. Returns `null`
 * when the selection touches no virtual row (e.g. entirely inside the streaming
 * tail, or entirely outside the transcript).
 *
 * PURE + O(1)-ish (two ancestor walks): the caller reads this on every
 * `selectionchange` while all rows are still mounted, storing the result in a
 * ref so `rangeExtractor` keeps those rows mounted BEFORE any unmount can move
 * the live Range endpoints. The retained-row ceiling is applied by the caller
 * (device-aware via `useMobile()`), not here.
 */
export function rangeToRowIndexSpan(
  range: Range,
  container: HTMLElement,
  rowCount: number,
): SelectionRowSpan | null {
  if (rowCount <= 0) return null;
  const { startContainer, endContainer } = range;
  const startIn = container.contains(startContainer);
  const endIn = container.contains(endContainer);
  if (!startIn && !endIn) return null; // selection does not touch the transcript

  const startIdx = endpointRowIndex(startContainer, container);
  const endIdx = endpointRowIndex(endContainer, container);
  if (startIdx == null && endIdx == null) return null; // only non-virtual regions

  const a = startIdx ?? clampEndpointToBoundary(startContainer, container, rowCount);
  const b = endIdx ?? clampEndpointToBoundary(endContainer, container, rowCount);
  const min = Math.max(0, Math.min(a, b));
  const max = Math.min(rowCount - 1, Math.max(a, b));
  return { min, max };
}

/**
 * Rows to keep mounted for ONE selection span (change: keep-oversized-chat-
 * selection, D1). Within the retained-row ceiling `cap` every row of the span is
 * retained; past it only the two ENDPOINT rows are, so neither Range boundary
 * ever moves (the interior re-highlights on remount). Never empty for a span.
 */
function spanRetainedRows(lo: number, hi: number, cap: number, count: number): number[] {
  const min = Math.max(0, lo);
  const max = Math.min(count - 1, hi);
  if (min > max) return [];
  if (max - min + 1 > cap) return min === max ? [min] : [min, max];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/**
 * D4 retained union: `stored` is the event-time span, `live` the extractor-time
 * read of the live Selection. Let U be their min/max hull. Within `cap` retain
 * all of U; otherwise ONLY the endpoint rows of both spans (≤ 4 rows). So a
 * stale stored span can never turn a live endpoint into an unmounted interior
 * row, and the retained set is always ≤ max(cap, 4). Sorted, deduped, in
 * `[0, count)`.
 */
export function retainedSelectionRows(
  stored: SelectionRowSpan | null,
  live: SelectionRowSpan | null,
  cap: number,
  count: number,
): number[] {
  if (!stored && !live) return [];
  const spans = [stored, live].filter((s): s is SelectionRowSpan => s != null);
  const hullMin = Math.min(...spans.map((s) => s.min));
  const hullMax = Math.max(...spans.map((s) => s.max));
  if (Math.min(count - 1, hullMax) - Math.max(0, hullMin) + 1 <= cap) {
    return spanRetainedRows(hullMin, hullMax, Number.POSITIVE_INFINITY, count);
  }
  const out = new Set<number>();
  for (const s of spans) for (const i of spanRetainedRows(s.min, s.max, 0, count)) out.add(i);
  return Array.from(out).sort((a, b) => a - b);
}

/**
 * Union an active selection's row span into the virtualizer's default range
 * (D3 / keep-oversized-chat-selection D1). Within the retained-row ceiling `cap`
 * the whole span is added; past it ONLY its two endpoint rows are — the
 * selection is never cleared and copy fidelity comes from the copy handler's
 * transient full-span mount, not from retention. Result stays sorted ascending
 * and within `[0, count)` as the virtualizer requires.
 */
export function extendRangeWithSelection(
  base: number[],
  span: SelectionRowSpan | null,
  cap: number,
  count: number,
): number[] {
  if (!span) return base;
  const set = new Set(base);
  for (const i of retainedSelectionRows(span, null, cap, count)) set.add(i);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Union the virtualizer default range, the retained rows and a transient COPY
 * span (D2). `copyOnly` = copy span minus base minus retained: rows mounted only
 * for the duration of one copy, which the render loop leaves unmeasured so the
 * virtualizer size cache and scroll position stay untouched.
 */
export function mergeCopySpan(
  base: number[],
  retained: number[],
  copySpan: SelectionRowSpan | null,
  count: number,
): { rows: number[]; copyOnly: Set<number> } {
  const set = new Set(base);
  for (const i of retained) set.add(i);
  const copyOnly = new Set<number>();
  if (copySpan) {
    const hi = Math.min(count - 1, copySpan.max);
    for (let i = Math.max(0, copySpan.min); i <= hi; i++) {
      if (!set.has(i)) copyOnly.add(i);
      set.add(i);
    }
  }
  return { rows: Array.from(set).sort((a, b) => a - b), copyOnly };
}

/** `virtualRowKey` → display-row index, for resolving DOM rows by stable identity (D4). */
export function buildRowKeyToIndex(displayRows: readonly BurstItem[]): Map<string, number> {
  const map = new Map<string, number>();
  displayRows.forEach((row, index) => {
    map.set(virtualRowKey(row, index), index);
  });
  return map;
}

/** Row key of the nearest `[data-row-key]` ancestor inside `container`, else `null`. */
function endpointRowKey(node: Node | null, container: HTMLElement): string | null {
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const rowEl = el?.closest?.("[data-row-key]") ?? null;
  if (!rowEl || !container.contains(rowEl)) return null;
  return rowEl.getAttribute("data-row-key");
}

/**
 * Row span of `range` clipped to `container`, resolved by stable row key (D4/D7).
 * An endpoint OUTSIDE the container clamps to the boundary row (start → `0`, end
 * → `rowCount - 1`), which is the clipped span of a range that begins before or
 * ends after the transcript. An endpoint in a non-virtual region inside the
 * container clamps like `rangeToRowIndexSpan`; an endpoint whose key is no
 * longer in `keyToIndex` falls back to the `stored` span's matching bound.
 * No ownership gate: callers decide whether the range counts.
 */
export function rangeRowSpanInContainer(
  range: Range,
  container: HTMLElement,
  keyToIndex: ReadonlyMap<string, number>,
  rowCount: number,
  stored: SelectionRowSpan | null = null,
): SelectionRowSpan | null {
  if (rowCount <= 0) return null;
  const resolve = (node: Node, isStart: boolean, fallback: number | undefined): number | null => {
    if (!container.contains(node)) return isStart ? 0 : rowCount - 1;
    const key = endpointRowKey(node, container);
    if (key == null) return clampEndpointToBoundary(node, container, rowCount);
    return keyToIndex.get(key) ?? fallback ?? null;
  };
  const a = resolve(range.startContainer, true, stored?.min);
  const b = resolve(range.endContainer, false, stored?.max);
  if (a == null && b == null) return null;
  const x = a ?? (b as number);
  const y = b ?? (a as number);
  return { min: Math.max(0, Math.min(x, y)), max: Math.min(rowCount - 1, Math.max(x, y)) };
}

/**
 * Row span of the LIVE Selection, read at extractor time (D4). Requires a
 * non-collapsed selection whose anchor OR focus lies inside `container` (the
 * hook's `selectionIntersects` test — a page-wide range with both endpoints
 * outside yields `null`). Resolution is `rangeRowSpanInContainer`'s: by the
 * stable `data-row-key`, never the DOM `data-index`, which still holds
 * pre-splice numbers right after a history splice. READ-ONLY: never mutates the
 * Selection.
 */
export function liveSelectionRowSpan(
  container: HTMLElement,
  keyToIndex: ReadonlyMap<string, number>,
  rowCount: number,
  stored: SelectionRowSpan | null = null,
): SelectionRowSpan | null {
  if (rowCount <= 0 || typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const anchorIn = sel.anchorNode ? container.contains(sel.anchorNode) : false;
  const focusIn = sel.focusNode ? container.contains(sel.focusNode) : false;
  if (!anchorIn && !focusIn) return null;
  return rangeRowSpanInContainer(sel.getRangeAt(0), container, keyToIndex, rowCount, stored);
}
