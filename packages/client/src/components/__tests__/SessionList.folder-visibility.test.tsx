/**
 * Default visibility of UNPINNED, non-workspace folders: an ended-only folder
 * is hidden unless an alive session, the selected session (no filter, no
 * Session search), a Folders filter, a tag filter (through a matching held
 * session) or an archive-search match keeps it. `endedTotals` alone never
 * reveals it. Pinned and workspace folders keep their stub / ended expander.
 *
 * Scenarios: test-plan #E1-#E20, #E22, #E23.
 * See change: fix-sidebar-folder-visibility.
 */
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { openFilterFunnel, setSidebarSearch } from "./sidebar-search-helper.js";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  // Pre-open the default-collapsed tag area so tag-filter chips render.
  const store: Record<string, string> = { "sidebar.tagArea.open": "true" };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let seq = 0;
function mk(over: Partial<DashboardSession> = {}): DashboardSession {
  seq += 1;
  return {
    id: `s-${seq}`,
    cwd: "/a",
    source: "tui",
    status: "ended",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...over,
  };
}

type ListProps = React.ComponentProps<typeof SessionList>;

function tree(props: Partial<ListProps>) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return (
    <Router hook={hook}>
      <ThemeProvider>
        <SessionList sessions={[]} onSelect={() => {}} {...props} />
      </ThemeProvider>
    </Router>
  );
}

function mount(props: Partial<ListProps> = {}) {
  const utils = render(tree(props));
  return { ...utils, update: (next: Partial<ListProps>) => utils.rerender(tree(next)) };
}

const folderShown = (cwd: string) => screen.queryByTestId(`folder-header-name-${cwd}`) !== null;
const emptyMessageShown = () => screen.queryByText("No active sessions") !== null;

function clickTag(tag: string) {
  fireEvent.click(within(screen.getByTestId("tag-filter-bar")).getByText(`#${tag}`));
}

