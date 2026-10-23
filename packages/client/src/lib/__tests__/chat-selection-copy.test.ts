import { describe, expect, it } from "vitest";
import {
  assembleClipboardParts,
  buildOutsideClipboardText,
  buildSelectionClipboardText,
  COPY_TEXT_ATTR,
  splitRangeAroundContainer,
} from "../chat/chat-selection-copy.js";

/** Mount HTML into a detached container and return it. */
function mount(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("buildSelectionClipboardText", () => {
  it("2.1 partial-node selection copies exactly the selected characters", () => {
    const container = mount(`<div data-index="0"><p>the quick brown fox</p></div>`);
    const textNode = container.querySelector("p")!.firstChild!;
    const range = document.createRange();
    // Select "quick brown" — mid-node on both ends.
    range.setStart(textNode, 4);
    range.setEnd(textNode, 15);

    expect(buildSelectionClipboardText(range, container)).toBe("quick brown");
    container.remove();
  });

  it("2.2 selection over a DOM-capped renderer copies the full text", () => {
    const full = "X".repeat(2500);
    const clipped = full.slice(0, 1000);
    const container = mount(
      `<div data-index="0"><span>before </span><pre ${COPY_TEXT_ATTR}="">${clipped}</pre><span> after</span></div>`,
    );
    // The DOM only holds the 1000-char prefix; the full text is on the attr.
    container.querySelector("pre")!.setAttribute(COPY_TEXT_ATTR, full);

    // Drag across the whole card so the capped <pre> is fully contained.
    const range = document.createRange();
    range.selectNodeContents(container.querySelector("div")!);

    const out = buildSelectionClipboardText(range, container);
    expect(out).toContain(full); // full 2500 chars, not the 1000-char prefix
    expect(out).toContain("before");
    expect(out).toContain("after");
    container.remove();
  });

  it("does not substitute full text for a partially-selected capped element", () => {
    const full = "Y".repeat(2500);
    const container = mount(`<div data-index="0"><pre ${COPY_TEXT_ATTR}="">${full.slice(0, 1000)}</pre></div>`);
    const pre = container.querySelector("pre")!;
    pre.setAttribute(COPY_TEXT_ATTR, full);

    // Select only the first 10 rendered chars inside the pre — partial.
    const range = document.createRange();
    range.setStart(pre.firstChild!, 0);
    range.setEnd(pre.firstChild!, 10);

    const out = buildSelectionClipboardText(range, container);
    expect(out).toBe("Y".repeat(10));
    container.remove();
  });

  it("returns empty string for a collapsed selection", () => {
    const container = mount(`<div data-index="0"><p>hello</p></div>`);
    const range = document.createRange();
    range.setStart(container.querySelector("p")!.firstChild!, 2);
    range.collapse(true);
    expect(buildSelectionClipboardText(range, container)).toBe("");
    container.remove();
  });
});

// --- keep-oversized-chat-selection D7: three-part serialization ---

describe("splitRangeAroundContainer + assembleClipboardParts (E9)", () => {
  function page() {
    document.body.innerHTML = `<p id="a">alpha</p><div id="c"><p id="m1">mid one</p><p id="m2">mid two</p></div><p id="z">omega</p>`;
    const t = (id: string) => document.getElementById(id)!.firstChild!;
    return { c: document.getElementById("c")!, t };
  }
  const shape = (parts: ReturnType<typeof splitRangeAroundContainer>) =>
    parts && Object.entries(parts).filter(([, v]) => v).map(([k]) => k);
  function rangeFrom(a: Node, ao: number, b: Node, bo: number): Range {
    const r = document.createRange();
    r.setStart(a, ao);
    r.setEnd(b, bo);
    return r;
  }

  it("classifies every range position", () => {
    const { c, t } = page();
    expect(shape(splitRangeAroundContainer(rangeFrom(t("a"), 0, t("a"), 3), c))).toEqual(["pre"]);
    expect(shape(splitRangeAroundContainer(rangeFrom(t("a"), 1, t("m1"), 3), c))).toEqual(["pre", "mid"]);
    expect(shape(splitRangeAroundContainer(rangeFrom(t("m1"), 1, t("m2"), 3), c))).toEqual(["mid"]);
    expect(shape(splitRangeAroundContainer(rangeFrom(t("m1"), 1, t("z"), 3), c))).toEqual(["mid", "post"]);
    expect(shape(splitRangeAroundContainer(rangeFrom(t("a"), 1, t("z"), 3), c))).toEqual(["pre", "mid", "post"]);
    expect(shape(splitRangeAroundContainer(rangeFrom(t("z"), 0, t("z"), 3), c))).toEqual(["post"]);
  });

  it("returns null for a collapsed range", () => {
    const { c, t } = page();
    expect(splitRangeAroundContainer(rangeFrom(t("a"), 2, t("a"), 2), c)).toBeNull();
  });

  it("the three parts serialize to exactly the selected text, container as a block boundary", () => {
    const { c, t } = page();
    const parts = splitRangeAroundContainer(rangeFrom(t("a"), 2, t("z"), 2), c)!;
    const text = assembleClipboardParts([
      parts.pre && buildOutsideClipboardText(parts.pre, document.body),
      parts.mid && buildSelectionClipboardText(parts.mid, c),
      parts.post && buildOutsideClipboardText(parts.post, document.body),
    ]);
    expect(text).toBe("pha\nmid one\nmid two\nom");
  });

  it("assembly drops empty parts and joins the rest with one newline", () => {
    expect(assembleClipboardParts(["a", "", "c"])).toBe("a\nc");
    expect(assembleClipboardParts([null, "mid", undefined])).toBe("mid");
    expect(assembleClipboardParts([null, "", null])).toBe("");
  });
});

describe("buildOutsideClipboardText (E10)", () => {
  it("skips non-rendered content, keeps visible text and full data-copy-text", () => {
    const full = "F".repeat(1500);
    document.body.innerHTML = `<div id="pre">
      <script>SCRIPT-MARK()</script><style>.x{color:red} STYLE-MARK</style>
      <template><i>TEMPLATE-MARK</i></template><noscript>NOSCRIPT-MARK</noscript>
      <p hidden>HIDDEN-MARK</p><p aria-hidden="true">ARIA-MARK</p>
      <p>SIDEBAR-MARK</p><pre ${COPY_TEXT_ATTR}="">${"F".repeat(1000)}</pre></div>`;
    const el = document.getElementById("pre")!;
    el.querySelector("pre")!.setAttribute(COPY_TEXT_ATTR, full);
    const r = document.createRange();
    r.selectNodeContents(el);
    const out = buildOutsideClipboardText(r, document.body);
    expect(out).toContain("SIDEBAR-MARK");
    expect(out).toContain(full);
    for (const bad of ["SCRIPT-MARK", "STYLE-MARK", "TEMPLATE-MARK", "NOSCRIPT-MARK", "HIDDEN-MARK", "ARIA-MARK"]) {
      expect(out).not.toContain(bad);
    }
    document.body.innerHTML = "";
  });
});
