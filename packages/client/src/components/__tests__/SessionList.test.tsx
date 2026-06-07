import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList, groupSessionsByDirectory } from "../SessionList.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
  // Mock localStorage for session-filter-storage
  const store: Record<string, string> = {};
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

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "test-session-1",
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

describe("SessionList spawn button", () => {
  it("should render spawn button on folder card when onSpawnSession is provided", () => {
    const onSpawn = vi.fn();
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={onSpawn}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const btn = screen.getByTestId("folder-spawn-session-btn");
    expect(btn).toBeTruthy();
  });

  it("renders spawn button even when onSpawnSession is not provided (no-op click)", () => {
    // FolderActionBar always renders the Session button; when the parent
    // doesn't supply onSpawnSession, clicking it is a no-op (onSpawnSession?.()
    // in SessionList). This is the current stable behavior.
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });

  it("should call onSpawnSession with cwd when clicked", () => {
    const onSpawn = vi.fn();
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/my/project" })]}
            onSelect={() => {}}
            onSpawnSession={onSpawn}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const btn = screen.getByTestId("folder-spawn-session-btn");
    fireEvent.click(btn);
    expect(onSpawn).toHaveBeenCalledWith("/my/project");
  });
});

describe("SessionList elevated spawn buttons", () => {
  it("expands a collapsed folder then spawns when +New Session is clicked", () => {
    // Seed the folder as collapsed.
    localStorage.setItem("dashboard:collapsedGroups", JSON.stringify(["/my/project"]));
    const onSpawn = vi.fn();
    const { container } = render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/my/project" })]}
            onSelect={() => {}}
            onSpawnSession={onSpawn}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    // Starts collapsed.
    expect(container.querySelector(".group-collapse.collapsed")).toBeTruthy();
    fireEvent.click(screen.getByTestId("folder-spawn-session-btn"));
    // Folder expanded, then spawn fired.
    expect(container.querySelector(".group-collapse.expanded")).toBeTruthy();
    expect(onSpawn).toHaveBeenCalledWith("/my/project");
  });

  it("renders spawn buttons for a pinned folder with 0 sessions", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={["/empty/folder"]}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });
});

