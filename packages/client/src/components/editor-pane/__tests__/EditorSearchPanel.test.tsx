import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GrepMatch } from "../../../lib/api/grep-api.js";
import { EditorSearchPanel } from "../EditorSearchPanel.js";

afterEach(() => cleanup());

const files: FileEntry[] = [
  { path: "src/editor.ts", isDirectory: false },
  { path: "src/edit-log.ts", isDirectory: false },
];
const contentMatches: GrepMatch[] = [
  { path: "src/a.ts", line: 80, col: 3, snippet: "const MAX_VISITS = 20000" },
];

function setup(overrides: Partial<React.ComponentProps<typeof EditorSearchPanel>> = {}) {
  const onFilenameSearch = vi.fn();
  const onContentSearch = vi.fn(async () => contentMatches);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <EditorSearchPanel
      cwd="/proj"
      fileResults={{ query: "edit", files }}
      onFilenameSearch={onFilenameSearch}
      onContentSearch={onContentSearch}
      onOpen={onOpen}
      onClose={onClose}
      minLen={3}
      {...overrides}
    />,
  );
  return { onFilenameSearch, onContentSearch, onOpen, onClose };
}

describe("EditorSearchPanel", () => {
  it("shows a min-length hint and issues no search below the minimum", async () => {
    const { onFilenameSearch } = setup({ fileResults: null });
    const input = screen.getByTestId("editor-search-input");
    fireEvent.change(input, { target: { value: "ab" } });
    await screen.findByText(/type ≥ 3/i);
    expect(onFilenameSearch).not.toHaveBeenCalled();
  });

  it("fires a filename search and renders path results (Filenames mode)", async () => {
    const { onFilenameSearch } = setup();
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "edit" } });
    await waitFor(() => expect(onFilenameSearch).toHaveBeenCalledWith("edit", false));
    expect(screen.getByText("src/editor.ts")).toBeTruthy();
    expect(screen.getByText("src/edit-log.ts")).toBeTruthy();
  });

  it("switches to Contents mode and renders grep results with line + snippet", async () => {
    const { onContentSearch } = setup({ fileResults: null });
    fireEvent.click(screen.getByTestId("mode-content"));
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "MAX_VISITS" } });
    await waitFor(() => expect(onContentSearch).toHaveBeenCalledWith("MAX_VISITS", false));
    await screen.findByText(/const MAX_VISITS/);
    expect(screen.getByText(/:80/)).toBeTruthy();
  });

  it("passes the regexp flag when toggled", async () => {
    const { onContentSearch } = setup({ fileResults: null });
    fireEvent.click(screen.getByTestId("mode-content"));
    fireEvent.click(screen.getByTestId("regex-toggle"));
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "MAX_[A-Z]+" } });
    await waitFor(() => expect(onContentSearch).toHaveBeenCalledWith("MAX_[A-Z]+", true));
  });

  it("keyboard: ArrowDown + Enter opens the selected result; Esc closes", async () => {
    const { onOpen, onClose } = setup();
    const input = screen.getByTestId("editor-search-input");
    fireEvent.change(input, { target: { value: "edit" } });
    await screen.findByText("src/editor.ts");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("src/edit-log.ts", undefined);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("content match opens with its line for scroll-to", async () => {
    const { onOpen } = setup({ fileResults: null });
    fireEvent.click(screen.getByTestId("mode-content"));
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "MAX_VISITS" } });
    await screen.findByText(/const MAX_VISITS/);
    fireEvent.keyDown(screen.getByTestId("editor-search-input"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("src/a.ts", 80);
  });
});
