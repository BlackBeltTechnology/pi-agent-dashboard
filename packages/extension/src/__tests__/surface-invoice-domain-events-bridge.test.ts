/**
 * surface-invoice-domain-events-bridge: the bridge forwards the full lifecycle
 * `ib:*` domain-event set under stable renamed protocol types, payload
 * preserved, gated on session-ready.
 *
 * Mirrors the bridge's EventBus catch-all exactly (see bridge.ts):
 *   - EVENT_BUS_MAP = { ...FLOW, ...SUBAGENT, ...IB }
 *   - sendEventForward: eventType = EVENT_BUS_MAP[channel] ?? channel
 *   - the emit intercept forwards only when `sessionReady && isActive()`
 * following the codebase idiom of testing a faithful mirror of the bridge
 * branch (cf. bridge-plugin-emit-event.test.ts, add-inline-consent-ui.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { FLOW_EVENT_MAP, SUBAGENT_EVENT_MAP, IB_EVENT_MAP } from "../flow-event-wiring.js";

const EVENT_BUS_MAP: Record<string, string> = { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP, ...IB_EVENT_MAP };

// Faithful mirror of bridge.ts `sendEventForward`.
function sendEventForward(
  send: (msg: unknown) => void,
  sessionId: string,
  channel: string,
  data: Record<string, unknown>,
): void {
  const eventType = EVENT_BUS_MAP[channel] ?? channel;
  send({ type: "event_forward", sessionId, event: { eventType, timestamp: 0, data } });
}

// Faithful mirror of the non-subagent emit-intercept gate in bridge.ts:
//   else if (sessionReady && isActive()) sendEventForward(channel, eventData);
function emitIntercept(
  send: (msg: unknown) => void,
  gate: { sessionReady: boolean; active: boolean },
  channel: string,
  data: Record<string, unknown>,
): void {
  if (gate.sessionReady && gate.active) sendEventForward(send, "sess-1", channel, data);
}

/** The full lifecycle set this change adds coverage for. */
const LIFECYCLE = [
  ["ib:invoice-state-changed", "ib_invoice_state_changed"],
  ["ib:approval-requested", "ib_approval_requested"],
  ["ib:approval-decided", "ib_approval_decided"],
  ["ib:connector-registered", "ib_connector_registered"],
  ["ib:connector-health", "ib_connector_health"],
  ["ib:connector-needs-auth", "ib_connector_needs_auth"],
  ["ib:intake-paused", "ib_intake_paused"],
  ["ib:intake-resumed", "ib_intake_resumed"],
  ["ib:intake-poll-complete", "ib_intake_poll_complete"],
  ["ib:automation-toggled", "ib_automation_toggled"],
  ["ib:automation-cadence-set", "ib_automation_cadence_set"],
  ["ib:source-item-detected", "ib_source_item_detected"],
  ["ib:source-item-dispatched", "ib_source_item_dispatched"],
  ["ib:source-item-skipped", "ib_source_item_skipped"],
  ["ib:source-error", "ib_source_error"],
] as const;

describe("surface-invoice-domain-events-bridge", () => {
  // 2.1
  it("forwards ib:invoice-state-changed as ib_invoice_state_changed with payload preserved", () => {
    const send = vi.fn();
    const payload = { invoice_id: "inv-1", state: "on_hold", hold_reason: "missing_po" };
    emitIntercept(send, { sessionReady: true, active: true }, "ib:invoice-state-changed", payload);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event_forward",
        event: expect.objectContaining({ eventType: "ib_invoice_state_changed", data: payload }),
      }),
    );
    // payload preserved verbatim (same reference contents)
    expect(send.mock.calls[0][0].event.data).toEqual(payload);
  });

  // 2.2
  it("renames every lifecycle ib:* entry to its mapped ib_* type", () => {
    for (const [channel, expected] of LIFECYCLE) {
      expect(IB_EVENT_MAP[channel]).toBe(expected);
      expect(EVENT_BUS_MAP[channel]).toBe(expected);
    }
    // the map covers exactly the lifecycle set (no missing entry, no stray key)
    expect(Object.keys(IB_EVENT_MAP).sort()).toEqual(LIFECYCLE.map(([c]) => c).sort());
  });

  // 2.3 regression
  it("keeps the pre-existing approval renames", () => {
    expect(IB_EVENT_MAP["ib:approval-requested"]).toBe("ib_approval_requested");
    expect(IB_EVENT_MAP["ib:approval-decided"]).toBe("ib_approval_decided");
  });

  // 2.4
  it("passes an unmapped ib:* channel through under its raw name", () => {
    const send = vi.fn();
    emitIntercept(send, { sessionReady: true, active: true }, "ib:unknown-future-event", { x: 1 });
    expect(send.mock.calls[0][0].event.eventType).toBe("ib:unknown-future-event");
  });

  // 2.5 session-ready gate
  it("does not forward before session-ready, forwards after", () => {
    const send = vi.fn();
    emitIntercept(send, { sessionReady: false, active: true }, "ib:invoice-state-changed", { invoice_id: "inv-1", state: "new" });
    expect(send).not.toHaveBeenCalled();
    emitIntercept(send, { sessionReady: true, active: true }, "ib:invoice-state-changed", { invoice_id: "inv-1", state: "new" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
