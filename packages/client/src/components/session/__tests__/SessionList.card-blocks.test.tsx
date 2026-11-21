/**
 * Directory-card block gating (`folder-*`, `pill-*`) + the folder banner
 * safety chip. Scenarios: test-plan #E17, #E18.
 * See change: add-focus-mode-and-card-block-toggles.
 */
import {
  createSlotRegistry,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorktreeInitStatus } from "../../../lib/git/git-api.js";
import { initStore } from "../../../lib/git/worktree-init-store.js";
import { CardSectionsProvider } from "../../../lib/state/CardSectionsContext.js";
import { FolderActionBanner } from "../../folder/FolderActionBanner.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionList } from "../SessionList.js";

const CWD = "/home/user/project";

// The init-status probe is what puts a folder into a banner rung; drive it per test.
const probe = vi.hoisted(() => ({ status: { hasHook: false } as { hasHook: boolean; trusted?: boolean; needsInit?: boolean } }));
vi.mock("../../../lib/git/git-api.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/git/git-api.js")>()),
  fetchWorktreeInitStatus: vi.fn(async () => probe.status),
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
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
afterEach(() => {
  cleanup();
  initStore.__resetForTests();
  probe.status = { hasHook: false };
});

const live: DashboardSession = {
  id: "s1", cwd: CWD, source: "tui", status: "active", startedAt: Date.now() - 60_000,
  tokensIn: 0, tokensOut: 0, cost: 0, gitBranch: "main",
};
const ended: DashboardSession = { ...live, id: "s2", status: "ended" };
const openspec: OpenSpecData = { initialized: true, changes: [] };

function renderList(prefs: CardSectionPrefs, selectedId?: string) {
  const registry = createSlotRegistry();
  registry.addClaim({ pluginId: "automation", priority: 1, slot: "sidebar-folder-section", Component: () => <i data-testid="pill-automation-x" /> });
  registry.addClaim({ pluginId: "goal", priority: 2, slot: "sidebar-folder-section", Component: () => <i data-testid="pill-goal-x" /> });
  const { hook } = memoryLocation({ path: "/", static: true });
  return render(
    <Router hook={hook}>
      <ThemeProvider>
        <PluginContextProvider registry={registry}>
          <CardSectionsProvider value={{ prefs }}>
            <SessionList
              sessions={[live, ended]}
              selectedId={selectedId}
              onSelect={() => {}}
              openspecMap={new Map([[CWD, openspec]])}
              onSpawnSession={() => {}}
              endedTotalsMap={new Map([[CWD, 1]])}
            />
          </CardSectionsProvider>
        </PluginContextProvider>
      </ThemeProvider>
    </Router>,
  );
}

const has = (id: string) => screen.queryByTestId(id) !== null;

describe("directory card blocks (#E17)", () => {
  it("renders every block with no prefs", () => {
    renderList({});
    expect(has("pill-automation-x")).toBe(true);
    expect(has("pill-goal-x")).toBe(true);
    expect(has("folder-spawn-session-btn")).toBe(true);
    expect(has(`folder-ended-toggle-${CWD}`)).toBe(true);
    expect(screen.queryByText("Create")).not.toBeNull();
  });

  it("pill-automation off hides only that pill", () => {
    renderList({ global: { "pill-automation": false } });
    expect(has("pill-automation-x")).toBe(false);
    expect(has("pill-goal-x")).toBe(true);
  });

  it("folder-create off removes CREATE divider, buttons and SESSIONS divider", () => {
    renderList({ global: { "folder-create": false } });
    expect(has("folder-spawn-session-btn")).toBe(false);
    expect(screen.queryByText("Create")).toBeNull();
    // The scoped search box has its own "Sessions" toggle; only the folder-card divider must be gone.
    expect(screen.queryAllByText("Sessions").filter((el) => !el.closest('[data-testid="search-scope-sessions"]'))).toEqual([]);
    expect(has(`folder-ended-toggle-${CWD}`)).toBe(true);
  });

  it("folder-ended off hides the ended expander only", () => {
    renderList({ global: { "folder-ended": false } });
    expect(has(`folder-ended-toggle-${CWD}`)).toBe(false);
    expect(has("folder-spawn-session-btn")).toBe(true);
  });

  it("folder-openspec off hides the OpenSpec pill but not the slot pills", () => {
    const withBlock = renderList({});
    const before = withBlock.container.innerHTML.length;
    cleanup();
    const without = renderList({ global: { "folder-openspec": false } });
    expect(without.container.innerHTML.length).toBeLessThan(before);
    expect(has("pill-automation-x")).toBe(true);
  });

  it("all blocks off → header + cards only, no empty grid (empty:hidden)", () => {
    const prefs: CardSectionPrefs = {
      global: {
        "folder-git": false, "folder-banner": false, "folder-openspec": false,
        "folder-create": false, "folder-ended": false, "pill-automation": false, "pill-goal": false,
      },
    };
    const { container } = renderList(prefs);
    expect(has("folder-spawn-session-btn")).toBe(false);
    expect(has("pill-automation-x")).toBe(false);
    expect(has(`folder-ended-toggle-${CWD}`)).toBe(false);
    const grid = container.querySelector(".grid.empty\\:hidden");
    expect(grid === null || grid.childElementCount === 0).toBe(true);
    expect(has(`folder-body-${CWD}`)).toBe(true);
  });
});

