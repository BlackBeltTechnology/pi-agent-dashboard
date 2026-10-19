/**
 * EditorPane × plugin file-handler modes: switcher (E7–E11), built-in not mounted
 * (E10), page-level instances + cap/eviction (F4–F6), leave guards (F7), live
 * plugin disable (F8), beforeunload (F9), shared instance (F10), refresh routing
 * (F13), overlay alignment (F14).
 * See change: add-editor-pane-file-handlers.
 */
import {
  bumpSlotClaimsVersion,
  createSlotRegistry,
  PluginContextProvider,
  ShellSessionsProvider,
  type SlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../MonacoBuffer.js", () => ({ default: () => <div data-testid="monaco-viewer" /> }));
vi.mock("../../preview/DocxPreview.js", () => ({ DocxPreview: () => <div data-testid="docx-preview" /> }));

import { EDITOR_PANE_KEY_PREFIX } from "../../../lib/layout/editor-pane-state.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";
import { installFetch } from "../file-handlers/__tests__/harness.js";
import { FileHandlerLayer } from "../file-handlers/FileHandlerLayer.js";
import { instanceKey } from "../file-handlers/file-handler-logic.js";
import { fileHandlerStore } from "../file-handlers/file-handler-store.js";

const originalFetch = globalThis.fetch;
const session = { id: "s1", cwd: "/proj", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

/** Latest props per handler `path` (so tests can drive setDirty / save from outside). */
const handlers = new Map<string, FileHandlerProps>();
const mounts: string[] = [];
function Handler(props: FileHandlerProps) {
  handlers.set(props.path, props);
  useEffect(() => {
    mounts.push(props.path);
  }, [props.path]);
  return <div data-testid="handler-body">{props.path}</div>;
}

interface ClaimOpts {
  plugin?: string;
  id?: string;
  priority?: number;
  keepAlive?: boolean;
  firstOverwriteNotice?: string;
}
function claim(registry: SlotRegistry, o: ClaimOpts = {}) {
  const id = o.id ?? "word";
  registry.addClaim({
    pluginId: o.plugin ?? "wc",
    priority: o.priority ?? 1000,
    slot: "editor-pane-file-handler",
    id,
    extensions: [".docx"],
    mode: "edit",
    label: `Edit ${o.plugin ?? "wc"}/${id}`,
    copySuffix: "wc",
    ...(o.keepAlive === false ? {} : { keepAlive: { max: 3 } }),
    ...(o.firstOverwriteNotice ? { firstOverwriteNotice: o.firstOverwriteNotice } : {}),
    Component: Handler,
  });
}
const registryWith = (...os: ClaimOpts[]) => {
  const r = createSlotRegistry();
  for (const o of os) claim(r, o);
  return r;
};

function Probe() {
  const { openInSplit, paneState } = useSplitWorkspace();
  return (
    <>
      {["a.docx", "b.docx", "c.docx", "d.docx", "REPORT.DOCX", "./a.docx", "../other/x.docx", "f.ts"].map((p) => (
        <button key={p} type="button" data-testid={`open-${p}`} onClick={() => openInSplit(p)} />
      ))}
      <div data-testid="tabs">{paneState.openFiles.map((f) => `${f.path}${f.handlerMode ? `@${f.handlerMode}` : ""}`).join("|")}</div>
    </>
  );
}

function renderPane(registry: SlotRegistry, { changeDetection = true, layer = true } = {}) {
  return render(
    <PluginContextProvider registry={registry}>
      <ShellSessionsProvider value={new Map([["s1", session]])}>
        <SplitWorkspaceProvider sessionId="s1" cwd="/proj" orientation="h" changeDetection={changeDetection}>
          <EditorPane />
          <Probe />
          {layer && <FileHandlerLayer />}
        </SplitWorkspaceProvider>
      </ShellSessionsProvider>
    </PluginContextProvider>,
  );
}

const open = (p: string) => fireEvent.click(screen.getByTestId(`open-${p}`));
const mode = (ref = "wc/word") => fireEvent.click(screen.getByTestId(`file-mode-${ref}`));
const key = (path: string, ref = "wc/word") => instanceKey("s1", "/proj", path, ref);
const frames = () => screen.queryAllByTestId("file-handler-instance");
const tabClose = (title: string) => {
  const tab = screen.getByTitle(title).closest("[data-testid=editor-tab]") as HTMLElement;
  return tab;
};

beforeEach(() => {
  localStorage.clear();
  fileHandlerStore.reset();
  handlers.clear();
  mounts.length = 0;
  installFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("switcher (E7–E9)", () => {
  it("E7: no claims → no switcher; one claim → Preview + label; two → Preview, then ascending priority, then plugin id", async () => {
    renderPane(createSlotRegistry());
    open("a.docx");
    await screen.findByTestId("docx-preview");
    expect(screen.queryByTestId("file-mode-switcher")).toBeNull();
    cleanup();

    renderPane(registryWith({}));
    open("a.docx");
    const sw = await screen.findByTestId("file-mode-switcher");
    expect(within(sw).getAllByRole("button").map((b) => b.textContent)).toEqual(["Preview", "Edit wc/word"]);
    cleanup();

    renderPane(registryWith({ plugin: "beta", priority: 1000 }, { plugin: "alpha", priority: 1000 }, { plugin: "zeta", priority: 100 }));
    open("a.docx");
    const sw2 = await screen.findByTestId("file-mode-switcher");
    expect(within(sw2).getAllByRole("button").map((b) => b.textContent)).toEqual(["Preview", "Edit zeta/word", "Edit alpha/word", "Edit beta/word"]);
  });

  it("E8: matches case-insensitively", async () => {
    renderPane(registryWith({}));
    open("REPORT.DOCX");
    expect(await screen.findByTestId("file-mode-switcher")).toBeTruthy();
  });

  it("E9: a file outside the session folder shows the modes unavailable; a folder pane has no switcher", async () => {
    renderPane(registryWith({}));
    open("../other/x.docx");
    await screen.findByTestId("file-mode-outside");
    expect((screen.getByTestId("file-mode-wc/word") as HTMLButtonElement).disabled).toBe(true);
    await screen.findByTestId("docx-preview");
    cleanup();

    renderPane(registryWith({}), { changeDetection: false });
    open("a.docx");
    await screen.findByTestId("docx-preview");
    expect(screen.queryByTestId("file-mode-switcher")).toBeNull();
  });

  it("E10: selecting a handler mode unmounts the built-in viewer and fetches nothing for it", async () => {
    const log = installFetch();
    renderPane(registryWith({}));
    open("a.docx");
    await screen.findByTestId("docx-preview");
    const before = log.urls.length;
    mode();
    await screen.findByTestId("handler-body");
    expect(screen.queryByTestId("docx-preview")).toBeNull();
    // Only the handler's own snapshot reads (if any): no built-in preview/size fetch.
    const after = log.urls.slice(before).map((u) => u.pathname);
    expect(after.filter((p) => p === "/api/file" || p === "/api/file/render")).toEqual([]);
    // Back to Preview mounts the built-in view again (handler clean/unknown guard → confirm).
    handlers.get("a.docx")?.setDirty(false);
    fireEvent.click(screen.getByTestId("file-mode-preview"));
    await screen.findByTestId("docx-preview");
    expect(frames()).toHaveLength(0);
  });
});

describe("handlerMode hydration (E11)", () => {
  it("restores a stored mode, ignores a malformed one, and renders the built-in view for an unknown claim", async () => {
    const tab = (path: string, extra: Record<string, unknown> = {}) => ({ path, viewer: "docx", addedAt: 1, ...extra });
    localStorage.setItem(
      `${EDITOR_PANE_KEY_PREFIX}s1`,
      JSON.stringify({
        openFiles: [tab("a.docx", { handlerMode: 42 }), tab("b.docx", { handlerMode: "wc/word" }), tab("c.docx", { handlerMode: "gone/claim" })],
        activeIndex: 1,
        treeOpenRoots: [],
      }),
    );
    renderPane(registryWith({}));
    await screen.findByTestId("handler-body");
    expect(screen.getByTestId("handler-body").textContent).toBe("b.docx");
    expect(screen.getByTestId("tabs").textContent).toBe("a.docx|b.docx@wc/word|c.docx@gone/claim");
    fireEvent.click(screen.getByTitle("c.docx"));
    await screen.findByTestId("docx-preview");
    expect(screen.getByTestId("file-mode-preview").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTitle("a.docx"));
    await screen.findByTestId("docx-preview");
  });
});

/** Open `path`, select the handler mode, wait for its handler to mount. */
async function startHandler(path: string, ref = "wc/word") {
  open(path);
  await screen.findByTestId("file-mode-switcher");
  mode(ref);
  await waitFor(() => expect(handlers.has(path)).toBe(true));
  await waitFor(() => expect(fileHandlerStore.get(key(path, ref))).toBeTruthy());
}

describe("cap and eviction (F4–F6)", () => {
  it("F4: the 4th instance evicts the least-recently-activated CLEAN one; its tab offers Resume", async () => {
    renderPane(registryWith({}));
    for (const p of ["a.docx", "b.docx", "c.docx"]) await startHandler(p);
    act(() => {
      handlers.get("a.docx")?.setDirty(false);
      handlers.get("b.docx")?.setDirty(true);
      handlers.get("c.docx")?.setDirty(true);
    });
    await startHandler("d.docx");
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))?.evicted).toBe(true));
    expect(fileHandlerStore.get(key("b.docx"))?.evicted).toBe(false);
    expect(fileHandlerStore.get(key("d.docx"))?.evicted).toBe(false);
    fireEvent.click(screen.getByTitle("a.docx"));
    const resume = await screen.findByTestId("file-handler-resume");
    expect(screen.getByTestId("file-handler-evicted").textContent).toContain("Editor closed to save memory");
    // Resume at the cap with b/c/d unsaved → blocked; free one by discarding.
    act(() => handlers.get("d.docx")?.setDirty(false));
    fireEvent.click(resume);
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))?.evicted).toBe(false));
    await waitFor(() => expect(fileHandlerStore.get(key("d.docx"))?.evicted).toBe(true));
  });

  it("F5: all three unsaved/unknown → nothing evicted, dialog lists the tabs, Cancel aborts the mount", async () => {
    renderPane(registryWith({}));
    for (const p of ["a.docx", "b.docx", "c.docx"]) await startHandler(p);
    act(() => {
      handlers.get("a.docx")?.setDirty(true);
      handlers.get("b.docx")?.setDirty("unknown");
      handlers.get("c.docx")?.setDirty(true);
    });
    open("d.docx");
    await screen.findByTestId("file-mode-switcher");
    mode();
    const dlg = await screen.findByTestId("file-handler-blocked");
    expect(within(dlg).getAllByTestId("file-handler-blocked-item")).toHaveLength(3);
    for (const p of ["a.docx", "b.docx", "c.docx"]) expect(fileHandlerStore.get(key(p))?.evicted).toBe(false);
    fireEvent.click(screen.getByTestId("file-handler-blocked-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-blocked")).toBeNull());
    expect(fileHandlerStore.get(key("d.docx"))).toBeUndefined();
    // The tab reverted to the built-in view.
    await screen.findByTestId("docx-preview");
    expect(screen.getByTestId("tabs").textContent).toContain("d.docx");
    expect(screen.getByTestId("tabs").textContent).not.toContain("d.docx@");
  });

  it("F5b: Discard in the blocked dialog frees a slot and the mount proceeds", async () => {
    renderPane(registryWith({}));
    for (const p of ["a.docx", "b.docx", "c.docx"]) await startHandler(p);
    act(() => {
      for (const p of ["a.docx", "b.docx", "c.docx"]) handlers.get(p)?.setDirty(true);
    });
    open("d.docx");
    await screen.findByTestId("file-mode-switcher");
    mode();
    await screen.findByTestId("file-handler-blocked");
    fireEvent.click(screen.getAllByTestId("file-handler-blocked-discard")[0]);
    await waitFor(() => expect(fileHandlerStore.get(key("d.docx"))).toBeTruthy());
    expect(fileHandlerStore.get(key("a.docx"))).toBeUndefined();
  });

  it("F6: a non-keepAlive instance closes on tab-inactive only when clean; dirty stays mounted hidden and counts", async () => {
    renderPane(registryWith({ keepAlive: false }));
    await startHandler("a.docx");
    act(() => handlers.get("a.docx")?.setDirty(false));
    open("f.ts");
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeUndefined());
    expect(frames()).toHaveLength(0);

    fireEvent.click(screen.getByTitle("a.docx"));
    await screen.findByTestId("file-mode-switcher");
    mode();
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy());
    act(() => handlers.get("a.docx")?.setDirty(true));
    fireEvent.click(screen.getByTitle("f.ts"));
    await waitFor(() => expect(screen.getByTestId("file-handler-instance").getAttribute("data-visible")).toBe("false"));
    expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy();
    // Becoming clean while inactive closes it.
    act(() => handlers.get("a.docx")?.setDirty(false));
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeUndefined());
  });

  it("a kept-alive instance survives a tab switch with its component state (no remount)", async () => {
    renderPane(registryWith({}));
    await startHandler("a.docx");
    const before = mounts.filter((p) => p === "a.docx").length;
    open("f.ts");
    await screen.findByTestId("monaco-viewer");
    fireEvent.click(screen.getByTitle("a.docx"));
    await waitFor(() => expect(screen.getByTestId("file-handler-instance").getAttribute("data-visible")).toBe("true"));
    expect(mounts.filter((p) => p === "a.docx").length).toBe(before);
  });
});