describe("unpinned folder default visibility (#1086)", () => {
  it("E1: an ended-only unpinned folder is hidden even though its sessions are unarchived", () => {
    const sessions = [mk({ cwd: "/old/dir" }), mk({ cwd: "/old/dir" }), mk({ cwd: "/live", status: "active" })];
    mount({ sessions, endedTotalsMap: new Map([["/old/dir", 2]]) });
    expect(folderShown("/old/dir")).toBe(false);
    expect(screen.queryByTestId("folder-ended-toggle-/old/dir")).toBeNull();
    expect(folderShown("/live")).toBe(true);
  });

  it("E2: a stub-only unpinned folder is hidden and sends no page request", () => {
    const onSessionsPage = vi.fn();
    mount({
      sessions: [mk({ cwd: "/live", status: "active" })],
      endedTotalsMap: new Map([["/old/dir", 3]]),
      onSessionsPage,
    });
    expect(folderShown("/old/dir")).toBe(false);
    expect(onSessionsPage).not.toHaveBeenCalled();
  });

  it("E3: a Folders filter reveals the stub group and its expander pages from offset 0", () => {
    const onSessionsPage = vi.fn();
    mount({
      sessions: [mk({ cwd: "/live", status: "active" })],
      endedTotalsMap: new Map([["/old/dir", 3]]),
      pagedCount: new Map(),
      onSessionsPage,
    });
    setSidebarSearch("folders", "old/dir");
    expect(folderShown("/old/dir")).toBe(true);
    fireEvent.click(screen.getByTestId("folder-ended-toggle-/old/dir"));
    expect(onSessionsPage).toHaveBeenCalledTimes(1);
    expect(onSessionsPage).toHaveBeenCalledWith("/old/dir", 0);
  });

  it("E4: a non-matching Folders filter hides the folder even when it holds the selected session", () => {
    const sel = mk({ cwd: "/old/dir" });
    mount({ sessions: [sel], selectedId: sel.id, endedTotalsMap: new Map([["/old/dir", 1]]) });
    expect(folderShown("/old/dir")).toBe(true);
    setSidebarSearch("folders", "zzz");
    expect(folderShown("/old/dir")).toBe(false);
  });

  it("E5: an unpinned folder with an alive session is visible", () => {
    mount({ sessions: [mk({ cwd: "/a", status: "idle" }), mk({ cwd: "/b", status: "active" })] });
    expect(folderShown("/a")).toBe(true);
    expect(folderShown("/b")).toBe(true);
  });

  it("E6: the folder leaves the sidebar when its last alive session ends", () => {
    const live = mk({ cwd: "/a", status: "active" });
    const other = mk({ cwd: "/b", status: "active" });
    const { update } = mount({ sessions: [live, other] });
    expect(folderShown("/a")).toBe(true);
    update({ sessions: [{ ...live, status: "ended" }, other], endedTotalsMap: new Map([["/a", 1]]) });
    expect(folderShown("/a")).toBe(false);
  });

  it("E7: a pinned ended-only folder keeps its ended expander labelled from endedTotals", () => {
    mount({ sessions: [mk({ cwd: "/p" })], pinnedDirectories: ["/p"], endedTotalsMap: new Map([["/p", 3]]) });
    const toggle = screen.getByTestId("folder-ended-toggle-/p");
    expect(toggle.textContent).toContain("3");
  });

  it("E8: a workspace folder (ended-only and stub-only) keeps its expander and pages", () => {
    const onSessionsPage = vi.fn();
    const workspaces: Workspace[] = [{ id: "ws1", name: "WS", collapsed: false, folders: ["/w", "/v"] }];
    mount({
      sessions: [mk({ cwd: "/v" })],
      workspaces,
      endedTotalsMap: new Map([["/w", 2], ["/v", 1]]),
      pagedCount: new Map(),
      onSessionsPage,
    });
    expect(screen.getByTestId("folder-ended-toggle-/v")).toBeTruthy();
    fireEvent.click(screen.getByTestId("folder-ended-toggle-/w"));
    expect(onSessionsPage).toHaveBeenCalledWith("/w", 0);
  });

  it("E9: a tag filter reveals an ended-only folder through a matching session, never a stub", () => {
    mount({
      sessions: [mk({ cwd: "/a", tags: ["x"] }), mk({ cwd: "/a" })],
      endedTotalsMap: new Map([["/a", 2], ["/b", 3]]),
    });
    expect(folderShown("/a")).toBe(false);
    clickTag("x");
    expect(folderShown("/a")).toBe(true);
    expect(folderShown("/b")).toBe(false);
  });

  it("E10: a tag filter that matches none of the folder's sessions keeps it hidden", () => {
    mount({
      sessions: [mk({ cwd: "/a", tags: ["y"] }), mk({ cwd: "/live", status: "active", tags: ["x"] })],
      endedTotalsMap: new Map([["/a", 1]]),
    });
    clickTag("x");
    expect(folderShown("/a")).toBe(false);
    expect(folderShown("/live")).toBe(true);
  });

  it("E11: an archive-search match keeps an ended-only folder visible with its Archive matches section", async () => {
    vi.useFakeTimers();
    try {
      const item = { id: "arch1", name: "Archived arch1", cwd: "/a", groupPath: "/a", endedAt: 1000, archivedAt: 2000, sessionFile: "/tmp/arch1.jsonl" };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true, data: { items: [item] } }),
      }));
      mount({ sessions: [mk({ cwd: "/a", name: "unrelated" })], endedTotalsMap: new Map([["/a", 1]]) });
      openFilterFunnel();
      fireEvent.click(screen.getByTestId("search-include-archive"));
      setSidebarSearch("sessions", "arch1");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(folderShown("/a")).toBe(true);
      expect(screen.getByText(/Archive matches/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("archive match under a Folders query (CodeRabbit #1107)", () => {
  it("keeps a Folders-matching folder with archive matches visible even when no resident session matches the Session query", async () => {
    vi.useFakeTimers();
    try {
      const item = { id: "arch1", name: "Archived arch1", cwd: "/a", groupPath: "/a", endedAt: 1000, archivedAt: 2000, sessionFile: "/tmp/arch1.jsonl" };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true, data: { items: [item] } }),
      }));
      mount({ sessions: [mk({ cwd: "/a", name: "unrelated" }), mk({ cwd: "/b", status: "active" })], endedTotalsMap: new Map([["/a", 1]]) });
      openFilterFunnel();
      fireEvent.click(screen.getByTestId("search-include-archive"));
      setSidebarSearch("folders", "/a");
      setSidebarSearch("sessions", "arch1");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(folderShown("/a")).toBe(true);
      expect(screen.getByText(/Archive matches/)).toBeTruthy();
      // The Folders query still decides: a non-matching path stays hidden.
      setSidebarSearch("folders", "/zzz");
      expect(folderShown("/a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CodeRabbit #1107 round 2", () => {
  it("renders the Archive matches section in a stub folder revealed by an archive match", async () => {
    vi.useFakeTimers();
    try {
      const item = { id: "arch1", name: "Archived arch1", cwd: "/a", groupPath: "/a", endedAt: 1000, archivedAt: 2000, sessionFile: "/tmp/arch1.jsonl" };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true, data: { items: [item] } }),
      }));
      mount({ sessions: [mk({ cwd: "/b", status: "active" })], endedTotalsMap: new Map([["/a", 2]]) });
      openFilterFunnel();
      fireEvent.click(screen.getByTestId("search-include-archive"));
      setSidebarSearch("sessions", "arch1");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(folderShown("/a")).toBe(true);
      expect(screen.getByTestId("archive-matches-/a")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the sidebar add actions when every folder is hidden", () => {
    mount({ sessions: [mk({ cwd: "/a" })], endedTotalsMap: new Map([["/a", 1]]), onOpenPinDialog: () => {} });
    expect(emptyMessageShown()).toBe(true);
    expect(screen.getByTestId("dashboard-add-folder-btn")).toBeTruthy();
  });

  it("says 'No matching folders' (not 'No active sessions') when a filter hides every folder", () => {
    mount({ sessions: [mk({ cwd: "/a", status: "active" })], onOpenPinDialog: () => {} });
    setSidebarSearch("folders", "zzz");
    expect(folderShown("/a")).toBe(false);
    expect(emptyMessageShown()).toBe(false);
    expect(screen.getByText("No matching folders")).toBeTruthy();
    expect(screen.getByTestId("dashboard-add-folder-btn")).toBeTruthy();
  });
});

