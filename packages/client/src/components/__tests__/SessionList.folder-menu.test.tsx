/**
 * Host-side folder actions menu composition: the items `SessionList` itself
 * contributes once the slot pills went state-only — the `OPEN` group's two
 * slot-qualified OpenSpec navigations, the ONE plain refresh that fans out over
 * registered refreshers plus the host's own OpenSpec refresher, and the single
 * home the Pi Resources surface keeps.
 *
 * Scenarios: test-plan #E4, #E9, #E12, #E13, #E21.
 * See change: move-slot-actions-to-menu.
 */

import { createFolderMenuStore, FolderMenuProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const CWD = "/home/user/project";

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
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(cleanup);

const session: DashboardSession = {
  id: "s1",
  cwd: CWD,
  source: "tui",
  status: "active",
  startedAt: Date.now() - 60_000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
};

const openspec: OpenSpecData = { initialized: true, changes: [] };

function renderList(props: Partial<React.ComponentProps<typeof SessionList>> = {}, menuStore = createFolderMenuStore()) {
  const { hook } = memoryLocation({ path: "/", static: true });
  render(
    <Router hook={hook}>
      <ThemeProvider>
        <FolderMenuProvider store={menuStore}>
          <SessionList sessions={[session]} onSelect={() => {}} {...props} />
        </FolderMenuProvider>
      </ThemeProvider>
    </Router>,
  );
  return menuStore;
}

function openMenu() {
  fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
}

function itemIds(): string[] {
  const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
  return Array.from(panel.querySelectorAll("[data-testid^='folder-menu-item-']")).map((n) =>
    n.getAttribute("data-testid")!.replace("folder-menu-item-", ""),
  );
}

describe("OPEN group (test-plan #E4, #E12)", () => {
  it("holds slot-qualified OpenSpec archive and specs items", () => {
    renderList({
      openspecMap: new Map([[CWD, openspec]]),
      onOpenSpecs: vi.fn(),
      onOpenArchive: vi.fn(),
    });
    openMenu();
    const group = screen.getByTestId("folder-menu-group-open");
    const labels = Array.from(group.querySelectorAll("[role='menuitem']")).map((n) => n.textContent ?? "");
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label).toContain("OpenSpec");
    expect(itemIds()).toContain("openspec-archive");
    expect(itemIds()).toContain("openspec-specs");
  });

  it("activating them routes to the same destinations the pill buttons used", () => {
    const onOpenSpecs = vi.fn();
    const onOpenArchive = vi.fn();
    renderList({ openspecMap: new Map([[CWD, openspec]]), onOpenSpecs, onOpenArchive });
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-openspec-archive"));
    expect(onOpenArchive).toHaveBeenCalledWith(CWD);
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-openspec-specs"));
    expect(onOpenSpecs).toHaveBeenCalledWith(CWD);
  });

  it("renders no OPEN group for a folder without OpenSpec", () => {
    renderList({ onOpenSpecs: vi.fn(), onOpenArchive: vi.fn() });
    openMenu();
    expect(screen.queryByTestId("folder-menu-group-open")).toBeNull();
  });
});

describe("the single folder refresh (test-plan #E9, #E21)", () => {
  it("E9: exactly one plain refresh item renders", () => {
    renderList({ openspecMap: new Map([[CWD, openspec]]), onOpenSpecRefresh: vi.fn() });
    openMenu();
    expect(itemIds().filter((id) => id === "refresh-folder")).toHaveLength(1);
    // The pre-change per-slot refreshes are gone from the card entirely.
    expect(screen.queryByTestId("folder-openspec-refresh")).toBeNull();
  });

  it("E21: activating it runs every registered refresher AND the host OpenSpec refresher", () => {
    const onOpenSpecRefresh = vi.fn();
    const automations = vi.fn();
    const goals = vi.fn();
    const store = createFolderMenuStore();
    store.registerRefresher(CWD, automations);
    store.registerRefresher(CWD, goals);
    renderList({ openspecMap: new Map([[CWD, openspec]]), onOpenSpecRefresh }, store);
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-refresh-folder"));
    expect(automations).toHaveBeenCalledTimes(1);
    expect(goals).toHaveBeenCalledTimes(1);
    expect(onOpenSpecRefresh).toHaveBeenCalledWith(CWD);
  });

  it("a refresher registered for ANOTHER folder is not reached", () => {
    const other = vi.fn();
    const store = createFolderMenuStore();
    store.registerRefresher("/some/other/folder", other);
    renderList({ onOpenSpecRefresh: vi.fn() }, store);
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-refresh-folder"));
    expect(other).not.toHaveBeenCalled();
  });
});

