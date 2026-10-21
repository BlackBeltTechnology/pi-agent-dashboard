import { useLayoutEffect, useRef } from "react";

/**
 * Soft trailing edge of the paced reveal (design D5). A small gradient overlay
 * sits at the reveal point so the newest glyphs appear softened and turn crisp
 * as the reveal advances. The markdown tree is NEVER touched — links, selection,
 * copy and linkification are unaffected — the overlay is a sibling inside the
 * streaming bubble (`.chat-stream-live`, already `position: relative`), painted
 * beneath that bubble's `::before`/`::after` liveness layers.
 *
 * After each reveal commit it finds the last text node of the bubble and measures
 * its last client rect with a `Range`. It is HIDDEN when the reveal point is in a
 * code block, diagram or math, in inline `code` (different background), or in
 * `direction: rtl` text; it fades out (opacity transition) when the backlog is
 * empty, and is not rendered at all when disabled (inactive / frozen / ended).
 *
 * `data-edge` is `visible` | `hidden` for tests; the rest is plain inline style.
 * See change: add-fluid-chat-motion.
 */

const NON_PROSE = "pre, svg, .katex, .katex-display, [data-mermaid-ordinal], [class*='mermaid'], [data-testid*='mermaid']";
const EDGE_EM = 2.5;

/** The last non-blank text node under `root`, found by walking backwards (O(depth), not O(nodes)). */
function lastTextNode(root: Element): Text | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ALL);
  while (walker.lastChild()) {
    // descend to the deepest last node
  }
  let node: Node | null = walker.currentNode;
  while (node && node !== root) {
    if (node.nodeType === Node.TEXT_NODE && (node as Text).nodeValue?.trim()) return node as Text;
    node = walker.previousNode();
  }
  return null;
}

/** Why the overlay cannot sit at this reveal point, or null when it can. */
function edgeSkipReason(node: Text): "block" | "inline-code" | "rtl" | null {
  const parent = node.parentElement;
  if (!parent) return "block";
  if (parent.closest(NON_PROSE)) return "block";
  if (parent.closest("code")) return "inline-code";
  const view = node.ownerDocument.defaultView;
  if (view && view.getComputedStyle(parent).direction === "rtl") return "rtl";
  return null;
}

interface Props {
  /** The revealed text; a change re-measures the reveal point. */
  text: string;
  /** True while a backlog remains. False fades the overlay out. */
  revealing: boolean;
}

export function TrailingEdge({ text, revealing }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the re-measure trigger
  useLayoutEffect(() => {
    const el = ref.current;
    const bubble = el?.parentElement;
    if (!el || !bubble) return;
    const hide = () => {
      el.dataset.edge = "hidden";
      el.style.opacity = "0";
    };
    const last = lastTextNode(bubble);
    if (!last || edgeSkipReason(last)) return hide();
    const range = last.ownerDocument.createRange();
    range.selectNodeContents(last);
    if (typeof range.getClientRects !== "function") return hide();
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    if (!rect) return hide();
    const host = bubble.getBoundingClientRect();
    const fontPx = Number.parseFloat(last.ownerDocument.defaultView?.getComputedStyle(last.parentElement as Element).fontSize ?? "") || 14;
    const width = EDGE_EM * fontPx;
    el.style.width = `${width}px`;
    el.style.height = `${rect.height}px`;
    el.style.transform = `translate(${rect.right - host.left - width}px, ${rect.top - host.top}px)`;
    el.dataset.edge = revealing ? "visible" : "hidden";
    el.style.opacity = revealing ? "1" : "0";
  }, [text, revealing]);

  return (
    <span
      ref={ref}
      aria-hidden
      data-testid="trailing-edge"
      data-edge="hidden"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        opacity: 0,
        background: "linear-gradient(to right, transparent, var(--bg-tertiary))",
        transition: "opacity 200ms ease-out",
      }}
    />
  );
}
