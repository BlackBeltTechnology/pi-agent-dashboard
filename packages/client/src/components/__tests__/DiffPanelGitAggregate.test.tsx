/**
 * DiffPanel git-aggregate (Path B) + change-derived-fallback (Path C) guards.
 * See change: fix-empty-git-aggregate-diff-tab.
 *
 * Path B: the `diff:` tab (DiffViewer, changeIndex:null) renders a git-tracked
 * file via <DiffView data={{...hunks}}>. The hunks payload MUST keep the unified
 * -diff file header (`diff --git`/`+++`) or @git-diff-view reconstructs zero
 * lines from empty file content → an empty panel (the reported bug).
 *
 * Path C: a non-git file whose last change is a detected-on-disk-only
 * (`type:"tool"`) event → buildChangeDiffTexts returns null → empty panel. The
 * panel MUST fall back to the newest change carrying renderable texts.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock("react-syntax-highlighter", () => ({
  Prism: (props: Record<string, unknown>) => (
    <div data-testid="syntax-highlighter">{props.children as React.ReactNode}</div>
  ),
}));

// Capture the `data` prop @git-diff-view/react receives so we can assert the
// hunks payload shape without the real reconstruction.
const capturedDiffData: Array<{ hunks?: unknown }> = [];
vi.mock("@git-diff-view/react", () => ({
  DiffView: (props: { data?: { hunks?: unknown } }) => {
    capturedDiffData.push(props.data ?? {});
    return <div data-testid="diff-view" />;
  },
  DiffModeEnum: { Split: "split", Unified: "unified" },
}));
vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));

// RichDiff renders the change-derived (Path A/C) diff; probe newText.
vi.mock("../diff/RichDiff.js", () => ({
  RichDiff: (props: { newText?: string }) => (
    <div data-testid="rich-diff" data-newtext={props.newText ?? ""} />
  ),
  getLang: () => "typescript",
}));

vi.mock("../settings/ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
}));

import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { DiffPanel } from "../diff/DiffPanel.js";

const GIT_DIFF = [
  "diff --git a/src/acc.ts b/src/acc.ts",
  "index 1111111..2222222 100644",
  "--- a/src/acc.ts",
  "+++ b/src/acc.ts",
  "@@ -18,7 +18,7 @@ export function accumulate(canvas) {",
  " export function accumulate(canvas, delta) {",
  "   const next = { ...canvas };",
  "-  next.nodes = delta.nodes;",
  "+  next.nodes = mergeNodes(canvas.nodes, delta.nodes);",
  "   next.revision = canvas.revision + 1;",
  " }",
].join("\n");

const render1 = (f: FileDiffEntry) =>
  render(<DiffPanel file={f} selection={{ filePath: f.path, changeIndex: null }} sessionId="s1" />);

describe("DiffPanel Path B — header-preserving git-aggregate hunks", () => {
  it("passes <DiffView> a hunks payload that retains the diff --git/+++ header", () => {
    capturedDiffData.length = 0;
    const fileWithDiff: FileDiffEntry = {
      path: "src/acc.ts",
      changes: [{ type: "edit", timestamp: 0 }],
      additions: 1,
      deletions: 1,
      gitDiff: GIT_DIFF,
    };
    render1(fileWithDiff);
    expect(screen.getByTestId("diff-view")).toBeTruthy();
    // The last captured data payload is the git-aggregate one.
    const data = capturedDiffData.at(-1);
    expect(data).toBeTruthy();
    const hunks = data?.hunks as string[];
    expect(Array.isArray(hunks)).toBe(true);
    expect(hunks.length).toBeGreaterThan(0);
    const joined = hunks.join("\n");
    // The file header MUST survive — this is exactly what extractHunks stripped.
    expect(joined).toContain("diff --git a/src/acc.ts b/src/acc.ts");
    expect(joined).toContain("+++ b/src/acc.ts");
    expect(joined).toContain("@@ -18,7 +18,7 @@");
  });
});

describe("DiffPanel Path C — prefer a change with renderable texts", () => {
  it("renders the newest edit's diff when the last change is a detected-on-disk tool event", () => {
    const fileWithToolLast: FileDiffEntry = {
      path: "src/b.ts",
      changes: [
        { type: "edit", timestamp: 1, edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }] },
        { type: "tool", timestamp: 2 },
      ] as unknown as FileDiffEntry["changes"],
    } as unknown as FileDiffEntry;
    render1(fileWithToolLast);
    // The edit renders (not the empty "No diff data available" note).
    const rd = screen.getByTestId("rich-diff");
    expect(rd.getAttribute("data-newtext")).toBe("const a = 2;");
    expect(screen.queryByText("No diff data available")).toBeNull();
  });
});
