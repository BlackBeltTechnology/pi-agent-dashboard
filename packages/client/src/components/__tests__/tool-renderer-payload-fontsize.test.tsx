/**
 * Spec: openspec/changes/unify-tool-renderer-code-font-size
 *
 * The code/diff payload region of Read / Write / Edit / Bash / Generic
 * renderers SHALL render at a single shared font-size of 12 px, applied via
 * the `.text-code` utility (or, where a third-party library forces it, an
 * inline `style.fontSize: "12px"` fallback on the wrapping element).
 *
 * Asserts the structural contract: the payload root carries either the
 * `text-code` className or an inline `12px` font-size. The 12 px value itself
 * is defined once in `packages/client/src/index.css` (`@utility text-code`).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

let mockIsMobile = false;
vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => mockIsMobile,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../diff/RichDiff.js", () => ({
  RichDiff: (props: Record<string, unknown>) => (
    <div data-testid="rich-diff" data-file={String(props.filePath)} />
  ),
}));

vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));

vi.mock("../settings/ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// SyntaxHighlighter passes customStyle through onto the wrapping <pre>/<div>.
// We rely on real react-syntax-highlighter for Read/Write to verify the
// `fontSize: "12px"` override actually lands on the rendered element.

import { ReadToolRenderer } from "../tool-renderers/ReadToolRenderer.js";
import { WriteToolRenderer } from "../tool-renderers/WriteToolRenderer.js";
import { EditToolRenderer } from "../tool-renderers/EditToolRenderer.js";
import { BashToolRenderer } from "../tool-renderers/BashToolRenderer.js";
import { GenericToolRenderer } from "../tool-renderers/GenericToolRenderer.js";
import type { ToolContext } from "../tool-renderers/types.js";

const ctx: ToolContext = {};

afterEach(() => cleanup());

/** Payload is "compliant" iff its className carries `text-code` OR its inline style.fontSize === "12px". */
function hasUnifiedFontSize(el: Element | null): boolean {
  if (!el) return false;
  const className = (el.getAttribute("class") ?? "").split(/\s+/);
  if (className.includes("text-code")) return true;
  const inline = (el as HTMLElement).style?.fontSize;
  return inline === "12px";
}

describe("tool renderer code/diff payload — unified 12 px", () => {
  it("ReadToolRenderer: SyntaxHighlighter wrapper carries fontSize: 12px", () => {
    const { container } = render(
      <ReadToolRenderer
        toolName="read"
        args={{ path: "foo.ts" }}
        status="complete"
        result="const x = 1;\n"
        context={ctx}
      />,
    );
    // SyntaxHighlighter applies customStyle inline on the outermost <pre>/<div>.
    const styledNode = container.querySelector('[style*="font-size: 12px"]');
    expect(styledNode).not.toBeNull();
  });

  it("WriteToolRenderer: SyntaxHighlighter wrapper carries fontSize: 12px", () => {
    const { container } = render(
      <WriteToolRenderer
        toolName="write"
        args={{ path: "foo.ts", content: "hello" }}
        status="complete"
        context={ctx}
      />,
    );
    const styledNode = container.querySelector('[style*="font-size: 12px"]');
    expect(styledNode).not.toBeNull();
  });

  it("EditToolRenderer desktop (RichDiff path): wrapper has text-code + inline fontSize fallback", () => {
    mockIsMobile = false;
    const { getByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "a", newText: "b" }}
        status="complete"
        context={ctx}
      />,
    );
    const wrapper = getByTestId("rich-diff").parentElement;
    expect(hasUnifiedFontSize(wrapper)).toBe(true);
  });

  it("EditToolRenderer mobile fallback (HomegrownDiff): root carries text-code", () => {
    mockIsMobile = true;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "a", newText: "b" }}
        status="complete"
        context={ctx}
      />,
    );
    const root = container.querySelector("div.font-mono");
    expect(root).not.toBeNull();
    expect(hasUnifiedFontSize(root)).toBe(true);
  });

  it("EditToolRenderer UnifiedDiffView (toolDetails.diff path): wrapper carries text-code", () => {
    mockIsMobile = false;
    const diff = "--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n";
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts" }}
        status="complete"
        toolDetails={{ diff }}
        context={ctx}
      />,
    );
    // UnifiedDiffView root is the div.font-mono inside the outer bg-[var(--bg-code)] wrapper.
    const wrapper = container.querySelector("div.bg-\\[var\\(--bg-code\\)\\]");
    expect(hasUnifiedFontSize(wrapper)).toBe(true);
  });

  it("BashToolRenderer: output <pre> carries text-code", () => {
    const { container } = render(
      <BashToolRenderer
        toolName="bash"
        args={{ command: "ls" }}
        status="complete"
        result="file1\nfile2\n"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(hasUnifiedFontSize(pre)).toBe(true);
  });

  it("GenericToolRenderer: args <pre> and result <pre> both carry text-code", () => {
    const { container } = render(
      <GenericToolRenderer
        toolName="custom"
        args={{ foo: "bar" }}
        status="complete"
        result="output text"
        context={ctx}
      />,
    );
    const pres = container.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    expect(hasUnifiedFontSize(pres[0])).toBe(true);
    expect(hasUnifiedFontSize(pres[1])).toBe(true);
  });
});
