/**
 * Migrated flows components render once each through the real slot consumer (test-plan #E91 / task 8.114,
 * the "migrated FlowActivityBadge + SessionFlowActions" observable). The demo-settings half lives in
 * `packages/client/src/__tests__/plugin-registry-consumers.test.tsx` (a core test may not import a plugin).
 * See change: decouple-plugins-from-core.
 */
import { CurrentPluginLayer, createSlotRegistry, PluginContextProvider, publishSessionEvents, SessionCardFlowsSlot } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardEvent, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionFlowActionsClaim } from "../client/SessionFlowActions.js";
import { shouldRenderFlowsSubcard } from "../client/shouldRender.js";

afterEach(() => cleanup());

describe("migrated flows claims render once each", () => {
  const sid = "reg-consumers-flow";
  const started = {
    seq: 1,
    timestamp: 1,
    eventType: "flow_started",
    data: { flowName: "Migrated", task: "", steps: [{ id: "s", stepType: "agent", agent: "a", blockedBy: [] }] },
  } as unknown as DashboardEvent;
  const session = { id: sid } as DashboardSession;

  it("SessionFlowActionsClaim → one FlowActivityBadge in the session-card-flows slot", () => {
    publishSessionEvents(sid, [started]);
    expect(shouldRenderFlowsSubcard(session)).toBe(true);
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "flows",
      priority: 100,
      slot: "session-card-flows",
      Component: SessionFlowActionsClaim,
      shouldRender: shouldRenderFlowsSubcard,
    } as never);
    const { container } = render(
      <PluginContextProvider registry={registry} sessions={[]} send={vi.fn()}>
        <CurrentPluginLayer pluginId="flows">
          <SessionCardFlowsSlot session={session} />
        </CurrentPluginLayer>
      </PluginContextProvider>,
    );
    // one claim → one badge root; the flow name appears exactly once
    expect((container.textContent ?? "").split("Migrated")).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(1); // the single running-flow Abort
  });
});
