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

// Mock useMobile — we control it per test via the module-level variable below.
let mockIsMobile = false;
vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => mockIsMobile,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock RichDiff with a recognisable test id.
vi.mock("../diff/RichDiff.js", () => ({
  RichDiff: (props: Record<string, unknown>) => (
    <div data-testid="rich-diff" data-file={String(props.filePath)} />
  ),
}));

// Mock @git-diff-view/react/styles (CSS import inside RichDiff).
vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));

// Mock ThemeProvider (consumed by RichDiff but not exercised here).
vi.mock("../settings/ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EditToolRenderer } from "../tool-renderers/EditToolRenderer.js";
import type { ToolContext } from "../tool-renderers/types.js";

const ctx: ToolContext = {};

afterEach(() => cleanup());

describe("EditToolRenderer — viewport branching", () => {
  // 5.2: desktop + oldText/newText → <RichDiff>, no homegrown DiffView
  it("desktop: renders <RichDiff> for oldText/newText args", () => {
    mockIsMobile = false;
    const { getAllByTestId, container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "const a = 1;", newText: "const a = 2;" }}
        status="complete"
        context={ctx}
      />,
    );
    expect(getAllByTestId("rich-diff").length).toBe(1);
    // homegrown diff renders .font-mono; should be absent on desktop
    expect(container.querySelectorAll("div.font-mono").length).toBe(0);
  });

  // 5.3: mobile + oldText/newText → homegrown diff, no <RichDiff>
  it("mobile: renders homegrown diff for oldText/newText args", () => {
    mockIsMobile = true;
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "const a = 1;", newText: "const a = 2;" }}
        status="complete"
        context={ctx}
      />,
    );
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    // homegrown diff uses div.font-mono
    expect(container.querySelectorAll("div.font-mono").length).toBeGreaterThan(0);
  });

  // 5.4: desktop + edits[] length 3 → exactly 3 <RichDiff>
  it("desktop: renders exactly 3 <RichDiff> for edits[] of length 3", () => {
    mockIsMobile = false;
    const { getAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { oldText: "a1", newText: "b1" },
            { oldText: "a2", newText: "b2" },
            { oldText: "a3", newText: "b3" },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(getAllByTestId("rich-diff").length).toBe(3);
  });

  // 5.5: mobile + edits[] length 3 → exactly 3 homegrown diffs
  it("mobile: renders exactly 3 homegrown diffs for edits[] of length 3", () => {
    mockIsMobile = true;
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { oldText: "a1", newText: "b1" },
            { oldText: "a2", newText: "b2" },
            { oldText: "a3", newText: "b3" },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    expect(container.querySelectorAll("div.font-mono").length).toBe(3);
  });

  // 5.6: no oldText/newText, no edits[] → raw JSON <pre> regardless of viewport
  it("desktop: falls back to raw JSON <pre> with no diff data", () => {
    mockIsMobile = false;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts" }}
        status="complete"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"path"');
  });

  it("mobile: falls back to raw JSON <pre> with no diff data", () => {
    mockIsMobile = true;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts" }}
        status="complete"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"path"');
  });

  // --- NEW: toolDetails.diff tests ---

  it("desktop: renders toolDetails.diff as UnifiedDiffView when present", () => {
    mockIsMobile = false;
    const diff = "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n";
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "old", newText: "new" }}
        status="complete"
        context={ctx}
        toolDetails={{ diff }}
      />,
    );
    // diff should take priority over top-level oldText/newText
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    expect(container.querySelectorAll("div.font-mono").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("+new");
    expect(container.textContent).toContain("-old");
  });

  it("mobile: renders toolDetails.diff as UnifiedDiffView", () => {
    mockIsMobile = true;
    const diff = "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n";
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts" }}
        status="complete"
        context={ctx}
        toolDetails={{ diff }}
      />,
    );
    expect(container.querySelectorAll("div.font-mono").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("+new");
  });

  // --- NEW: hashline replace_text tests ---

  it("desktop: renders hashline replace_text edits as <RichDiff>", () => {
    mockIsMobile = false;
    const { getAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { op: "replace_text", oldText: "a", newText: "b" },
            { op: "replace_text", oldText: "c", newText: "d" },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(getAllByTestId("rich-diff").length).toBe(2);
  });

  it("mobile: renders hashline replace_text edits as homegrown diffs", () => {
    mockIsMobile = true;
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { op: "replace_text", oldText: "a", newText: "b" },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    expect(container.querySelectorAll("div.font-mono").length).toBeGreaterThan(0);
  });

  // --- NEW: hashline replace/append/prepend summary tests ---

  it("desktop: renders hashline replace/append/prepend as summaries", () => {
    mockIsMobile = false;
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { op: "replace", pos: "11#KT", lines: ["console.log('hello');"] },
            { op: "append", pos: "15#AB", lines: ["// new line"]
, },
            { op: "prepend", lines: ["// header"] },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    expect(container.textContent).toContain("Replace at 11#KT");
    expect(container.textContent).toContain("Insert after 15#AB");
    expect(container.textContent).toContain("Insert before BOF");
  });

  it("mobile: renders hashline replace/append/prepend as summaries", () => {
    mockIsMobile = true;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { op: "replace", pos: "11#KT", lines: ["x"] },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    expect(container.textContent).toContain("Replace at 11#KT");
  });

  // --- NEW: mixed valid/invalid edits ---

  it("filters out edits missing oldText/newText and renders only valid ones", () => {
    mockIsMobile = false;
    const { getAllByTestId, container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { oldText: "valid", newText: "edit" },
            { op: "replace", pos: "11#KT", lines: ["hashline"] },
            { oldText: undefined, newText: "missing" },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    // Should render only the 1 valid text diff (hashline ops are skipped when text edits exist)
    expect(getAllByTestId("rich-diff").length).toBe(1);
    // Should NOT show raw JSON fallback
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders hashline summaries when no text edits exist", () => {
    mockIsMobile = false;
    const { container, queryAllByTestId } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { op: "replace", pos: "11#KT", lines: ["x"] },
            { op: "append", pos: "15#AB", lines: ["y"] },
          ],
        }}
        status="complete"
        context={ctx}
      />,
    );
    // Should render hashline summaries, NOT fall back to JSON or RichDiff
    expect(queryAllByTestId("rich-diff").length).toBe(0);
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).toContain("Replace at 11#KT");
    expect(container.textContent).toContain("Insert after 15#AB");
  });

  // --- NEW: defensive validation ---

  it("falls back to JSON when oldText is present but newText is not", () => {
    mockIsMobile = false;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", oldText: "hello" }}
        status="complete"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"path"');
  });

  it("does not crash when edits array is malformed (undefined fields)", () => {
    mockIsMobile = false;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{
          path: "file.ts",
          edits: [
            { oldText: "a", newText: null },
            { oldText: null, newText: "b" },
            {},
          ] as unknown as Array<{ oldText: string; newText: string }>,
        }}
        status="complete"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"path"');
  });

  it("handles empty edits array", () => {
    mockIsMobile = false;
    const { container } = render(
      <EditToolRenderer
        toolName="edit"
        args={{ path: "file.ts", edits: [] }}
        status="complete"
        context={ctx}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"path"');
  });
});
