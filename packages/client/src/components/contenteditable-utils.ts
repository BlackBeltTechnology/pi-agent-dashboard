/**
 * contenteditable-utils.ts
 *
 * Cursor-position and plaintext<->HTML conversion helpers for
 * contentEditable plaintext-only divs.
 */

/**
 * Recursively walk the tree under `root`, accumulating a character count.
 * Text nodes add their length. `<br>` elements add 1 (representing `\n`).
 * Other elements are descended into but add nothing.
 */
function countCharsUpTo(root: Node, stopNode: Node, stopOffset: number): number {
  let count = 0;

  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child === stopNode) {
      return count + stopOffset;
    }

    // Check if stopNode is inside this child
    if (child.contains(stopNode)) {
      if (child.nodeType === Node.TEXT_NODE) {
        return count + Math.min(stopOffset, (child as Text).length);
      }
      if (child.nodeName === "BR") {
        return count + (stopOffset === 0 ? 0 : 1);
      }
      // Descend
      return count + countCharsUpTo(child, stopNode, stopOffset);
    }

    // Entire child is before stopNode — count it fully
    if (child.nodeType === Node.TEXT_NODE) {
      count += (child as Text).length;
    } else if (child.nodeName === "BR") {
      count += 1;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      count += countCharsUpTo(child, stopNode, Number.MAX_SAFE_INTEGER);
    }
  }

  return count;
}

/**
 * Find the text node (or element) and offset within `root` that corresponds
 * to a given plaintext character offset. Returns `null` if offset is
 * beyond the total text length.
 */
function findNodeAt(root: Node, targetOffset: number): { node: Node; offset: number } | null {
  let remaining = targetOffset;

  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) {
      const len = (child as Text).length;
      if (remaining <= len) {
        return { node: child, offset: remaining };
      }
      remaining -= len;
    } else if (child.nodeName === "BR") {
      if (remaining <= 0) {
        return { node: child, offset: 0 };
      }
      remaining -= 1;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const sub = findNodeAt(child, remaining);
      if (sub) return sub;
      // Count everything in this child
      remaining -= countCharsUpTo(child, child, Number.MAX_SAFE_INTEGER);
    }
  }

  return null;
}

/**
 * Get the character offset of the current collapsed selection within the
 * plaintext representation of a contentEditable root element.
 *
 * Returns `null` if there is no selection or the selection is not within
 * the given root element.
 */
export function getPlainTextCursor(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  if (!sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const anchorNode = range.startContainer;
  const anchorOffset = range.startOffset;

  if (!root.contains(anchorNode)) return null;

  return countCharsUpTo(root, anchorNode, anchorOffset);
}

/**
 * Place a collapsed cursor at the given character offset within the
 * plaintext representation of a contentEditable root element.
 *
 * If offset exceeds the total text length, cursor is placed at the end.
 */
export function setPlainTextCursor(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  const found = findNodeAt(root, offset);

  if (found) {
    if (found.node.nodeName === "BR") {
      range.setStartBefore(found.node);
    } else {
      range.setStart(found.node, found.offset);
    }
  } else {
    // Offset beyond end — place at end of last text node, or root start
    range.setStart(root, root.childNodes.length);
  }

  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Convert plaintext to safe HTML suitable for setting as innerHTML
 * of a contenteditable div.
 *
 * Escapes &, <, > and maps \n to <br>.
 */
export function plainToSafeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/**
 * Convert innerHTML from a contenteditable div back to plaintext.
 *
 * Strips all HTML tags, decodes common entities, and normalizes
 * block-level breaks (<br>, <div>, <p>) to \n.
 *
 * Does NOT collapse consecutive newlines or trim trailing newlines —
 * the user's blank lines are intentionally preserved.
 */
export function safeHtmlToPlain(html: string): string {
  return html
    // Normalize <br> variants to \n
    .replace(/<br\s*\/?>/gi, "\n")
    // Normalize block element boundaries to \n (opening and closing tags)
    .replace(/<\/div>\s*<div[^>]*>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<\/(div|p)>/gi, "\n")
    .replace(/<(div|p)[^>]*>/gi, "")
    // Strip remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
