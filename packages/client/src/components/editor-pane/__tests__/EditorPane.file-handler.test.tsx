/**
 * EditorPane + FileHandlerLayer integration: switcher (E7–E10), handlerMode
 * restore (E11), leave guards (F7), refresh wiring (F13), plugin disable (F8),
 * beforeunload (F9), overlay alignment (F14).
 * See change: add-editor-pane-file-handlers (D2, D5, tasks 3.2, 5.1–5.3).
 */

import { createHash } from "node:crypto";
import { __resetSlotClaimsVersionForTests, bumpSlotClaimsVersion, createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_PANE_KEY_PREFIX } from "../../../lib/layout/editor-pane-state.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";
import { FileHandlerLayer } from "../file-handler/FileHandlerLayer.js";
import { createFileHandlerStore, type FileHandlerStore } from "../file-handler/file-handler-store.js";
import { FileHandlerStoreProvider } from "../file-handler/use-file-handler-store.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

// The built-in viewer is a probe: mounting it is what "built-in view" means.
const cappedMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../CappedViewer.js", async () => {
  const React = await import("react");
  return {
    CappedViewer: ({ path }: { path: string }) => {
      React.useEffect(() => {
        cappedMounts.count++;
      }, []);
      return React.createElement("div", { "data-testid": "capped-viewer" }, path);
    },
  };
});

