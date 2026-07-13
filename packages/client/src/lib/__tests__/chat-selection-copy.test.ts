import { describe, expect, it } from "vitest";
import { buildSelectionClipboardText, COPY_TEXT_ATTR } from "../chat-selection-copy.js";

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
