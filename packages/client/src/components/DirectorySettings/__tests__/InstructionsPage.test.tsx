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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Reset the URL so a `?file=` pushed by one test does not leak into the next.
  window.history.replaceState(null, "", "/");
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