let handlerMounts = 0;
let dirtyOnLoad: boolean | "unknown" = false;
function Handler(p: { path: string; setDirty: (s: boolean | "unknown") => void }) {
  useEffect(() => {
    handlerMounts++;
    if (dirtyOnLoad !== "unknown") p.setDirty(dirtyOnLoad);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div data-testid="handler-body">{p.path}</div>;
}

const meta = (id: string, over = {}) => ({ id, extensions: [".docx"], mode: "edit" as const, label: `Edit ${id}`, keepAlive: { max: 3 }, copySuffix: "x", ...over });
const addClaim = (reg: ReturnType<typeof createSlotRegistry>, pluginId: string, priority: number, id = "docx", over = {}) =>
  reg.addClaim({ pluginId, priority, slot: "editor-pane-file-handler", fileHandler: meta(id, over), Component: Handler } as never);

const tab = (path: string, extra: Record<string, unknown> = {}) => ({ path, viewer: "docx", addedAt: 1, ...extra });
function seed(files: Array<ReturnType<typeof tab>>, activeIndex = 0, sessionId = "s1") {
  localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}${sessionId}`, JSON.stringify({ openFiles: files, activeIndex, treeOpenRoots: [] }));
}


/**
 * Per-file in-memory `localStorage`: under `npm test` Node's file-backed
 * `localStorage` is shared by every worker, so another file's `clear()` would
 * race these seeds.
 */
function installMemoryStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  });
}

let store: FileHandlerStore;
const originalFetch = globalThis.fetch;
const sha = (v: string) => createHash("sha1").update(v).digest("hex");
let digestSha = sha("v1");
let fetched: string[] = [];

beforeEach(() => {
  installMemoryStorage();
  __resetSlotClaimsVersionForTests();
  cappedMounts.count = 0;
  handlerMounts = 0;
  dirtyOnLoad = false;
  digestSha = sha("v1");
  fetched = [];
  store = createFileHandlerStore();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input), "http://x");
    fetched.push(u.pathname);
    if (u.pathname === "/api/file/digest") return new Response(JSON.stringify({ success: true, data: { size: 2, mtime: 1, sha1: digestSha } }));
    if (u.pathname === "/api/file/raw") return new Response("v1");
    return new Response(JSON.stringify({ success: true, data: { entries: [] } }));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type MountOpts = { sessionPane?: boolean; layer?: boolean; cwd?: string; candidates?: Map<string, number> };
function tree(reg: ReturnType<typeof createSlotRegistry>, opts: MountOpts) {
  return (
    <PluginContextProvider registry={reg}>
      <FileHandlerStoreProvider value={store}>
        <SplitWorkspaceProvider
          sessionId="s1"
          cwd={opts.cwd ?? "/proj"}
          orientation="h"
          changeDetection={opts.sessionPane !== false}
          changedFiles={opts.candidates}
        >
          <EditorPane />
          {opts.layer !== false && <FileHandlerLayer />}
        </SplitWorkspaceProvider>
      </FileHandlerStoreProvider>
    </PluginContextProvider>
  );
}
function mount(reg: ReturnType<typeof createSlotRegistry>, opts: MountOpts = {}) {
  const r = render(tree(reg, opts));
  return Object.assign(r, { withOpts: (next: MountOpts) => r.rerender(tree(reg, next)) });
}

const switcherLabels = () => within(screen.getByTestId("file-mode-switcher")).getAllByRole("button").map((b) => b.textContent);
const answer = async (testId: string, action: string) => {
  const btn = await screen.findByTestId(`${testId}-${action}`);
  fireEvent.click(btn);
};

describe("switcher (E7–E10)", () => {
  it("E7: 0 claims → no switcher; 1 → Preview + label; 2 → Preview, ascending priority, then plugin id", () => {
    seed([tab("report.docx")]);
    const none = mount(createSlotRegistry());
    expect(screen.queryByTestId("file-mode-switcher")).toBeNull();
    none.unmount();

    const one = createSlotRegistry();
    addClaim(one, "alpha", 1000);
    const r1 = mount(one);
    expect(switcherLabels()).toEqual(["Preview", "Edit docx"]);
    r1.unmount();

    const two = createSlotRegistry();
    addClaim(two, "alpha", 1000, "docx");
    addClaim(two, "zeta", 100, "docx");
    addClaim(two, "beta", 1000, "docx");
    mount(two);
    // zeta (100) first, then alpha, beta (same priority → plugin id)
    expect(within(screen.getByTestId("file-mode-switcher")).getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual([
      "file-mode-builtin",
      "file-mode-zeta/docx",
      "file-mode-alpha/docx",
      "file-mode-beta/docx",
    ]);
  });

  it.each([["REPORT.DOCX"], ["a.Docx"]])("E8: %s matches a .docx claim case-insensitively", (name) => {
    seed([tab(name)]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    expect(screen.getByTestId("file-mode-switcher")).toBeTruthy();
  });

  it("E9: folder pane → no switcher; outside the session cwd → unavailable; under cwd → modes", () => {
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    seed([tab("report.docx")]);
    const folder = mount(reg, { sessionPane: false });
    expect(screen.queryByTestId("file-mode-switcher")).toBeNull();
    folder.unmount();

    seed([tab("../elsewhere/report.docx")]);
    const outside = mount(reg);
    expect(screen.getByTestId("file-mode-unavailable").textContent).toMatch(/outside the session folder/);
    expect(screen.queryByTestId("file-mode-alpha/docx")).toBeNull();
    outside.unmount();

    seed([tab("report.docx")]);
    mount(reg);
    expect(screen.getByTestId("file-mode-alpha/docx")).toBeTruthy();
  });

  it("E10: with a handler mode selected the built-in viewer is not mounted and nothing is rendered/fetched for it", async () => {
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    expect(screen.queryByTestId("capped-viewer")).toBeNull();
    expect(cappedMounts.count).toBe(0);
    expect(fetched.some((p) => p === "/api/file/render" || p === "/api/file")).toBe(false);
  });

  it("selecting Preview mounts the built-in view; selecting the mode switches back", async () => {
    seed([tab("report.docx")]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("capped-viewer");
    fireEvent.click(screen.getByTestId("file-mode-alpha/docx"));
    await screen.findByTestId("handler-body");
    expect(screen.queryByTestId("capped-viewer")).toBeNull();
    // clean (dirty=false) → switching away needs no confirm
    fireEvent.click(screen.getByTestId("file-mode-builtin"));
    await screen.findByTestId("capped-viewer");
    expect(store.getState().instances).toHaveLength(0);
  });
});

describe("handlerMode restore (E11)", () => {
  it("restores a valid mode, falls back to the built-in view for an unknown claim, keeps every tab", async () => {
    seed([tab("a.docx", { handlerMode: 42 }), tab("b.docx", { handlerMode: "alpha/docx" }), tab("c.docx", { handlerMode: "gone/x" })], 1);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    expect(screen.getAllByTestId("editor-tab")).toHaveLength(3);
    await screen.findByTestId("handler-body"); // b: restored
    fireEvent.click(screen.getAllByTestId("editor-tab")[2]); // c: unknown claim → built-in
    await screen.findByTestId("capped-viewer");
    // b's instance stays alive but hidden behind the built-in view.
    expect(screen.getByTestId("file-handler-instance").getAttribute("data-visible")).toBe("0");
    fireEvent.click(screen.getAllByTestId("editor-tab")[0]); // a: field dropped → built-in
    await waitFor(() => expect(screen.getByTestId("capped-viewer").textContent).toBe("a.docx"));
  });
});

describe("leave guards (F7)", () => {
  async function dirtyHandlerPane(extraTabs: Array<ReturnType<typeof tab>> = []) {
    dirtyOnLoad = true;
    seed([tab("report.docx", { handlerMode: "alpha/docx" }), ...extraTabs]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    const r = mount(reg);
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(true));
    return { reg, r };
  }

  it("mode switch with unsaved edits confirms; Cancel keeps the handler and its edits", async () => {
    await dirtyHandlerPane();
    fireEvent.click(screen.getByTestId("file-mode-builtin"));
    await screen.findByTestId("file-handler-guard-dialog");
    fireEvent.click(screen.getByTestId("file-handler-guard-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-guard-dialog")).toBeNull());
    expect(screen.getByTestId("handler-body")).toBeTruthy();
    expect(screen.queryByTestId("capped-viewer")).toBeNull();
    expect(handlerMounts).toBe(1);
  });

  it("mode switch confirmed discards the instance and shows the built-in view", async () => {
    await dirtyHandlerPane();
    fireEvent.click(screen.getByTestId("file-mode-builtin"));
    await answer("file-handler-guard-dialog", "discard");
    await screen.findByTestId("capped-viewer");
    await waitFor(() => expect(store.getState().instances).toHaveLength(0));
  });

  it("closing the last tab of a dirty instance confirms first; Cancel keeps the tab", async () => {
    await dirtyHandlerPane();
    fireEvent.click(screen.getByLabelText(/Close report\.docx/));
    await screen.findByTestId("file-handler-guard-dialog");
    fireEvent.click(screen.getByTestId("file-handler-guard-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-guard-dialog")).toBeNull());
    expect(screen.getAllByTestId("editor-tab")).toHaveLength(1);
    expect(store.getState().instances).toHaveLength(1);
  });

  it("closing the last tab, confirmed, closes it and drops the instance", async () => {
    await dirtyHandlerPane();
    fireEvent.click(screen.getByLabelText(/Close report\.docx/));
    await answer("file-handler-guard-dialog", "discard");
    await waitFor(() => expect(screen.queryAllByTestId("editor-tab")).toHaveLength(0));
    await waitFor(() => expect(store.getState().instances).toHaveLength(0));
  });

  it("a clean instance closes without a prompt", async () => {
    dirtyOnLoad = false;
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(false));
    fireEvent.click(screen.getByLabelText(/Close report\.docx/));
    await waitFor(() => expect(screen.queryAllByTestId("editor-tab")).toHaveLength(0));
    expect(screen.queryByTestId("file-handler-guard-dialog")).toBeNull();
  });

  it("an unknown-state instance (never called setDirty) is guarded like a dirty one", async () => {
    dirtyOnLoad = "unknown";
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    fireEvent.click(screen.getByTestId("file-mode-builtin"));
    const dlg = await screen.findByTestId("file-handler-guard-dialog");
    expect(dlg.textContent).toMatch(/may have unsaved/);
  });
});

describe("refresh wiring (F13) + banner (F7)", () => {
  const reloadBtn = () => screen.getByTitle("Reload file");

  it("F13: header refresh remounts the handler after the guard and never re-keys the built-in viewer", async () => {
    dirtyOnLoad = false;
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(false));
    const remount = vi.spyOn(store, "remount");
    fireEvent.click(reloadBtn());
    await waitFor(() => expect(remount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handlerMounts).toBe(2));
    expect(cappedMounts.count).toBe(0);
  });

  it("header refresh with unsaved edits confirms; Cancel does not remount", async () => {
    dirtyOnLoad = true;
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(true));
    fireEvent.click(reloadBtn());
    await screen.findByTestId("file-handler-guard-dialog");
    fireEvent.click(screen.getByTestId("file-handler-guard-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-guard-dialog")).toBeNull());
    expect(handlerMounts).toBe(1);
  });

  it("banner Refresh confirms; Cancel leaves the banner shown, confirm remounts and clears it", async () => {
    dirtyOnLoad = true;
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    const m = mount(reg, { candidates: new Map() });
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(true));
    // Handler body baseline: the harness handler never snapshots, so seed the
    // baseline the way a snapshot does; the agent then rewrites the file.
    await act(async () => {
      await store.getInstance(store.getState().instances[0].key)!.host.snapshot();
    });
    digestSha = sha("v2");
    m.withOpts({ candidates: new Map([["report.docx", 1]]) });
    const banner = await screen.findByTestId("changed-on-disk-banner", undefined, { timeout: 4000 });
    fireEvent.click(within(banner).getByTestId("changed-refresh"));
    await screen.findByTestId("file-handler-guard-dialog");
    fireEvent.click(screen.getByTestId("file-handler-guard-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-guard-dialog")).toBeNull());
    expect(screen.getByTestId("changed-on-disk-banner")).toBeTruthy();
    expect(handlerMounts).toBe(1);
    fireEvent.click(within(screen.getByTestId("changed-on-disk-banner")).getByTestId("changed-refresh"));
    await answer("file-handler-guard-dialog", "discard");
    await waitFor(() => expect(handlerMounts).toBe(2));
    await waitFor(() => expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull());
  });
});

describe("live plugin disable (F8)", () => {
  it("clean → closed, built-in view; dirty → kept with the re-enable-or-discard overlay", async () => {
    dirtyOnLoad = false;
    seed([tab("clean.docx", { handlerMode: "alpha/docx" }), tab("dirty.docx", { handlerMode: "alpha/docx" })], 0);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    await screen.findByTestId("handler-body");
    await waitFor(() => expect(store.getState().instances[0]?.dirty).toBe(false));
    // open the second tab's instance as dirty
    dirtyOnLoad = true;
    fireEvent.click(screen.getAllByTestId("editor-tab")[1]);
    await waitFor(() => expect(store.getState().instances).toHaveLength(2));
    await waitFor(() => expect(store.getState().instances.find((i) => i.path === "dirty.docx")?.dirty).toBe(true));

    // The plugin is disabled live.
    act(() => {
      reg.setEnabledSet(new Set());
      bumpSlotClaimsVersion();
    });
    await waitFor(() => expect(store.getState().instances.map((i) => i.path)).toEqual(["dirty.docx"]));
    expect((await screen.findByTestId("file-handler-disabled-overlay")).textContent).toMatch(/Re-enable it to save, or discard/);
    // The clean tab fell back to the built-in view.
    fireEvent.click(screen.getAllByTestId("editor-tab")[0]);
    await screen.findByTestId("capped-viewer");
  });
});

describe("beforeunload (F9)", () => {
  const fire = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it.each([
    ["no instance", undefined, false],
    ["clean", false, false],
    ["dirty", true, true],
    ["unknown", "unknown" as const, true],
  ])("%s → prevented=%s", async (_n, state, prevented) => {
    seed([]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    if (state !== undefined) {
      await store.activate({ sessionId: "s1", cwd: "/proj", path: "x.docx", claim: { key: "alpha/docx", pluginId: "alpha", claimId: "docx", priority: 1000, meta: meta("docx"), Component: Handler } });
      const key = store.getState().instances[0].key;
      store.setDirty(key, state);
    }
    expect(fire()).toBe(prevented);
  });
});

describe("overlay alignment (F14)", () => {
  it("the visible instance follows the anchor rect on every ResizeObserver callback", async () => {
    let cb: (() => void) | null = null;
    class RO {
      constructor(c: () => void) {
        cb = c;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", RO);
    let rect = { top: 10, left: 20, width: 300, height: 200 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ ...rect, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} }) as DOMRect);
    seed([tab("report.docx", { handlerMode: "alpha/docx" })]);
    const reg = createSlotRegistry();
    addClaim(reg, "alpha", 1000);
    mount(reg);
    const inst = await screen.findByTestId("file-handler-instance");
    await waitFor(() => expect(inst.getAttribute("data-visible")).toBe("1"));
    const css = () => ({ top: inst.style.top, left: inst.style.left, width: inst.style.width, height: inst.style.height });
    expect(css()).toEqual({ top: "10px", left: "20px", width: "300px", height: "200px" });
    rect = { top: 50, left: 60, width: 400, height: 250 };
    act(() => cb?.());
    expect(css()).toEqual({ top: "50px", left: "60px", width: "400px", height: "250px" });
    vi.unstubAllGlobals();
  });
});
