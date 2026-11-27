// @vitest-environment jsdom
/**
 * L1 — pane scroll guard: focus forced quiet, install conditions, no new APIs,
 * scrollIntoView argument mapping inside the pane only.
 * See change: mock-player-step-controls (test-plan E12-E15).
 */
// @ts-expect-error jsdom has no bundled types and @types/jsdom is not installed
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { installPaneScrollGuard } from "../pane-scroll-guard.ts";

type Win = Window & typeof globalThis;
/** A JSDOM window at `search`; `embedded` fakes a parent window (the host page). */
function makeWin(search: string, embedded: boolean, prep?: (w: Win) => void) {
  const w = new JSDOM("<!doctype html><body></body>", { url: `http://mock.local/${search}` }).window as unknown as Win;
  const host = { scrollTo: vi.fn() };
  if (embedded) Object.defineProperty(w, "parent", { value: host, configurable: true });
  prep?.(w);
  return { w, host };
}

describe("pane scroll guard", () => {
  it("focus always reaches the original with preventScroll: true; target is activeElement (E12)", () => {
    const { w } = makeWin("?pane=a/1/proposed", true);
    const html = vi.spyOn(w.HTMLElement.prototype, "focus");
    const svg = vi.spyOn(w.SVGElement.prototype, "focus");
    w.scrollTo = vi.fn() as never;
    expect(installPaneScrollGuard(w)).toBe(true);
    const doc = w.document;
    doc.body.innerHTML = `<button id="b">b</button><svg><a id="s" href="#x" tabindex="0"><text>s</text></a></svg>`;
    const b = doc.getElementById("b")!;
    b.focus();
    expect(html).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(b);
    b.blur();
    b.focus({ preventScroll: false });
    expect(html).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(b);
    const s = doc.getElementById("s") as unknown as SVGElement;
    s.focus();
    expect(svg).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(s);
  });

  it("installs only with pane= AND embedded (E13)", () => {
    for (const [search, embedded, want] of [["?pane=a/1/proposed", true, true], ["?pane=a/1/proposed", false, false], ["", true, false], ["", false, false]] as const) {
      const { w } = makeWin(search, embedded);
      const focus = w.HTMLElement.prototype.focus;
      expect(installPaneScrollGuard(w)).toBe(want);
      expect(w.HTMLElement.prototype.focus !== focus).toBe(want);
    }
  });

  it("does not define scrollIntoView / scrollIntoViewIfNeeded where absent (E14)", () => {
    const { w } = makeWin("?pane=a/1/proposed", true);
    expect(w.Element.prototype.scrollIntoView).toBeUndefined();
    installPaneScrollGuard(w);
    expect(w.Element.prototype.scrollIntoView).toBeUndefined();
    expect((w.Element.prototype as { scrollIntoViewIfNeeded?: unknown }).scrollIntoViewIfNeeded).toBeUndefined();
  });

  it("scrollIntoView maps true/false/center/() inside the pane; host never scrolls (E15)", () => {
    const { w, host } = makeWin("?pane=a/1/proposed", true, (win) => {
      (win.Element.prototype as { scrollIntoView: unknown }).scrollIntoView = vi.fn();
    });
    w.scrollTo = vi.fn() as never;
    installPaneScrollGuard(w);
    const doc = w.document;
    doc.body.innerHTML = `<div id="list" style="overflow-y:auto"><div id="row">row</div></div>`;
    const list = doc.getElementById("list")!;
    const row = doc.getElementById("row")!;
    // 200 px list at y=100 (viewport 768); row 40 px high at content offset 600.
    let st = 0;
    Object.defineProperties(list, {
      scrollTop: { get: () => st, set: (v: number) => { st = v; }, configurable: true },
      scrollHeight: { value: 1000 }, clientHeight: { value: 200 }, scrollWidth: { value: 300 }, clientWidth: { value: 300 },
      clientTop: { value: 0 }, clientLeft: { value: 0 },
    });
    list.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 0, right: 300, height: 200, width: 300 }) as DOMRect;
    row.getBoundingClientRect = () => { const top = 100 + 600 - st; return { top, bottom: top + 40, left: 0, right: 300, height: 40, width: 300 } as DOMRect; };
    const at = (arg?: boolean | ScrollIntoViewOptions) => { st = 0; row.scrollIntoView(arg); return st; };
    expect(at(true)).toBe(600); // start
    expect(at(false)).toBe(440); // end: 640 - 200
    expect(at({ block: "center" })).toBe(520); // 620 - 100
    expect(at()).toBe(600); // default start
    expect(host.scrollTo).not.toHaveBeenCalled();
  });
});