describe("selected-session clause (design D3)", () => {
  it("E12: an ended-only folder holding the selected session stays visible with the selected card", () => {
    const sel = mk({ cwd: "/a" });
    mount({ sessions: [sel, mk({ cwd: "/a" })], selectedId: sel.id, endedTotalsMap: new Map([["/a", 2]]) });
    expect(folderShown("/a")).toBe(true);
    // Ended cards sit behind the folder's ended fold (collapsed by default,
    // unchanged here); the folder staying visible keeps the card reachable.
    fireEvent.click(screen.getByTestId("folder-ended-toggle-/a"));
    expect(document.querySelector(`[data-session-id="${sel.id}"]`)).not.toBeNull();
  });

  it("E13: the folder leaves when the selection moves to another folder, and when it is cleared", () => {
    const sel = mk({ cwd: "/a" });
    const alive = mk({ cwd: "/b", status: "active" });
    const base = { sessions: [sel, alive], endedTotalsMap: new Map([["/a", 1]]) };
    const { update } = mount({ ...base, selectedId: sel.id });
    expect(folderShown("/a")).toBe(true);
    update({ ...base, selectedId: alive.id });
    expect(folderShown("/a")).toBe(false);
    update({ ...base, selectedId: sel.id });
    expect(folderShown("/a")).toBe(true);
    update({ ...base, selectedId: undefined });
    expect(folderShown("/a")).toBe(false);
  });

  it("E14: the selected session does not reveal its folder during a Session search", () => {
    const sel = mk({ cwd: "/a" });
    mount({ sessions: [sel], selectedId: sel.id, endedTotalsMap: new Map([["/a", 1]]) });
    expect(folderShown("/a")).toBe(true);
    setSidebarSearch("sessions", "zzz");
    expect(folderShown("/a")).toBe(false);
  });

  it("E15: a hidden selected session does not keep its folder visible", () => {
    const sel = mk({ cwd: "/a", hidden: true });
    mount({ sessions: [sel, mk({ cwd: "/b", status: "active" })], selectedId: sel.id });
    expect(folderShown("/a")).toBe(false);
  });

  it("E16: a tag filter that excludes the selected session's folder decides alone", () => {
    const sel = mk({ cwd: "/a" });
    mount({
      sessions: [sel, mk({ cwd: "/b", status: "active", tags: ["x"] })],
      selectedId: sel.id,
      endedTotalsMap: new Map([["/a", 1]]),
    });
    expect(folderShown("/a")).toBe(true);
    clickTag("x");
    expect(folderShown("/a")).toBe(false);
  });

  it("E23: archive search is a Session search — only an archive match, never the selection, keeps the folder", async () => {
    vi.useFakeTimers();
    try {
      const item = { id: "arch1", name: "Archived arch1", cwd: "/a", groupPath: "/a", endedAt: 1000, archivedAt: 2000, sessionFile: "/tmp/arch1.jsonl" };
      let items: unknown[] = [];
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ success: true, data: { items } }),
      })));
      const sel = mk({ cwd: "/a", name: "unrelated" });
      mount({ sessions: [sel], selectedId: sel.id, endedTotalsMap: new Map([["/a", 1]]) });
      openFilterFunnel();
      fireEvent.click(screen.getByTestId("search-include-archive"));
      // (a) archive search active, no archive match in /a.
      setSidebarSearch("sessions", "nomatch");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(folderShown("/a")).toBe(false);
      // (b) an archive match in /a keeps it, via the archive-match clause.
      items = [item];
      setSidebarSearch("sessions", "arch1");
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(folderShown("/a")).toBe(true);
      expect(screen.getByText(/Archive matches/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("hidden sessions and the empty-state gate", () => {
  it("E17: a sidebar whose every folder is hidden shows the empty message", () => {
    mount({
      sessions: [mk({ cwd: "/a" }), mk({ cwd: "/b" })],
      endedTotalsMap: new Map([["/a", 1], ["/b", 4]]),
    });
    expect(emptyMessageShown()).toBe(true);
    expect(document.querySelector('[data-testid^="folder-header-name-"]')).toBeNull();
  });

  it("E18a: a pinned folder keeps the list (no empty message) while the unpinned folder is hidden", () => {
    mount({ sessions: [mk({ cwd: "/a" })], pinnedDirectories: ["/p"], endedTotalsMap: new Map([["/a", 1]]) });
    expect(emptyMessageShown()).toBe(false);
    expect(folderShown("/p")).toBe(true);
    expect(folderShown("/a")).toBe(false);
  });

  it("E18b: a workspace keeps the list (no empty message) while the unpinned folder is hidden", () => {
    mount({
      sessions: [mk({ cwd: "/a" })],
      workspaces: [{ id: "ws1", name: "WS", collapsed: false, folders: [] }],
      endedTotalsMap: new Map([["/a", 1]]),
    });
    expect(emptyMessageShown()).toBe(false);
    expect(screen.getByTestId("workspace-name-ws1")).toBeTruthy();
    expect(folderShown("/a")).toBe(false);
  });

  it("E19: the group key is the worktree main path; pinning it brings the expander back", () => {
    const wt = mk({ cwd: "/repoA/.worktrees/wt1", gitWorktree: { mainPath: "/repoA", name: "wt1" } });
    const live = mk({ cwd: "/live", status: "active" });
    const base = { sessions: [wt, live], endedTotalsMap: new Map([["/repoA", 1]]) };
    const { update } = mount(base);
    expect(folderShown("/repoA")).toBe(false);
    update({ ...base, pinnedDirectories: ["/repoA"] });
    expect(screen.getByTestId("folder-ended-toggle-/repoA")).toBeTruthy();
  });

  it("E20: hidden-only ended sessions — unpinned folder absent, pinned stub expander unchanged", () => {
    const live = mk({ cwd: "/live", status: "active" });
    const hiddenEnded = mk({ cwd: "/h", hidden: true });
    const base = { sessions: [hiddenEnded, live], endedTotalsMap: new Map([["/h", 1]]) };
    const { update } = mount(base);
    expect(folderShown("/h")).toBe(false);
    update({ ...base, pinnedDirectories: ["/h"] });
    expect(screen.getByTestId("folder-ended-toggle-/h")).toBeTruthy();
  });

  it("E22: a hidden alive session does not keep an unpinned folder visible", () => {
    mount({ sessions: [mk({ cwd: "/a", status: "active", hidden: true }), mk({ cwd: "/b", status: "active" })] });
    expect(folderShown("/a")).toBe(false);
    expect(folderShown("/b")).toBe(true);
  });
});
