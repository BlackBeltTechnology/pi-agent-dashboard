/**
 * add-inline-consent-ui (dashboard): the two guarantees the inline consent UI
 * rests on, verified offline:
 *   - invoicebot domain events (`ib:*`) forward to the browser under a stable,
 *     renamed protocol type (IB_EVENT_MAP), payload preserved. The bridge's
 *     EventBus catch-all already forwards every channel; the merged rename map is
 *     what gives the consumed events a fixed name (mirroring FLOW_EVENT_MAP).
 *   - a consent `ask_user` prompt not claimed as widget-bar resolves to an
 *     INLINE placement, so it renders in the chat transcript (not suppressed by
 *     flow-question-routing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FLOW_EVENT_MAP, SUBAGENT_EVENT_MAP, IB_EVENT_MAP } from "../flow-event-wiring.js";
import { PromptBus, type PromptAdapter } from "../prompt-bus.js";

// The bridge builds EVENT_BUS_MAP exactly this way (flow + subagent + ib).
const EVENT_BUS_MAP: Record<string, string> = { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP, ...IB_EVENT_MAP };
// The catch-all renames known channels, else uses the raw channel name.
const renameChannel = (channel: string) => EVENT_BUS_MAP[channel] ?? channel;

describe("ib:* domain events forward under a stable renamed type", () => {
  it("maps approval-requested / approval-decided to stable protocol names", () => {
    expect(IB_EVENT_MAP["ib:approval-requested"]).toBe("ib_approval_requested");
    expect(IB_EVENT_MAP["ib:approval-decided"]).toBe("ib_approval_decided");
  });

  it("the merged EVENT_BUS_MAP renames ib channels (payload passes through the catch-all verbatim)", () => {
    const payload = { invoice_id: "inv-1", set: "cfo", approver: { user: "anna" }, reference: "REF-1" };
    // The catch-all forwards { eventType: rename(channel), data: payload }.
    const forwarded = { eventType: renameChannel("ib:approval-requested"), data: payload };
    expect(forwarded.eventType).toBe("ib_approval_requested");
    expect(forwarded.data).toEqual(payload); // payload preserved verbatim
    expect(renameChannel("ib:approval-decided")).toBe("ib_approval_decided");
  });

  it("does not clobber flow/subagent renames and leaves flowName in data untouched", () => {
    expect(renameChannel("flow:flow-started")).toBe("flow_started"); // flowName rides in data, not the map
    expect(renameChannel("subagents:started")).toBe("subagent_started");
    expect(renameChannel("ib:connector-health")).toBe("ib:connector-health"); // unmapped ib:* still pass through
  });
});

describe("consent prompts resolve to an inline placement", () => {
  let bus: PromptBus;
  let onDashboardRequest: any;

  const nonClaimingAdapter = (name: string): PromptAdapter =>
    ({ name, onRequest: vi.fn().mockReturnValue({}), onResponse: vi.fn(), onCancel: vi.fn() } as any);

  beforeEach(() => {
    vi.useFakeTimers();
    onDashboardRequest = vi.fn();
    bus = new PromptBus({ timeoutMs: 5000, onDashboardRequest, onDashboardDismiss: vi.fn(), onDashboardCancel: vi.fn() });
  });
  afterEach(() => vi.useRealTimers());

  it("a consent confirmation not claimed as widget-bar is inline (generic-dialog)", () => {
    bus.registerAdapter(nonClaimingAdapter("noop")); // no widget-bar claim
    bus.request({
      pipeline: "invoicebot",
      type: "confirm",
      question: "Aktiv\u00e1ljam a szab\u00e1lyt?",
    } as any);
    expect(onDashboardRequest).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Aktiv\u00e1ljam a szab\u00e1lyt?" }),
      expect.objectContaining({ type: "generic-dialog" }),
      "inline",
    );
  });
});
