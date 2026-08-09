import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { groupSessionsByDirectory, SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { AddToWorkspaceMenu } from "../workspace/AddToWorkspaceMenu.js";

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
    // Starts collapsed: the enclosed folder body (Create tray + sessions) is
    // not rendered at all, so the spawn button is absent (change: folder-card-enclosure).
    expect(container.querySelector('[data-testid="folder-body-/my/project"]')).toBeNull();
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

  it("encloses the Create tray inside the folder body (change: folder-card-enclosure)", () => {
    const { container } = render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/my/project" })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const body = container.querySelector('[data-testid="folder-body-/my/project"]');
    expect(body).toBeTruthy();
    // The Create tray spawn button is a descendant of the enclosed folder body,
    // not a detached sibling below the card.
    expect(body?.querySelector('[data-testid="folder-spawn-session-btn"]')).toBeTruthy();
  });

  it("tints a top-level folder but not a workspace-grouped one (change: folder-card-enclosure)", () => {
    const { container } = render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/root/proj" })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={["/root/proj"]}
            workspaces={[{ id: "ws1", name: "WS", folders: ["/ws/proj"], collapsed: false }]}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    // Top-level (non-workspace) folder body carries the accent-tinted inline
    // background (color-mix on --accent-blue); a workspace folder does not.
    const rootBody = container.querySelector('[data-testid="folder-body-/root/proj"]') as HTMLElement | null;
    expect(rootBody).toBeTruthy();
    expect(rootBody?.getAttribute("style") ?? "").toContain("--accent-blue");
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

describe("SessionList add-to-workspace affordance", () => {
  it("renders a labelled Workspace pill (not the cryptic +ws) on a top-level folder", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/root/proj" })]}
            onSelect={() => {}}
            workspaces={[{ id: "ws1", name: "WS", folders: [], collapsed: false }]}
            onAddFolderToWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    // Now hosted inside the folder actions menu. See change: add-folder-actions-menu.
    fireEvent.click(screen.getByTestId("folder-actions-menu-/root/proj"));
    const btn = screen.getByTestId("add-to-workspace-btn-/root/proj");
    expect(btn.textContent).toContain("Workspace");
    expect(btn.textContent).not.toContain("+ws");
  });

  it("opens the AddToWorkspaceMenu on click", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/root/proj" })]}
            onSelect={() => {}}
            workspaces={[{ id: "ws1", name: "WS", folders: [], collapsed: false }]}
            onAddFolderToWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    fireEvent.click(screen.getByTestId("folder-actions-menu-/root/proj"));
    fireEvent.click(screen.getByTestId("add-to-workspace-btn-/root/proj"));
    // The menu surfaces the "+ New workspace…" entry.
    expect(screen.getByText("+ New workspace…")).toBeTruthy();
  });

  it("hides the add-to-workspace button when no workspace exists and no create handler", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: "/root/proj" })]}
            onSelect={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    fireEvent.click(screen.getByTestId("folder-actions-menu-/root/proj"));
    expect(screen.queryByTestId("add-to-workspace-btn-/root/proj")).toBeNull();
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
    // Opens the multi-select Add Folders dialog with THIS workspace preselected
    // as the destination. See change: redesign-folder-workspace-add-flow.
    expect(screen.getByTestId("add-folders-dialog")).toBeTruthy();
    expect(screen.getByTestId("add-folders-dest-ws1").getAttribute("aria-checked")).toBe("true");
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

// F2 — the folder header ROW navigates to the folder home without toggling
// collapse. See change: add-directory-home-page (D3); migrated off the deleted
// `folder-open-home-<cwd>` icon by change: add-folder-actions-menu (D3).
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

  it("renders NO dedicated open icon on a pinned row (the row itself is the affordance)", () => {
    const { cwd } = renderPinned();
    expect(screen.queryByTestId(`folder-open-home-${cwd}`)).toBeNull();
    expect(screen.getByTestId(`folder-home-row-${cwd}`)).toBeTruthy();
  });

  it("navigates to /folder/<enc> and leaves the folder expanded (collapse not toggled)", () => {
    const { cwd } = renderPinned();
    // Expanded row shows the spawn/action bar; collapsing would hide it.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-home-row-${cwd}`));
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

// enable-workspace-folder-home-page — the open affordance renders on
// workspace-folder rows too. The dedicated icon is deleted by change
// add-folder-actions-menu (D3); the header ROW carries the gesture for every
// row shape, so these cases now drive `folder-home-row-<cwd>`.
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
    expect(screen.getByTestId(`folder-home-row-${cwd}`)).toBeTruthy();
    expect(screen.queryByTestId(`folder-open-home-${cwd}`)).toBeNull();
  });

  it("F4: activating the affordance navigates to /folder/<enc> without toggling collapse", () => {
    const { cwd } = renderWorkspaceFolder();
    // Expanded row shows the spawn/action bar; collapsing would hide it.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`folder-home-row-${cwd}`));
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
    expect(screen.queryByTestId(`folder-open-home-${cwd}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`folder-home-row-${cwd}`));
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(cwd)}`);
  });
});

