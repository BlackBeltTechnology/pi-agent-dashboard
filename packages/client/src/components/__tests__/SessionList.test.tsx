import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { groupSessionsByDirectory, SessionList } from "../session/SessionList.js";
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
  it("hides the spawn button while collapsed; expanding reveals it and spawns", () => {
    // Seed the folder as collapsed. Variant B (condense-collapsed-folder-header)
    // hides the elevated spawn buttons (and all heavy slots) when collapsed —
    // the header keeps only name + status. Expanding restores them.
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
    // Starts collapsed: spawn button hidden along with the other slots.
    expect(container.querySelector(".group-collapse.collapsed")).toBeTruthy();
    expect(screen.queryByTestId("folder-spawn-session-btn")).toBeNull();
    // Expand via the header toggle.
    fireEvent.click(screen.getByTestId("folder-toggle-btn"));
    expect(container.querySelector(".group-collapse.expanded")).toBeTruthy();
    // Now visible — clicking it spawns.
    fireEvent.click(screen.getByTestId("folder-spawn-session-btn"));
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

  it("filter bar no longer renders the folder pin chip", () => {
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
    expect(screen.queryByTestId("pin-dir-dialog-btn")).toBeNull();
  });
});

describe("SessionList dashboard add buttons", () => {
  it("renders the Add Folder button as first list item and calls onOpenPinDialog", () => {
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
    const addBtn = screen.getByTestId("dashboard-add-folder-btn");
    fireEvent.click(addBtn);
    expect(onOpenPinDialog).toHaveBeenCalledTimes(1);
    // PinDirectoryDialog heading "Pin Directory" should NOT be rendered by SessionList
    expect(screen.queryByText("Pin Directory")).toBeNull();
  });

  it("renders New Workspace button when onCreateWorkspace is provided", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            onOpenPinDialog={() => {}}
            onCreateWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const newWsBtn = screen.getByTestId("dashboard-new-workspace-btn");
    fireEvent.click(newWsBtn);
    // Opens the new-workspace dialog flow.
    expect(screen.getByTestId("new-workspace-input")).toBeTruthy();
  });

  it("hides New Workspace button when onCreateWorkspace is absent", () => {
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
    expect(screen.queryByTestId("dashboard-new-workspace-btn")).toBeNull();
    expect(screen.getByTestId("dashboard-add-folder-btn")).toBeTruthy();
  });

  it("no longer renders the dashed + New workspace… list button", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            onOpenPinDialog={() => {}}
            onCreateWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.queryByTestId("new-workspace-btn")).toBeNull();
  });
});

describe("SessionList workspace-scope Add Folder", () => {
  const expandedWs = { id: "ws1", name: "WS One", collapsed: false, folders: [] as string[] };

  it("renders the Add Folder button in an expanded workspace and opens the picker", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            workspaces={[expandedWs]}
            onAddFolderToWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const addBtn = screen.getByTestId("workspace-add-folder-btn-ws1");
    fireEvent.click(addBtn);
    // Opens the workspace-scoped folder picker (PinDirectoryDialog).
    expect(screen.getByText("Pin Directory")).toBeTruthy();
  });

  it("hides the workspace Add Folder button when collapsed", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            workspaces={[{ ...expandedWs, collapsed: true }]}
            onAddFolderToWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.queryByTestId("workspace-add-folder-btn-ws1")).toBeNull();
  });

  it("no longer renders the mdiPin add-folder icon in the workspace header", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onPinDirectory={() => {}}
            workspaces={[expandedWs]}
            onAddFolderToWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(screen.queryByTestId("workspace-add-folder-ws1")).toBeNull();
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

// F2 — the pinned-row "open" affordance navigates to the folder home without
// toggling collapse. See change: add-directory-home-page (D3).
describe("SessionList folder-home open affordance", () => {
  function LocationProbe() {
    const [loc] = useLocation();
    return <span data-testid="loc">{loc}</span>;
  }

  function renderPinned() {
    const cwd = "/home/user/project";
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <LocationProbe />
          <SessionList
            sessions={[makeSession({ cwd })]}
            onSelect={() => {}}
            pinnedDirectories={[cwd]}
            onUnpinDirectory={() => {}}
            onSpawnSession={() => {}}
          />
        </ThemeProvider>
      </Router>,
    );
    return { cwd };
  }

  it("renders the open affordance on a pinned row", () => {
    const { cwd } = renderPinned();
    expect(screen.getByTestId(`folder-open-home-${cwd}`)).toBeTruthy();
  });

  it("navigates to /folder/<enc> and leaves the folder expanded (collapse not toggled)", () => {
    const { cwd } = renderPinned();
    // Expanded row shows the spawn/action bar; collapsing would hide it.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-open-home-${cwd}`));
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(cwd)}`);
    // stopPropagation kept the collapse toggle from firing: still expanded.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });

  // directory-card-clickable-select: the whole header row is clickable to open
  // the directory home (like clicking a session card selects its session).
  // Collapse moved solely to the chevron, so the row navigates AND stays
  // expanded.
  it("clicking the whole header row navigates to the folder home without collapsing", () => {
    const { cwd } = renderPinned();
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-home-row-${cwd}`));
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(cwd)}`);
    // Row navigates but does not collapse: the chevron owns collapse now.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });
});

// enable-workspace-folder-home-page — the open affordance now renders on
// workspace-folder rows too (condition `isPinned || inWorkspace`). An UNPINNED
// workspace folder has `folder.pinned === false`, so the affordance must show
// via `inWorkspace`. Scenario ids per that change's test-plan.md.
describe("SessionList workspace-folder open affordance (enable-workspace-folder-home-page)", () => {
  function LocationProbe() {
    const [loc] = useLocation();
    return <span data-testid="loc">{loc}</span>;
  }

  // Renders an UNPINNED folder inside a workspace container. The folder is NOT
  // in pinnedDirectories, so `renderGroup(folder, folder.pinned=false, true)`.
  function renderWorkspaceFolder() {
    const cwd = "/home/user/ws-folder";
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <LocationProbe />
          <SessionList
            sessions={[makeSession({ cwd })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            workspaces={[{ id: "w1", name: "WS", collapsed: false, folders: [cwd] }]}
          />
        </ThemeProvider>
      </Router>,
    );
    return { cwd };
  }

  it("F3: an unpinned workspace-folder row shows the open affordance", () => {
    const { cwd } = renderWorkspaceFolder();
    expect(screen.getByTestId(`folder-open-home-${cwd}`)).toBeTruthy();
  });

  it("F4: activating the affordance navigates to /folder/<enc> without toggling collapse", () => {
    const { cwd } = renderWorkspaceFolder();
    // Expanded row shows the spawn/action bar; collapsing would hide it.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-open-home-${cwd}`));
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(cwd)}`);
    // stopPropagation kept the collapse toggle from firing: still expanded.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });

  it("F5 (regression): a pinned non-workspace row still shows the affordance and navigates", () => {
    const cwd = "/home/user/pinned-only";
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <LocationProbe />
          <SessionList
            sessions={[makeSession({ cwd })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={[cwd]}
            onUnpinDirectory={() => {}}
          />
        </ThemeProvider>
      </Router>,
    );
    expect(screen.getByTestId(`folder-open-home-${cwd}`)).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-open-home-${cwd}`));
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(cwd)}`);
  });
});
