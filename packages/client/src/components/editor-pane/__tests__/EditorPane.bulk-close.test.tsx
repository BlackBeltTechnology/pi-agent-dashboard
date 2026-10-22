/**
 * Tab context menu, bulk close and Search tabs (test-plan #E14, #E18, #E25,
 * #F1–#F8, #X4, #X6). See change: scope-anchor-editor-pane-controls (D5–D9).
 */
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { fileHandlerInstanceKey } from "../file-handler/file-handler-claims.js";
import { createFileHandlerStore, type FileHandlerStore } from "../file-handler/file-handler-store.js";
import { installMemoryStorage, mount, readPane, seedPane, stubFetch, tab } from "./chrome-harness.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../CappedViewer.js", async () => {
  const React = await import("react");
  return { CappedViewer: ({ path }: { path: string }) => React.createElement("div", { "data-testid": "capped-viewer" }, path) };
});
vi.mock("../../terminal/TerminalView.js", async () => {
  const React = await import("react");
  return { TerminalView: ({ terminalId }: { terminalId: string }) => React.createElement("div", { "data-testid": `terminal-view-${terminalId}` }) };
});

const originalFetch = globalThis.fetch;
let store: FileHandlerStore;
let paneWrites: number;

beforeEach(() => {
  installMemoryStorage();
  const setItem = localStorage.setItem.bind(localStorage);
  paneWrites = 0;
  vi.spyOn(localStorage, "setItem").mockImplementation((k: string, v: string) => {
    if (k.startsWith("pi-dashboard:editor-pane:")) paneWrites++;
    setItem(k, v);
  });
  stubFetch();
  store = createFileHandlerStore();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CLAIM = "p/handler";
const registry = () => {
  const reg = createSlotRegistry();
  reg.addClaim({
    pluginId: "p",
    priority: 1,
    slot: "editor-pane-file-handler",
    fileHandler: { id: "handler", extensions: [".pdf", ".docx"], mode: "edit", label: "Edit", keepAlive: { max: 3 }, copySuffix: "x" },
    Component: () => null,
  } as never);
  return reg;
};
const handlerTab = (path: string) => tab(path, { handlerMode: CLAIM });
const keyOf = (path: string) => fileHandlerInstanceKey("s1", "/proj", path, CLAIM);
const paths = () => readPane("s1").openFiles.map((f) => f.path);
const tabEl = (path: string) => screen.getAllByTestId("editor-tab").find((e) => e.getAttribute("data-tab-path") === path) as HTMLElement;
const menuItem = (id: string) => screen.getByTestId(id);
const openMenuOn = (path: string) => fireEvent.contextMenu(tabEl(path));
const pressCmdW = () => fireEvent.keyDown(window, { key: "w", metaKey: true });
const settle = () => act(async () => void (await Promise.resolve()));

/** Mount with `active` tab active so the pane creates its handler instance, then set dirty states. */
async function mountWithInstances(
  tabs: ReturnType<typeof tab>[],
  dirty: Record<string, boolean | "unknown">,
  opts: Parameters<typeof mount>[0] = {},
) {
  const handlerPaths = Object.keys(dirty);
  // Activate each handler tab once (creates its instance), then settle on tab 0.
  seedPane("s1", tabs, 0);
  const view = mount({ registry: registry(), store, terminals: [{ id: "t1", title: "zsh" }], ...opts });
  await settle();
  for (const p of handlerPaths) {
    fireEvent.click(tabEl(p));
    await waitFor(() => expect(store.getInstance(keyOf(p))).toBeTruthy());
    store.setDirty(keyOf(p), dirty[p]);
  }
  fireEvent.click(tabEl(tabs[0].path));
  return view;
}

describe("tab context menu (#E14, #F7)", () => {
  it("#E14 the menu on the last tab disables 'to the right'; Close other tabs closes without a dialog", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("c.ts")], 2);
    mount();
    openMenuOn("c.ts");
    expect((menuItem("tab-menu-close-right") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId("tab-context-menu"), { key: "Escape" });

    openMenuOn("b.ts");
    fireEvent.click(menuItem("tab-menu-close-others"));
    expect(screen.queryByTestId("bulk-close-confirm")).toBeNull();
    expect(paths()).toEqual(["b.ts"]);
    expect(readPane("s1").activeIndex).toBe(0);
  });

  it("B4: outside-cwd file tabs get neither Show in file tree nor Copy path; in-cwd file tabs get both", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    seedPane("s1", [tab("src/a.ts"), tab("/etc/hosts"), tab("term:t1")], 0);
    mount({ cwd: "/proj", terminals: [{ id: "t1", title: "zsh" }] });
    openMenuOn("src/a.ts");
    expect(screen.queryByTestId("tab-menu-show-in-tree")).toBeTruthy();
    // The item copies the RELATIVE path (spec: "Copy relative path" for tabs inside the cwd).
    expect(screen.getByTestId("tab-menu-copy-path").textContent).toBe("Copy relative path");
    fireEvent.click(screen.getByTestId("tab-menu-copy-path"));
    expect(writeText).toHaveBeenLastCalledWith("src/a.ts");
    openMenuOn("/etc/hosts");
    expect(screen.queryByTestId("tab-menu-show-in-tree")).toBeNull();
    expect(screen.queryByTestId("tab-menu-copy-path")).toBeNull();
    expect(screen.getByTestId("tab-menu-close")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("tab-context-menu"), { key: "Escape" });
    openMenuOn("term:t1");
    expect(screen.queryByTestId("tab-menu-show-in-tree")).toBeNull();
  });

  it("Close tabs to the right closes only those after the clicked tab", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("c.ts")], 0);
    mount();
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-right"));
    expect(paths()).toEqual(["a.ts"]);
  });

  it("opens from the ContextMenu key and Shift+F10", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    fireEvent.keyDown(tabEl("a.ts"), { key: "ContextMenu" });
    expect(screen.getByTestId("tab-context-menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("tab-context-menu"), { key: "Escape" });
    fireEvent.keyDown(tabEl("a.ts"), { key: "F10", shiftKey: true });
    expect(screen.getByTestId("tab-context-menu")).toBeTruthy();
  });

  it("#F7 keyboard model: wrap, skip disabled, Home/End, Escape refocuses the tab", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts")], 1);
    mount();
    openMenuOn("b.ts");
    const menu = screen.getByTestId("tab-context-menu");
    const enabled = within(menu).getAllByRole("menuitem").filter((e) => !(e as HTMLButtonElement).disabled);
    expect(enabled.map((e) => e.getAttribute("data-testid"))).not.toContain("tab-menu-close-right");
    expect(document.activeElement).toBe(enabled[0]);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(enabled[5 % enabled.length]);
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(enabled[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(enabled[enabled.length - 1]);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByTestId("tab-context-menu")).toBeNull();
    expect(document.activeElement).toBe(tabEl("b.ts"));
  });
});

