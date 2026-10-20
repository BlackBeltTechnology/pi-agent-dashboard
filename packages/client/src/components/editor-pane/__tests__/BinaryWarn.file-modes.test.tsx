/**
 * E29 (extend-craft-web-to-all-apps, D11 A4): the built-in binary notice offers the matching file-handler
 * modes as buttons (same label + action as the switcher); none for a non-matching or absent claim.
 * The built-in viewer probe renders the REAL BinaryWarn, so the context EditorPane provides is exercised.
 * Harness: EditorPane.file-handler.test.tsx.
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

// The built-in viewer renders the real binary notice for every file (what a `.psd` gets in Preview).
const cappedMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../CappedViewer.js", async () => {
  const React = await import("react");
  const { default: BinaryWarn } = await import("../BinaryWarn.js");
  return {
    CappedViewer: (props: { path: string }) => {
      React.useEffect(() => {
        cappedMounts.count++;
      }, []);
      return React.createElement("div", { "data-testid": "capped-viewer" }, React.createElement(BinaryWarn, props as never));
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

const meta = (id: string, over = {}) => ({ id, extensions: [".psd"], mode: "edit" as const, label: `Edit ${id}`, keepAlive: { max: 3 }, copySuffix: "x", ...over });
const addClaim = (reg: ReturnType<typeof createSlotRegistry>, pluginId: string, priority: number, id = "docx", over = {}) =>
  reg.addClaim({ pluginId, priority, slot: "editor-pane-file-handler", fileHandler: meta(id, over), Component: Handler } as never);

const tab = (path: string, extra: Record<string, unknown> = {}) => ({ path, viewer: "binary-warn", addedAt: 1, ...extra });
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

describe("E29 binary notice offers modes (A4)", () => {
  it("enabled PhotoCraft claim → one button 'Edit in PhotoCraft'; clicking it selects the mode exactly like the switcher", async () => {
    seed([tab("photo.psd")]);
    const reg = createSlotRegistry();
    addClaim(reg, "craft-web", 400, "photocraft", { label: "Edit in PhotoCraft" });
    mount(reg);
    const offers = await screen.findByTestId("binary-mode-offers");
    const buttons = within(offers).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Edit in PhotoCraft"]);
    expect(buttons[0].getAttribute("data-testid")).toBe("binary-mode-craft-web/photocraft");
    expect(screen.getByTestId("file-mode-craft-web/photocraft").textContent).toBe("Edit in PhotoCraft");
    fireEvent.click(buttons[0]);
    await screen.findByTestId("handler-body");
    expect(screen.getByTestId("file-mode-craft-web/photocraft").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("capped-viewer")).toBeNull();
  });

  it("no matching claim (plugin disabled → claim absent, or a claim for another extension) → no button", async () => {
    seed([tab("photo.psd")]);
    const none = mount(createSlotRegistry());
    await screen.findByTestId("capped-viewer");
    expect(screen.queryByTestId("binary-mode-offers")).toBeNull();
    none.unmount();

    const other = createSlotRegistry();
    addClaim(other, "craft-web", 400, "wordcraft", { extensions: [".docx"], label: "Edit in WordCraft" });
    mount(other);
    await screen.findByTestId("capped-viewer");
    expect(screen.queryByTestId("binary-mode-offers")).toBeNull();
  });

  it("archive.bin with no claim → the plain notice only", async () => {
    seed([tab("archive.bin")]);
    const reg = createSlotRegistry();
    addClaim(reg, "craft-web", 400, "photocraft", { label: "Edit in PhotoCraft" });
    mount(reg);
    await screen.findByTestId("capped-viewer");
    expect(screen.getByTestId("capped-viewer").textContent).toContain("This file is binary");
    expect(screen.queryByTestId("binary-mode-offers")).toBeNull();
  });

  it("a folder pane (no session) offers nothing", async () => {
    seed([tab("photo.psd")]);
    const reg = createSlotRegistry();
    addClaim(reg, "craft-web", 400, "photocraft", { label: "Edit in PhotoCraft" });
    mount(reg, { sessionPane: false });
    await screen.findByTestId("capped-viewer");
    expect(screen.queryByTestId("binary-mode-offers")).toBeNull();
  });
});
