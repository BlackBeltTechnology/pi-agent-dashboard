/**
 * "Remove from sidebar" folder-menu item (#1118): one step detaches a folder
 * from its workspace and unpins it; live sessions in the folder's group are
 * listed in a confirm dialog and ended (`shutdown`) first.
 *
 * Scenarios: test-plan #S1–#S15, #S24, #S25, #X1–#X3, #X7.
 * See change: sidebar-folder-ux.
 */

import {
  createFolderMenuStore,
  FolderMenuProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const CWD = "/home/user/project";
const ITEM = "folder-menu-item-remove-from-sidebar";
const DIALOG = "remove-from-sidebar-confirm";

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

function mk(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id,
    cwd: CWD,
    source: "tui",
    status: "ended",
    startedAt: Date.now() - 60_000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    name: `name-${id}`,
    ...over,
  };
}

type Props = Partial<React.ComponentProps<typeof SessionList>>;

function tree(props: Props) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return (
    <Router hook={hook}>
      <ThemeProvider>
        <FolderMenuProvider store={createFolderMenuStore()}>
          <SessionList sessions={[mk("e1")]} onSelect={() => {}} {...props} />
        </FolderMenuProvider>
      </ThemeProvider>
    </Router>
  );
}

function renderList(props: Props = {}) {
  const r = render(tree(props));
  return { rerender: (next: Props) => r.rerender(tree(next)) };
}

/** Callbacks writing one shared ordered log. */
function spies() {
  const log: string[] = [];
  return {
    log,
    onShutdown: vi.fn((id: string) => { log.push(`shutdown:${id}`); }),
    onUnpinDirectory: vi.fn((p: string) => { log.push(`unpin:${p}`); }),
    onRemoveFolderFromWorkspace: vi.fn((w: string, p: string) => { log.push(`rmws:${w}:${p}`); }),
  };
}

const WS = [{ id: "w1", name: "WS", collapsed: false, folders: [CWD] }];

function openMenu(cwd = CWD) {
  fireEvent.click(screen.getByTestId(`folder-actions-menu-${cwd}`));
}
function activate(cwd = CWD) {
  openMenu(cwd);
  fireEvent.click(screen.getByTestId(ITEM));
}
function confirm() {
  fireEvent.click(screen.getByTestId(`${DIALOG}-action`));
}

describe("item presence (#S1, #S15)", () => {
  it("is offered for pinned+ws, pinned-only, ws-only; absent for an unpinned outside folder; neutral tone", () => {
    const s = spies();
    const base = {
      onShutdown: s.onShutdown,
      onUnpinDirectory: s.onUnpinDirectory,
      onPinDirectory: () => {},
      onRemoveFolderFromWorkspace: s.onRemoveFolderFromWorkspace,
    };
    const cases: Array<[Props, boolean]> = [
      [{ pinnedDirectories: [CWD], workspaces: WS }, true],
      [{ pinnedDirectories: [CWD] }, true],
      [{ workspaces: WS }, true],
      // An ended-only unpinned folder is hidden (#1086), so keep it visible with a live session.
      [{ sessions: [mk("live", { status: "idle" })] }, false],
    ];
    for (const [props, expected] of cases) {
      cleanup();
      renderList({ ...base, ...props });
      openMenu();
      if (expected) {
        const item = screen.getByTestId(ITEM);
        expect(item.hasAttribute("data-action-tone")).toBe(false);
      } else {
        expect(screen.queryByTestId(ITEM)).toBeNull();
        expect(screen.queryByText("Remove from sidebar")).toBeNull();
      }
    }
  });
});

