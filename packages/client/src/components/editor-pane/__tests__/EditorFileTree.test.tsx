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

describe("EditorFileTree — copy-path popup (copy-file-path)", () => {
  const CWD = "/Users/u/proj";
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
    return { row, glyph: within(row).getByLabelText("Copy path") };
  };

  it("(a) reveals a copy glyph on each file/directory row", async () => {
    renderTree();
    expect((await glyphOf("foo.ts")).glyph).toBeTruthy();
    expect((await glyphOf(".git")).glyph).toBeTruthy();
  });

  it("(b) activating the glyph opens the popup and does NOT open the file", async () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(within(row).getByRole("menuitem", { name: /Copy full path/ })).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("(c) Copy full path writes cwd + '/' + rel", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(within(row).getByRole("menuitem", { name: /Copy full path/ }));
    expect(writeText).toHaveBeenCalledWith(`${CWD}/src/foo.ts`);
  });

  it("(d) Copy relative path writes rel", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(within(row).getByRole("menuitem", { name: /Copy relative path/ }));
    expect(writeText).toHaveBeenCalledWith("src/foo.ts");
  });

  it("(e) Copy file name writes the basename", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.click(within(row).getByRole("menuitem", { name: /Copy file name/ }));
    expect(writeText).toHaveBeenCalledWith("foo.ts");
  });

  it("(f) a directory row's glyph copies without toggling onToggleRoot", async () => {
    const onToggleRoot = vi.fn();
    renderTree({ onToggleRoot });
    const { row, glyph } = await glyphOf(".git");
    fireEvent.click(glyph);
    fireEvent.click(within(row).getByRole("menuitem", { name: /Copy full path/ }));
    expect(writeText).toHaveBeenCalledWith(`${CWD}/.git`);
    expect(onToggleRoot).not.toHaveBeenCalled();
  });

  it("(g1) outside-click dismisses the popup with no copy", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(within(row).queryByRole("menuitem", { name: /Copy full path/ })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(within(row).queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(g2) Escape dismisses the popup with no copy", async () => {
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(row).queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(g3) rail scroll dismisses the popup with no copy", async () => {
    const { container } = renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    fireEvent.scroll(container.querySelector("[data-file-rail]") as HTMLElement);
    expect(within(row).queryByRole("menuitem", { name: /Copy full path/ })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("(h) does not throw when navigator.clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderTree();
    const { row, glyph } = await glyphOf("foo.ts");
    fireEvent.click(glyph);
    expect(() =>
      fireEvent.click(within(row).getByRole("menuitem", { name: /Copy full path/ })),
    ).not.toThrow();
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
