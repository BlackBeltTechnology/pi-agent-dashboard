/**
 * EditorFileTree consumes the single `/api/file/tree` endpoint (#1).
 *
 * Regression: hidden directories (`.git`) MUST render as expandable folders,
 * not files. The old `/api/file`+`/api/browse` merge stripped hidden dirs from
 * the dirs-only source and labelled them files.
 *
 * See change: improve-content-editor (tasks §2.2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

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
