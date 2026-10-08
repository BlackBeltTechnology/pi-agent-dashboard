/**
 * Agent-initiated open, client half end-to-end (task 6.9, #F14/#F17 unit
 * level): `editor_tab_open` → route listener → ONE navigation with a fresh
 * nonce → SplitRouteSync → `openPluginTab` → the pane shows the tab; opening
 * again after the user closed it works; other routes do not react.
 * Uses the real wouter browser location + the real provider (no mocks).
 * See change: add-browser-editor-pane-tab.
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocation, useSearchParams } from "wouter";
import { useHistoryState } from "wouter/use-browser-location";
import { EDITOR_TAB_OPEN_EVENT, useEditorTabOpenListener } from "../../lib/layout/editor-tab-open.js";
import { SplitRouteSync } from "../split/SessionSplitView.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../split/SplitWorkspaceContext.js";

let dispatchPane: ReturnType<typeof useSplitWorkspace>["dispatch"];
let pane: ReturnType<typeof useSplitWorkspace>["paneState"];

function Probe() {
  const w = useSplitWorkspace();
  dispatchPane = w.dispatch;
  pane = w.paneState;
  return null;
}

/** App's route glue, minus everything unrelated. */
function Glue() {
  const [loc, navigate] = useLocation();
  const [search] = useSearchParams();
  const nonce = (useHistoryState() as { openNonce?: unknown } | null)?.openNonce;
  useEditorTabOpenListener(loc, navigate);
  const editor = /\/editor$/.test(loc);
  return <SplitRouteSync active={editor} tabs={editor ? search.getAll("tab") : undefined} nonce={typeof nonce === "string" ? nonce : ""} />;
}

function mountApp() {
  const registry = createSlotRegistry();
  registry.addClaim({ pluginId: "browser", priority: 1, slot: "editor-pane-tab", pathPrefix: "browser" });
  return render(
    <PluginContextProvider registry={registry}>
      <SplitWorkspaceProvider sessionId="S" cwd="/proj" orientation="h">
        <Probe />
        <Glue />
      </SplitWorkspaceProvider>
    </PluginContextProvider>,
  );
}
const announce = (sessionId: string, path: string) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(EDITOR_TAB_OPEN_EVENT, { detail: { sessionId, path } }));
  });
const paths = () => pane.openFiles.map((f) => f.path);

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/session/S");
});
afterEach(cleanup);

describe("editor_tab_open → pane tab", () => {
  it("a client on the session's chat route opens the tab, active, and the URL carries ?tab=", () => {
    mountApp();
    announce("S", "browser:i1:42");
    expect(paths()).toEqual(["browser:i1:42"]);
    expect(pane.openFiles[pane.activeIndex].viewer).toBe("plugin");
    expect(window.location.pathname).toBe("/session/S/editor");
    expect(window.location.search).toBe("?tab=browser%3Ai1%3A42");
  });

  it("re-opening after the user closed the tab opens it again; while open it focuses without duplicating", () => {
    mountApp();
    announce("S", "browser:i1:42");
    act(() => dispatchPane({ type: "closeTab", index: 0 }));
    expect(paths()).toEqual([]);
    announce("S", "browser:i1:42"); // identical URL, fresh nonce
    expect(paths()).toEqual(["browser:i1:42"]);
    announce("S", "browser:i1:42");
    expect(paths()).toEqual(["browser:i1:42"]);
    announce("S", "browser:i1:43");
    expect(paths()).toEqual(["browser:i1:42", "browser:i1:43"]);
    expect(pane.openFiles[pane.activeIndex].path).toBe("browser:i1:43");
  });

  it("a client on another session or the settings route ignores it", () => {
    mountApp();
    window.history.replaceState(null, "", "/session/OTHER");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    announce("S", "browser:i1:42");
    expect(window.location.pathname).toBe("/session/OTHER");
    window.history.replaceState(null, "", "/settings");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    announce("S", "browser:i1:42");
    expect(window.location.pathname).toBe("/settings");
    expect(paths()).toEqual([]);
  });

  it("an unclaimed prefix navigates but opens nothing", () => {
    mountApp();
    announce("S", "unknown:x");
    expect(paths()).toEqual([]);
  });
});
