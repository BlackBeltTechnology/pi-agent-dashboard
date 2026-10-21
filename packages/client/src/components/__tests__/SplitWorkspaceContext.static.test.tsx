/**
 * openStaticTarget + the `bump` flag (change: improve-canvas-html-and-url-ux,
 * test-plan #F2; tasks 4.2).
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EditorPaneState, editorPaneReducer } from "../../lib/layout/editor-pane-state.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../split/SplitWorkspaceContext.js";

let api: ReturnType<typeof useSplitWorkspace> | null = null;
function Probe() {
  api = useSplitWorkspace();
  return null;
}
const mount = () =>
  render(
    <SplitWorkspaceProvider sessionId="sStatic" cwd="/p" orientation="h">
      <Probe />
    </SplitWorkspaceProvider>,
  );
const files = () => api?.paneState.openFiles ?? [];
const active = () => files()[api?.paneState.activeIndex ?? -1];

beforeEach(() => {
  localStorage.clear();
  api = null;
});
afterEach(() => cleanup());

describe("openStaticTarget", () => {
  it("opens one tab per file under static:<absolute path>, the live-server viewer", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "m/a/index.html"));
    expect(files()).toHaveLength(1);
    expect(files()[0]).toMatchObject({ path: "static:/p/m/a/index.html", viewer: "live-server", autoOpened: false });
    expect(api?.split.mode).toBe("split");
  });

  it("an absolute (granted, outside-cwd) path keeps its own location", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "/shared/out/x.html"));
    expect(files()[0].path).toBe("static:/shared/out/x.html");
  });

  it("opener agent stamps autoOpened (restricted); operator does not", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "a.html", { opener: "agent" }));
    act(() => api?.openStaticTarget("/p", "b.html", { opener: "operator" }));
    expect(files().find((f) => f.path === "static:/p/a.html")?.autoOpened).toBe(true);
    expect(files().find((f) => f.path === "static:/p/b.html")?.autoOpened).toBe(false);
  });

  it("F2: a second file under the same root adds a tab and leaves the active one alone", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "m/a/index.html"));
    act(() => api?.openStaticTarget("/p", "m/a/settings.html", { opener: "agent", background: true }));
    expect(files().map((f) => f.path)).toEqual(["static:/p/m/a/index.html", "static:/p/m/a/settings.html"]);
    expect(active().path).toBe("static:/p/m/a/index.html");
    expect(files()[1].unread).toBe(true);
  });

  it("F2: bump on the ACTIVE tab sets updatedByAgent and does not change the nonce", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "m/a/index.html"));
    act(() => api?.openStaticTarget("/p", "m/a/index.html", { opener: "agent", background: true, bump: true }));
    expect(active()).toMatchObject({ updatedByAgent: true });
    expect(active().reloadNonce).toBeUndefined();
    expect(files()).toHaveLength(1);
  });

  it("F2: bump on a BACKGROUND tab increments reloadNonce (no second tab, no focus change)", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "m/a/index.html"));
    act(() => api?.openStaticTarget("/p", "m/a/settings.html", { background: true }));
    act(() => api?.openStaticTarget("/p", "m/a/settings.html", { background: true, bump: true }));
    act(() => api?.openStaticTarget("/p", "m/a/settings.html", { background: true, bump: true }));
    const tab = files().find((f) => f.path === "static:/p/m/a/settings.html");
    expect(tab?.reloadNonce).toBe(2);
    expect(tab?.updatedByAgent).toBeUndefined();
    expect(files()).toHaveLength(2);
    expect(active().path).toBe("static:/p/m/a/index.html");
  });

  it("a re-open WITHOUT bump never reloads anything", () => {
    mount();
    act(() => api?.openStaticTarget("/p", "a.html"));
    act(() => api?.openStaticTarget("/p", "a.html", { background: true }));
    expect(active().updatedByAgent).toBeUndefined();
    expect(active().reloadNonce).toBeUndefined();
  });
});

describe("openLiveTarget opener", () => {
  it("defaults to operator provenance; opener agent (chip tap) marks the tab agent-opened", () => {
    mount();
    act(() => api?.openLiveTarget("http://localhost:5173/"));
    act(() => api?.openLiveTarget("http://127.0.0.1:5174/app", { opener: "agent" }));
    expect(files().find((f) => f.path === "live:http://localhost:5173/")?.autoOpened).toBe(false);
    expect(files().find((f) => f.path === "live:http://127.0.0.1:5174/app")?.autoOpened).toBe(true);
  });
});

describe("reducer: bump + ackUpdate", () => {
  const base: EditorPaneState = {
    openFiles: [
      { path: "static:/p/a.html", viewer: "live-server", addedAt: 1 },
      { path: "static:/p/b.html", viewer: "live-server", addedAt: 2 },
    ],
    activeIndex: 0,
    treeOpenRoots: [],
  };
  it("ackUpdate clears updatedByAgent and is a no-op otherwise", () => {
    const flagged = editorPaneReducer(base, { type: "openFile", path: "static:/p/a.html", viewer: "live-server", activate: false, bump: true });
    expect(flagged.openFiles[0].updatedByAgent).toBe(true);
    expect(editorPaneReducer(flagged, { type: "ackUpdate", path: "static:/p/a.html" }).openFiles[0].updatedByAgent).toBe(false);
    expect(editorPaneReducer(base, { type: "ackUpdate", path: "static:/p/a.html" })).toBe(base);
  });
  it("bump on a tab that is not open adds it plainly", () => {
    const next = editorPaneReducer(base, { type: "openFile", path: "static:/p/c.html", viewer: "live-server", activate: false, bump: true });
    expect(next.openFiles[2]).toMatchObject({ path: "static:/p/c.html", unread: true });
    expect(next.openFiles[2].reloadNonce).toBeUndefined();
  });
});
