import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the heavy Monaco editor with a plain textarea that forwards onChange.
vi.mock("../../editor-pane/MarkdownEditor.js", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="monaco" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { InstructionsPage } from "../InstructionsPage.js";

const CANDIDATES = [
  { path: "/repo/AGENTS.md", relPath: "AGENTS.md" },
  { path: "/repo/README.md", relPath: "README.md" },
];

function mockFetch() {
  const fetchMock = vi.fn((url: unknown) => {
    const u = String(url);
    if (u.includes("/api/file/md-candidates")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: { candidates: CANDIDATES } }) });
    }
    if (u.includes("/api/file/write")) {
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ success: true, data: { mtime: 222 } }) });
    }
    if (u.includes("/api/file")) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { type: "file", content: "# hello", mtime: 111 } }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: false }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const btn = (id: string) => screen.getByTestId(id) as HTMLButtonElement;

/**
 * Stub `window.matchMedia` so `(min-width: 768px)` reports `desktop`. jsdom has
 * no `matchMedia`; `InstructionsPage` treats a missing `matchMedia` as desktop,
 * so the default (unstubbed) tests exercise the desktop split. A mobile test
 * installs this stub with `desktop=false`.
 */
function stubViewport(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 768px") ? desktop : !desktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Reset the URL so a `?file=` pushed by one test does not leak into the next.
  window.history.replaceState(null, "", "/");
  // Drop any matchMedia stub so the next test defaults to desktop.
  // @ts-expect-error jsdom has no matchMedia; deleting restores that baseline.
  delete window.matchMedia;
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});

describe("InstructionsPage", () => {
  it("auto-selects AGENTS.md and starts clean with Save/Discard disabled", async () => {
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    expect(ta.value).toBe("# hello");
    expect(btn("instructions-save-btn").disabled).toBe(true);
    expect(btn("instructions-discard-btn").disabled).toBe(true);
    expect(screen.getByText("Saved")).toBeDefined();
  });

  it("enables Save/Discard once the buffer is edited", async () => {
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "# changed" } });
    expect(btn("instructions-save-btn").disabled).toBe(false);
    expect(btn("instructions-discard-btn").disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeDefined();
  });

  it("clears dirty after a successful save (Save disabled again)", async () => {
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "# changed" } });
    fireEvent.click(btn("instructions-save-btn"));
    await waitFor(() => expect(btn("instructions-save-btn").disabled).toBe(true));
    expect(screen.getByText("Saved")).toBeDefined();
  });

  // URL is the source of truth for the active file (change:
  // fix-plugin-and-scoped-back-navigation).
  it("selecting a file pushes ?file= and derives selection from the query", async () => {
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    await screen.findByTestId("monaco"); // AGENTS.md auto-selected (default)
    const items = screen.getAllByTestId("file-picker-item");
    fireEvent.click(items[1]); // README.md — clean buffer → navigates
    await waitFor(() => {
      expect(window.location.search).toContain("file=README.md");
    });
    await waitFor(() => {
      const readme = screen.getAllByTestId("file-picker-item")[1];
      expect(readme.getAttribute("aria-current")).toBe("true");
    });
  });

  it("restores the selected file from ?file= on deep-link / refresh", async () => {
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions?file=README.md");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    await waitFor(() => {
      const readme = screen.getAllByTestId("file-picker-item")[1];
      expect(readme.getAttribute("aria-current")).toBe("true");
    });
  });

  it("falls back to the default selection when ?file= names an unknown file", async () => {
    window.history.replaceState(
      null,
      "",
      "/folder/Zm9v/settings/instructions?file=does/not/exist.md",
    );
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    await waitFor(() => {
      const agents = screen.getAllByTestId("file-picker-item")[0];
      expect(agents.getAttribute("aria-current")).toBe("true");
    });
  });

  it("prompts a confirm when switching files with unsaved edits", async () => {
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "# changed" } });
    const items = screen.getAllByTestId("file-picker-item");
    // Click the OTHER file (README.md) while AGENTS.md is dirty.
    fireEvent.click(items[1]);
    await waitFor(() => {
      expect(screen.getByTestId("instructions-switch-confirm")).toBeDefined();
    });
  });
});