describe("single close stays silent (#E25)", () => {
  const closeKinds: Array<[string, () => void]> = [
    ["×", () => fireEvent.click(within(tabEl("term:t1")).getByRole("button"))],
    ["middle-click", () => fireEvent.mouseDown(tabEl("term:t1"), { button: 1 })],
    ["Cmd-W", () => pressCmdW()],
    [
      "context-menu Close",
      () => {
        openMenuOn("term:t1");
        fireEvent.click(menuItem("tab-menu-close"));
      },
    ],
  ];
  it.each(closeKinds)("%s kills the terminal with no dialog and activates a neighbour", async (_n, close) => {
    const onKillTerminal = vi.fn();
    seedPane("s1", [tab("a.ts"), tab("term:t1")], 1);
    mount({ terminals: [{ id: "t1", title: "zsh" }], onKillTerminal });
    await settle();
    close();
    expect(onKillTerminal).toHaveBeenCalledTimes(1);
    expect(onKillTerminal).toHaveBeenCalledWith("t1");
    expect(screen.queryByTestId("bulk-close-confirm")).toBeNull();
    expect(paths()).toEqual(["a.ts"]);
    expect(readPane("s1").activeIndex).toBe(0);
  });
});

describe("bulk close confirmation (#F1–#F6, #X4)", () => {
  const tabs = () => [tab("a.ts"), tab("term:t1"), handlerTab("memo.pdf")];

  it("#F1 Cancel changes nothing", async () => {
    const onKillTerminal = vi.fn();
    await mountWithInstances(tabs(), { "memo.pdf": true }, { onKillTerminal });
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    const dlg = screen.getByTestId("bulk-close-confirm");
    expect(within(dlg).getByTestId("bulk-close-list").textContent).toContain("zsh");
    expect(within(dlg).getByTestId("bulk-close-list").textContent).toContain("memo.pdf");
    fireEvent.click(screen.getByTestId("bulk-close-cancel"));
    expect(screen.queryByTestId("bulk-close-confirm")).toBeNull();
    expect(paths()).toEqual(["a.ts", "term:t1", "memo.pdf"]);
    expect(onKillTerminal).not.toHaveBeenCalled();
  });

  it("#F1 'Close all but these 2' closes the plain tab and keeps terminal + instance", async () => {
    const onKillTerminal = vi.fn();
    await mountWithInstances(tabs(), { "memo.pdf": true }, { onKillTerminal });
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    expect(screen.getByTestId("bulk-close-keep").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("bulk-close-keep"));
    expect(paths()).toEqual(["term:t1", "memo.pdf"]);
    expect(onKillTerminal).not.toHaveBeenCalled();
    expect(store.getInstance(keyOf("memo.pdf"))).toBeTruthy();
  });

  it("#F1 'Close all & discard' kills once, discards once, in ONE closeTabs dispatch", async () => {
    const onKillTerminal = vi.fn();
    await mountWithInstances(tabs(), { "memo.pdf": true }, { onKillTerminal });
    const discard = vi.spyOn(store, "discard");
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    const before = paneWrites;
    fireEvent.click(screen.getByTestId("bulk-close-discard"));
    expect(onKillTerminal).toHaveBeenCalledTimes(1);
    expect(onKillTerminal).toHaveBeenCalledWith("t1");
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith(keyOf("memo.pdf"));
    expect(paths()).toEqual([]);
    expect(paneWrites - before).toBe(1); // one state transition: no closeByPath, no per-tab closes
  });

  it("#F2 a risk that appears while the dialog is open re-shows it instead of acting", async () => {
    const onKillTerminal = vi.fn();
    await mountWithInstances([tab("a.ts"), tab("term:t1"), handlerTab("x.docx")], { "x.docx": "unknown" }, { onKillTerminal });
    const discard = vi.spyOn(store, "discard");
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    const list = () => screen.getByTestId("bulk-close-list").textContent ?? "";
    expect(list()).toContain("zsh");
    expect(list()).not.toContain("x.docx"); // unknown stays silent in bulk
    act(() => store.setDirty(keyOf("x.docx"), true));
    fireEvent.click(screen.getByTestId("bulk-close-discard"));
    expect(paths()).toHaveLength(3);
    expect(onKillTerminal).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(list()).toContain("zsh");
    expect(list()).toContain("x.docx");
  });

  it("#F3 a tab opened in the background during the dialog survives", async () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("term:t1")], 0);
    function Probe() {
      const { dispatch } = useSplitWorkspace();
      return <button type="button" data-testid="bg-open" onClick={() => dispatch({ type: "openFile", path: "c.ts", viewer: "monaco", activate: false })} />;
    }
    mount({ terminals: [{ id: "t1", title: "zsh" }], extra: <Probe /> });
    await settle();
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    fireEvent.click(screen.getByTestId("bg-open"));
    fireEvent.click(screen.getByTestId("bulk-close-discard"));
    expect(paths()).toEqual(["c.ts"]);
  });

  it("#F5 Cmd-W is inert while the dialog, the popover or a menu is open; works otherwise", async () => {
    await mountWithInstances(tabs(), { "memo.pdf": true });
    // dialog
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    pressCmdW();
    expect(paths()).toHaveLength(3);
    fireEvent.click(screen.getByTestId("bulk-close-cancel"));
    // context menu
    openMenuOn("a.ts");
    pressCmdW();
    expect(paths()).toHaveLength(3);
    fireEvent.keyDown(screen.getByTestId("tab-context-menu"), { key: "Escape" });
    // Search tabs popover
    fireEvent.click(screen.getByTestId("tab-search-toggle"));
    pressCmdW();
    expect(paths()).toHaveLength(3);
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "Escape" });
    // none open → the active tab closes
    pressCmdW();
    expect(paths()).toEqual(["term:t1", "memo.pdf"]);
  });

  it("#F6 Cancel, not the dialog ✕, holds focus on open", async () => {
    await mountWithInstances(tabs(), { "memo.pdf": true });
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("bulk-close-cancel")));
    const buttons = within(screen.getByTestId("bulk-close-confirm")).getAllByRole("button");
    const cancelAt = buttons.indexOf(screen.getByTestId("bulk-close-cancel"));
    expect(cancelAt).toBeLessThan(buttons.indexOf(screen.getByTestId("bulk-close-keep")));
    expect(cancelAt).toBeLessThan(buttons.indexOf(screen.getByTestId("bulk-close-discard")));
  });

  it("#X4 an instance evicted after listing: no throw, no discard of a missing key, tab closes", async () => {
    await mountWithInstances([tab("a.ts"), handlerTab("memo.pdf")], { "memo.pdf": true });
    openMenuOn("a.ts");
    fireEvent.click(menuItem("tab-menu-close-all"));
    expect(screen.getByTestId("bulk-close-list").textContent).toContain("memo.pdf");
    store.discard(keyOf("memo.pdf")); // evicted behind the dialog's back
    const discard = vi.spyOn(store, "discard");
    expect(() => fireEvent.click(screen.getByTestId("bulk-close-discard"))).not.toThrow();
    expect(paths()).toEqual([]);
    expect(discard).not.toHaveBeenCalled();
  });
});

