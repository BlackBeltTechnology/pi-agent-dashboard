/**
 * Client edit-mode state: push frames are session-scoped (#F7) and effective
 * edit mode alone never opens the FLOWS subcard (#E16).
 * See change: stop-flows-edit-mode-project-writes (D4).
 */
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer, PluginContextProvider, publishSessionData } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFlowActionsClaim } from "../client/SessionFlowActions.js";
import { SessionFlowMenuClaim } from "../client/SessionFlowMenuClaim.js";
import { shouldRenderFlowsSubcard } from "../client/shouldRender.js";
import { useEditModeState } from "../client/useEditModeState.js";

function fakeWs() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const ws = {
    addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.delete(l),
  } as unknown as WebSocket;
  const push = (frame: unknown) =>
    act(() => {
      for (const l of listeners) l({ data: JSON.stringify(frame) } as MessageEvent);
    });
  return { ws, push };
}

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: false }), { status: 200 }));
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEditModeState frames are session-scoped (#F7)", () => {
  it("only S's frame updates S's state", async () => {
    const { ws, push } = fakeWs();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider send={() => {}} ws={ws}>
        {children}
      </PluginContextProvider>
    );
    const { result } = renderHook(() => useEditModeState("S", { active: true }), { wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.enabled).toBe(false);

    push({ type: "flows_edit_mode_state", sessionId: "T", enabled: true, error: "timeout" });
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toBeNull();

    push({ type: "flows_edit_mode_state", sessionId: "S", enabled: true });
    expect(result.current.enabled).toBe(true);
  });
});

describe("FLOWS subcard ignores edit mode (#E16)", () => {
  it("empty flowsList, no flow events, effective on → no subcard, New/Edit in the menu", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    const sid = "e16-S";
    publishSessionData(sid, "commandsList", [{ name: "flows" }]);
    publishSessionData(sid, "flowsList", []);
    const session = { id: sid } as DashboardSession;
    expect(shouldRenderFlowsSubcard(session)).toBe(false);

    const registry = createUiPrimitiveRegistry();
    registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, (() => null) as never);
    registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.searchableSelectDialog, (() => null) as never);
    registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, (() => null) as never);
    render(
      <PluginContextProvider send={() => {}}>
        <UiPrimitiveProvider value={registry}>
          <CurrentPluginLayer pluginId="flows">
            <div data-testid="subcard">
              <SessionFlowActionsClaim session={session} />
            </div>
            <SessionFlowMenuClaim session={session} />
          </CurrentPluginLayer>
        </UiPrimitiveProvider>
      </PluginContextProvider>,
    );
    expect(await screen.findByRole("button", { name: /New \/ Edit/ })).toBeTruthy();
    expect(screen.getByTestId("subcard").textContent).toBe("");
    expect(screen.queryByText("FLOWS")).toBeNull();
  });
});
