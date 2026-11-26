// GENERIC pane scroll guard (side-effect module, imported FIRST by main.tsx). In an
// embedded `?pane=` document, nothing the runner or a mocked component does may scroll
// the reviewer's page: native focus / scrollIntoView scroll every ancestor scrollport,
// including the host page. Patched (only methods that exist):
// - HTMLElement / SVGElement `focus`: always `preventScroll: true`, then reveal in the pane
//   unless the caller asked for `preventScroll: true`;
// - `scrollIntoView` / `scrollIntoViewIfNeeded`: reveal in the pane only.
// Reveal scrolls in-pane scroll containers, then the pane window; never an ancestor
// document. Top-level `?pane=` documents (headless check / video) keep native scrolling.
// See change: mock-player-step-controls (design D1).

type Align = "start" | "center" | "end" | "nearest";
type Win = Window & typeof globalThis;

/** Scroll offset that brings [a, b] (relative to the scrollport start) into a port of `size`. */
function delta(a: number, b: number, size: number, align: Align): number {
  if (align === "start") return a;
  if (align === "end") return b - size;
  if (align === "center") return (a + b) / 2 - size / 2;
  if (a >= 0 && b <= size) return 0;
  if (a < 0 && b > size) return 0;
  return a < 0 || b - a > size ? a : b - size;
}

/** Reveal `el` inside its own document: scrollable ancestors first, then the window. */
function reveal(win: Win, el: Element, block: Align, inline: Align): void {
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const cs = win.getComputedStyle(p);
    const sy = cs.overflowY !== "visible" && p.scrollHeight > p.clientHeight;
    const sx = cs.overflowX !== "visible" && p.scrollWidth > p.clientWidth;
    if (!sy && !sx) continue;
    const box = p.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const top = box.top + p.clientTop;
    const left = box.left + p.clientLeft;
    if (sy) p.scrollTop += delta(r.top - top, r.bottom - top, p.clientHeight, block);
    if (sx) p.scrollLeft += delta(r.left - left, r.right - left, p.clientWidth, inline);
  }
  const r = el.getBoundingClientRect();
  const dy = delta(r.top, r.bottom, win.innerHeight, block);
  const dx = delta(r.left, r.right, win.innerWidth, inline);
  if (dx || dy) win.scrollTo(win.scrollX + dx, win.scrollY + dy);
}

const blockOf = (arg: unknown): Align =>
  arg === false ? "end" : typeof arg === "object" && arg !== null ? ((arg as ScrollIntoViewOptions).block ?? "start") : "start";

/** Install the guard on `win` when it is an embedded `?pane=` document. Returns whether it did. */
export function installPaneScrollGuard(win: Win): boolean {
  if (!new URLSearchParams(win.location.search).has("pane") || win.parent === win) return false;
  for (const proto of [win.HTMLElement?.prototype, win.SVGElement?.prototype]) {
    const focus = proto?.focus;
    if (typeof focus !== "function") continue;
    proto.focus = function (this: HTMLElement, opts?: FocusOptions) {
      focus.call(this, { ...opts, preventScroll: true });
      if (opts?.preventScroll !== true && this.ownerDocument.activeElement === this) reveal(win, this, "nearest", "nearest");
    };
  }
  const el = win.Element.prototype as Element & { scrollIntoViewIfNeeded?: (center?: boolean) => void };
  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) { reveal(win, this, blockOf(arg), "nearest"); };
  }
  if (typeof el.scrollIntoViewIfNeeded === "function") {
    el.scrollIntoViewIfNeeded = function (this: Element) { reveal(win, this, "nearest", "nearest"); };
  }
  return true;
}

installPaneScrollGuard(window as Win);