describe("Search tabs popover (#E18, #F4, #F8, #X6)", () => {
  const openPopover = () => fireEvent.click(screen.getByTestId("tab-search-toggle"));
  const options = () => screen.queryAllByTestId("tab-search-option");

  it("lists tabs, filters live, Enter activates the first match", () => {
    seedPane("s1", [tab("src/alpha.ts"), tab("src/beta.ts"), tab("docs/alpha.md")], 0);
    mount();
    openPopover();
    expect(options()).toHaveLength(3);
    fireEvent.change(screen.getByTestId("tab-search-input"), { target: { value: "alpha" } });
    expect(options().map((o) => o.getAttribute("data-tab-path"))).toEqual(["src/alpha.ts", "docs/alpha.md"]);
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "Enter" });
    expect(screen.queryByTestId("tab-search-popover")).toBeNull();
    expect(readPane("s1").openFiles[readPane("s1").activeIndex].path).toBe("docs/alpha.md");
  });

  it("#E18 'Close all but the active tab' is anchored on the active tab, not the highlighted row", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("c.ts")], 0);
    mount();
    openPopover();
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "ArrowDown" }); // highlight c
    fireEvent.click(screen.getByTestId("tab-search-bulk-all-but-active"));
    expect(paths()).toEqual(["a.ts"]);
  });

  it("the footer closes the matching tabs only", () => {
    seedPane("s1", [tab("src/alpha.ts"), tab("src/beta.ts"), tab("docs/alpha.md")], 1);
    mount();
    openPopover();
    fireEvent.change(screen.getByTestId("tab-search-input"), { target: { value: "alpha" } });
    expect(screen.getByTestId("tab-search-bulk-matching").textContent).toContain("2");
    fireEvent.click(screen.getByTestId("tab-search-bulk-matching"));
    expect(paths()).toEqual(["src/beta.ts"]);
  });

  it("#F4 the popover closes before the dialog opens; Escape then dismisses only the dialog", async () => {
    seedPane("s1", [tab("a.ts"), tab("term:t1")], 0);
    mount({ terminals: [{ id: "t1", title: "zsh" }] });
    await settle();
    openPopover();
    fireEvent.change(screen.getByTestId("tab-search-input"), { target: { value: "zsh" } });
    expect(screen.getByTestId("tab-search-bulk-matching").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("tab-search-bulk-matching"));
    expect(screen.queryByTestId("tab-search-popover")).toBeNull();
    expect(screen.getByTestId("bulk-close-confirm")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("bulk-close-confirm")).toBeNull());
    expect(paths()).toEqual(["a.ts", "term:t1"]);
  });

  it("#F8 ↓ moves the active descendant; Delete closes the selected tab; text keeps Delete for editing", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("c.ts")], 0);
    mount();
    openPopover();
    const input = screen.getByTestId("tab-search-input");
    const active = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "");
    expect(active()?.getAttribute("data-tab-path")).toBe("a.ts");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()?.getAttribute("data-tab-path")).toBe("b.ts");
    fireEvent.keyDown(input, { key: "Delete" });
    expect(paths()).toEqual(["a.ts", "c.ts"]);
    expect(screen.getByTestId("tab-search-popover")).toBeTruthy();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "a" } });
    const ev = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(paths()).toEqual(["a.ts", "c.ts"]);
  });

  it("an unsaved dot appears only for confirmed unsaved edits", async () => {
    await mountWithInstances([tab("a.ts"), handlerTab("memo.pdf"), handlerTab("x.docx")], { "memo.pdf": true, "x.docx": "unknown" });
    openPopover();
    const rows = options();
    const dot = (p: string) => !!within(rows.find((r) => r.getAttribute("data-tab-path") === p) as HTMLElement).queryByTestId("tab-search-unsaved");
    expect(dot("memo.pdf")).toBe(true);
    expect(dot("x.docx")).toBe(false);
    expect(dot("a.ts")).toBe(false);
  });

  it("no match: Enter falls through to rail Search prefilled when file search exists", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount({ kind: "session" });
    openPopover();
    fireEvent.change(screen.getByTestId("tab-search-input"), { target: { value: "kickoff" } });
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "Enter" });
    expect(screen.queryByTestId("tab-search-popover")).toBeNull();
    expect((screen.getByTestId("editor-search-input") as HTMLInputElement).value).toBe("kickoff");
    expect(screen.getByTestId("mode-file").getAttribute("aria-pressed")).toBe("true");
  });

  it("#X6 a folder pane never falls through: 'No open tab matches', popover stays, no Search view", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount({ kind: "folder" });
    openPopover();
    fireEvent.change(screen.getByTestId("tab-search-input"), { target: { value: "zzz" } });
    fireEvent.keyDown(screen.getByTestId("tab-search-input"), { key: "Enter" });
    expect(screen.getByTestId("tab-search-empty").textContent).toContain("No open tab matches");
    expect(screen.getByTestId("tab-search-popover")).toBeTruthy();
    expect(screen.queryByTestId("editor-search-panel")).toBeNull();
  });
});
