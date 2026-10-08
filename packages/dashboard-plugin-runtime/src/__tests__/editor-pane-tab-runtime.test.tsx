/**
 * editor-pane-tab runtime: claim lookup, body/label slots, route helper (#E8
 * navigation shape) and `ctx.openEditorTab` prefix rule (#X16).
 * See change: add-browser-editor-pane-tab.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPaneTabLabelSlot, EditorPaneTabSlot, findEditorPaneTabClaim, openPluginTabRoute, pluginTabRouteHref } from "../editor-pane-tab.js";
import { PluginContextProvider } from "../plugin-context.js";
import { createServerPluginContext, type ServerContextDeps } from "../server/server-context.js";
import { createSlotRegistry } from "../slot-registry.js";

afterEach(cleanup);
const session = { id: "s1", cwd: "/r", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

function registryWith(pluginId = "browser") {
  const r = createSlotRegistry();
  r.addClaim({
    pluginId,
    priority: 1,
    slot: "editor-pane-tab",
    pathPrefix: "browser",
    Component: (p: { path: string; isActive: boolean }) => <span data-testid="body">{p.path}|{String(p.isActive)}</span>,
    LabelComponent: (p: { path: string }) => <span data-testid="label">L:{p.path}</span>,
  });
  return r;
}

describe("editor-pane-tab slots", () => {
  it("claimed prefix renders body + label", () => {
    render(
      <PluginContextProvider registry={registryWith()}>
        <EditorPaneTabSlot path="browser:i:1" session={session} isActive onClose={() => {}} fallback={<i data-testid="fb" />} />
        <EditorPaneTabLabelSlot path="browser:i:1" session={session} fallback="x" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("body").textContent).toBe("browser:i:1|true");
    expect(screen.getByTestId("label").textContent).toBe("L:browser:i:1");
    expect(screen.queryByTestId("fb")).toBeNull();
  });

  it("unclaimed / built-in prefix → fallback", () => {
    render(
      <PluginContextProvider registry={registryWith()}>
        <EditorPaneTabSlot path="other:x" session={session} isActive onClose={() => {}} fallback={<i data-testid="fb1" />} />
        <EditorPaneTabSlot path="term:1" session={session} isActive onClose={() => {}} fallback={<i data-testid="fb2" />} />
        <EditorPaneTabLabelSlot path="other:x" session={session} fallback="pfx" />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("fb1")).toBeDefined();
    expect(screen.getByTestId("fb2")).toBeDefined();
    expect(screen.getByText("pfx")).toBeDefined();
  });

  it("disabled plugin → no claim → fallback", () => {
    const r = registryWith();
    r.setEnabledSet(new Set(["someone-else"]));
    expect(findEditorPaneTabClaim(r, "browser:i:1")).toBeNull();
  });
});

describe("openPluginTabRoute (#E8)", () => {
  it("one navigation, repeatable tab params, fresh nonce each call", () => {
    const nav = vi.fn();
    openPluginTabRoute(nav, "S 1", ["browser:i:1", "browser:i:2", "browser:i:1"]);
    openPluginTabRoute(nav, "S 1", ["browser:i:1"]);
    expect(nav).toHaveBeenCalledTimes(2);
    expect(nav.mock.calls[0][0]).toBe("/session/S%201/editor?tab=browser%3Ai%3A1&tab=browser%3Ai%3A2");
    expect(nav.mock.calls[0][1].state.openNonce).not.toBe(nav.mock.calls[1][1].state.openNonce);
  });
  it("ignores invalid/built-in paths and empty input", () => {
    const nav = vi.fn();
    openPluginTabRoute(nav, "S", ["term:1", "nocolon"]);
    openPluginTabRoute(nav, "", ["browser:i:1"]);
    expect(nav).not.toHaveBeenCalled();
    expect(pluginTabRouteHref("S", [])).toBe("/session/S/editor");
  });
});

describe("ctx.openEditorTab (#X16)", () => {
  const mk = (owned: string[]) => {
    const broadcast = vi.fn();
    const ctx = createServerPluginContext({ broadcastToSubscribers: broadcast } as unknown as ServerContextDeps, "browser", owned);
    return { ctx, broadcast };
  };
  it("own prefix broadcasts editor_tab_open", () => {
    const { ctx, broadcast } = mk(["browser"]);
    ctx.openEditorTab("S", "browser:i:42");
    expect(broadcast).toHaveBeenCalledWith({ type: "editor_tab_open", sessionId: "S", path: "browser:i:42" });
  });
  it.each(["term:1", "other:x", "browser", "Browser:x", ""])("rejects %j, broadcasts nothing", (p) => {
    const { ctx, broadcast } = mk(["browser"]);
    expect(() => ctx.openEditorTab("S", p)).toThrow(/refused/);
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("a plugin without claims can open nothing", () => {
    const { ctx, broadcast } = mk([]);
    expect(() => ctx.openEditorTab("S", "browser:i:1")).toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
