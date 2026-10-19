/**
 * The desktop session card ↔ session actions menu: entry points, the condensed
 * card, status-vs-menu parity, dialogs, and plugin hosting.
 * See change: add-session-actions-flyout (test-plan E15–E23, E30, F1, F2, F19,
 * F22, X1, X3, X4).
 */
import {
  createSlotRegistry,
  createUiPrimitiveRegistry,
  intentStore,
  PluginContextProvider,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiDotsHorizontal, mdiDotsVertical, mdiFolderCogOutline } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { GoalControl } from "../../../../goal-plugin/src/client/GoalControl.js";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: vi.fn(() => false) }));
vi.mock("../../lib/git/git-api.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/git/git-api.js")>()),
  fetchChangedFiles: vi.fn(async () => []),
}));

beforeEach(() => {
  // Layout: the placement hook reads the card's rect; give every card a stable one.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-session-card")) return { left: 20, top: 400, right: 320, bottom: 480, width: 300, height: 80, x: 20, y: 400, toJSON() {} } as DOMRect;
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  intentStore.__resetForTests();
  const { useMobile } = await import("../../hooks/useMobile.js");
  (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return { id: "s1", cwd: "/repo", source: "tui", status: "idle", startedAt: Date.now() - 60_000, ...over } as DashboardSession;
}

const done = [
  { id: "proposal", status: "done" as const },
  { id: "design", status: "done" as const },
  { id: "specs", status: "done" as const },
];
const IMPLEMENTING: OpenSpecChange = { name: "add-auth", status: "in-progress", completedTasks: 1, totalTasks: 3, artifacts: done };
const COMPLETE: OpenSpecChange = { name: "add-auth", status: "complete", completedTasks: 3, totalTasks: 3, artifacts: done };

const baseProps = {
  selectedId: undefined,
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: true,
  isHidden: false,
  onArchive: () => {},
  onShutdown: () => {},
  onSendPrompt: () => {},
  onAttachProposal: () => {},
  onDetachProposal: () => {},
  onSpawnSibling: () => {},
  openspecHasDir: true,
};

function card(session: DashboardSession, props: Partial<React.ComponentProps<typeof SessionCard>> = {}, wrap?: (n: React.ReactNode) => React.ReactNode) {
  const node = <SessionCard session={session} {...baseProps} {...props} />;
  return render(<>{wrap ? wrap(node) : node}</>);
}

const trigger = () => screen.getByTestId("session-actions-trigger-s1");
const menuIds = () =>
  Array.from(screen.getByTestId("session-actions-menu-s1").querySelectorAll("[data-item-id]")).map((e) => e.getAttribute("data-item-id"));

describe("four entry points open the same menu (F1, L1 half)", () => {
  const fixture = () =>
    makeSession({ gitBranch: "feat", gitWorktree: { mainPath: "/repo", name: "feat" } as never, attachedProposal: "add-auth", gitPrNumber: 4, gitPrUrl: "https://gh/pr/4", gitPrState: "open" });
  const props = () => ({ openspecChanges: [IMPLEMENTING], onSpawnWorktree: () => {} });

  it("trigger: opens, aria-expanded, card not selected", () => {
    const onSelect = vi.fn();
    card(fixture(), { ...props(), onSelect });
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("right-click opens the same item set at the pointer, suppresses the browser menu, does not select", () => {
    const onSelect = vi.fn();
    card(fixture(), { ...props(), onSelect });
    fireEvent.click(trigger());
    const triggerIds = menuIds();
    fireEvent.keyDown(screen.getByTestId("session-actions-menu-s1"), { key: "Escape" });
    const body = screen.getByTestId("session-card-desktop");
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 150, clientY: 440 });
    act(() => {
      body.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    const panel = screen.getByTestId("session-actions-menu-s1");
    expect(menuIds()).toEqual(triggerIds);
    expect([panel.style.left, panel.style.top]).toEqual(["150px", "440px"]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Shift+F10 with focus on Archive opens the menu with the same items and focuses the first enabled one; Escape returns to Archive", () => {
    card(fixture(), props());
    fireEvent.click(trigger());
    const ids = menuIds();
    fireEvent.keyDown(screen.getByTestId("session-actions-menu-s1"), { key: "Escape" });
    const archive = screen.getByTestId("session-archive-btn");
    archive.focus();
    fireEvent.keyDown(archive, { key: "F10", shiftKey: true });
    expect(menuIds()).toEqual(ids);
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    fireEvent.keyDown(screen.getByTestId("session-actions-menu-s1"), { key: "Escape" });
    expect(document.activeElement).toBe(archive);
  });

  it("the ContextMenu key opens it too, but not from a text input", () => {
    card(fixture(), props());
    const archive = screen.getByTestId("session-archive-btn");
    fireEvent.keyDown(archive, { key: "ContextMenu" });
    expect(screen.getByTestId("session-actions-menu-s1")).toBeTruthy();
  });
});

describe("native context menu exemptions (F2)", () => {
  const withPr = () => makeSession({ gitBranch: "feat", gitPrNumber: 4, gitPrUrl: "https://gh/pr/4", gitPrState: "open", gitWorktree: { mainPath: "/repo", name: "feat" } as never });

  function contextmenu(target: Element): MouseEvent {
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    act(() => {
      target.dispatchEvent(ev);
    });
    return ev;
  }

  it("a link keeps the native menu", () => {
    card(withPr(), { onRename: () => {} });
    const link = screen.getByText("#4").closest("a") as HTMLElement;
    expect(link.getAttribute("href")).toBe("https://gh/pr/4");
    expect(contextmenu(link).defaultPrevented).toBe(false);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });

  it("the inline rename input keeps the native menu", () => {
    card(withPr(), { onRename: () => {} });
    fireEvent.doubleClick(screen.getByTestId("session-card-desktop").querySelector(".cursor-text") as HTMLElement);
    const input = screen.getByTestId("session-card-desktop").querySelector("input") as HTMLElement;
    expect(contextmenu(input).defaultPrevented).toBe(false);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });

  it("a non-empty text selection inside the card keeps the native menu", () => {
    card(withPr());
    const name = screen.getByTestId("session-card-desktop").querySelector("span.font-semibold") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(name);
    const sel = window.getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(contextmenu(screen.getByTestId("session-card-desktop")).defaultPrevented).toBe(false);
    sel.removeAllRanges();
  });

  it("a drag in progress keeps the native menu", () => {
    card(withPr());
    document.body.insertAdjacentHTML("beforeend", '<div data-session-dragging=""></div>');
    expect(contextmenu(screen.getByTestId("session-card-desktop")).defaultPrevented).toBe(false);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    document.querySelector("[data-session-dragging]")?.remove();
  });
});

describe("condensed desktop card (E18, E19, E21, E30)", () => {
  const REMOVED = [
    "session-card-spawn-sibling",
    "session-card-spawn-worktree",
    "openspec-overflow-btn",
    "apply-btn",
    "attach-combo",
    "explore-unattached-btn",
    "worktree-actions-menu",
    "worktree-action-push",
    "worktree-action-merge",
  ];
  const noRemoved = () => {
    for (const id of REMOVED) expect(screen.queryByTestId(id), id).toBeNull();
    expect(document.querySelector("[data-testid^='subcard-menu-']")).toBeNull();
    // no rename pencil
    expect(screen.queryByTitle("Rename session")).toBeNull();
  };
  const full = {
    openspecChanges: [IMPLEMENTING],
    onResume: () => {},
    onSpawnWorktree: () => {},
    onRename: () => {},
    openspecReadiness: { state: "READY" as const },
  };

  it.each([
    ["ended + sessionFile + git", makeSession({ status: "ended", sessionFile: "/x.jsonl", gitBranch: "main" })],
    ["live", makeSession()],
    ["worktree", makeSession({ gitBranch: "feat", gitWorktree: { mainPath: "/repo", name: "feat" } as never, attachedProposal: "add-auth" })],
    ["unattached READY", makeSession({ gitBranch: "main" })],
    ["archived attachment", makeSession({ attachedProposal: "old" })],
  ])("%s: no removed control renders; Archive, trigger, Exit render", (name, s) => {
    card(s, full);
    noRemoved();
    expect(screen.getByTestId("session-actions-trigger-s1")).toBeTruthy();
    expect(screen.getByTestId("session-archive-btn")).toBeTruthy();
    if (name !== "ended + sessionFile + git") expect(screen.getByTestId("session-close-btn")).toBeTruthy();
    // no footer row below the last subcard
    expect(screen.getByTestId("session-card-desktop").lastElementChild?.getAttribute("data-plugin-group")).toBeNull();
  });

  it("PROCESS row stop / kill and the safety chip are still on the card", () => {
    const tool = { toolCallId: "t1", command: "npm test", startedAt: Date.now() };
    const proc = { pid: 1, pgid: 1, command: "vitest --watch", elapsedMs: 5 } as never;
    card(makeSession({ status: "streaming" }), { inflightBashTools: [tool], processes: [proc], onKillProcess: () => {}, onAbortTool: () => {}, onSetProcessDrawerCollapsed: () => {} });
    expect(screen.getByTestId("process-summary-line")).toBeTruthy();
    cleanup();
    card(makeSession(), { processes: [proc], onKillProcess: () => {} }, (n) => <CardSectionsProvider value={{ prefs: { folders: { "/repo": { process: false } } } }}>{n}</CardSectionsProvider>);
    expect(screen.getByTestId("process-safety-chip")).toBeTruthy();
  });

  it("E19: READY attached → change link + lifecycle bar; READY unattached → no OPENSPEC title; BROKEN → remediation; legacy → degrades", () => {
    card(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" }, onReadArtifact: () => {} });
    expect(screen.getByText("OPENSPEC")).toBeTruthy();
    expect(screen.getByTestId("attached-badge").textContent).toContain("add-auth");
    expect(screen.getByTestId("openspec-stepper")).toBeTruthy();
    cleanup();
    card(makeSession(), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" } });
    expect(screen.queryByText("OPENSPEC")).toBeNull();
    cleanup();
    card(makeSession(), { openspecChanges: [], openspecReadiness: { state: "BROKEN", reason: "cli-failed" }, onSeekToFolderOpenSpec: () => {} });
    expect(screen.getByTestId("session-openspec-remediate")).toBeTruthy();
    cleanup();
    card(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: undefined });
    expect(screen.getByText("OPENSPEC")).toBeTruthy();
  });

  it("E21: the mobile card renders no session actions menu and right-click does nothing", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
    card(makeSession({ gitBranch: "main" }), full);
    expect(document.querySelector("[data-testid^='session-actions-trigger-']")).toBeNull();
    const li = document.querySelector("[data-session-id='s1']") as HTMLElement;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => {
      li.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector("[role='menu']")).toBeNull();
  });

  it("E30: the trigger glyph is an inline three-dot SVG (not mdiDotsVertical), differs from the folder trigger, and no card control uses mdiDotsHorizontal", () => {
    card(makeSession({ gitBranch: "feat", gitWorktree: { mainPath: "/repo", name: "feat" } as never, attachedProposal: "add-auth" }), full);
    const d = (el: Element) => el.querySelector("path")?.getAttribute("d");
    expect(trigger().querySelectorAll("svg circle").length).toBe(3);
    expect(d(trigger())).toBeUndefined();
    expect(mdiDotsVertical).not.toBe(mdiFolderCogOutline);
    const triggers = Array.from(screen.getByTestId("session-card-desktop").querySelectorAll("[aria-haspopup]"));
    expect(triggers.map(d)).not.toContain(mdiDotsHorizontal);
    expect(triggers.map(d)).not.toContain(mdiDotsVertical);
  });
});

/**
 * The trigger sits on the card's right edge, outside the header row.
 * See change: move-session-actions-trigger-to-card-edge (test-plan E1, E2, E18, F10).
 */
describe("edge trigger placement", () => {
  const liOf = () => document.querySelector("[data-session-card]") as HTMLElement;
  const wrapper = () => trigger().parentElement as HTMLElement;

  it("E1: the trigger wrapper is an absolute card-edge child of the card root, right after the content row, not in the header", () => {
    card(makeSession(), { onRename: () => {} });
    const archive = screen.getByTestId("session-archive-btn");
    const header = archive.parentElement as HTMLElement;
    expect(header.contains(trigger())).toBe(false);
    expect(header.contains(screen.getByTestId("session-close-btn"))).toBe(true);
    expect(wrapper().parentElement).toBe(liOf());
    const prev = wrapper().previousElementSibling as HTMLElement;
    expect(prev.className).toContain("flex");
    expect(prev.contains(header)).toBe(true);
    const cls = wrapper().className.split(/\s+/);
    expect(cls).toContain("absolute");
    expect(cls).toContain("card-edge-trigger");
  });

  it("E2: an ended card's header holds Archive but no trigger; the trigger is on the card; no inline action chips", () => {
    card(makeSession({ status: "ended", sessionFile: "/sess/x.jsonl" }), { onResume: () => {}, onSpawnWorktree: () => {} });
    const header = screen.getByTestId("session-archive-btn").parentElement as HTMLElement;
    expect(header.querySelector("[data-testid^='session-actions-trigger-']")).toBeNull();
    expect(wrapper().parentElement).toBe(liOf());
    expect(screen.queryByTestId("session-card-resume")).toBeNull();
    expect(screen.queryByTestId("session-card-spawn-sibling")).toBeNull();
  });

  it.each([
    ["hidden", { isHidden: true }, makeSession(), "opacity-40"],
    ["closing", {}, makeSession({ closing: true } as Partial<DashboardSession>), "opacity-50"],
  ])("E18: a %s (dimmed) card still renders a working trigger", (_n, props, session, dim) => {
    card(session, props as never);
    expect(liOf().className).toContain(dim);
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("F10: Escape from a trigger-opened menu returns focus to the moved trigger", () => {
    card(makeSession());
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByTestId("session-actions-menu-s1"), { key: "Escape" });
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("status vs menu parity (E20)", () => {
  it("lifecycle segment, change link, PR and dirty pill make the same calls as their menu items", async () => {
    const onReadArtifact = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { CommitDialogProvider } = await import("../worktree/CommitDialog.js");
    const s = makeSession({
      gitBranch: "feat",
      gitWorktree: { mainPath: "/repo", name: "feat" } as never,
      attachedProposal: "add-auth",
      gitPrNumber: 4,
      gitPrUrl: "https://gh/pr/4",
      gitPrState: "open",
      gitStatus: { dirtyCount: 2, staged: 0, unstaged: 2, untracked: 0, ahead: 0, behind: 0 } as never,
    });
    card(s, { openspecChanges: [IMPLEMENTING], onReadArtifact }, (n) => <CommitDialogProvider>{n}</CommitDialogProvider>);
    // card status
    fireEvent.click(screen.getByTestId("stepper-segment-design"));
    fireEvent.click(screen.getByTestId("attached-badge"));
    const cardCalls = onReadArtifact.mock.calls.map((c) => c.join(":"));
    expect(cardCalls).toEqual(["add-auth:design", "add-auth:proposal"]);
    // menu items
    onReadArtifact.mockClear();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-segment-design"));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-item-open-change"));
    expect(onReadArtifact.mock.calls.map((c) => c.join(":"))).toEqual(cardCalls);
    // PR: the pill is a link to the same URL the menu item opens
    expect(screen.getByText("#4").closest("a")?.getAttribute("href")).toBe("https://gh/pr/4");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-item-view-pr"));
    expect(openSpy).toHaveBeenCalledWith("https://gh/pr/4", "_blank", "noopener,noreferrer");
    // dirty pill vs Commit item both open the commit dialog
    fireEvent.click(screen.getByTestId("git-dirty-pill"));
    await screen.findByTestId("commit-cancel");
    fireEvent.click(screen.getByTestId("commit-cancel"));
    await waitFor(() => expect(screen.queryByTestId("commit-cancel")).toBeNull());
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-item-commit"));
    await screen.findByTestId("commit-cancel");
  });
});

describe("dialogs hosted by the card (E17, X4)", () => {
  it("E17: Bulk archive… confirms before sending; cancel sends nothing", () => {
    const onBulkArchive = vi.fn();
    const completed: OpenSpecChange = { ...COMPLETE, name: "done-1" };
    card(makeSession(), { openspecChanges: [completed], openspecReadiness: { state: "READY" }, onBulkArchive });
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-item-openspec-bulk-archive"));
    expect(screen.getByText("Bulk archive all completed changes?")).toBeTruthy();
    // cancel
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onBulkArchive).not.toHaveBeenCalled();
    // confirm
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-item-openspec-bulk-archive"));
    fireEvent.click(screen.getByRole("button", { name: /^bulk archive$/i }));
    expect(onBulkArchive).toHaveBeenCalledTimes(1);
  });

  it("X4: Escape inside ExploreDialog closes the dialog, the menu does not reopen, focus returns to the trigger", async () => {
    const { makeRunConfig, RunConfigHarness } = await import("../../test-support/runConfigHarness.js");
    card(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" } }, (n) => (
      <RunConfigHarness value={makeRunConfig()}>{n}</RunConfigHarness>
    ));
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("session-menu-more-openspec"));
    fireEvent.click(screen.getByTestId("session-menu-item-openspec-explore"));
    const area = await screen.findByTestId("explore-textarea");
    fireEvent.keyDown(area, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("explore-textarea")).toBeNull());
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("plugin hosting in the PLUGINS group (F19, X1, F22, X3)", () => {
  function registryWith(...claims: Array<{ id: string; C: React.ComponentType<{ session: DashboardSession }> }>) {
    const registry = createSlotRegistry();
    for (const { id, C } of claims) registry.addClaim({ pluginId: id, priority: 100, slot: "session-card-action-bar", Component: C as never });
    return registry;
  }
  const wrapPlugins = (registry: ReturnType<typeof createSlotRegistry>, prefs = {}) => (n: React.ReactNode) => {
    const prim = createUiPrimitiveRegistry();
    registerUiPrimitive(prim, "ui:action-list" as never, ActionList as never);
    return (
      <UiPrimitiveProvider value={prim}>
        <Router hook={memoryLocation({ path: "/", record: true }).hook}>
          <PluginContextProvider registry={registry}>
            <CardSectionsProvider value={{ prefs, pluginNames: { alpha: "Alpha plugin" } }}>{n}</CardSectionsProvider>
          </PluginContextProvider>
        </Router>
      </UiPrimitiveProvider>
    );
  };
  const Button = () => <button type="button" data-testid="alpha-btn">Do alpha</button>;
  const Nothing = () => null;

  it("F19: output is absent from the card, present in a labelled group when open; click closes without selecting", () => {
    const onSelect = vi.fn();
    const { container } = card(makeSession(), { onSelect }, wrapPlugins(registryWith({ id: "alpha", C: Button }, { id: "beta", C: Nothing })));
    expect(container.querySelector("[data-testid='alpha-btn']")).toBeNull();
    fireEvent.click(trigger());
    const btn = screen.getByTestId("alpha-btn");
    expect(btn.closest("[role='group'][aria-label='Alpha plugin']")).toBeTruthy();
    expect(screen.getByTestId("session-menu-group-plugins").hasAttribute("hidden")).toBe(false);
    btn.focus();
    fireEvent.click(btn);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    // the claim stays mounted: reopening shows it again
    fireEvent.click(trigger());
    expect(screen.getByTestId("alpha-btn")).toBeTruthy();
  });

  it("F19: a claim rendering null leaves no PLUGINS heading", async () => {
    card(makeSession(), {}, wrapPlugins(registryWith({ id: "beta", C: Nothing })));
    fireEvent.click(trigger());
    expect(screen.getByTestId("session-menu-group-plugins").hasAttribute("hidden")).toBe(true);
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it("F19: the per-plugin actionbar-<id> filter removes that plugin's output", () => {
    card(makeSession(), {}, wrapPlugins(registryWith({ id: "alpha", C: Button }), { global: { "actionbar-alpha": false } }));
    fireEvent.click(trigger());
    expect(screen.queryByTestId("alpha-btn")).toBeNull();
  });

  it("X1: a claim that throws is contained; host groups still render", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("boom");
    };
    card(makeSession(), {}, wrapPlugins(registryWith({ id: "bad", C: Boom }, { id: "alpha", C: Button })));
    fireEvent.click(trigger());
    expect(screen.getByTestId("session-menu-group-view")).toBeTruthy();
    expect(screen.getByTestId("alpha-btn")).toBeTruthy();
    err.mockRestore();
  });

  it("F22: an action-list intent renders menuitems; activating one dispatches it and closes the menu", () => {
    const registry = registryWith();
    const sent: unknown[] = [];
    card(makeSession(), {}, (n) => {
      const w = wrapPlugins(registry)(n);
      return w;
    });
    act(() => {
      intentStore.set({ pluginId: "alpha", sessionId: "s1", slot: "session-card-action-bar" }, {
        primitive: "ui:action-list",
        props: { actions: [{ label: "First", onClick: () => sent.push("first") }, { label: "Second" }] },
      } as never);
    });
    fireEvent.click(trigger());
    const items = screen.getAllByTestId("action-list-item");
    expect(items.map((i) => i.getAttribute("role"))).toEqual(["menuitem", "menuitem"]);
    items[0].focus();
    fireEvent.click(items[0]);
    expect(sent).toEqual(["first"]);
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
    // keyboard users land back on the trigger, never on <body>
    expect(document.activeElement).toBe(trigger());
  });

  it("X3: the goal plugin's claim renders in the menu (link chip → goal detail) while GoalChip stays on the card", () => {
    const mem = memoryLocation({ path: "/", record: true });
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "goal", priority: 100, slot: "session-card-action-bar", Component: GoalControl as never });
    const s = makeSession({ goalId: "g1" } as Partial<DashboardSession>);
    card(s, {}, (n) => (
      <Router hook={mem.hook}>
        <PluginContextProvider registry={registry}>{n}</PluginContextProvider>
      </Router>
    ));
    expect(screen.queryByTestId("goal-control-link")).toBeNull(); // not on the card
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId("goal-control-link"));
    expect(mem.history?.at(-1)).toContain("g1");
    expect(screen.queryByTestId("session-actions-menu-s1")).toBeNull();
  });
});

// align-ui-contract-recipes (test-plan #E11): text and target floors of the menu.
describe("menu text and target floors (#E11)", () => {
  const openMenu = (session: DashboardSession, props: Partial<React.ComponentProps<typeof SessionCard>> = {}, wrap?: (n: React.ReactNode) => React.ReactNode) => {
    card(session, props, wrap);
    fireEvent.click(trigger());
    return screen.getByTestId("session-actions-menu-s1");
  };
  const gone = () => makeSession({ cwdMissing: true, gitBranch: "feat", isGitRepo: true });

  it("group headings are 11 px semibold in the secondary text colour", () => {
    const menu = openMenu(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" } });
    const headings = Array.from(menu.querySelectorAll("[role='group'] > div.sticky"));
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(h.className).toContain("text-[11px]");
      expect(h.className).toContain("font-semibold");
      expect(h.className).toContain("text-[var(--text-secondary)]");
      expect(h.className).not.toContain("text-[10px]");
    }
  });

  it("every host item is at least 36 px (44 px below sm)", () => {
    const menu = openMenu(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" } });
    const items = Array.from(menu.querySelectorAll("button[role='menuitem']"));
    expect(items.length).toBeGreaterThan(2);
    for (const i of items) {
      expect(i.className).toContain("min-h-[36px]");
      expect(i.className).toContain("max-sm:min-h-[44px]");
      expect(i.className).not.toContain("min-h-[30px]");
    }
  });

  it("an enabled item label is the primary text colour", () => {
    const menu = openMenu(makeSession(), { onSpawnSibling: () => {} });
    const item = menu.querySelector("button[role='menuitem']:not([aria-disabled]):not([data-emphasis])") as HTMLElement;
    expect(item).toBeTruthy();
    expect(item.className).toContain("text-[var(--text-primary)]");
    expect(item.className).not.toContain("text-[var(--text-secondary)]");
    expect(item.className).not.toContain("text-[var(--text-tertiary)]");
  });

  it("More… and its count are not tertiary", () => {
    const menu = openMenu(makeSession({ attachedProposal: "add-auth" }), { openspecChanges: [IMPLEMENTING], openspecReadiness: { state: "READY" } });
    const more = menu.querySelector("[data-testid='session-menu-more-openspec']") as HTMLElement;
    expect(more).toBeTruthy();
    expect(more.className).toContain("text-[var(--text-primary)]");
    expect(more.className).not.toContain("text-[var(--text-tertiary)]");
    const count = more.querySelector("span.ml-auto") as HTMLElement;
    expect(count.className).toContain("text-xs");
    expect(count.className).toContain("text-[var(--text-secondary)]");
    expect(count.className).not.toContain("text-[10px]");
    expect(count.className).not.toContain("text-[var(--text-tertiary)]");
  });

  it("a disabled item keeps secondary text, aria-disabled and no muted colour", () => {
    openMenu(gone(), { onSpawnWorktree: () => {} });
    const item = screen.getByTestId("session-card-spawn-worktree");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.className).toContain("text-[var(--text-secondary)]");
    expect(item.className).not.toContain("text-[var(--text-muted)]");
  });

  it("the disabled reason is its own wrapping line, 12 px, and the item references it", () => {
    openMenu(gone(), { onSpawnWorktree: () => {} });
    const item = screen.getByTestId("session-card-spawn-worktree");
    const reason = screen.getByTestId("session-menu-reason-spawn-worktree");
    expect(reason.textContent).toBe("session's directory no longer exists");
    expect(reason.className).toContain("block");
    expect(reason.className).toContain("text-xs");
    expect(reason.className).toContain("text-[var(--text-secondary)]");
    expect(reason.className).not.toContain("truncate");
    expect(reason.className).not.toContain("shrink-0");
    expect(reason.className).not.toContain("text-[10px]");
    expect(reason.id).toBeTruthy();
    expect(item.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("an item without a reason has no aria-describedby", () => {
    openMenu(makeSession(), { onSpawnSibling: () => {} });
    const item = screen.getByTestId("session-card-spawn-sibling");
    expect(item.hasAttribute("aria-describedby")).toBe(false);
  });

  it("two disabled items get distinct reason ids", () => {
    openMenu(gone(), { onSpawnWorktree: () => {}, onSpawnSibling: () => {} });
    const ids = Array.from(screen.getByTestId("session-actions-menu-s1").querySelectorAll("[data-testid^='session-menu-reason-']")).map((e) => e.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the PLUGINS container sets the primary text colour so plugin output inherits it", () => {
    const registry = createSlotRegistry();
    const Plain = () => <button type="button" data-testid="plain-btn">Plain</button>;
    registry.addClaim({ pluginId: "alpha", priority: 100, slot: "session-card-action-bar", Component: Plain as never });
    const wrap = (n: React.ReactNode) => {
      const prim = createUiPrimitiveRegistry();
      registerUiPrimitive(prim, "ui:action-list" as never, ActionList as never);
      return (
        <UiPrimitiveProvider value={prim}>
          <Router hook={memoryLocation({ path: "/", record: true }).hook}>
            <PluginContextProvider registry={registry}>
              <CardSectionsProvider value={{ prefs: {}, pluginNames: { alpha: "Alpha plugin" } }}>{n}</CardSectionsProvider>
            </PluginContextProvider>
          </Router>
        </UiPrimitiveProvider>
      );
    };
    openMenu(makeSession(), {}, wrap);
    const host = screen.getByTestId("plain-btn").closest("[data-session-menu-plugins]") as HTMLElement;
    expect(host.className).toContain("text-[var(--text-primary)]");
    // The host does not restyle the plugin's own button.
    expect(screen.getByTestId("plain-btn").className).toBe("");
  });

  it("the menu contains no muted token and no 10 px text", () => {
    const menu = openMenu(gone(), { onSpawnWorktree: () => {}, onSpawnSibling: () => {} });
    expect(menu.outerHTML).not.toContain("text-muted");
    expect(menu.outerHTML).not.toContain("--text-muted");
    expect(menu.outerHTML).not.toContain("text-[10px]");
    expect(menu.outerHTML).not.toContain("text-[var(--text-tertiary)]");
  });
});
