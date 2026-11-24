/**
 * EditorFileTree consumes the single `/api/file/tree` endpoint (#1).
 *
 * Regression: hidden directories (`.git`) MUST render as expandable folders,
 * not files. The old `/api/file`+`/api/browse` merge stripped hidden dirs from
 * the dirs-only source and labelled them files.
 *
 * See change: improve-content-editor (tasks §2.2).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// Download delivery is covered in preview/__tests__/download.test.ts.
vi.mock("../../preview/download.js", () => ({ startDownload: vi.fn(() => Promise.resolve()) }));

// Controllable shared-diff data for the changed-file-marker tests. Inert for
// the pre-existing tests (they render EditorFileTree without a provider, so
// useOptionalSessionDiff() returns null regardless of this mock).
const diffHolder = vi.hoisted(() => ({
  diff: null as import("@blackbelt-technology/pi-dashboard-shared/diff-types.js").SessionDiffResponse | null,
}));
vi.mock("../../../hooks/useSessionDiff.js", () => ({
  useSessionDiff: () => ({ data: diffHolder.diff, isLoading: false, error: null, refresh: () => {} }),
}));

import type {
  FileDiffEntry,
  SessionDiffResponse,
} from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { SessionDiffProvider } from "../../diff/SessionDiffContext.js";
import { startDownload } from "../../preview/download.js";
import { EditorFileTree } from "../EditorFileTree.js";

type Entry = { name: string; isDir: boolean };
const dirs: Record<string, Entry[]> = {};

// Canonical tree, re-applied before EVERY test so no test's in-place mutation
// of the shared `dirs` map leaks into the next. Previously a test restored
// `dirs` at its OWN end, which was skipped whenever that test threw first —
// cascading a single race failure into an unrelated ".git" test.
// See change: fix-flaky-full-suite-tests.
function resetDirs() {
  for (const k of Object.keys(dirs)) delete dirs[k];
  dirs["."] = [
    { name: ".git", isDir: true },
    { name: "README.md", isDir: false },
  ];
  dirs[".git"] = [{ name: "HEAD", isDir: false }];
}

function mockTreeFetch() {
  globalThis.fetch = vi.fn((url: string) => {
    const u = new URL(url, "http://localhost");
    const p = u.searchParams.get("path") ?? ".";
    const entries = dirs[p === "." ? "." : p] ?? [];
    return Promise.resolve({
      json: () => Promise.resolve({ success: true, data: { entries } }),
    });
  }) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  resetDirs();
  mockTreeFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("EditorFileTree — active row reveal (#5)", () => {
  it("scrolls a deep active row into view once expanded", async () => {
    // jsdom does not implement scrollIntoView — define it, then spy.
    HTMLElement.prototype.scrollIntoView = () => {};
    const scrollSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    // Deep chain: ./src → src/README.md (active), ancestors pre-expanded.
    dirs["src"] = [{ name: "README.md", isDir: false }];
    dirs["."] = [{ name: "src", isDir: true }];
    render(
      <EditorFileTree
        cwd="/proj"
        treeOpenRoots={["src"]}
        onToggleRoot={vi.fn()}
        onOpenFile={vi.fn()}
        activePath="src/README.md"
      />,
    );
    await screen.findByText("README.md");
    // scrollIntoView fires in a post-mount effect that can lag behind the row
    // appearing under CPU contention — poll instead of a bare one-shot assert.
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });
});

describe("EditorFileTree — row actions menu (copy-file-path, add-file-download)", () => {
  const CWD = "/Users/u/proj";
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(startDownload).mockClear();
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    // A nested file so relative path (`src/foo.ts`) differs from basename (`foo.ts`).
    dirs["."] = [
      { name: ".git", isDir: true },
      { name: "src", isDir: true },
    ];
    dirs["src"] = [{ name: "foo.ts", isDir: false }];
  });
  afterEach(() => {
    delete dirs["src"];
    dirs["."] = [
      { name: ".git", isDir: true },
      { name: "README.md", isDir: false },
    ];
  });

  const renderTree = (overrides: Partial<React.ComponentProps<typeof EditorFileTree>> = {}) =>
    render(
      <EditorFileTree
        cwd={CWD}
        treeOpenRoots={["src"]}
        onToggleRoot={vi.fn()}
        onOpenFile={vi.fn()}
        activePath={null}
        {...overrides}
      />,
    );

  const glyphOf = async (name: string) => {
    const label = await screen.findByText(name);
    const row = label.closest("[data-row]") as HTMLElement;
    expect(row).toBeTruthy();
    return { row, glyph: within(row).getByLabelText("Row actions") };
  };

  it("(a) reveals a copy glyph on each file/directory row", async () => {
    renderTree();
    expect((await glyphOf("foo.ts")).glyph).toBeTruthy();
    expect((await glyphOf(".git")).glyph).toBeTruthy();
  });

  it("(b) activating the glyph opens the popup and does NOT open the file", async () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(screen.getByRole("menuitem", { name: /Copy full path/ })).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("(c) Copy full path writes cwd + '/' + rel", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy full path/ }));
    expect(writeText).toHaveBeenCalledWith(`${CWD}/src/foo.ts`);
  });

  it("(d) Copy relative path writes rel", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy relative path/ }));
    expect(writeText).toHaveBeenCalledWith("src/foo.ts");
  });

  it("(e) Copy file name writes the basename", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy file name/ }));
    expect(writeText).toHaveBeenCalledWith("foo.ts");
  });

  it("(f) a directory row's glyph copies without toggling onToggleRoot", async () => {
    const onToggleRoot = vi.fn();
    renderTree({ onToggleRoot });
    const { glyph } = await glyphOf(".git");
    fireEvent.click(glyph);
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy full path/ }));
    expect(writeText).toHaveBeenCalledWith(`${CWD}/.git`);
    expect(onToggleRoot).not.toHaveBeenCalled();
  });

  it("(g1) outside-click dismisses the popup with no copy", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(screen.queryByRole("menuitem", { name: /Copy full path/ })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(g2) Escape dismisses the popup with no copy", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(g3) rail scroll dismisses the popup with no copy", async () => {
    const { container } = renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.scroll(container.querySelector("[data-file-rail]") as HTMLElement);
    expect(screen.queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(h) does not throw when navigator.clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(() =>
      fireEvent.click(screen.getByRole("menuitem", { name: /Copy full path/ })),
    ).not.toThrow();
  });

  // #728: the rail (`overflow-auto`) + EditorPane (`overflow-hidden`) clipped an
  // inline `absolute` popup. It must portal out of the rail, `fixed`-positioned.
  it("(i) menu is portaled outside [data-file-rail] with clickable items", async () => {
    const { container } = renderTree();
    const { glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    const menu = screen.getByRole("menu");
    expect(container.querySelector("[data-file-rail]")?.contains(menu)).toBe(false);
    expect((menu.closest("[data-testid='ui-popover']") as HTMLElement).style.position).toBe("fixed");
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy relative path/ }));
    expect(writeText).toHaveBeenCalledWith("src/foo.ts");
  });

  it("(F5) file row: three copy items then Download; directory row: copy only", async () => {
    renderTree();
    fireEvent.click((await glyphOf("foo.ts")).glyph);
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual([
      "Copy full path",
      "Copy relative path",
      "Copy file name",
      "Download",
    ]);
    expect(screen.getByTestId("tree-row-download")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    fireEvent.click((await glyphOf(".git")).glyph);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.queryByTestId("tree-row-download")).toBeNull();
  });

  it("(F6) right-click opens the menu without opening the file / toggling the directory", async () => {
    const onOpenFile = vi.fn();
    const onToggleRoot = vi.fn();
    renderTree({ onOpenFile, onToggleRoot });
    for (const name of ["foo.ts", "src"]) {
      const { row } = await glyphOf(name);
      const notPrevented = fireEvent.contextMenu(row);
      expect(notPrevented).toBe(false); // preventDefault was called
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.mouseDown(document.body);
    }
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onToggleRoot).not.toHaveBeenCalled();
  });

  it("(F7) Shift+F10 and the ContextMenu key open the menu; focus starts on Copy full path", async () => {
    renderTree();
    const { row } = await glyphOf("foo.ts");
    const rowButton = within(row).getByText("foo.ts").closest("button") as HTMLElement;
    rowButton.focus();
    fireEvent.keyDown(rowButton, { key: "F10", shiftKey: true });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Copy full path/ })),
    );
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /Copy relative path/ }));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(writeText).toHaveBeenCalledWith("src/foo.ts");
    fireEvent.mouseDown(document.body);

    fireEvent.keyDown(rowButton, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("(F8) Escape returns focus to the glyph (glyph-opened) or the row button (keyboard-opened)", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(glyph);

    const rowButton = within(row).getByText("foo.ts").closest("button") as HTMLElement;
    rowButton.focus();
    fireEvent.keyDown(rowButton, { key: "F10", shiftKey: true });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(rowButton);
  });

  it("(F9) Download starts the download, closes the menu and does not open the file", async () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });
    fireEvent.click((await glyphOf("foo.ts")).glyph);
    fireEvent.click(screen.getByTestId("tree-row-download"));
    expect(startDownload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startDownload).mock.calls[0]?.[0]).toEqual({ cwd: CWD, path: "src/foo.ts" });
    expect(vi.mocked(startDownload).mock.calls[0]?.[1]).toMatchObject({ outsideCwd: false });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("(F10) glyph a11y attributes and the touch-visibility class", async () => {
    renderTree();
    const { glyph } = await glyphOf("foo.ts");
    expect(glyph.getAttribute("aria-label")).toBe("Row actions");
    expect(glyph.getAttribute("aria-haspopup")).toBe("menu");
    expect(glyph.getAttribute("aria-expanded")).toBe("false");
    expect(glyph.className).toContain("[@media(hover:none)]:opacity-100");
    fireEvent.click(glyph);
    expect(glyph.getAttribute("aria-expanded")).toBe("true");
  });

  it("(F11) dismissal (outside click / rail scroll / Escape) copies and downloads nothing", async () => {
    const { container } = renderTree();
    const { glyph } = await glyphOf("foo.ts");
    for (const dismiss of [
      () => fireEvent.mouseDown(document.body),
      () => fireEvent.scroll(container.querySelector("[data-file-rail]") as HTMLElement),
      () => fireEvent.keyDown(document, { key: "Escape" }),
    ]) {
      fireEvent.click(glyph);
      expect(screen.getByRole("menu")).toBeTruthy();
      dismiss();
      expect(screen.queryByRole("menu")).toBeNull();
    }
    expect(writeText).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
  });
});

describe("EditorFileTree — changed-file markers (collapse-diff-file-tree)", () => {
  const base = {
    isGitRepo: true,
    files: [] as FileDiffEntry[],
  };
  function renderWithDiff(
    diff: SessionDiffResponse,
    props: Partial<React.ComponentProps<typeof EditorFileTree>> = {},
  ) {
    diffHolder.diff = diff;
    return render(
      <SessionDiffProvider sessionId="s1">
        <EditorFileTree
          cwd="/proj"
          treeOpenRoots={props.treeOpenRoots ?? []}
          onToggleRoot={props.onToggleRoot ?? vi.fn()}
          onOpenFile={props.onOpenFile ?? vi.fn()}
          onOpenDiff={props.onOpenDiff}
          activePath={null}
          sessionOnly={props.sessionOnly}
        />
      </SessionDiffProvider>,
    );
  }

  it("(E3) status indicator: write→+, edit→●, tool→●", async () => {
    dirs["."] = [
      { name: "w.ts", isDir: false },
      { name: "e.ts", isDir: false },
      { name: "t.ts", isDir: false },
    ];
    renderWithDiff({
      ...base,
      files: [
        { path: "w.ts", origin: "write", changes: [{ type: "write", timestamp: 1 }], additions: 3, deletions: 0 },
        { path: "e.ts", origin: "edit", changes: [{ type: "edit", timestamp: 1 }], additions: 2, deletions: 1 },
        { path: "t.ts", origin: "tool", changes: [{ type: "tool", timestamp: 1 }], additions: 4, deletions: 0 },
      ],
    });
    const rowOf = async (name: string) =>
      (await screen.findByText(name)).closest("[data-row]") as HTMLElement;
    expect(within(await rowOf("w.ts")).getByTestId("status-added")).toBeTruthy();
    expect(within(await rowOf("e.ts")).getByTestId("status-modified")).toBeTruthy();
    expect(within(await rowOf("t.ts")).getByTestId("status-modified")).toBeTruthy();
  });

  it("(E4) folder dot marks an ancestor of a changed file, not an unrelated dir", async () => {
    dirs["."] = [
      { name: "packages", isDir: true },
      { name: "qa", isDir: true },
    ];
    renderWithDiff({
      ...base,
      files: [{ path: "packages/server/src/a.ts", changes: [{ type: "edit", timestamp: 1 }] }],
    });
    const pkg = (await screen.findByText("packages")).closest("[data-row]") as HTMLElement;
    const qa = (await screen.findByText("qa")).closest("[data-row]") as HTMLElement;
    expect(within(pkg).getByTestId("folder-dot")).toBeTruthy();
    expect(within(qa).queryByTestId("folder-dot")).toBeNull();
  });

  it("(F2) row name → onOpenFile, diff chip → onOpenDiff", async () => {
    dirs["."] = [{ name: "a.ts", isDir: false }];
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();
    renderWithDiff(
      { ...base, files: [{ path: "a.ts", changes: [{ type: "edit", timestamp: 1 }], additions: 1, deletions: 0 }] },
      { onOpenFile, onOpenDiff },
    );
    const row = (await screen.findByText("a.ts")).closest("[data-row]") as HTMLElement;
    fireEvent.click(screen.getByText("a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("a.ts", expect.anything());
    fireEvent.click(within(row).getByTestId("open-diff-chip"));
    expect(onOpenDiff).toHaveBeenCalledWith("a.ts");
  });

  it("(F3) multi-event file expands to its change history", async () => {
    dirs["."] = [{ name: "a.ts", isDir: false }];
    renderWithDiff({
      ...base,
      files: [
        {
          path: "a.ts",
          changes: [
            { type: "edit", timestamp: 1, message: "first" },
            { type: "write", timestamp: 2, message: "second" },
          ],
        },
      ],
    });
    const row = (await screen.findByText("a.ts")).closest("[data-row]") as HTMLElement;
    expect(screen.queryAllByTestId("change-event-row")).toHaveLength(0);
    fireEvent.click(within(row).getByTestId("event-expander"));
    expect(screen.queryAllByTestId("change-event-row")).toHaveLength(2);
    fireEvent.click(within(row).getByTestId("event-expander"));
    expect(screen.queryAllByTestId("change-event-row")).toHaveLength(0);
  });

  it("(F4) other-changes group renders and hides under this-session-only", async () => {
    dirs["."] = [{ name: "README.md", isDir: false }];
    const diff: SessionDiffResponse = {
      ...base,
      files: [],
      otherChanges: [{ path: "vendor/x.ts", changes: [{ type: "tool", timestamp: 1 }] }],
    };
    const { rerender } = renderWithDiff(diff, { sessionOnly: false });
    const group = await screen.findByTestId("other-changes-group");
    expect(within(group).getByText(/other working-tree changes/i)).toBeTruthy();
    rerender(
      <SessionDiffProvider sessionId="s1">
        <EditorFileTree
          cwd="/proj"
          treeOpenRoots={[]}
          onToggleRoot={vi.fn()}
          onOpenFile={vi.fn()}
          activePath={null}
          sessionOnly={true}
        />
      </SessionDiffProvider>,
    );
    expect(screen.queryByTestId("other-changes-group")).toBeNull();
  });

  it("(F7) no auto-expand: a changed file in a collapsed dir shows no row, only a folder dot", async () => {
    dirs["."] = [{ name: "src", isDir: true }];
    dirs["src"] = [{ name: "a.ts", isDir: false }];
    renderWithDiff({
      ...base,
      files: [{ path: "src/a.ts", changes: [{ type: "edit", timestamp: 1 }] }],
    });
    const src = (await screen.findByText("src")).closest("[data-row]") as HTMLElement;
    expect(within(src).getByTestId("folder-dot")).toBeTruthy();
    expect(screen.queryByText("a.ts")).toBeNull();
  });

  it("(X1) no diff provider → tree renders with zero markers, no throw", async () => {
    dirs["."] = [{ name: "a.ts", isDir: false }];
    render(
      <EditorFileTree
        cwd="/proj"
        treeOpenRoots={[]}
        onToggleRoot={vi.fn()}
        onOpenFile={vi.fn()}
        activePath={null}
      />,
    );
    await screen.findByText("a.ts");
    expect(screen.queryByTestId("status-added")).toBeNull();
    expect(screen.queryByTestId("status-modified")).toBeNull();
  });

  it("(X2) path-map miss → plain unmarked row, no crash", async () => {
    dirs["."] = [{ name: "a.ts", isDir: false }];
    renderWithDiff({ ...base, files: [{ path: "other.ts", changes: [{ type: "edit", timestamp: 1 }] }] });
    const row = (await screen.findByText("a.ts")).closest("[data-row]") as HTMLElement;
    expect(within(row).queryByTestId("status-added")).toBeNull();
    expect(within(row).queryByTestId("status-modified")).toBeNull();
    expect(within(row).queryByTestId("open-diff-chip")).toBeNull();
  });
});

describe("EditorFileTree — hidden dir correctness (#1)", () => {
  it("renders .git as an expandable folder that reveals its files", async () => {
    const openRoots: string[] = [];
    const onToggleRoot = vi.fn((rel: string) => {
      openRoots.push(rel);
      rerender();
    });
    const props = {
      cwd: "/proj",
      treeOpenRoots: openRoots,
      onToggleRoot,
      onOpenFile: vi.fn(),
      activePath: null,
    };
    const { rerender: rtlRerender } = render(<EditorFileTree {...props} />);
    const rerender = () =>
      rtlRerender(<EditorFileTree {...props} treeOpenRoots={[...openRoots]} />);

    // `.git` appears as a folder toggle (button), not a file open button.
    const gitFolder = await screen.findByText(".git");
    expect(gitFolder).toBeTruthy();
    const btn = gitFolder.closest("button");
    expect(btn).toBeTruthy();

    // Expanding it calls onToggleRoot(".git") and reveals HEAD.
    fireEvent.click(btn!);
    expect(onToggleRoot).toHaveBeenCalledWith(".git");
    await waitFor(() => expect(screen.getByText("HEAD")).toBeTruthy());
  });
});
