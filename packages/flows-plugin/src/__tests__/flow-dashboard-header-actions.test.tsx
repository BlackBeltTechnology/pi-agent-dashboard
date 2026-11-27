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
import { flowCollapseKey } from "../client/flow-collapse-storage.js";
import { useIsolatedLocalStorage, completed, editMode, entry, fetchMock, publishCatalog, registry, started, tree } from "./flows-test-harness.js";

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
    fireEvent.click(await screen.findByText(/^batch:apply\|/));
    expect(getAttachment(sid)?.name).toBe("batch:apply");
  });
});

describe("view-only (path-opened) not-started header (add-flow-open-tool E20)", () => {
  const auto = () => screen.queryByText("AUTO");
  it("view-only: no Run, no AUTO, no Edit…; label, Close and Open flow… present", async () => {
    const sid = `hdr-S-${++n}`;
    publishCatalog(sid, [entry("ship-it")]);
    act(() =>
      setAttachment(sid, { id: "v1", name: "flows/a/flow.yaml", source: "/w/flows/a/flow.yaml", baselineStartedAt: 0, viewOnly: true }),
    );
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    await screen.findByTestId("flow-header-actions-idle");
    expect(q("flow-idle-run")).toBeNull();
    expect(auto()).toBeNull();
    expect(q("flow-header-edit-button")).toBeNull();
    expect(q("flow-view-only-label")?.textContent).toBe("view only - not registered");
    expect(q("flow-idle-close")).toBeTruthy();
    expect(q("flow-header-open")).toBeTruthy();
  });

  it("F7/X12: a view-only definition the plugin refuses shows the load error, the re-open hint and Close; no host fallback", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/plugins/flows/files")) {
        return { status: 200, json: async () => ({ success: true, data: { reported: true, agents: {}, handlers: {} } }) };
      }
      return { status: 403, json: async () => ({ success: false, error: "not a flow file of this session" }) };
    });
    vi.stubGlobal("fetch", f);
    const sid = `hdr-S-${++n}`;
    act(() =>
      setAttachment(sid, { id: "v2", name: "flows/a/flow.yaml", source: "/w/flows/a/flow.yaml", baselineStartedAt: 0, viewOnly: true }),
    );
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    const msg = await screen.findByTestId("flow-slot-message");
    await vi.waitFor(() => expect(msg.getAttribute("data-tone")).toBe("error"));
    expect(msg.textContent).toContain("ask the agent to open it again");
    expect(q("flow-idle-close")).toBeTruthy();
    expect(f.mock.calls.some(([u]) => String(u).includes("/api/pi-resource-file"))).toBe(false);
  });

  it("catalog attachment: Run, AUTO and Edit… present, no view-only label", async () => {
    const sid = `hdr-S-${++n}`;
    publishCatalog(sid, [entry("ship-it")]);
    act(() => setAttachment(sid, { id: "c1", name: "ship-it", source: "/p/ship-it/flow.yaml", baselineStartedAt: 0 }));
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    await screen.findByTestId("flow-header-actions-idle");
    expect(q("flow-idle-run")).toBeTruthy();
    expect(auto()).toBeTruthy();
    expect(q("flow-header-edit-button")).toBeTruthy();
    expect(q("flow-view-only-label")).toBeNull();
  });
});

/** E39: header Abort / Auto dispatch plugin_action. See change: update-flows-plugin (D2). */
describe("header Abort / Auto dispatch (E39)", () => {
  it("sends flow.abort then flow.toggle-autonomous; no flow_control / flow_management", () => {
    const sid = `hdr-S-${++n}`;
    const send = vi.fn();
    publishSessionEvents(sid, [
      { ...started("batch:apply", 10, 2), data: { ...started("batch:apply", 10, 2).data, autonomousMode: true } },
    ]);
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />, send));
    const auto = screen.getByTitle("Toggle autonomous mode");
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTitle("Abort flow"));
    fireEvent.click(auto);
    const sent = send.mock.calls.map(([m]) => m as Record<string, unknown>);
    expect(sent.filter((m) => m.type === "plugin_action" && String(m.action).startsWith("flow.") && m.action !== "flow.request-catalog")).toEqual([
      { type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.abort" },
      { type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.toggle-autonomous" },
    ]);
    expect(sent.some((m) => m.type === "flow_control" || m.type === "flow_management")).toBe(false);
  });

  it("no Abort button when no flow is active", () => {
    const sid = `hdr-S-${++n}`;
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    expect(screen.queryByTitle("Abort flow")).toBeNull();
  });
});

