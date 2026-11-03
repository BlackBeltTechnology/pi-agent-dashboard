import type { FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrepMatch } from "../../../lib/api/grep-api.js";
import { EditorSearchPanel, type Mode } from "../EditorSearchPanel.js";

/** The pane owns the mode (so shortcuts can switch it); this harness plays the pane. */
function Panel(props: Omit<React.ComponentProps<typeof EditorSearchPanel>, "mode" | "onModeChange">) {
  const [mode, setMode] = useState<Mode>("file");
  return <EditorSearchPanel {...props} mode={mode} onModeChange={setMode} />;
}

// Timer hygiene (test-plan E3): a test that throws after `useFakeTimers()` must
// not leak fake timers into the real-timer `waitFor` tests that follow.
beforeEach(() => expect(vi.isFakeTimers()).toBe(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The active row carries a bare `bg-[var(--bg-hover)]`; inactive rows only the `hover:`-prefixed one. */
const isActive = (el: HTMLElement) => /(?:^|\s)bg-\[var\(--bg-hover\)\]/.test(el.className);
const resultRows = () => screen.getAllByRole("button").filter((b) => b.textContent?.includes("src/"));

/**
 * Type `value` and advance past the 200 ms debounce INSIDE `act`, so the
 * debounce commit and its passive effect (`setActiveIndex(0)`) flush together.
 * Without it, a key pressed between commit and effect is clobbered (#1097).
 */
async function typeAndSettle(value: string) {
  fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

const files: FileEntry[] = [
  { path: "src/editor.ts", isDirectory: false },
  { path: "src/edit-log.ts", isDirectory: false },
];
const contentMatches: GrepMatch[] = [
  { path: "src/a.ts", line: 80, col: 3, snippet: "const MAX_VISITS = 20000" },
];

function setup(overrides: Partial<React.ComponentProps<typeof Panel>> = {}) {
  const onFilenameSearch = vi.fn();
  const onContentSearch = vi.fn(async () => contentMatches);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <Panel
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
    vi.useFakeTimers();
    const { onOpen, onClose } = setup();
    const input = screen.getByTestId("editor-search-input");
    await typeAndSettle("edit");
    screen.getByText("src/editor.ts");
    expect(isActive(resultRows()[0])).toBe(true);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Synchronous: the act flush already ran the reset effect; no polling.
    expect(isActive(resultRows()[1])).toBe(true);
    expect(isActive(resultRows()[0])).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("src/edit-log.ts", undefined);
    // Escape is handled by the rail container (EditorPane), not the panel (D4).
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keyboard: Enter right after ArrowDown opens the new selection, not a stale closure (test-plan F3)", async () => {
    vi.useFakeTimers();
    const { onOpen } = setup();
    const input = screen.getByTestId("editor-search-input");
    await typeAndSettle("edit");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("src/edit-log.ts", undefined);
  });

  it("debounce boundary: no results at 199 ms, results after 200 ms (test-plan E2)", async () => {
    vi.useFakeTimers();
    const { onFilenameSearch } = setup();
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "edit" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(screen.queryByText("src/editor.ts")).toBe(null);
    expect(onFilenameSearch).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("src/editor.ts").textContent).toBe("src/editor.ts");
    expect(screen.getByText("src/edit-log.ts").textContent).toBe("src/edit-log.ts");
    expect(onFilenameSearch).toHaveBeenCalledWith("edit", false);
  });

  describe("timer hygiene (test-plan E3)", () => {
    it.fails("a test throwing after useFakeTimers()", () => {
      vi.useFakeTimers();
      throw new Error("boom after useFakeTimers");
    });

    it("the next test starts on real timers", () => {
      expect(vi.isFakeTimers()).toBe(false);
    });
  });

  it("prefill: a new nonce replaces the query and focuses the field", () => {
    const { rerender } = render(
      <EditorSearchPanel cwd="/proj" fileResults={null} onFilenameSearch={vi.fn()} onContentSearch={vi.fn(async () => [])} onOpen={vi.fn()} onClose={vi.fn()} mode="file" onModeChange={vi.fn()} prefill={{ nonce: 1, query: "kickoff" }} />,
    );
    const input = screen.getByTestId("editor-search-input") as HTMLInputElement;
    expect(input.value).toBe("kickoff");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "other" } });
    rerender(
      <EditorSearchPanel cwd="/proj" fileResults={null} onFilenameSearch={vi.fn()} onContentSearch={vi.fn(async () => [])} onOpen={vi.fn()} onClose={vi.fn()} mode="file" onModeChange={vi.fn()} prefill={{ nonce: 2, query: "again" }} />,
    );
    expect(input.value).toBe("again");
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
