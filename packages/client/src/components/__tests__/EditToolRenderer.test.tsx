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
vi.mock("../RichDiff.js", () => ({
  RichDiff: (props: Record<string, unknown>) => (
    <div data-testid="rich-diff" data-file={String(props.filePath)} />
  ),
}));

// Mock @git-diff-view/react/styles (CSS import inside RichDiff).
vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));

// Mock ThemeProvider (consumed by RichDiff but not exercised here).
vi.mock("../ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EditToolRenderer } from "../tool-renderers/EditToolRenderer.js";
import type { ToolContext } from "../tool-renderers/types.js";

const ctx: ToolContext = { editors: [] };

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
    // homegrown DiffView renders .font-mono; should be absent on desktop
    expect(container.querySelectorAll("div.font-mono").length).toBe(0);
  });

  // 5.3: mobile + oldText/newText → homegrown DiffView, no <RichDiff>
  it("mobile: renders homegrown DiffView for oldText/newText args", () => {
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
    // homegrown DiffView uses div.font-mono
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

  // 5.5: mobile + edits[] length 3 → exactly 3 homegrown DiffViews
  it("mobile: renders exactly 3 homegrown DiffViews for edits[] of length 3", () => {
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
});
