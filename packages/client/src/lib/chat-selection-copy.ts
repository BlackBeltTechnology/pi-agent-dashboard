/**
 * Rebuild clipboard text for an active transcript selection
 * (change: chat-copy-fidelity-intercept).
 *
 * Keeping a selection alive across virtual-row churn
 * (`preserve-chat-selection-during-churn`) does not guarantee a correct copy.
 * Two pre-existing gaps remain that whole-message serialization gets wrong:
 *
 *  - Partial-node selections: a `Range` can start/end mid-node inside rendered
 *    markdown. Text comes from `Range.cloneContents()` — exactly the selected
 *    characters. We do NOT reconstruct from markdown source (mapping a rendered
 *    offset back to a source offset is intractable without a source map).
 *  - DOM-capped renderers: a renderer may cap its rendered text (e.g.
 *    `AgentToolRenderer` renders `text.slice(0, 1000)`), so a fully on-screen
 *    selection over it copies a truncated prefix. Such a renderer opts its full
 *    text into the copy path via a `data-copy-text` attribute. When the capped
 *    element is FULLY within the selection, its full text is substituted;
 *    partially-selected capped elements fall back to the rendered (clipped)
 *    text so the copy never over-reaches the selection.
 */

/** Attribute a capping renderer sets to expose its full text to the copy path. */
export const COPY_TEXT_ATTR = "data-copy-text";

/** Block-level tags whose boundary emits a newline (approximate native copy). */
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "PRE",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TABLE",
  "TR",
  "HR",
]);

/** True when `range` fully contains `el`'s contents (both endpoints outside). */
function selectionFullyContains(range: Range, el: Element): boolean {
  const elRange = el.ownerDocument.createRange();
  elRange.selectNodeContents(el);
  const startsAtOrBefore = range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0;
  const endsAtOrAfter = range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0;
  return startsAtOrBefore && endsAtOrAfter;
}

/** Serialize a detached fragment to text with block-boundary newlines. */
function serializeFragment(root: Node): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    // Separate a block element from preceding inline content with a leading
    // newline too, so `inline<block>inline` reads like a native copy.
    if (BLOCK_TAGS.has(el.tagName) && out.length > 0 && !out.endsWith("\n")) out += "\n";
    for (const child of Array.from(el.childNodes)) walk(child);
    if (BLOCK_TAGS.has(el.tagName)) out += "\n";
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return out.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

/**
 * Build clipboard text for `range`. `container` scopes the capped-element scan
 * to the transcript. Returns the empty string for a collapsed/empty selection.
 */
export function buildSelectionClipboardText(range: Range, container: Element): string {
  if (range.collapsed) return "";
  const fragment = range.cloneContents();

  // Live capped elements intersecting the range, in document order, tagged with
  // whether the selection fully contains each. `cloneContents()` includes the
  // same intersecting capped elements in the same order, so the two lists zip.
  const liveCapped = Array.from(container.querySelectorAll(`[${COPY_TEXT_ATTR}]`))
    .filter((el) => range.intersectsNode(el))
    .map((el) => ({ full: selectionFullyContains(range, el), text: el.getAttribute(COPY_TEXT_ATTR) ?? "" }));

  const fragCapped = Array.from(fragment.querySelectorAll(`[${COPY_TEXT_ATTR}]`));
  for (let i = 0; i < fragCapped.length; i++) {
    const info = liveCapped[i];
    // Substitute only for a fully-contained capped element whose full text
    // starts with the rendered (clipped) prefix — the prefix guard also
    // protects against a rare live/fragment ordering desync.
    if (info?.full && info.text.startsWith(fragCapped[i].textContent ?? "")) {
      fragCapped[i].textContent = info.text;
    }
  }
  return serializeFragment(fragment);
}