describe("leave guards (F7)", () => {
  type Trigger = { name: string; run: () => void; proceeded: () => boolean };
  const triggers: Trigger[] = [
    { name: "mode switch", run: () => fireEvent.click(screen.getByTestId("file-mode-preview")), proceeded: () => !!screen.queryByTestId("docx-preview") },
    {
      name: "last-tab close",
      run: () => fireEvent.click(within(tabClose("a.docx")).getByRole("button", { name: /close|×/i })),
      proceeded: () => !screen.getByTestId("tabs").textContent?.includes("a.docx"),
    },
    {
      name: "header refresh",
      run: () => fireEvent.click(screen.getByTitle("Reload file")),
      proceeded: () => (fileHandlerStore.get(key("a.docx"))?.nonce ?? 0) > 1,
    },
  ];

  for (const state of [false, true, "unknown"] as const) {
    for (const t of triggers) {
      it(`${t.name} with state ${String(state)}: ${state === false ? "proceeds" : "asks; Cancel keeps the instance, confirm proceeds"}`, async () => {
        renderPane(registryWith({}));
        await startHandler("a.docx");
        act(() => handlers.get("a.docx")?.setDirty(state));
        t.run();
        if (state === false) {
          await waitFor(() => expect(t.proceeded()).toBe(true));
          expect(screen.queryByTestId("file-handler-confirm")).toBeNull();
          return;
        }
        await screen.findByTestId("file-handler-confirm");
        fireEvent.click(screen.getByTestId("file-handler-confirm-cancel"));
        await waitFor(() => expect(screen.queryByTestId("file-handler-confirm")).toBeNull());
        expect(t.proceeded()).toBe(false);
        expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy();
        t.run();
        await screen.findByTestId("file-handler-confirm");
        fireEvent.click(screen.getByTestId("file-handler-confirm-action"));
        await waitFor(() => expect(t.proceeded()).toBe(true));
      });
    }
  }

  it("a tab that shares its instance with another tab closes without a guard", async () => {
    renderPane(registryWith({}));
    await startHandler("a.docx");
    open("./a.docx");
    await screen.findByTestId("file-mode-switcher");
    mode();
    await waitFor(() => expect(screen.getByTestId("tabs").textContent).toContain("./a.docx@wc/word"));
    expect(frames()).toHaveLength(1);
    act(() => handlers.get("a.docx")?.setDirty(true));
    fireEvent.click(within(tabClose("./a.docx")).getByRole("button", { name: /close|×/i }));
    await waitFor(() => expect(screen.getByTestId("tabs").textContent).toBe("a.docx@wc/word"));
    expect(screen.queryByTestId("file-handler-confirm")).toBeNull();
    expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy();
  });

  it("banner Refresh on a handler tab asks first; Cancel leaves the banner", async () => {
    const ws = { current: null as ReturnType<typeof useSplitWorkspace> | null };
    function Grab() {
      ws.current = useSplitWorkspace();
      return null;
    }
    // A candidate is injected through `changedFiles`; verification runs against the digest route.
    let changed = new Map<string, number>();
    const log = installFetch({ digest: (n) => ({ size: 5, sha1: n <= 2 ? "same" : "new".padEnd(40, "0") }) });
    void log;
    const r = registryWith({});
    const ui = (c: Map<string, number>) => (
      <PluginContextProvider registry={r}>
        <ShellSessionsProvider value={new Map([["s1", session]])}>
          <SplitWorkspaceProvider sessionId="s1" cwd="/proj" orientation="h" changeDetection changedFiles={c}>
            <EditorPane />
            <Probe />
            <Grab />
            <FileHandlerLayer />
          </SplitWorkspaceProvider>
        </ShellSessionsProvider>
      </PluginContextProvider>
    );
    const view = render(ui(changed));
    await startHandler("a.docx");
    act(() => handlers.get("a.docx")?.setDirty(true));
    changed = new Map([["a.docx", 1]]);
    view.rerender(ui(changed));
    await screen.findByTestId("changed-on-disk-banner", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByTestId("changed-refresh"));
    await screen.findByTestId("file-handler-confirm");
    fireEvent.click(screen.getByTestId("file-handler-confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("file-handler-confirm")).toBeNull());
    expect(screen.getByTestId("changed-on-disk-banner")).toBeTruthy();
    expect(fileHandlerStore.get(key("a.docx"))?.nonce).toBe(1);
    fireEvent.click(screen.getByTestId("changed-refresh"));
    await screen.findByTestId("file-handler-confirm");
    fireEvent.click(screen.getByTestId("file-handler-confirm-action"));
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))?.nonce).toBe(2));
  });
});

