/**
 * Live and opened-not-started flow panel headers carry Open flow… and Edit…:
 * while a flow runs Open flow… is disabled ("A flow is running"), Edit… stays
 * enabled, Abort is present. The opened header swaps the opened flow.
 * See change: flows-dock-chip-and-panel-actions (test-plan E24).
 */
import { initPluginConfigs, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { registerUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@blackbelt-technology/pi-dashboard-client-utils/useMobile", () => ({ useMobile: () => false }));

import { FlowDashboardClaim } from "../client/FlowDashboard.js";
import { __resetFlowAttachStoreForTests, getAttachment, setAttachment } from "../client/flow-attach-store.js";
import { useIsolatedLocalStorage, editMode, entry, fetchMock, publishCatalog, registry, started, tree } from "./flows-test-harness.js";

useIsolatedLocalStorage();

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  for (const k of [UI_PRIMITIVE_KEYS.markdownContent, UI_PRIMITIVE_KEYS.zoomControls, UI_PRIMITIVE_KEYS.agentCard] as const) {
    registerUiPrimitive(registry, k, (() => null) as never);
  }
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, ((ms: number) => `${ms}ms`) as never);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, ((x: number) => `${x}`) as never);
});
beforeEach(() => {
  localStorage.clear();
  __resetFlowAttachStoreForTests();
  initPluginConfigs({ flows: {} });
  editMode.served = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/plugins/flows/edit-mode-state")) return fetchMock(url);
      if (String(url).startsWith("/api/plugins/flows/files")) {
        return { status: 200, json: async () => ({ success: true, data: { reported: true, agents: {}, handlers: {} } }) };
      }
      const content = "name: ship-it\ndescription: d\nsteps:\n  - id: alpha\n    type: agent\n    agent: e2e-alpha\n";
      return { status: 200, json: async () => ({ success: true, data: { content } }) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let n = 0;
const q = (id: string) => screen.queryByTestId(id) as HTMLButtonElement | null;

describe("live header (E24)", () => {
  it("running: Open flow… disabled with the reason, Edit… enabled, Abort present", () => {
    const sid = `hdr-S-${++n}`;
    publishCatalog(sid, [entry("batch:apply"), entry("ship-it")]);
    publishSessionEvents(sid, [started("batch:apply", 10, 3)]);
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    expect(q("flow-header-actions-live")).toBeTruthy();
    expect(q("flow-header-open")?.disabled).toBe(true);
    expect(q("flow-header-open")?.title).toBe("A flow is running");
    expect(q("flow-header-edit-button")?.disabled).toBe(false);
    expect(screen.getByTitle("Abort flow")).toBeTruthy();
    expect(q("flow-header-run-again")).toBeNull();
  });
});

describe("opened-not-started header", () => {
  it("offers Open flow… and Edit… beside Run; Open swaps the opened flow", async () => {
    const sid = `hdr-S-${++n}`;
    publishCatalog(sid, [entry("ship-it"), entry("batch:apply")]);
    act(() => setAttachment(sid, { id: "a1", name: "ship-it", source: "/p/ship-it/flow.yaml", baselineStartedAt: 0 }));
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    await screen.findByTestId("flow-header-actions-idle");
    expect(q("flow-header-open")?.disabled).toBe(false);
    expect(q("flow-header-edit-button")).toBeTruthy();
    fireEvent.click(q("flow-header-open") as HTMLButtonElement);
    fireEvent.click(screen.getByText(/^batch:apply\|/));
    expect(getAttachment(sid)?.name).toBe("batch:apply");
  });
});