/** T9: Dismiss names the shown run so the bridge can persist it.
 *  See change: persist-flow-run-close (D3, D4). */
describe("summary Dismiss sends the run's runId (T9)", () => {
  const dismissals = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.map(([m]) => m as Record<string, unknown>).filter((m) => m.action === "flow.dismiss-summary");
  const runEvents = () => {
    const s = started("batch:apply", 10, 1);
    const c = completed("batch:apply", 20, "aborted");
    return [{ ...s, data: { ...s.data, runId: "r1" } }, { ...c, data: { ...c.data, runId: "r1" } }];
  };

  it("FlowDashboardClaim summary header", () => {
    const sid = `hdr-S-${++n}`;
    const send = vi.fn();
    publishSessionEvents(sid, runEvents());
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />, send));
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(dismissals(send)).toEqual([
      { type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.dismiss-summary", payload: { runId: "r1" } },
    ]);
  });

  it("FlowDashboardClaim on a completed flow renders summary mode (the FlowSummaryClaim shell is gone)", () => {
    const sid = `hdr-S-${++n}`;
    const send = vi.fn();
    publishSessionEvents(sid, runEvents());
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />, send));
    expect(screen.getByTestId("flow-dashboard").getAttribute("data-flow-mode")).toBe("summary");
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(dismissals(send)).toEqual([
      { type: "plugin_action", pluginId: "flows", sessionId: sid, action: "flow.dismiss-summary", payload: { runId: "r1" } },
    ]);
  });

  // X1: a dismissed run stays gone after replay — summary mode never mounts.
  // See change: unify-flow-rendering (test-plan X1).
  it("X1: a run dismissed via flow-run-close renders nothing after replay", () => {
    const sid = `hdr-S-${++n}`;
    publishSessionEvents(sid, [...runEvents(), { ...completed("batch:apply", 30), eventType: "flow_summary_dismissed", data: { runId: "r1" } }]);
    const { container } = render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("flow-dashboard")).toBeNull();
  });
});

/** F6: collapsing the completed panel unmounts the body; header actions and
 *  Dismiss stay. See change: unify-flow-rendering (test-plan F6). */
describe("completed panel collapses to its header (F6)", () => {
  it("collapse hides cards, Summaries and the scroll box; Run again / Open / Edit + Dismiss stay", async () => {
    const sid = `hdr-S-${++n}`;
    publishCatalog(sid, [entry("batch:apply")]);
    localStorage.setItem(flowCollapseKey("summary", sid), "false");
    localStorage.setItem(flowCollapseKey("cards", sid), "false");
    const s = started("batch:apply", 10, 2);
    publishSessionEvents(sid, [
      s,
      { ...s, eventType: "flow_agent_complete", data: { agentName: "a0", stepId: "s0", result: { success: true, summary: "S0" } } },
      completed("batch:apply", 20),
    ]);
    render(tree(<FlowDashboardClaim session={{ id: sid } as DashboardSession} />));
    expect(q("flow-summary-scrollbox")).not.toBeNull();
    expect(q("flow-summaries")).not.toBeNull();
    expect(q("flow-agent-cards-section")).not.toBeNull();
    fireEvent.click(screen.getByTestId("flow-summary-panel-toggle"));
    expect(screen.getByTestId("flow-summary-panel-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
    expect(q("flow-summaries")).toBeNull();
    expect(q("flow-summary-scrollbox")).toBeNull();
    expect(document.querySelector("[data-node]")).toBeNull();
    await screen.findByTestId("flow-header-run-again");
    expect(q("flow-header-open")).not.toBeNull();
    expect(q("flow-header-edit-button")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeTruthy();
  });
});