describe("removal without live sessions", () => {
  it("pinned folder inside a workspace: both messages once, no shutdown, no dialog (#S2)", () => {
    const s = spies();
    renderList({ ...s, pinnedDirectories: [CWD], workspaces: WS });
    activate();
    expect(s.onRemoveFolderFromWorkspace).toHaveBeenCalledTimes(1);
    expect(s.onRemoveFolderFromWorkspace).toHaveBeenCalledWith("w1", CWD);
    expect(s.onUnpinDirectory).toHaveBeenCalledTimes(1);
    expect(s.onUnpinDirectory).toHaveBeenCalledWith(CWD);
    expect(s.onShutdown).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pinned top-level folder: only unpin (#S3)", () => {
    const s = spies();
    renderList({ ...s, pinnedDirectories: [CWD] });
    activate();
    expect(s.onUnpinDirectory).toHaveBeenCalledWith(CWD);
    expect(s.onRemoveFolderFromWorkspace).not.toHaveBeenCalled();
  });

  it("workspace-owned but unpinned: only remove-from-workspace (#S4)", () => {
    const s = spies();
    renderList({ ...s, workspaces: WS });
    activate();
    expect(s.onRemoveFolderFromWorkspace).toHaveBeenCalledWith("w1", CWD);
    expect(s.onUnpinDirectory).not.toHaveBeenCalled();
  });
});

describe("live sessions require confirmation", () => {
  it("opens a dialog listing both live sessions; nothing sent yet (#S5)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: [CWD],
      sessions: [mk("a", { status: "streaming" }), mk("b", { status: "idle" })],
    });
    activate();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("name-a")).toBeTruthy();
    expect(within(dialog).getByText("name-b")).toBeTruthy();
    expect(s.log).toEqual([]);
  });

  it("BVA on live count: 0 → no dialog; ≥1 → dialog; a `closing` session counts as live (#S6)", () => {
    const run = (sessions: DashboardSession[]) => {
      cleanup();
      const s = spies();
      renderList({ ...s, pinnedDirectories: [CWD], sessions });
      activate();
      return { s, dialog: screen.queryByRole("dialog") };
    };
    expect(run([mk("e1")]).dialog).toBeNull();
    const one = run([mk("a", { status: "idle" })]);
    expect(one.dialog).not.toBeNull();
    expect(one.s.log).toEqual([]);
    const two = run([mk("a", { status: "idle" }), mk("b", { status: "active" })]);
    expect(within(two.dialog!).getAllByRole("listitem")).toHaveLength(2);
    const closing = run([mk("c", { status: "idle", closing: true })]);
    expect(within(closing.dialog!).getByText("name-c")).toBeTruthy();
  });

  it("includes hidden live sessions, and needs confirmation when they are the only live ones (#S7)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: [CWD],
      sessions: [mk("vis", { status: "idle" }), mk("hid", { status: "idle", hidden: true })],
    });
    activate();
    expect(within(screen.getByRole("dialog")).getByText("name-hid")).toBeTruthy();
    confirm();
    expect(s.onShutdown).toHaveBeenCalledWith("hid");
    expect(s.onShutdown).toHaveBeenCalledWith("vis");

    cleanup();
    const only = spies();
    renderList({ ...only, pinnedDirectories: [CWD], sessions: [mk("e1"), mk("hid", { status: "idle", hidden: true })] });
    activate();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("includes an unpinned worktree session rendered in the folder's card (#S8)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: [CWD],
      sessions: [
        mk("wt", {
          status: "idle",
          cwd: `${CWD}/.worktrees/x`,
          gitWorktree: { mainPath: CWD, name: "x" },
        }),
      ],
    });
    activate();
    expect(within(screen.getByRole("dialog")).getByText("name-wt")).toBeTruthy();
    confirm();
    expect(s.onShutdown).toHaveBeenCalledWith("wt");
  });

  it("path drift collapses (trailing separator) and a prefix-colliding sibling is excluded (#S9)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: [CWD],
      sessions: [
        mk("drift", { status: "idle", cwd: `${CWD}/` }),
        mk("sib", { status: "idle", cwd: `${CWD}-other` }),
      ],
    });
    activate();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("name-drift")).toBeTruthy();
    expect(within(dialog).queryByText("name-sib")).toBeNull();
    confirm();
    expect(s.onShutdown).toHaveBeenCalledTimes(1);
    expect(s.onShutdown).toHaveBeenCalledWith("drift");
  });

  it("path drift: case drift on a case-insensitive platform collapses (#S9)", () => {
    const s = spies();
    const pinned = "C:\\Users\\Me\\Repo";
    renderList({
      ...s,
      pinnedDirectories: [pinned],
      sessions: [mk("drift", { status: "idle", cwd: "c:\\users\\me\\repo" })],
    });
    activate(pinned);
    expect(within(screen.getByRole("dialog")).getByText("name-drift")).toBeTruthy();
    confirm();
    expect(s.onShutdown).toHaveBeenCalledWith("drift");
  });

  it("only shuts down sessions of the target folder (#S10)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: ["/a", "/b"],
      sessions: [
        mk("a1", { cwd: "/a", status: "idle" }),
        mk("b1", { cwd: "/b", status: "idle" }),
      ],
    });
    activate("/a");
    confirm();
    expect(s.onShutdown.mock.calls.map((c) => c[0])).toEqual(["a1"]);
  });

  it("confirm: every shutdown strictly before the removal messages, each once (#S11)", () => {
    const s = spies();
    renderList({
      ...s,
      pinnedDirectories: [CWD],
      workspaces: WS,
      sessions: [mk("A", { status: "idle" }), mk("B", { status: "streaming" })],
    });
    activate();
    confirm();
    expect(s.log).toHaveLength(4);
    expect(s.log.slice(0, 2).sort()).toEqual(["shutdown:A", "shutdown:B"]);
    expect(s.log.slice(2)).toEqual([`rmws:w1:${CWD}`, `unpin:${CWD}`]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("evaluates the live set at confirm time, not open time (#S12)", () => {
    const s = spies();
    const common = { ...s, pinnedDirectories: [CWD] };
    const { rerender } = renderList({ ...common, sessions: [mk("A", { status: "idle" })] });
    activate();
    rerender({ ...common, sessions: [mk("A"), mk("C", { status: "idle" })] });
    confirm();
    expect(s.onShutdown).toHaveBeenCalledTimes(1);
    expect(s.onShutdown).toHaveBeenCalledWith("C");
  });

  it("Cancel and Escape change nothing (#S13)", () => {
    const s = spies();
    renderList({ ...s, pinnedDirectories: [CWD], sessions: [mk("A", { status: "idle" })] });
    activate();
    fireEvent.click(screen.getByTestId(`${DIALOG}-cancel`));
    expect(screen.queryByRole("dialog")).toBeNull();
    activate();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(s.log).toEqual([]);
    expect(screen.getByTestId(`folder-actions-menu-${CWD}`)).toBeTruthy();
  });

  it("the dialog outlives the menu and the folder leaving the list (#S14)", () => {
    const s = spies();
    const common = { ...s };
    const { rerender } = renderList({
      ...common,
      pinnedDirectories: [CWD],
      workspaces: WS,
      sessions: [mk("A", { status: "idle" })],
    });
    activate();
    // The menu closed on select; now the folder leaves the list entirely.
    rerender({ ...common, pinnedDirectories: [], workspaces: [], sessions: [] });
    expect(screen.getByRole("dialog")).toBeTruthy();
    confirm();
    expect(s.log).toEqual([`rmws:w1:${CWD}`, `unpin:${CWD}`]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("keyboard and focus (#S24, #S25)", () => {
  it("keyboard only: Enter on the item → dialog focus on Cancel → Tab to Confirm → Enter (#S24)", async () => {
    const user = userEvent.setup();
    const s = spies();
    renderList({ ...s, pinnedDirectories: [CWD], sessions: [mk("A", { status: "idle" })] });
    const trigger = screen.getByTestId(`folder-actions-menu-${CWD}`);
    trigger.focus();
    await user.keyboard("{Enter}");
    const item = screen.getByTestId(ITEM);
    item.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId(`${DIALOG}-cancel`));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId(`${DIALOG}-action`));
    await user.keyboard("{Enter}");
    expect(s.log).toEqual(["shutdown:A", `unpin:${CWD}`]);
  });

  it("focus returns to the menu trigger on cancel and on confirm; unmounted trigger does not throw (#S25)", () => {
    const s = spies();
    const common = { ...s, pinnedDirectories: [CWD], sessions: [mk("A", { status: "idle" })] };
    const { rerender } = renderList(common);
    activate();
    fireEvent.click(screen.getByTestId(`${DIALOG}-cancel`));
    expect(document.activeElement).toBe(screen.getByTestId(`folder-actions-menu-${CWD}`));

    activate();
    confirm();
    expect(document.activeElement).toBe(screen.getByTestId(`folder-actions-menu-${CWD}`));

    activate();
    rerender({ ...common, pinnedDirectories: [], sessions: [] });
    expect(() => confirm()).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("fault injection (#X1–#X3, #X7)", () => {
  it("a throwing remove-from-workspace handler does not block unpin or crash (#X1)", () => {
    const s = spies();
    const err = vi.fn(() => { throw new Error("boom"); });
    renderList({
      ...s,
      onRemoveFolderFromWorkspace: err,
      pinnedDirectories: [CWD],
      workspaces: WS,
    });
    expect(() => activate()).not.toThrow();
    expect(s.onUnpinDirectory).toHaveBeenCalledWith(CWD);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("a throwing shutdown for one session does not abort the rest; the dialog closes (#X2)", () => {
    const s = spies();
    const onShutdown = vi.fn((id: string) => {
      if (id === "A") throw new Error("boom");
      s.log.push(`shutdown:${id}`);
    });
    renderList({
      ...s,
      onShutdown,
      pinnedDirectories: [CWD],
      sessions: [mk("A", { status: "idle" }), mk("B", { status: "idle" })],
    });
    activate();
    expect(() => confirm()).not.toThrow();
    expect(onShutdown).toHaveBeenCalledWith("A");
    expect(s.log).toEqual(["shutdown:B", `unpin:${CWD}`]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("without onShutdown: a live folder has no item; an ended-only folder keeps it (#X3)", () => {
    const common = { onUnpinDirectory: vi.fn(), pinnedDirectories: ["/live", "/ended"] };
    renderList({
      ...common,
      onShutdown: undefined,
      sessions: [mk("l", { cwd: "/live", status: "idle" }), mk("e", { cwd: "/ended" })],
    });
    openMenu("/live");
    expect(screen.queryByTestId(ITEM)).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    openMenu("/ended");
    expect(screen.getByTestId(ITEM)).toBeTruthy();
    fireEvent.click(screen.getByTestId(ITEM));
    expect(common.onUnpinDirectory).toHaveBeenCalledWith("/ended");
  });

  it("sessions that end while the dialog is open: no shutdown, removal still sent (#X7)", () => {
    const s = spies();
    const common = { ...s, pinnedDirectories: [CWD] };
    const { rerender } = renderList({ ...common, sessions: [mk("A", { status: "idle" })] });
    activate();
    rerender({ ...common, sessions: [mk("A")] });
    confirm();
    expect(s.onShutdown).not.toHaveBeenCalled();
    expect(s.log).toEqual([`unpin:${CWD}`]);
  });
});
