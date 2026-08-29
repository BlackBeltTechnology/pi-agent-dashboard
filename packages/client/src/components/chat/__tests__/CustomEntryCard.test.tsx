/**
 * CustomEntryCard — the bounded generic fallback renderer for non-flow-event
 * custom content (change: render-inline-reasoning-and-custom-entries, task 3.3).
 *
 * Contract (design D4):
 * - `customType` renders as a visible label.
 * - The body renders VISIBLE by default (the bug being fixed is invisibility).
 * - The body is PLAIN TEXT in a `<pre>` — markdown payloads must NOT be
 *   interpreted (untrusted extension input; no injection/spoofing surface).
 * - A long payload renders inside a bounded-height region (the card must never
 *   grow unbounded; the reducer truncates content at row creation).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CustomEntryCard } from "../CustomEntryCard.js";

afterEach(() => cleanup());

describe("CustomEntryCard", () => {
  it("renders the customType label and the visible body", () => {
    const { container } = render(
      <CustomEntryCard customType="my-ext:state" body={"branch: main"} timestamp={1756300000000} />,
    );
    expect(screen.getByText("my-ext:state")).toBeTruthy();
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toBe("branch: main");
  });

  it("renders markdown-looking payloads as PLAIN TEXT (no markdown interpretation)", () => {
    const { container } = render(
      <CustomEntryCard
        customType="x"
        body={"**bold** [link](https://e.com) <img src=x onerror=alert(1)>"}
        timestamp={1756300000000}
      />,
    );
    const pre = container.querySelector("pre")!;
    // Exact text preservation — no <strong>, no <a>, no <img> created.
    expect(pre.querySelector("strong")).toBeNull();
    expect(pre.querySelector("a")).toBeNull();
    expect(pre.querySelector("img")).toBeNull();
    expect(pre.textContent).toBe("**bold** [link](https://e.com) <img src=x onerror=alert(1)>");
  });

  it("bounds a long payload in a fixed-height scroll region", () => {
    const longBody = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join("\n");
    const { container } = render(
      <CustomEntryCard customType="x" body={longBody} timestamp={1756300000000} />,
    );
    const pre = container.querySelector("pre")!;
    // Bounded height + vertical scroll: the card region never grows unbounded.
    expect(pre.className).toMatch(/max-h-\[/);
    expect(pre.className).toContain("overflow-y-auto");
    // The (already-truncated) body is still fully present in the DOM.
    expect(pre.textContent).toContain("line-200");
  });

  it("shows the message time", () => {
    render(<CustomEntryCard customType="x" body="b" timestamp={1756300000000} />);
    // formatMessageTime output — just assert some time text node exists beyond
    // the label/body by checking the card's meta region is non-empty.
    const meta = screen.getByText("x").parentElement!;
    expect(meta.textContent!.length).toBeGreaterThan("x".length);
  });
});