// redesign-folder-workspace-add-flow — the `+ws` text token becomes a real
// affordance living INSIDE the header icon cluster (order: sort · add-to ·
// home · pin). PRESENTATION is add-to-workspace-affordance's labelled
// `mdiViewGridPlus` + "Workspace" pill (which superseded this change's
// icon-plus-caret while it was still unmerged); the SCOPE-keyed popover state
// and the a11y contract asserted below remain this change's.
describe("SessionList add-to-workspace button", () => {
  const CWD = "/home/user/project";

  function renderList(extra: Partial<React.ComponentProps<typeof SessionList>> = {}) {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: CWD })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={[CWD]}
            onUnpinDirectory={() => {}}
            onCreateWorkspace={() => {}}
            {...extra}
          />
        </ThemeProvider>
      </TestRouter>,
    );
  }

  /** The affordance now lives inside the folder actions menu. See change: add-folder-actions-menu. */
  function openMenu() {
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
  }

  it("renders a labelled pill whose accessible name carries the add-to-workspace verb", () => {
    renderList();
    openMenu();
    const btn = screen.getByTestId(`add-to-workspace-btn-${CWD}`);
    // The visible label is the noun ("Workspace", per add-to-workspace-affordance);
    // the accessible name still carries the full verb, so the two do not collapse.
    expect(btn.getAttribute("aria-label")).toMatch(/add to workspace/i);
    expect(btn.getAttribute("title")).toMatch(/add to workspace/i);
    expect(btn.textContent).toMatch(/workspace/i);
    // Glyph + label, never a bare text token.
    expect(btn.querySelectorAll("svg path").length).toBeGreaterThanOrEqual(1);
  });

  it("exposes aria-haspopup and reflects popover state in aria-expanded", () => {
    renderList();
    openMenu();
    const btn = screen.getByTestId(`add-to-workspace-btn-${CWD}`);
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(screen.getByTestId(`add-to-workspace-btn-${CWD}`).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("add-to-workspace-menu")).toBeTruthy();
  });

  it("renders no element with the literal text `+ws`", () => {
    const { container } = render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ cwd: CWD })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={[CWD]}
            onCreateWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    expect(container.textContent).not.toContain("+ws");
  });

  it("the popover offers no pin destination", () => {
    renderList();
    openMenu();
    fireEvent.click(screen.getByTestId(`add-to-workspace-btn-${CWD}`));
    const menu = screen.getByTestId("add-to-workspace-menu");
    expect(menu.textContent).not.toMatch(/pin to dashboard/i);
  });

  // E1 (migrated) — the cluster used to be exactly
  // `[folder-urgency-sort, add-to-workspace-btn, folder-open-home, unpin-dir-btn]`.
  // add-folder-actions-menu collapses all four into ONE trigger.
  it("the header action cluster is exactly the folder actions menu trigger", () => {
    renderList();
    const cluster = screen.getByTestId(`folder-header-cluster-${CWD}`);
    const ids = Array.from(cluster.querySelectorAll("button[data-testid]")).map((b) =>
      b.getAttribute("data-testid"),
    );
    expect(ids).toEqual([`folder-actions-menu-${CWD}`]);
  });

  // The open menu is absolutely positioned inside the folder header card; any
  // ancestor carrying `overflow-hidden` clips it to the card bounds.
  it("no ancestor of the open menu panel clips it with overflow-hidden", () => {
    renderList();
    openMenu();
    const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
    const clipping: string[] = [];
    for (let n = panel.parentElement; n && n !== document.body; n = n.parentElement) {
      if (/\boverflow-hidden\b/.test(n.className)) clipping.push(n.className);
    }
    expect(clipping).toEqual([]);
  });

  it("the cluster never wraps and the parent path yields before the folder name", () => {
    renderList();
    const cluster = screen.getByTestId(`folder-header-cluster-${CWD}`);
    // flex:none + white-space:nowrap — the cluster absorbs no squeeze.
    expect(cluster.className).toMatch(/\bflex-none\b/);
    expect(cluster.className).toMatch(/\bwhitespace-nowrap\b/);
    // The name region is the shrinkable one.
    const name = screen.getByTestId(`folder-header-name-${CWD}`);
    expect(name.className).toMatch(/\bmin-w-0\b/);
    // Parent path may collapse entirely; the leaf keeps a legible floor.
    const parent = screen.getByTestId(`folder-header-parent-${CWD}`);
    const leaf = screen.getByTestId(`folder-header-leaf-${CWD}`);
    expect(parent.className).toMatch(/min-w-0/);
    expect(leaf.className).toMatch(/min-w-\[6ch\]/);
  });
});