describe("Pi Resources keeps exactly one home (test-plan #E13)", () => {
  it("routes from the DIRECTORY group's Directory Settings item and nowhere else", () => {
    const onOpenDirectorySettings = vi.fn();
    renderList({
      openspecMap: new Map([[CWD, openspec]]),
      onOpenSpecs: vi.fn(),
      onOpenArchive: vi.fn(),
      onOpenDirectorySettings,
    });
    openMenu();
    const settings = screen.getByTestId("folder-menu-item-directory-settings");
    expect(
      screen.getByTestId("folder-menu-group-directory").contains(settings),
      "Directory Settings lives in the DIRECTORY group",
    ).toBe(true);
    // No duplicate destination in OPEN.
    const openGroup = screen.getByTestId("folder-menu-group-open");
    expect(openGroup.contains(settings)).toBe(false);
    expect(itemIds().filter((id) => id === "directory-settings")).toHaveLength(1);

    fireEvent.click(settings);
    expect(onOpenDirectorySettings).toHaveBeenCalledWith(CWD);
  });
});

/**
 * fix-connect-snapshot-frame-loss D9 UI: stub groups from `endedTotals`, the
 * expander label, the "more" affordance, and per-group page in-flight with a
 * 15 s timeout. Scenarios: test-plan E36, X6 (+ the spec's no-paging-when-held
 * and one-request-at-a-time scenarios).
 */
describe("stub groups + ended paging (fix-connect-snapshot-frame-loss)", () => {
  it("E36: a cwd with endedTotals and no held session renders a stub group inside its workspace", () => {
    renderList({
      sessions: [],
      endedTotalsMap: new Map([["/old", 3]]),
      workspaces: [{ id: "w1", name: "Work", collapsed: false, folders: ["/old"] }],
      // An entry in the map must NOT surface a section on a stub group.
      openspecMap: new Map([["/old", openspec]]),
    });
    const header = screen.getByTestId("folder-header-name-/old");
    // The folder is a DOM descendant of the workspace CONTAINER (a sibling of
    // the workspace header element, so containment is asserted against it).
    expect(screen.getByTestId("sortable-workspace").contains(header)).toBe(true);
    expect(screen.getByTestId("workspace-name-w1").textContent).toContain("Work");

    const expander = screen.getByTestId("folder-ended-toggle-/old");
    expect(expander.textContent).toContain("3");

    // Stub = header + ended expander only: no cards, no Create tray / spawn
    // buttons, no OPENSPEC/KB/GIT sections.
    expect(document.querySelector("[data-session-id]")).toBeNull();
    expect(screen.queryByTestId("folder-body-/old")).toBeNull();
    expect(screen.queryByTestId("folder-spawn-session-btn")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-refresh")).toBeNull();
  });

  it("E36: an unpinned stub group renders and sorts last in recency mode", () => {
    renderList({
      sessions: [session], // live session under CWD
      endedTotalsMap: new Map([["/old", 3]]),
    });
    const headers = Array.from(document.querySelectorAll('[data-testid^="folder-header-name-"]'));
    expect(headers.map((h) => h.getAttribute("data-testid"))).toEqual([
      `folder-header-name-${CWD}`,
      "folder-header-name-/old",
    ]);
  });

  it("expanding a stub group requests its first page at offset 0", () => {
    const onSessionsPage = vi.fn();
    renderList({
      sessions: [],
      endedTotalsMap: new Map([["/old", 5]]),
      pagedCount: new Map(),
      onSessionsPage,
    });
    fireEvent.click(screen.getByTestId("folder-ended-toggle-/old"));
    expect(onSessionsPage).toHaveBeenCalledTimes(1);
    expect(onSessionsPage).toHaveBeenCalledWith("/old", 0);
  });

  it("does not page when every ended session is already held", () => {
    const onSessionsPage = vi.fn();
    const ended = { ...session, id: "e1", status: "ended" as const, cwd: "/done" };
    renderList({
      sessions: [ended],
      endedTotalsMap: new Map([["/done", 1]]),
      onSessionsPage,
    });
    fireEvent.click(screen.getByTestId("folder-ended-toggle-/done"));
    expect(onSessionsPage).not.toHaveBeenCalled();
  });

  it("X6: a lost sessions_page reply is retried with the same offset after the 15 s in-flight timeout", () => {
    vi.useFakeTimers();
    try {
      const onSessionsPage = vi.fn();
      renderList({
        sessions: [],
        endedTotalsMap: new Map([["/old", 5]]),
        pagedCount: new Map(),
        onSessionsPage,
        connected: true,
      });
      fireEvent.click(screen.getByTestId("folder-ended-toggle-/old"));
      expect(onSessionsPage).toHaveBeenCalledTimes(1);
      expect(onSessionsPage).toHaveBeenCalledWith("/old", 0);

      // Still in flight (reply not yet arrived) — a further expand must not
      // send a second sessions_page for the same cwd.
      fireEvent.click(screen.getByTestId("folder-ended-more-/old"));
      expect(onSessionsPage).toHaveBeenCalledTimes(1);

      // Reply lost; after 15 s the mark clears and "more" retries with the
      // same offset (pagedCount unchanged).
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      fireEvent.click(screen.getByTestId("folder-ended-more-/old"));
      expect(onSessionsPage).toHaveBeenCalledTimes(2);
      expect(onSessionsPage).toHaveBeenLastCalledWith("/old", 0);
    } finally {
      vi.useRealTimers();
    }
  });
});