describe("live plugin disable (F8)", () => {
  it("clean → instance closed and the built-in view shows; unsaved → kept with the re-enable / discard overlay", async () => {
    const r = registryWith({ plugin: "wc" }, { plugin: "other", id: "o" });
    r.setEnabledSet(new Set(["wc", "other"]));
    renderPane(r);
    await startHandler("a.docx");
    act(() => handlers.get("a.docx")?.setDirty(false));
    act(() => {
      r.setEnabledSet(new Set(["other"]));
      bumpSlotClaimsVersion();
    });
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeUndefined());
    await screen.findByTestId("docx-preview");
    // Re-enable and open again, this time with unsaved edits.
    act(() => {
      r.setEnabledSet(new Set(["wc", "other"]));
      bumpSlotClaimsVersion();
    });
    await screen.findByTestId("file-mode-wc/word");
    mode();
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy());
    act(() => handlers.get("a.docx")?.setDirty(true));
    act(() => {
      r.setEnabledSet(new Set(["other"]));
      bumpSlotClaimsVersion();
    });
    const overlay = await screen.findByTestId("file-handler-disabled");
    expect(overlay.textContent).toContain("wc was disabled. Re-enable it to save, or discard the edits.");
    expect(fileHandlerStore.get(key("a.docx"))).toBeTruthy();
    expect(screen.getByTestId("handler-body")).toBeTruthy(); // component reference captured at mount
    // Discard confirms, then the tab falls back to the built-in view.
    fireEvent.click(screen.getByTestId("file-handler-discard"));
    await screen.findByTestId("file-handler-confirm");
    fireEvent.click(screen.getByTestId("file-handler-confirm-action"));
    await waitFor(() => expect(fileHandlerStore.get(key("a.docx"))).toBeUndefined());
  });
});