describe("InstructionsPage resize (desktop)", () => {
  it("restores the tree column width from localStorage on mount", async () => {
    localStorage.setItem("dashboard:dirset-width", "420");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const picker = await screen.findByTestId("file-picker");
    expect(picker.style.width).toBe("420px");
  });

  it("dragging the gutter changes the tree width within the clamp and persists on mouseup", async () => {
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const gutter = await screen.findByTestId("tree-gutter");
    const picker = screen.getByTestId("file-picker");

    // Drag to 420px (jsdom getBoundingClientRect left = 0, so width = clientX).
    fireEvent.mouseDown(gutter);
    fireEvent.mouseMove(document, { clientX: 420 });
    fireEvent.mouseUp(document, { clientX: 420 });
    expect(picker.style.width).toBe("420px");
    expect(localStorage.getItem("dashboard:dirset-width")).toBe("420");

    // Beyond the max clamps to 560px.
    fireEvent.mouseDown(gutter);
    fireEvent.mouseMove(document, { clientX: 9999 });
    fireEvent.mouseUp(document, { clientX: 9999 });
    expect(picker.style.width).toBe("560px");

    // Below the min clamps to 200px.
    fireEvent.mouseDown(gutter);
    fireEvent.mouseMove(document, { clientX: 10 });
    fireEvent.mouseUp(document, { clientX: 10 });
    expect(picker.style.width).toBe("200px");
  });
});

describe("InstructionsPage mobile master/detail", () => {
  it("shows the full-width tree with no default file and no gutter", async () => {
    stubViewport(false);
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const picker = await screen.findByTestId("file-picker");
    // Full-width (no inline width) and no resize gutter.
    expect(picker.style.width).toBe("");
    expect(screen.queryByTestId("tree-gutter")).toBeNull();
    // No file auto-selected ⇒ editor not mounted.
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("swaps to the editor on file tap and back returns to the tree", async () => {
    stubViewport(false);
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const agents = await screen.findByText("AGENTS.md");
    fireEvent.click(agents);
    // Editor replaces the tree.
    await screen.findByTestId("monaco");
    expect(screen.queryByTestId("file-picker")).toBeNull();
    await waitFor(() => expect(window.location.search).toContain("file=AGENTS.md"));
    // Mobile back control clears ?file= and returns to the tree.
    fireEvent.click(screen.getByTestId("instructions-mobile-back"));
    await screen.findByTestId("file-picker");
    expect(window.location.search).toBe("");
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("prompts a discard confirm when mobile back is tapped with unsaved edits", async () => {
    stubViewport(false);
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions?file=AGENTS.md");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "# changed" } });
    // Tapping back while dirty must NOT navigate immediately — it confirms first.
    fireEvent.click(screen.getByTestId("instructions-mobile-back"));
    await screen.findByTestId("instructions-back-confirm");
    expect(window.location.search).toContain("file=AGENTS.md");
    // Confirming discard clears the buffer and returns to the tree.
    fireEvent.click(screen.getByTestId("instructions-back-confirm-action"));
    await screen.findByTestId("file-picker");
    expect(window.location.search).toBe("");
  });
});

describe("InstructionsPage default selection (desktop regression)", () => {
  it("applies the default selection at ≥md when ?file= is absent", async () => {
    stubViewport(true);
    window.history.replaceState(null, "", "/folder/Zm9v/settings/instructions");
    mockFetch();
    render(<InstructionsPage cwd="/repo" />);
    const ta = (await screen.findByTestId("monaco")) as HTMLTextAreaElement;
    expect(ta.value).toBe("# hello");
    const agents = screen.getAllByTestId("file-picker-item")[0];
    expect(agents.getAttribute("aria-current")).toBe("true");
  });
});
