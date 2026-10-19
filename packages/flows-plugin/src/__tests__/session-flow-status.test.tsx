/**
 * FLOWS subcard body (`SessionFlowActions`) carries flow STATUS only: the
 * activity badge (Abort while running) when a flow state exists, else nothing.
 * The flow actions live in `SessionFlowMenuClaim`. See change:
 * add-session-actions-flyout (D12).
 */
import {
  CurrentPluginLayer,
  PluginContextProvider,
  publishSessionEvents,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardEvent, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionFlowActionsClaim } from "../client/SessionFlowActions.js";

let seq = 0;
const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent =>
  ({ seq: ++seq, timestamp: seq, eventType, data }) as unknown as DashboardEvent;
const started = ev("flow_started", { flowName: "A", task: "", steps: [{ id: "s", stepType: "agent", agent: "a", blockedBy: [] }] });

function renderClaim(sid: string, send: (m: unknown) => void = () => {}) {
  return render(
    <PluginContextProvider send={send}>
      <CurrentPluginLayer pluginId="flows">
        <SessionFlowActionsClaim session={{ id: sid } as DashboardSession} />
      </CurrentPluginLayer>
    </PluginContextProvider>,
  );
}

afterEach(() => cleanup());

describe("SessionFlowActionsClaim (status only)", () => {
  it("renders nothing without a flow state", () => {
    const { container } = renderClaim("status-none");
    expect(container.textContent).toBe("");
  });

  it("renders the badge and no action buttons while a flow runs; Abort sends flow_control", () => {
    const send = vi.fn();
    publishSessionEvents("status-run", [started]);
    const { container } = renderClaim("status-run", send);
    expect(container.textContent).toContain("A");
    expect(screen.queryByRole("button", { name: /Run Flow|Open flow|New \/ Edit|Delete/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /abort/i }));
    expect(send).toHaveBeenCalledWith({ type: "flow_control", sessionId: "status-run", action: "abort" });
  });
});
