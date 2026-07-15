/**
 * DiffPanel file-preview control in the split diff tab
 * (change: fix-session-diff-open-nongit-and-preview, Decision 3).
 *
 * The Diff / File toggle is a persistent, labeled control in the DiffPanel
 * header (which DiffViewer renders in the split tab). Default = Diff; clicking
 * File fetches `/api/session-file` and shows the whole file via
 * SyntaxHighlighter; clicking Diff returns to the diff.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@git-diff-view/react", () => ({
  DiffView: () => <div data-testid="diff-view" />,
  DiffModeEnum: { Split: "split", Unified: "unified" },
}));
vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));

// RichDiff renders the change-derived (Path A/C) diff; probe it so we can tell
// "diff view" apart from "file view".
vi.mock("../RichDiff.js", () => ({
  RichDiff: () => <div data-testid="rich-diff" />,
  getLang: () => "typescript",
}));

vi.mock("../ThemeProvider.js", async () => {
  const actual = await import("react");
  const ThemeContext = actual.createContext<{ resolved: "light" | "dark"; themeName: string } | null>(
    null,
  );
  return {
    ThemeProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: { resolved: "light" | "dark"; themeName: string };
    }) => actual.createElement(ThemeContext.Provider, { value }, children),
    useThemeContext: () => ({ resolved: "dark", themeName: "base" }),
  };
});

import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { DiffPanel } from "../DiffPanel.js";

const file: FileDiffEntry = {
  path: "src/a.ts",
  changes: [{ type: "write", timestamp: 0, content: "const a = 1;\n" }],
};

const GIT_DIFF = [
  "@@ -18,7 +18,7 @@ export function accumulate(canvas) {",
  " export function accumulate(canvas, delta) {",
  "   const next = { ...canvas };",
  "-  next.nodes = delta.nodes;",
  "-  next.dirty = true;",
  "+  next.nodes = mergeNodes(canvas.nodes, delta.nodes);",
  "+  next.dirty = delta.nodes.length > 0;",
  "   next.revision = canvas.revision + 1;",
  "-  return next;",
  "+  return freeze(next);",
  " }",
].join("\n");

const fileWithDiff: FileDiffEntry = {
  path: "src/acc.ts",
  changes: [{ type: "edit", timestamp: 0 }],
  additions: 3,
  deletions: 3,
  gitDiff: GIT_DIFF,
};

const render1 = (f: FileDiffEntry) =>
  render(<DiffPanel file={f} selection={{ filePath: f.path, changeIndex: null }} sessionId="s1" />);

describe("DiffPanel file preview", () => {
  it("toggles Diff → File (whole file) → Diff", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { content: "WHOLE FILE CONTENTS" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DiffPanel file={file} selection={{ filePath: "src/a.ts", changeIndex: null }} sessionId="s1" />);

    // Default = Diff.
    expect(screen.getByTestId("rich-diff")).toBeTruthy();

    // Click File → fetches /api/session-file and shows the whole file.
    fireEvent.click(screen.getByText("File"));
    await waitFor(() => expect(screen.getByTestId("syntax-highlighter")).toBeTruthy());
    expect(screen.getByText("WHOLE FILE CONTENTS")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain("/api/session-file");

    // Click Diff → back to the diff.
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByTestId("rich-diff")).toBeTruthy();
  });
});

describe("DiffPanel Preview mode (collapse-diff-file-tree)", () => {
  it("(E1) Preview shows changed regions, removed lines omitted, new-file order", () => {
    render1(fileWithDiff);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    const body = screen.getByTestId("preview-body");
    // Added line present; a removed line's text absent.
    expect(body.textContent).toContain("return freeze(next);");
    expect(body.textContent).not.toContain("next.nodes = delta.nodes;");
    expect(body.textContent).not.toContain("return next;");
    // New-file line numbers are contiguous 18..24 (removed lines don't advance).
    const nums = Array.from(body.querySelectorAll("[data-preview-line]")).map((e) =>
      e.getAttribute("data-preview-line"),
    );
    expect(nums).toEqual(["18", "19", "20", "21", "22", "23", "24"]);
  });

  it("(E2) Preview disabled without a parseable gitDiff", () => {
    // No gitDiff at all.
    const { unmount } = render1(file);
    expect((screen.getByTestId("preview-toggle") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    // Binary marker → zero hunks → still disabled.
    render1({ ...file, gitDiff: "Binary files a/x.png and b/x.png differ" });
    expect((screen.getByTestId("preview-toggle") as HTMLButtonElement).disabled).toBe(true);
  });

  it("(#4) exits Preview when refreshed data loses a parseable gitDiff", () => {
    const sel = { filePath: fileWithDiff.path, changeIndex: null };
    const { rerender } = render(<DiffPanel file={fileWithDiff} selection={sel} sessionId="s1" />);
    fireEvent.click(screen.getByTestId("preview-toggle"));
    expect(screen.getByTestId("preview-body")).toBeTruthy();
    // Same tab, refreshed data no longer supports Preview.
    rerender(<DiffPanel file={{ ...fileWithDiff, gitDiff: undefined }} selection={sel} sessionId="s1" />);
    expect(screen.queryByTestId("preview-body")).toBeNull();
    expect((screen.getByTestId("preview-toggle") as HTMLButtonElement).disabled).toBe(true);
  });

  it("(F5) Diff default; File + Preview coexist", () => {
    render1(fileWithDiff);
    // Default = Diff (git aggregate → DiffView).
    expect(screen.getByTestId("diff-view")).toBeTruthy();
    expect(screen.queryByTestId("preview-body")).toBeNull();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Preview")).toBeTruthy();
    expect((screen.getByTestId("preview-toggle") as HTMLButtonElement).disabled).toBe(false);
  });
});
