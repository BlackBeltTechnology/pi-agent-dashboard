/**
 * Sidebar tag/phase filter axis (§6.5).
 *   - OR within the tag group; AND across axes (folder + search + tag).
 *   - no selection = inert.
 *   - user tag `apply` vs phase `apply` do NOT collide (two separate sets).
 *   - phase-chip selection filters by openspecPhase without touching tags.
 *   - folder-tier coverage: a tag-matching session (incl. ENDED) keeps its
 *     folder visible + auto-expanded in pinned, unpinned, AND workspace tiers;
 *     a zero-match folder is hidden in every tier.
 * See change: add-session-tags.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  // The sidebar tag area is default-collapsed (change:
  // sidebar-tag-collapse-and-delete). These tests exercise filter LOGIC, so
  // pre-open the area to keep the filter chips rendered.
  const store: Record<string, string> = { "sidebar.tagArea.open": "true" };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => cleanup());

let idSeq = 0;
function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  idSeq += 1;
  return {
    id: `s-${idSeq}`,
    cwd: "/home/user/project",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

function renderList(sessions: DashboardSession[], extraProps: Record<string, unknown> = {}) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList sessions={sessions} onSelect={() => {}} {...extraProps} />
      </ThemeProvider>
    </TestRouter>,
  );
}

const visible = (c: HTMLElement, id: string) => !!c.querySelector(`[data-session-id="${id}"]`);

describe("SessionList tag filter", () => {
  it("no selection is inert (all sessions visible)", () => {
    const a = makeSession({ tags: ["feature"] });
    const b = makeSession({ tags: ["docs"] });
    const { container } = renderList([a, b]);
    expect(visible(container, a.id)).toBe(true);
    expect(visible(container, b.id)).toBe(true);
  });

  it("OR within the tag group", () => {
    const a = makeSession({ tags: ["feature"] });
    const b = makeSession({ tags: ["bugfix"] });
    const c = makeSession({ tags: ["docs"] });
    const { container, getByLabelText } = renderList([a, b, c]);

    fireEvent.click(getByLabelText("Filter by tag feature"));
    fireEvent.click(getByLabelText("Filter by tag bugfix"));

    expect(visible(container, a.id)).toBe(true);
    expect(visible(container, b.id)).toBe(true);
    expect(visible(container, c.id)).toBe(false);
  });

  it("ANDs the tag axis with the folder-path filter", () => {
    const a = makeSession({ cwd: "/proj/api", tags: ["feature"] });
    const b = makeSession({ cwd: "/proj/web", tags: ["feature"] });
    const { container, getByLabelText, getByTestId } = renderList([a, b]);

    fireEvent.click(getByLabelText("Filter by tag feature"));
    fireEvent.change(getByTestId("workspace-filter-input"), { target: { value: "/proj/api" } });

    expect(visible(container, a.id)).toBe(true);
    expect(visible(container, b.id)).toBe(false);
  });

  it("ANDs the tag axis with the session search", () => {
    const a = makeSession({ name: "auth work", tags: ["feature"] });
    const b = makeSession({ name: "billing work", tags: ["feature"] });
    const { container, getByLabelText, getByTestId } = renderList([a, b]);

    fireEvent.click(getByLabelText("Filter by tag feature"));
    fireEvent.change(getByTestId("session-search-input"), { target: { value: "auth" } });

    expect(visible(container, a.id)).toBe(true);
    expect(visible(container, b.id)).toBe(false);
  });

  it("user tag `apply` does not match a phase-only `apply` session", () => {
    const tagged = makeSession({ tags: ["apply"], openspecPhase: null });
    const phased = makeSession({ tags: [], openspecPhase: "apply" });
    const { container, getByLabelText } = renderList([tagged, phased]);

    // Select the USER-TAG chip named apply.
    fireEvent.click(getByLabelText("Filter by tag apply"));
    expect(visible(container, tagged.id)).toBe(true);
    expect(visible(container, phased.id)).toBe(false);
  });

  it("phase chip filters by openspecPhase (separate axis from user tags)", () => {
    const tagged = makeSession({ tags: ["apply"], openspecPhase: null });
    const phased = makeSession({ tags: [], openspecPhase: "apply" });
    const { container, getByLabelText } = renderList([tagged, phased]);

    fireEvent.click(getByLabelText("Filter by phase apply"));
    expect(visible(container, phased.id)).toBe(true);
    expect(visible(container, tagged.id)).toBe(false);
  });
});

describe("SessionList tag filter — folder-tier coverage", () => {
  it("reveals an ENDED tag-matching session's folder and hides zero-match folders (unpinned tier)", () => {
    const match = makeSession({ cwd: "/u/match", status: "ended", endedAt: Date.now(), tags: ["feature"] });
    const other = makeSession({ cwd: "/u/other", status: "ended", endedAt: Date.now(), tags: ["chore"] });
    const { container, getByLabelText } = renderList([match, other]);

    // At rest: ended-only unpinned folders are hidden.
    expect(visible(container, match.id)).toBe(false);

    fireEvent.click(getByLabelText("Filter by tag feature"));
    // Folder revealed + ended card auto-expanded.
    expect(visible(container, match.id)).toBe(true);
    // Zero-match folder stays hidden — no empty shell.
    expect(visible(container, other.id)).toBe(false);
  });

  it("reveals an ENDED tag match in the pinned tier and hides zero-match pinned folders", () => {
    const match = makeSession({ cwd: "/p/match", status: "ended", endedAt: Date.now(), tags: ["feature"] });
    const other = makeSession({ cwd: "/p/other", status: "ended", endedAt: Date.now(), tags: ["chore"] });
    const { container, getByLabelText } = renderList([match, other], {
      pinnedDirectories: ["/p/match", "/p/other"],
    });

    fireEvent.click(getByLabelText("Filter by tag feature"));
    expect(visible(container, match.id)).toBe(true);
    expect(visible(container, other.id)).toBe(false);
  });

  it("reveals an ENDED tag match in the workspace tier and hides zero-match workspace folders", () => {
    const match = makeSession({ cwd: "/w/match", status: "ended", endedAt: Date.now(), tags: ["feature"] });
    const other = makeSession({ cwd: "/w/other", status: "ended", endedAt: Date.now(), tags: ["chore"] });
    const { container, getByLabelText } = renderList([match, other], {
      workspaces: [
        { id: "ws1", name: "WS", collapsed: false, folders: ["/w/match", "/w/other"] },
      ],
    });

    fireEvent.click(getByLabelText("Filter by tag feature"));
    expect(visible(container, match.id)).toBe(true);
    expect(visible(container, other.id)).toBe(false);
  });
});

// ── archive-sessions-lazy-load: include-archive search chip ──────────────
// #F11: chip OFF → no archived request, no Archive matches section.
// #F12: chip ON → debounced single fetch (q=allow after al→all→allow), results
//       grouped per groupPath under `Archive matches (N)`.
// #F13: chip state persists in localStorage across remounts.
// See change: archive-sessions-lazy-load.
describe("SessionList — include-archive search chip (archive-sessions-lazy-load)", () => {
  function archivedItem(id: string, groupPath = "/home/user/project") {
    return {
      id,
      name: `Archived ${id}`,
      cwd: groupPath,
      groupPath,
      endedAt: 1000,
      archivedAt: 2000,
      sessionFile: `/tmp/sessions/${id}.jsonl`,
    };
  }

  function archiveFetch(items: ReturnType<typeof archivedItem>[], nextCursor?: string) {
    return vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ success: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } }),
    });
  }

  /** Only the archive-listing calls — SessionList also fetches git/openspec/tunnel. */
  function archivedCalls(fetchImpl: ReturnType<typeof vi.fn>) {
    return fetchImpl.mock.calls.filter((c) => String(c[0]).includes("/api/sessions/archived"));
  }

  it("F11: chip off — typing a query makes no archived fetch and renders no Archive matches", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = archiveFetch([archivedItem("a1"), archivedItem("a2")]);
      vi.stubGlobal("fetch", fetchImpl);
      renderList([makeSession({ name: "Live session" })]);

      fireEvent.change(screen.getByTestId("session-search-input"), { target: { value: "allowlist" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });

      expect(archivedCalls(fetchImpl)).toHaveLength(0);
      expect(screen.queryByText(/Archive matches/)).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("F12: chip on — one debounced fetch with q=allow; results grouped under Archive matches (2)", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = archiveFetch([archivedItem("a1"), archivedItem("a2")]);
      vi.stubGlobal("fetch", fetchImpl);
      renderList([makeSession({ name: "Live session" })]);

      // Chip ON.
      fireEvent.click(screen.getByTestId("search-include-archive"));
      expect(screen.getByTestId("search-include-archive").getAttribute("aria-pressed")).toBe("true");

      const input = screen.getByTestId("session-search-input");
      fireEvent.change(input, { target: { value: "al" } });
      fireEvent.change(input, { target: { value: "all" } });
      fireEvent.change(input, { target: { value: "allow" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });

      const calls = archivedCalls(fetchImpl);
      expect(calls).toHaveLength(1);
      const url = String(calls[0][0]);
      expect(url).toContain("q=allow");
      expect(url).toContain("limit=50");

      // Flush the fetch promise + setState microtasks (no real timers —
      // waitFor would hang under fake timers).
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(screen.getByText("Archive matches (2)")).toBeTruthy();
      // Two archived rows rendered beneath the section.
      expect(screen.getAllByTestId("archived-session-row").length).toBe(2);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("F12: chip on but query shorter than 3 chars → no fetch", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = archiveFetch([]);
      vi.stubGlobal("fetch", fetchImpl);
      renderList([makeSession({ name: "Live session" })]);

      fireEvent.click(screen.getByTestId("search-include-archive"));
      fireEvent.change(screen.getByTestId("session-search-input"), { target: { value: "al" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });

      expect(archivedCalls(fetchImpl)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("F13: chip state persists in localStorage across remounts", () => {
    window.localStorage.setItem("sidebar.search.includeArchive", "true");
    const first = renderList([makeSession()]);
    expect(screen.getByTestId("search-include-archive").getAttribute("aria-pressed")).toBe("true");
    first.unmount();

    const second = renderList([makeSession()]);
    expect(screen.getByTestId("search-include-archive").getAttribute("aria-pressed")).toBe("true");
    second.unmount();
  });
});
