/**
 * Pane bar + document bar (test-plan #E8–#E10, #E13, #E15–#E17, #E19, #E21–#E24,
 * #F11, #X1–#X3, #X5). See change: scope-anchor-editor-pane-controls (D1–D3, D9–D11).
 */
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryStorage, mount, readPane, seedPane, stubFetch, stubResizeObserver, tab, treeVisibleKey } from "./chrome-harness.js";

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
beforeEach(() => {
  installMemoryStorage();
  stubFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const health = (over: Record<string, unknown> = {}) => stubFetch({ capabilities: { systemOpen: true }, platform: "darwin", ...over });
/** Flush the one-shot `/api/health` capability read. */
const settle = () => act(async () => void (await Promise.resolve()));

describe("pane bar (D1)", () => {
  it("#E16 an empty pane keeps Files, + and ✕, disables Search tabs and shows no document bar", () => {
    seedPane("s1", [], -1);
    mount();
    expect(screen.getByTestId("tree-toggle")).toBeTruthy();
    expect(screen.getByTestId("new-tab-menu-toggle")).toBeTruthy();
    expect(screen.getByTestId("editor-pane-close")).toBeTruthy();
    expect((screen.getByTestId("tab-search-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("doc-bar")).toBeNull();
  });

  it("#E16 closing the only tab leaves that same bar", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    expect(screen.getByTestId("doc-bar")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close a.ts"));
    expect(screen.getByTestId("new-tab-menu-toggle")).toBeTruthy();
    expect((screen.getByTestId("tab-search-toggle") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("doc-bar")).toBeNull();
  });

  it("#E17 the + menu offers Terminal, Live preview, Open file… in a session pane", () => {
    seedPane("s1", [], -1);
    mount({ kind: "session" });
    fireEvent.click(screen.getByTestId("new-tab-menu-toggle"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByTestId("new-terminal-launch")).toBeTruthy();
    expect(within(menu).getByTestId("live-preview-launch")).toBeTruthy();
    expect(within(menu).getByTestId("open-file-launch")).toBeTruthy();
  });

  it("#E17 a folder pane's + menu has no Open file…", () => {
    seedPane("s1", [], -1);
    mount({ kind: "folder" });
    fireEvent.click(screen.getByTestId("new-tab-menu-toggle"));
    expect(screen.getByTestId("new-terminal-launch")).toBeTruthy();
    expect(screen.getByTestId("live-preview-launch")).toBeTruthy();
    expect(screen.queryByTestId("open-file-launch")).toBeNull();
  });

  it("#E24 + → Terminal creates a terminal in the pane cwd", () => {
    seedPane("s1", [], -1);
    const onCreateTerminal = vi.fn();
    mount({ cwd: "/home/u/proj", onCreateTerminal });
    fireEvent.click(screen.getByTestId("new-tab-menu-toggle"));
    fireEvent.click(screen.getByTestId("new-terminal-launch"));
    expect(onCreateTerminal).toHaveBeenCalledWith("/home/u/proj");
  });

  it("+ → Live preview opens the live:preview tab", () => {
    seedPane("s1", [], -1);
    mount();
    fireEvent.click(screen.getByTestId("new-tab-menu-toggle"));
    fireEvent.click(screen.getByTestId("live-preview-launch"));
    expect(readPane("s1").openFiles.map((f) => f.path)).toContain("live:preview");
  });

  it("D9 menu keys: first item focused, ↓ wraps, Escape closes and refocuses the trigger", () => {
    seedPane("s1", [], -1);
    mount();
    const toggle = screen.getByTestId("new-tab-menu-toggle");
    fireEvent.click(toggle);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("#E19 the Files toggle's name starts with its label and aria-pressed follows the rail", () => {
    seedPane("s1", [], -1);
    mount();
    const toggle = screen.getByRole("button", { name: /^Files/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(window, { key: "p", metaKey: true });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("#E22 ✕ unsplits the pane and keeps the tabs", () => {
    seedPane("s1", [tab("a.ts"), tab("b.ts"), tab("c.ts")], 0);
    localStorage.setItem("pi-dashboard:split:s1", JSON.stringify({ mode: "split", ratio: 0.5, orientation: "h" }));
    mount();
    fireEvent.click(screen.getByTestId("editor-pane-close"));
    const split = JSON.parse(localStorage.getItem("pi-dashboard:split:s1") ?? "{}");
    expect(split.mode).toBe("closed");
    expect(readPane("s1").openFiles).toHaveLength(3);
  });
});

describe("document bar (D2, D3, D10, D11)", () => {
  it("#E9 file tab: breadcrumb, Reload, ⋯; Open/Reveal only with systemOpen", async () => {
    health();
    seedPane("s1", [tab("Projektek/BOSCH/memo.pdf")], 0);
    mount();
    await settle();
    const bar = screen.getByTestId("doc-bar");
    expect(within(bar).getByTestId("doc-breadcrumb").textContent).toContain("memo.pdf");
    expect(within(bar).getByTestId("tab-reload")).toBeTruthy();
    expect(within(bar).getByTestId("doc-more-menu")).toBeTruthy();
    await waitFor(() => expect(within(bar).getByTestId("tab-open-in-app")).toBeTruthy());
    expect(within(bar).getByTestId("tab-reveal-in-file-manager")).toBeTruthy();
  });

  it("#E9 systemOpen false hides Open/Reveal", async () => {
    stubFetch({ capabilities: { systemOpen: false }, platform: "darwin" });
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    await settle();
    expect(screen.queryByTestId("tab-open-in-app")).toBeNull();
    expect(screen.queryByTestId("tab-reveal-in-file-manager")).toBeNull();
  });

  it("#E9 outside cwd: absolute inert breadcrumb, ⋯ without Show in tree / Copy relative", async () => {
    seedPane("s1", [tab("/etc/hosts")], 0);
    mount();
    await settle();
    const crumb = screen.getByTestId("doc-breadcrumb");
    expect(crumb.textContent).toContain("/etc/");
    expect(crumb.querySelectorAll("button")).toHaveLength(1); // the leaf only
    fireEvent.click(screen.getByTestId("doc-more-menu"));
    expect(screen.queryByTestId("doc-show-in-tree")).toBeNull();
    expect(screen.queryByTestId("doc-copy-rel")).toBeNull();
    expect(screen.getByTestId("doc-copy-full")).toBeTruthy();
  });

  it("#E9 url tab: url + Open in system browser; other pseudo tabs: title line only; none: no bar", async () => {
    seedPane("s1", [tab("url:https://example.com/x"), tab("diff:src/a.ts"), tab("live:preview"), tab("term:t1")], 0);
    mount({ terminals: [{ id: "t1", title: "zsh" }] });
    await settle();
    expect(within(screen.getByTestId("doc-bar")).getByTestId("tab-open-in-browser")).toBeTruthy();
    expect(screen.getByTestId("doc-bar").textContent).toContain("https://example.com/x");
    for (const [i, expected] of [[1, "a.ts"], [2, "preview"], [3, "zsh"]] as const) {
      fireEvent.click(screen.getAllByTestId("editor-tab")[i]);
      const bar = screen.getByTestId("doc-bar");
      expect(within(bar).getByTestId("doc-title").textContent).toContain(expected);
      expect(within(bar).queryByTestId("tab-open-in-browser")).toBeNull();
      expect(within(bar).queryByTestId("doc-more-menu")).toBeNull();
    }
  });

  it.each([
    ["darwin", "Reveal in Finder"],
    ["win32", "Show in Explorer"],
    ["linux", "Reveal in file manager"],
    [undefined, "Reveal in file manager"],
    [42, "Reveal in file manager"],
  ])("#E10/#X2 platform %s labels Reveal %s", async (platform, label) => {
    stubFetch({ capabilities: { systemOpen: true }, platform });
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    await waitFor(() => expect(screen.getByTestId("tab-reveal-in-file-manager").getAttribute("aria-label")).toBe(label));
  });

  it("#X1 a failing /api/health hides Open/Reveal without throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    await settle();
    expect(screen.getByTestId("doc-bar")).toBeTruthy();
    expect(screen.queryByTestId("tab-open-in-app")).toBeNull();
  });

  it("#E8 narrow fold at 639 / 640 / 641 px: Open/Reveal move into ⋯, ids stay unique", async () => {
    health();
    const ro = stubResizeObserver();
    seedPane("s1", [tab("Projektek/BOSCH/memo.pdf")], 0);
    mount();
    await waitFor(() => expect(screen.getByTestId("tab-open-in-app")).toBeTruthy());
    const count = (id: string) => screen.queryAllByTestId(id).length;
    const ids = ["tab-open-in-app", "tab-reveal-in-file-manager"];

    ro.setWidth(641);
    expect(screen.getByTestId("doc-breadcrumb").textContent).toContain("Projektek");
    expect(ids.map(count)).toEqual([1, 1]);
    expect(within(screen.getByTestId("doc-bar")).getByTestId("tab-open-in-app")).toBeTruthy();

    ro.setWidth(640);
    expect(ids.map(count)).toEqual([1, 1]);
    expect(screen.getByTestId("doc-breadcrumb").textContent).toContain("Projektek");

    ro.setWidth(639);
    expect(screen.getByTestId("doc-breadcrumb").textContent).toContain("…");
    expect(screen.getByTestId("doc-breadcrumb").textContent).not.toContain("Projektek");
    expect(ids.map(count)).toEqual([0, 0]); // folded: not in the bar, menu closed
    fireEvent.click(screen.getByTestId("doc-more-menu"));
    expect(ids.map(count)).toEqual([1, 1]);
    expect(within(screen.getByRole("menu")).getByTestId("tab-open-in-app")).toBeTruthy();
    // The Files label survives the fold.
    expect(screen.getByTestId("tree-toggle").textContent).toContain("Files");
  });

  it("#E21 the mode switcher lives in the doc bar; outside the cwd it shows unavailable", async () => {
    const reg = createSlotRegistry();
    reg.addClaim({
      pluginId: "p",
      priority: 1,
      slot: "editor-pane-file-handler",
      fileHandler: { id: "pdf", extensions: [".pdf"], mode: "edit", label: "Edit in PdfCraft", keepAlive: { max: 3 }, copySuffix: "x" },
      Component: () => null,
    } as never);
    seedPane("s1", [tab("Projektek/BOSCH/memo.pdf")], 0);
    const { unmount } = mount({ registry: reg });
    await settle();
    const bar = screen.getByTestId("doc-bar");
    expect(within(bar).getByTestId("file-mode-switcher")).toBeTruthy();
    expect(within(bar).getByTestId("file-mode-p/pdf").textContent).toBe("Edit in PdfCraft");
    unmount();
    cleanup();
    seedPane("s1", [tab("/elsewhere/memo.pdf")], 0);
    mount({ registry: reg });
    await settle();
    expect(within(screen.getByTestId("doc-bar")).getByTestId("file-mode-unavailable")).toBeTruthy();
  });

  it("#E13 a breadcrumb folder expands only, shows the rail and persists visibility", async () => {
    seedPane("s1", [tab("Projektek/BOSCH/memo.pdf")], 0, ["Projektek", "Projektek/Other"]);
    mount();
    await settle();
    fireEvent.keyDown(window, { key: "f", shiftKey: true, metaKey: true }); // Search view open, rail collapsed
    expect(screen.getByTestId("editor-search-panel")).toBeTruthy();
    expect(localStorage.getItem(treeVisibleKey("s1"))).not.toBe("true"); // search never persists a reveal
    fireEvent.click(within(screen.getByTestId("doc-breadcrumb")).getByText("BOSCH"));
    expect(readPane("s1").treeOpenRoots).toEqual(expect.arrayContaining(["Projektek", "Projektek/Other", "Projektek/BOSCH"]));
    expect(screen.queryByTestId("editor-search-panel")).toBeNull();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("true");
  });

  it("#E15 ⋯ copies the full path, the relative path and the file name, then confirms", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    seedPane("s1", [tab("Projektek/BOSCH/memo.pdf")], 0);
    mount({ cwd: "/u/proj" });
    await settle();
    for (const [id, text] of [
      ["doc-copy-full", "/u/proj/Projektek/BOSCH/memo.pdf"],
      ["doc-copy-rel", "Projektek/BOSCH/memo.pdf"],
      ["doc-copy-name", "memo.pdf"],
    ] as const) {
      fireEvent.click(screen.getByTestId("doc-more-menu"));
      fireEvent.click(screen.getByTestId(id));
      expect(writeText).toHaveBeenLastCalledWith(text);
      expect(within(screen.getByTestId(id)).getByTestId ? screen.getByTestId(id).querySelector("svg") : null).toBeTruthy();
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    }
  });

  it("#X3 without navigator.clipboard the shipped fallback runs and nothing throws", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    await settle();
    fireEvent.click(screen.getByTestId("doc-more-menu"));
    expect(() => fireEvent.click(screen.getByTestId("doc-copy-rel"))).not.toThrow();
    await waitFor(() => expect(exec).toHaveBeenCalledWith("copy"));
  });

  it("#E23 Reload re-requests the file without reopening the tab; a folder pane shows no banner", async () => {
    seedPane("s1", [tab("foo.ts")], 0);
    const { unmount } = mount({ kind: "session" });
    await settle();
    expect(screen.getByTestId("capped-viewer")).toBeTruthy();
    const before = screen.getByTestId("capped-viewer");
    fireEvent.click(screen.getByTestId("tab-reload"));
    // The viewer is re-keyed by the refresh nonce: a fresh mount, same single tab.
    await waitFor(() => expect(screen.getByTestId("capped-viewer")).not.toBe(before));
    expect(readPane("s1").openFiles.map((f) => f.path)).toEqual(["foo.ts"]);
    unmount();
    cleanup();
    seedPane("s1", [tab("foo.ts")], 0);
    mount({ kind: "folder" });
    await settle();
    fireEvent.click(screen.getByTestId("tab-reload"));
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  });

  it("#F11 a terminal rename updates the tab and the title line together", async () => {
    seedPane("s1", [tab("term:t1")], 0);
    const view = mount({ terminals: [{ id: "t1", title: "zsh" }] });
    await settle();
    expect(screen.getByTestId("doc-title").textContent).toBe("zsh");
    expect(screen.getByTestId("editor-tab").textContent).toContain("zsh");
    view.rerender(
      (await import("./chrome-harness.js")).tree({ terminals: [{ id: "t1", title: "build" }] }),
    );
    expect(screen.getByTestId("doc-title").textContent).toBe("build");
    expect(screen.getByTestId("editor-tab").textContent).toContain("build");
  });

  it("#F11/#X5 a plugin label renders in the strip and the title line; a throwing label is contained", async () => {
    const ok = createSlotRegistry();
    ok.addClaim({
      pluginId: "browser",
      priority: 1,
      slot: "editor-pane-tab",
      pathPrefix: "browser",
      Component: () => null,
      LabelComponent: () => <i data-testid="plugin-label">Docs site</i>,
    } as never);
    seedPane("s1", [tab("browser:i:1")], 0);
    mount({ registry: ok });
    await settle();
    expect(screen.getAllByTestId("plugin-label")).toHaveLength(2); // strip + doc bar
    expect(within(screen.getByTestId("doc-bar")).getByTestId("plugin-label")).toBeTruthy();
    cleanup();

    const bad = createSlotRegistry();
    bad.addClaim({
      pluginId: "browser",
      priority: 1,
      slot: "editor-pane-tab",
      pathPrefix: "browser",
      Component: () => null,
      LabelComponent: () => {
        throw new Error("boom");
      },
    } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedPane("s1", [tab("browser:i:1"), tab("a.ts")], 0);
    mount({ registry: bad });
    await settle();
    expect(screen.getByTestId("doc-bar")).toBeTruthy();
    expect(screen.getByTestId("pane-bar")).toBeTruthy();
    expect(screen.getAllByTestId("editor-tab")).toHaveLength(2);
  });
});
