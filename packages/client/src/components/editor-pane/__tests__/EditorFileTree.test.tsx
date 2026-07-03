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
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

import { EditorFileTree } from "../EditorFileTree.js";

type Entry = { name: string; isDir: boolean };
const dirs: Record<string, Entry[]> = {
  ".": [
    { name: ".git", isDir: true },
    { name: "README.md", isDir: false },
  ],
  ".git": [{ name: "HEAD", isDir: false }],
};

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
beforeEach(mockTreeFetch);
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
    expect(scrollSpy).toHaveBeenCalled();
    delete dirs["src"];
    dirs["."] = [
      { name: ".git", isDir: true },
      { name: "README.md", isDir: false },
    ];
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