describe("beforeunload (F9)", () => {
  const fire = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };
  it("prevents only while an instance is dirty or unknown", async () => {
    renderPane(registryWith({}));
    expect(fire()).toBe(false);
    await startHandler("a.docx");
    expect(fire()).toBe(true); // unknown until the handler reports
    act(() => handlers.get("a.docx")?.setDirty(false));
    expect(fire()).toBe(false);
    act(() => handlers.get("a.docx")?.setDirty(true));
    expect(fire()).toBe(true);
  });
});

describe("shared instance (F10)", () => {
  it("two tabs of the same file+claim share one instance and ONE first-overwrite confirmation", async () => {
    installFetch();
    renderPane(registryWith({ firstOverwriteNotice: "Heads up" }));
    await startHandler("a.docx");
    open("./a.docx");
    await screen.findByTestId("file-mode-switcher");
    mode();
    await waitFor(() => expect(screen.getByTestId("tabs").textContent).toContain("./a.docx@wc/word"));
    expect(frames()).toHaveLength(1);
    const props = handlers.get("a.docx") as FileHandlerProps;
    await act(async () => {
      await props.snapshot();
    });
    const bytes = new ArrayBuffer(4);
    let p!: ReturnType<FileHandlerProps["save"]>;
    act(() => {
      p = props.save(bytes, { target: "overwrite" });
    });
    await screen.findByTestId("file-handler-first-overwrite");
    fireEvent.click(screen.getByTestId("file-handler-first-overwrite-overwrite"));
    expect((await p).ok).toBe(true);
    // "Tab B" saves through the same instance: no second confirmation.
    fireEvent.click(screen.getByTitle("a.docx"));
    const res = await props.save(bytes, { target: "overwrite" });
    expect(res.ok).toBe(true);
    expect(screen.queryByTestId("file-handler-first-overwrite")).toBeNull();
  });
});

