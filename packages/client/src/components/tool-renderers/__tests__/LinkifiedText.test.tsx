import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { LinkifiedText } from "../LinkifiedText.js";
import * as tokenizer from "../../../lib/linkify-tool-output.js";
import type { ToolContext } from "../types.js";

const ctx: ToolContext = { cwd: "/r" };

afterEach(() => vi.restoreAllMocks());

describe("LinkifiedText", () => {
  it("renders a mix of URL + file + plain text", () => {
    const text = "see https://example.com/x and src/foo.ts:42 ok";
    const { container } = render(<LinkifiedText text={text} context={ctx} />);
    const anchors = container.querySelectorAll("a");
    const buttons = container.querySelectorAll("button");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com/x");
    expect(buttons).toHaveLength(1);
    // Coverage: the rendered textContent equals the input verbatim, so
    // user-selecting and copying yields the original string (D8 spec).
    expect(container.textContent).toBe(text);
  });

  it("preserves text verbatim on prose with no links", () => {
    const text = "no links here, version 1.0.0, and/or skip";
    const { container } = render(<LinkifiedText text={text} context={ctx} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it("falls back to plain text if tokenizer throws (ErrorBoundary)", () => {
    vi.spyOn(tokenizer, "tokenize").mockImplementation(() => {
      throw new Error("boom");
    });
    // Suppress React's error log noise for this single render.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const text = "src/foo.ts:42 fallback path";
    const { container } = render(<LinkifiedText text={text} context={ctx} />);
    expect(container.textContent).toBe(text);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    errSpy.mockRestore();
  });

  it("renders nothing for empty text", () => {
    const { container } = render(<LinkifiedText text="" context={ctx} />);
    expect(container.textContent).toBe("");
  });
});
