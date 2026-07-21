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

// The new type-based Preview mounts the shared CappedViewer; stub it so the test
// stays off Monaco / the real registry and can assert which viewer + file it got.
vi.mock("../editor-pane/CappedViewer.js", () => ({
  CappedViewer: (p: { viewer: string; path: string }) => (
    <div data-testid="capped-viewer" data-viewer={p.viewer} data-path={p.path} />
  ),
}));

// RichDiff renders the change-derived (Path A/C) diff; probe it so we can tell
// "diff view" apart from "file view".
vi.mock("../diff/RichDiff.js", () => ({
  // Expose newText so tests can prove which content the diff rendered.
  RichDiff: (props: { newText?: string }) => (
    <div data-testid="rich-diff" data-newtext={props.newText ?? ""} />
  ),
  getLang: () => "typescript",
}));

vi.mock("../settings/ThemeProvider.js", async () => {
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
import { DiffPanel } from "../diff/DiffPanel.js";

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

// Regions = the OLD Preview, renamed (D11). Function unchanged: changed regions
// from gitDiff, disabled without a parseable gitDiff, auto-fallback to Diff.
describe("DiffPanel Regions mode (F12 — renamed old Preview)", () => {
  it("(E1/F12) Regions shows changed regions, removed lines omitted, new-file order", () => {
    render1(fileWithDiff);
    fireEvent.click(screen.getByTestId("regions-toggle"));
    const body = screen.getByTestId("regions-body");
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

  it("(E2/F12) Regions disabled without a parseable gitDiff", () => {
    // No gitDiff at all.
    const { unmount } = render1(file);
    expect((screen.getByTestId("regions-toggle") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    // Binary marker → zero hunks → still disabled.
    render1({ ...file, gitDiff: "Binary files a/x.png and b/x.png differ" });
    expect((screen.getByTestId("regions-toggle") as HTMLButtonElement).disabled).toBe(true);
  });

  it("(#4) exits Regions when refreshed data loses a parseable gitDiff", () => {
    const sel = { filePath: fileWithDiff.path, changeIndex: null };
    const { rerender } = render(<DiffPanel file={fileWithDiff} selection={sel} sessionId="s1" />);
    fireEvent.click(screen.getByTestId("regions-toggle"));
    expect(screen.getByTestId("regions-body")).toBeTruthy();
    // Same tab, refreshed data no longer supports Regions.
    rerender(<DiffPanel file={{ ...fileWithDiff, gitDiff: undefined }} selection={sel} sessionId="s1" />);
    expect(screen.queryByTestId("regions-body")).toBeNull();
    expect((screen.getByTestId("regions-toggle") as HTMLButtonElement).disabled).toBe(true);
  });

  it("(F5) Diff default; File + Regions coexist", () => {
    render1(fileWithDiff);
    // Default = Diff (git aggregate → DiffView).
    expect(screen.getByTestId("diff-view")).toBeTruthy();
    expect(screen.queryByTestId("regions-body")).toBeNull();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Regions")).toBeTruthy();
    expect((screen.getByTestId("regions-toggle") as HTMLButtonElement).disabled).toBe(false);
  });
});

// New type-based Preview of the CURRENT on-disk file (D11). Threaded `cwd`
// enables it; independent of gitDiff; 404 metadata → not-found (no crash).
describe("DiffPanel new Preview mode (D11 — F13/F14/F15/F16)", () => {
  const renderWithCwd = (f: FileDiffEntry) =>
    render(
      <DiffPanel file={f} selection={{ filePath: f.path, changeIndex: null }} sessionId="s1" cwd="/proj" />,
    );

  it("(F15) toolbar lists Diff·File·Regions·Preview, active Diff by default", () => {
    renderWithCwd(fileWithDiff);
    expect(screen.getByText("Diff")).toBeTruthy();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Regions")).toBeTruthy();
    expect(screen.getByTestId("file-preview-toggle")).toBeTruthy();
    // Default = Diff.
    expect(screen.getByTestId("diff-view")).toBeTruthy();
    expect(screen.queryByTestId("diff-preview-body")).toBeNull();
  });

  it("(F13) selecting Preview mounts the type-based viewer for the CURRENT file", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { type: "file", kind: "markdown", mimeType: "text/markdown", size: 12 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    // Markdown file → viewer "markdown", regardless of gitDiff.
    const md: FileDiffEntry = { path: "README.md", changes: [{ type: "write", timestamp: 0, content: "# hi\n" }] };
    renderWithCwd(md);
    fireEvent.click(screen.getByTestId("file-preview-toggle"));
    const viewer = await screen.findByTestId("capped-viewer");
    expect(viewer.getAttribute("data-viewer")).toBe("markdown");
    expect(viewer.getAttribute("data-path")).toBe("README.md");
    // The metadata came from /api/file (not /api/session-file).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/file?"))).toBe(true);
  });

  it("(F14) new Preview omitted for an out-of-cwd entry (previewable:false)", () => {
    renderWithCwd({ ...fileWithDiff, previewable: false });
    expect(screen.queryByTestId("file-preview-toggle")).toBeNull();
  });

  it("(F16) a deleted file (404 metadata) → not-found state, panel does not crash", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: false, error: "not found" }) });
    vi.stubGlobal("fetch", fetchMock);
    const tool: FileDiffEntry = { path: "gone.md", changes: [{ type: "write", timestamp: 0, content: "x" }] };
    renderWithCwd(tool);
    fireEvent.click(screen.getByTestId("file-preview-toggle"));
    expect(await screen.findByTestId("diff-preview-not-found")).toBeTruthy();
    expect(screen.queryByTestId("capped-viewer")).toBeNull();
  });
});

// opt-in-out-of-cwd-session-diffs: out-of-cwd entries render payload-only,
// hide the File toggle (previewable:false), and lazy-upgrade truncated payloads.
describe("DiffPanel out-of-cwd payload render", () => {
  const outOfCwd: FileDiffEntry = {
    path: "/tmp/mockup/index.html",
    previewable: false,
    changes: [{ type: "write", timestamp: 0, content: "<h1>hi</h1>\n" }],
  };

  it("(F5) hides the File content-view toggle when previewable is false", () => {
    render1(outOfCwd);
    expect(screen.queryByTestId("file-view-toggle")).toBeNull();
    expect(screen.queryByText("File")).toBeNull();
    // The Diff payload still renders (Path C).
    expect(screen.getByTestId("rich-diff")).toBeTruthy();
  });

  it("(F3) lazy-fetches the full payload for a truncated Write and renders it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { content: "FULL 1MB CONTENT" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const truncated: FileDiffEntry = {
      path: "/tmp/mockup/big.html",
      previewable: false,
      changes: [
        { type: "write", timestamp: 0, content: "partial\n…[truncated]", truncated: true, toolCallId: "tc-1" },
      ],
    };
    render1(truncated);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/session-change/s1/tc-1"))).toBe(true),
    );
    // The fetched full content REPLACES the truncated text in the render.
    await waitFor(() =>
      expect(screen.getByTestId("rich-diff").getAttribute("data-newtext")).toBe("FULL 1MB CONTENT"),
    );
    // No persistent truncation banner once the full payload arrives.
    expect(screen.queryByTestId("diff-truncation-banner")).toBeNull();
  });

  it("(#4) falls back to Diff when a refresh flips the entry to out-of-cwd in File mode", () => {
    const inCwd: FileDiffEntry = {
      path: "src/a.ts",
      previewable: true,
      changes: [{ type: "write", timestamp: 0, content: "const a = 1;\n" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, data: { content: "WHOLE FILE" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const sel = { filePath: inCwd.path, changeIndex: null };
    const { rerender } = render(<DiffPanel file={inCwd} selection={sel} sessionId="s1" />);
    // Enter File mode (in-cwd → toggle present).
    fireEvent.click(screen.getByTestId("file-view-toggle"));
    const before = fetchMock.mock.calls.length;
    // Refresh flips the SAME tab to out-of-cwd (previewable:false).
    rerender(
      <DiffPanel file={{ ...inCwd, previewable: false }} selection={sel} sessionId="s1" />,
    );
    // The File toggle is gone and no further /api/session-file fetch fires.
    expect(screen.queryByTestId("file-view-toggle")).toBeNull();
    const sessionFileCalls = fetchMock.mock.calls
      .slice(before)
      .filter((c) => String(c[0]).includes("/api/session-file"));
    expect(sessionFileCalls).toHaveLength(0);
  });

  it("(X2) shows a truncation banner when the lazy fetch fails (never blank)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const truncated: FileDiffEntry = {
      path: "/tmp/mockup/big.html",
      previewable: false,
      changes: [
        { type: "write", timestamp: 0, content: "partial\n…[truncated]", truncated: true, toolCallId: "tc-1" },
      ],
    };
    render1(truncated);
    await waitFor(() => expect(screen.getByTestId("diff-truncation-banner")).toBeTruthy());
    // The partial diff still renders (never blank).
    expect(screen.getByTestId("rich-diff")).toBeTruthy();
  });
});