describe("refresh routing (F13)", () => {
  it("header refresh on a handler tab remounts via the layer after the guard; the viewer is not re-keyed", async () => {
    renderPane(registryWith({}));
    await startHandler("a.docx");
    act(() => handlers.get("a.docx")?.setDirty(false));
    const remount = vi.spyOn(fileHandlerStore, "remount");
    const n = mounts.filter((p) => p === "a.docx").length;
    fireEvent.click(screen.getByTitle("Reload file"));
    await waitFor(() => expect(remount).toHaveBeenCalledWith(key("a.docx")));
    await waitFor(() => expect(mounts.filter((p) => p === "a.docx").length).toBe(n + 1));
    expect(screen.queryByTestId("docx-preview")).toBeNull();
    expect(screen.queryByTestId("baseline-pending")).toBeNull();
  });
});

describe("overlay alignment (F14)", () => {
  it("tracks the anchor rect and updates on a ResizeObserver callback", async () => {
    const callbacks: Array<() => void> = [];
    class RO {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", RO);
    let rect = { left: 10, top: 20, width: 300, height: 200 };
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-testid") === "file-handler-anchor"
        ? ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON() {} } as DOMRect)
        : ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect);
    });
    renderPane(registryWith({}));
    await startHandler("a.docx");
    const style = () => (screen.getByTestId("file-handler-instance") as HTMLElement).style;
    await waitFor(() => expect(style().width).toBe("300px"));
    expect([style().left, style().top, style().height]).toEqual(["10px", "20px", "200px"]);
    rect = { left: 50, top: 60, width: 400, height: 250 };
    act(() => callbacks.forEach((cb) => cb()));
    expect([style().left, style().top, style().width, style().height]).toEqual(["50px", "60px", "400px", "250px"]);
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