describe("folder banner safety chip (#E18)", () => {
  const retrust: WorktreeInitStatus = { hasHook: true, trusted: false };

  it("compact: chip instead of the banner; activating reveals the full banner", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={retrust} compact />);
    expect(has(`folder-banner-retrust-${CWD}`)).toBe(false);
    const chip = screen.getByTestId(`folder-banner-chip-${CWD}`);
    expect(chip.textContent).toContain("Re-trust needed");
    fireEvent.click(chip);
    expect(has(`folder-banner-retrust-${CWD}`)).toBe(true);
    expect(has(`folder-banner-chip-${CWD}`)).toBe(false);
  });

  it("compact + healthy folder: neither chip nor banner", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={{ hasHook: false }} compact />);
    expect(has(`folder-banner-chip-${CWD}`)).toBe(false);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("not compact: banner as before", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={retrust} />);
    expect(has(`folder-banner-retrust-${CWD}`)).toBe(true);
  });
});

describe("Focus mode overlay on the directory card (spec focus-mode)", () => {
  const stored: CardSectionPrefs = { global: { "pill-goal": true }, folders: { [CWD]: { "folder-create": true } } };

  it("built-in profile → minimal directory card; normal prefs untouched; off restores", () => {
    // Focus switches the list to accordion; select a session so the folder is focused (full).
    renderList({ ...stored, focus: { enabled: true } }, "s1");
    expect(has("folder-spawn-session-btn")).toBe(false);
    expect(has("pill-automation-x")).toBe(false);
    expect(has("pill-goal-x")).toBe(false);
    expect(has(`folder-ended-toggle-${CWD}`)).toBe(false);
    expect(has(`folder-body-${CWD}`)).toBe(true);
    cleanup();
    renderList({ ...stored, focus: { enabled: false } });
    expect(has("folder-spawn-session-btn")).toBe(true);
    expect(has("pill-goal-x")).toBe(true);
    expect(has("pill-automation-x")).toBe(true);
    expect(stored).toEqual({ global: { "pill-goal": true }, folders: { [CWD]: { "folder-create": true } } });
  });

  it("outside Focus: the banner is hidden by prefs, the compact chip still shows", () => {
    render(<FolderActionBanner cwd={CWD} isProjectRoot status={{ hasHook: true, trusted: false }} compact />);
    expect(has(`folder-banner-chip-${CWD}`)).toBe(true);
  });
});

// Focus mode suppresses the folder compact chip on every path (#1134).
// See change: sidebar-folder-ux (test-plan #S27, #S28, #S29).
describe("Focus mode × folder banner chip (#1134)", () => {
  const OTHER = "/home/user/other";
  const otherLive: DashboardSession = { ...live, id: "s3", cwd: OTHER };
  const FOCUS_ON: CardSectionPrefs = { focus: { enabled: true } };
  const FOCUS_OFF: CardSectionPrefs = { focus: { enabled: false } };
  const SHOWS_BANNER: CardSectionPrefs = {
    focus: { enabled: true, profile: { sections: { "folder-banner": true }, folderListMode: "accordion" } },
  };

  function tree(prefs: CardSectionPrefs) {
    const { hook } = memoryLocation({ path: "/", static: true });
    return (
      <Router hook={hook}>
        <ThemeProvider>
          <CardSectionsProvider value={{ prefs }}>
            <SessionList
              sessions={[live, otherLive]}
              selectedId="s1"
              onSelect={() => {}}
              openspecMap={new Map([[CWD, openspec]])}
              onSpawnSession={() => {}}
            />
          </CardSectionsProvider>
        </ThemeProvider>
      </Router>
    );
  }
  const mount = (prefs: CardSectionPrefs) => {
    const r = render(tree(prefs));
    return (next: CardSectionPrefs) => r.rerender(tree(next));
  };
  const anyBanner = () => document.querySelectorAll("[data-testid^='folder-banner-']").length;

  it("S29: Focus (built-in profile) renders no folder chip/banner on a blocked folder — focused or compact", async () => {
    probe.status = { hasHook: true, trusted: false };
    mount(FOCUS_ON);
    await waitFor(() => expect(has(`folder-header-name-${CWD}`)).toBe(true));
    await new Promise((r) => setTimeout(r, 20)); // let the probe resolve
    expect(anyBanner()).toBe(0);
  });

  it("S27: Focus with a profile that shows folder-banner renders the full banner, no chip", async () => {
    probe.status = { hasHook: true, trusted: false };
    mount(SHOWS_BANNER);
    await waitFor(() => expect(has(`folder-banner-retrust-${CWD}`)).toBe(true));
    expect(has(`folder-banner-chip-${CWD}`)).toBe(false);
  });

  it("S28: init run running → failed shows nothing in Focus; Focus off brings the banner back with Retry", async () => {
    probe.status = { hasHook: true, trusted: true };
    initStore.startRun(CWD);
    const setPrefs = mount(FOCUS_ON);
    await new Promise((r) => setTimeout(r, 20));
    expect(anyBanner()).toBe(0);
    initStore.markFailed(CWD, "exit_1", "boom");
    await new Promise((r) => setTimeout(r, 20));
    expect(anyBanner()).toBe(0);
    setPrefs(FOCUS_OFF);
    await waitFor(() => expect(has(`folder-banner-failed-${CWD}`)).toBe(true));
    expect(screen.queryByText("Retry")).not.toBeNull();
  });
});