// redesign-folder-workspace-add-flow — the same glyph appears on the session
// card header cluster, targeting the session's own cwd, so one learned symbol
// works in both scopes (mockups/add-flow.html, "Session card — same button").
describe("SessionCard add-to-workspace icon button", () => {
  const CWD = "/home/user/project";

  function renderList() {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ id: "s1", cwd: CWD })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            pinnedDirectories={[CWD]}
            onUnpinDirectory={() => {}}
            onCreateWorkspace={() => {}}
          />
        </ThemeProvider>
      </TestRouter>,
    );
  }

  // F10 (migrated) — workspace membership is directory-scoped, so the affordance
  // left the session card entirely. See change: add-folder-actions-menu (D1).
  it("renders NO add-to-workspace control on the session card", () => {
    renderList();
    expect(screen.queryByTestId("session-card-add-to-workspace-s1")).toBeNull();
  });

  it("the folder actions menu is the only place the affordance lives", () => {
    renderList();
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    expect(screen.getAllByTestId(`add-to-workspace-btn-${CWD}`)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// add-folder-actions-menu — the header's trailing cluster collapses to ONE
// trigger; every header-row mutation moves into a grouped popover.
// Scenarios E1-E7, E10-E15, X3 from openspec/changes/add-folder-actions-menu/test-plan.md.
// ─────────────────────────────────────────────────────────────────────────────
describe("SessionList folder actions menu", () => {
  const CWD = "/home/user/project";

  function LocationProbe() {
    const [loc] = useLocation();
    return <span data-testid="loc">{loc}</span>;
  }

  function renderList(extra: Partial<React.ComponentProps<typeof SessionList>> = {}, path = "/") {
    const { hook } = memoryLocation({ path });
    const utils = render(
      <Router hook={hook}>
        <ThemeProvider>
          <LocationProbe />
          <SessionList
            sessions={[makeSession({ id: "s1", cwd: CWD })]}
            onSelect={() => {}}
            onSpawnSession={() => {}}
            {...extra}
          />
        </ThemeProvider>
      </Router>,
    );
    return utils;
  }

  function openMenu(cwd = CWD) {
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${cwd}`));
    return screen.getByTestId(`folder-actions-menu-panel-${cwd}`);
  }

  // E1 — the cluster collapses to a single control.
  it("E1: the trailing cluster holds exactly one control and none of the old buttons", () => {
    renderList({ pinnedDirectories: [CWD], onUnpinDirectory: () => {}, onCreateWorkspace: () => {} });
    const cluster = screen.getByTestId(`folder-header-cluster-${CWD}`);
    expect(cluster.children).toHaveLength(1);
    expect(screen.getByTestId(`folder-actions-menu-${CWD}`)).toBeTruthy();
    for (const id of [
      `folder-urgency-sort-${CWD}`,
      `add-to-workspace-btn-${CWD}`,
      `folder-open-home-${CWD}`,
      "unpin-dir-btn",
      "pin-dir-btn",
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  // E2 — top-level folder outside a workspace.
  it("E2: workspace group carries add-to-workspace; directory group carries pin, sort, settings", () => {
    renderList({
      onPinDirectory: () => {},
      onOpenDirectorySettings: () => {},
      workspaces: [{ id: "w1", name: "WS", collapsed: false, folders: [] }],
    });
    const panel = openMenu();
    expect(panel.querySelector("[data-testid='folder-menu-group-workspace']")).toBeTruthy();
    expect(screen.getByTestId(`add-to-workspace-btn-${CWD}`)).toBeTruthy();
    expect(screen.getByTestId("folder-menu-item-pin")).toBeTruthy();
    expect(screen.getByTestId("folder-menu-item-urgency-sort")).toBeTruthy();
    expect(screen.getByTestId("folder-menu-item-directory-settings")).toBeTruthy();
    expect(screen.queryByTestId("folder-menu-item-remove-from-workspace")).toBeNull();
  });

  // E3 — workspace-owned folder omits what does not apply.
  it("E3: a workspace-owned folder gets remove-from-workspace, no add-to-workspace, no pin", () => {
    renderList({
      onPinDirectory: () => {},
      onOpenDirectorySettings: () => {},
      onRemoveFolderFromWorkspace: () => {},
      workspaces: [{ id: "w1", name: "WS", collapsed: false, folders: [CWD] }],
    });
    openMenu();
    expect(screen.getByTestId("folder-menu-item-remove-from-workspace")).toBeTruthy();
    expect(screen.queryByTestId(`add-to-workspace-btn-${CWD}`)).toBeNull();
    expect(screen.queryByTestId("folder-menu-item-pin")).toBeNull();
  });

  // E4 — a group with no applicable item does not render its heading.
  it("E4: the workspace group heading is absent when no workspace item applies", () => {
    renderList({ workspaces: [], onOpenDirectorySettings: () => {} });
    const panel = openMenu();
    expect(panel.querySelector("[data-testid='folder-menu-group-workspace']")).toBeNull();
    expect(panel.querySelector("[data-testid='folder-menu-group-directory']")).toBeTruthy();
  });

  // E5 — gating is unchanged: a create handler alone is enough.
  it("E5: with no workspaces but a create handler, add-to-workspace still renders", () => {
    renderList({ workspaces: [], onCreateWorkspace: () => {} });
    openMenu();
    expect(screen.getByTestId(`add-to-workspace-btn-${CWD}`)).toBeTruthy();
  });

  // E6 — the historical test id survives the relocation.
  it("E6: add-to-workspace-btn-<cwd> exists inside the menu", () => {
    const cwd = "/a/b";
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ id: "s1", cwd })]}
            onSelect={() => {}}
            onCreateWorkspace={() => {}}
          />
        </ThemeProvider>
      </Router>,
    );
    const panel = openMenu(cwd);
    expect(panel.querySelector(`[data-testid='add-to-workspace-btn-${cwd}']`)).toBeTruthy();
  });

  // E7 — open state is keyed per folder scope.
  it("E7: opening one folder's menu leaves the other closed and closes the first", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ id: "s1", cwd: "/a" }), makeSession({ id: "s2", cwd: "/b" })]}
            onSelect={() => {}}
          />
        </ThemeProvider>
      </Router>,
    );
    fireEvent.click(screen.getByTestId("folder-actions-menu-/a"));
    expect(screen.getByTestId("folder-actions-menu-panel-/a")).toBeTruthy();
    expect(screen.queryByTestId("folder-actions-menu-panel-/b")).toBeNull();
    fireEvent.click(screen.getByTestId("folder-actions-menu-/b"));
    expect(screen.getByTestId("folder-actions-menu-panel-/b")).toBeTruthy();
    expect(screen.queryByTestId("folder-actions-menu-panel-/a")).toBeNull();
  });

  // E10 — pin from the menu.
  it("E10: activating the pin item pins the directory once and closes the menu", () => {
    const onPinDirectory = vi.fn();
    renderList({ onPinDirectory });
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-pin"));
    expect(onPinDirectory).toHaveBeenCalledTimes(1);
    expect(onPinDirectory).toHaveBeenCalledWith(CWD);
    expect(screen.queryByTestId(`folder-actions-menu-panel-${CWD}`)).toBeNull();
  });

  // E11 — unpin from the menu.
  it("E11: on a pinned folder the pin item unpins", () => {
    const onUnpinDirectory = vi.fn();
    renderList({ pinnedDirectories: [CWD], onUnpinDirectory });
    openMenu();
    const item = screen.getByTestId("folder-menu-item-pin");
    expect(item.textContent).toMatch(/unpin/i);
    fireEvent.click(item);
    expect(onUnpinDirectory).toHaveBeenCalledTimes(1);
    expect(onUnpinDirectory).toHaveBeenCalledWith(CWD);
  });

  // E12 — the pinned state is an inert indicator, not a control.
  it("E12: a pinned folder shows a non-interactive pin indicator", () => {
    renderList({ pinnedDirectories: [CWD], onUnpinDirectory: () => {} });
    const indicator = screen.getByTestId(`folder-pinned-indicator-${CWD}`);
    expect(indicator.tagName).not.toBe("BUTTON");
    expect(indicator.querySelector("button")).toBeNull();
    expect(indicator.hasAttribute("tabindex")).toBe(false);
    expect(indicator.getAttribute("aria-hidden")).toBe("true");
  });

  // E13 — no indicator when unpinned.
  it("E13: an unpinned folder renders no pin indicator", () => {
    renderList({ onPinDirectory: () => {} });
    expect(screen.queryByTestId(`folder-pinned-indicator-${CWD}`)).toBeNull();
  });

  // E14 — accepted duplication: the menu's remove item and the
  // AddToWorkspaceMenu popover's own remove entry have identical effect.
  //
  // Reachability note: on a folder ROW the popover's entry is currently
  // unreachable — `AddToWorkspaceMenu` renders its remove entry only when
  // `currentWorkspaceId !== null`, while the top-level tiers filter
  // workspace-owned folders out (`visibleTopPinned` / `visibleTopUnpinned`), so
  // a row that carries the add-to-workspace affordance always resolves
  // `owningWsId === null`. That predates this change and is NOT fixed here. The
  // duplication is therefore pinned where it is observable: the menu item's
  // args, and the popover's own entry driven directly.
  it("E14: the menu's remove item removes the folder from its owning workspace", () => {
    const onRemoveFolderFromWorkspace = vi.fn();
    renderList({
      onRemoveFolderFromWorkspace,
      workspaces: [{ id: "w1", name: "WS", collapsed: false, folders: [CWD] }],
      onCreateWorkspace: () => {},
    });
    openMenu();
    fireEvent.click(screen.getByTestId("folder-menu-item-remove-from-workspace"));
    expect(onRemoveFolderFromWorkspace).toHaveBeenCalledTimes(1);
    expect(onRemoveFolderFromWorkspace).toHaveBeenCalledWith("w1", CWD);
  });

  it("E14: the AddToWorkspaceMenu popover keeps its own remove entry, with the same effect", () => {
    const onRemoveFromWorkspace = vi.fn();
    render(
      <ThemeProvider>
        <AddToWorkspaceMenu
          workspaces={[{ id: "w1", name: "WS", collapsed: false, folders: [CWD] }]}
          currentWorkspaceId="w1"
          onPick={() => {}}
          onNewWorkspace={() => {}}
          onRemoveFromWorkspace={onRemoveFromWorkspace}
          onClose={() => {}}
        />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("remove-from-workspace"));
    // SessionList wires this callback to
    // `onRemoveFolderFromWorkspace(owningWsId, cwd)` — the same pair the menu
    // item passes above.
    expect(onRemoveFromWorkspace).toHaveBeenCalledTimes(1);
  });

  // E15 — Directory Settings item navigates to the settings route.
  it("E15: the Directory Settings item opens that directory's settings route", () => {
    const cwd = "/Users/u/proj";
    const onOpenDirectorySettings = vi.fn();
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ id: "s1", cwd })]}
            onSelect={() => {}}
            onOpenDirectorySettings={onOpenDirectorySettings}
          />
        </ThemeProvider>
      </Router>,
    );
    openMenu(cwd);
    fireEvent.click(screen.getByTestId("folder-menu-item-directory-settings"));
    expect(onOpenDirectorySettings).toHaveBeenCalledWith(cwd);
    // The handler routes to the settings page; the page segment is omitted so
    // the route handler defaults to `packages`.
    expect(buildFolderSettingsUrl(cwd)).toBe(`/folder/${encodeFolderPath(cwd)}/settings`);
  });

  // X3 — the trigger's click does not reach the navigating header row.
  it("X3: activating the trigger neither navigates nor collapses", () => {
    renderList({ onPinDirectory: () => {} });
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
    openMenu();
    expect(screen.getByTestId("loc").textContent).toBe("/");
    // Still expanded — collapse did not toggle.
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });

  // The leaf name reads as a link on hover (3.10).
  it("the folder leaf name carries a hover affordance", () => {
    renderList();
    const leaf = screen.getByTestId(`folder-header-leaf-${CWD}`);
    expect(leaf.className).toMatch(/group-hover:underline/);
  });
});

// add-folder-actions-menu (CodeRabbit review) — deleting `folder-open-home`
// removed the only FOCUSABLE open control, so the whole-row navigation had no
// keyboard route. The name region carries link semantics; the row itself cannot,
// because it also hosts the menu trigger and a button may not nest in a link.
describe("SessionList folder header keyboard accessibility", () => {
  const CWD = "/home/user/project";

  function LocationProbe() {
    const [loc] = useLocation();
    return <span data-testid="loc">{loc}</span>;
  }

  function renderList() {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <LocationProbe />
          <SessionList sessions={[makeSession({ id: "s1", cwd: CWD })]} onSelect={() => {}} />
        </ThemeProvider>
      </Router>,
    );
  }

  it("the folder name exposes link semantics and is focusable", () => {
    renderList();
    const name = screen.getByTestId(`folder-header-name-${CWD}`);
    expect(name.getAttribute("role")).toBe("link");
    expect(name.getAttribute("tabindex")).toBe("0");
  });

  it("Enter on the focused folder name navigates to the directory home", () => {
    renderList();
    const name = screen.getByTestId(`folder-header-name-${CWD}`);
    name.focus();
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${encodeFolderPath(CWD)}`);
  });

  it("the menu trigger is not nested inside the link region", () => {
    renderList();
    const name = screen.getByTestId(`folder-header-name-${CWD}`);
    expect(name.querySelector(`[data-testid="folder-actions-menu-${CWD}"]`)).toBeNull();
  });
});