describe("SessionList placeholder spawn card", () => {
  it("should render placeholder card when cwd is in spawningCwds", () => {
    const spawningCwds = new Set(["/home/user/project"]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.getByTestId("placeholder-session-card")).toBeTruthy();
  });

  it("should not render placeholder card when cwd is not in spawningCwds", () => {
    const spawningCwds = new Set(["/other/project"]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.queryByTestId("placeholder-session-card")).toBeNull();
  });

  it("should disable New button when cwd is in spawningCwds", () => {
    const spawningCwds = new Set(["/home/user/project"]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const btn = screen.getByTestId("folder-spawn-session-btn");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("should not disable New button when cwd is not spawning", () => {
    const spawningCwds = new Set<string>();
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const btn = screen.getByTestId("folder-spawn-session-btn");
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  // Worktree spawn: placeholder keyed on the PARENT repo cwd (the group the
  // worktree session collapses into via gitWorktree.mainPath), NOT the
  // worktree path. See change: add-worktree-spawn-placeholder-card.
  it("renders the worktree placeholder under the PARENT repo group, not a worktree-path group", () => {
    // One session living in a worktree but grouping under /repo via
    // gitWorktree.mainPath. spawningCwds carries the PARENT cwd.
    const session = makeSession({
      id: "wt-sess",
      cwd: "/repo/.worktrees/feat-x",
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    } as Partial<DashboardSession>);
    const spawningCwds = new Set(["/repo"]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[session]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    // Exactly one placeholder, rendered in the single /repo group.
    expect(screen.getAllByTestId("placeholder-session-card").length).toBe(1);
    // The worktree path produced no standalone group/placeholder: there is
    // only one spawn button (the parent group's) and it is disabled.
    const btns = screen.getAllByTestId("folder-spawn-session-btn");
    expect(btns.length).toBe(1);
    expect(btns[0].hasAttribute("disabled")).toBe(true);
  });

  it("does NOT render a placeholder when only the worktree path (not parent) is in spawningCwds", () => {
    const session = makeSession({
      id: "wt-sess",
      cwd: "/repo/.worktrees/feat-x",
      gitWorktree: { mainPath: "/repo", name: "feat-x" },
    } as Partial<DashboardSession>);
    // The worktree path is homeless: no group has cwd === worktree path.
    const spawningCwds = new Set(["/repo/.worktrees/feat-x"]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[session]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            spawningCwds={spawningCwds}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.queryByTestId("placeholder-session-card")).toBeNull();
  });
});

describe("SessionList header layout", () => {
  it("renders two header rows: app-bar and filter-bar", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.getByTestId("header-app-bar")).toBeTruthy();
    expect(screen.getByTestId("header-filter-bar")).toBeTruthy();
  });

  it("places settings gear in app-bar row", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const appBar = screen.getByTestId("header-app-bar");
    const settingsBtn = screen.getByTestId("settings-btn");
    expect(appBar.contains(settingsBtn)).toBe(true);
  });

  it("places theme controls in app-bar row", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const appBar = screen.getByTestId("header-app-bar");
    const themePicker = appBar.querySelector('[data-testid="theme-picker"]');
    const themeToggle = appBar.querySelector('[data-testid="theme-toggle"]');
    expect(themePicker).toBeTruthy();
    expect(themeToggle).toBeTruthy();
  });

  it("places pin button in filter-bar row", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            onOpenPinDialog={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const filterBar = screen.getByTestId("header-filter-bar");
    const pinBtn = screen.getByTestId("pin-dir-dialog-btn");
    expect(filterBar.contains(pinBtn)).toBe(true);
  });

  it("Add folder button calls onOpenPinDialog and does not mount PinDirectoryDialog internally", () => {
    const onOpenPinDialog = vi.fn();
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            onOpenPinDialog={onOpenPinDialog}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const pinBtn = screen.getByTestId("pin-dir-dialog-btn");
    fireEvent.click(pinBtn);
    expect(onOpenPinDialog).toHaveBeenCalledTimes(1);
    // PinDirectoryDialog heading "Pin Directory" should NOT be rendered by SessionList
    expect(screen.queryByText("Pin Directory")).toBeNull();
  });
});

describe("groupSessionsByDirectory", () => {
  it("groups sessions by cwd into unpinned when no pinned dirs", () => {
    const sessions = [
      makeSession({ id: "s1", cwd: "/a", startedAt: 100 }),
      makeSession({ id: "s2", cwd: "/b", startedAt: 200 }),
    ];
    const { pinned, unpinned } = groupSessionsByDirectory(sessions);
    expect(pinned).toHaveLength(0);
    expect(unpinned).toHaveLength(2);
    // Sorted by recency descending
    expect(unpinned[0].cwd).toBe("/b");
    expect(unpinned[1].cwd).toBe("/a");
  });

  it("puts pinned directories first in pinned order", () => {
    const sessions = [
      makeSession({ id: "s1", cwd: "/a", startedAt: 300 }),
      makeSession({ id: "s2", cwd: "/b", startedAt: 200 }),
      makeSession({ id: "s3", cwd: "/c", startedAt: 100 }),
    ];
    const { pinned, unpinned } = groupSessionsByDirectory(sessions, undefined, ["/c", "/a"]);
    expect(pinned).toHaveLength(2);
    expect(pinned[0].cwd).toBe("/c");
    expect(pinned[0].pinned).toBe(true);
    expect(pinned[1].cwd).toBe("/a");
    expect(pinned[1].pinned).toBe(true);
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0].cwd).toBe("/b");
    expect(unpinned[0].pinned).toBe(false);
  });

  it("includes pinned directories with zero sessions", () => {
    const sessions = [
      makeSession({ id: "s1", cwd: "/a", startedAt: 100 }),
    ];
    const { pinned } = groupSessionsByDirectory(sessions, undefined, ["/empty-dir", "/a"]);
    expect(pinned).toHaveLength(2);
    expect(pinned[0].cwd).toBe("/empty-dir");
    expect(pinned[0].sessions).toHaveLength(0);
    expect(pinned[1].cwd).toBe("/a");
    expect(pinned[1].sessions).toHaveLength(1);
  });

  it("unpinned groups are sorted by most recent session activity", () => {
    const sessions = [
      makeSession({ id: "s1", cwd: "/old", startedAt: 100 }),
      makeSession({ id: "s2", cwd: "/new", startedAt: 300 }),
      makeSession({ id: "s3", cwd: "/mid", startedAt: 200 }),
    ];
    const { unpinned } = groupSessionsByDirectory(sessions);
    expect(unpinned.map((g) => g.cwd)).toEqual(["/new", "/mid", "/old"]);
  });
});
