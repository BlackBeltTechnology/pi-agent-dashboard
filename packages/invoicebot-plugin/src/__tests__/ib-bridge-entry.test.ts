/**
 * relocate-ib-domain-events-to-plugin · unit: the plugin BRIDGE ENTRY
 * subscribes to the declared `ib:*` channels via `pi.events.on` on the SHARED
 * bus — so a FOREIGN extension facade's emissions are observed (the exact bug
 * class fix-automation-run-lifecycle (#456) fixed: an emit intercept never saw
 * foreign emitters) — and re-emits each on the generic
 * `dashboard:plugin-message` channel with the invoicebot envelope.
 *
 * The fake below models pi's real event architecture: ONE shared handler bus,
 * MANY per-extension facades over it. `on()` registers on the shared bus;
 * `emit()` from ANY facade dispatches every registered handler.
 */
import { describe, it, expect } from "vitest";
import activate from "../bridge/index.js";

/** Shared bus + facade factory mirroring pi's per-extension `events` facades. */
function makeSharedBus() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  const emissions: Array<{ channel: string; data: unknown }> = [];
  function facade() {
    return {
      on(channel: string, handler: (data: unknown) => void) {
        const arr = handlers.get(channel) ?? [];
        arr.push(handler);
        handlers.set(channel, arr);
        return () => {};
      },
      emit(channel: string, data: unknown) {
        emissions.push({ channel, data });
        for (const h of handlers.get(channel) ?? []) h(data);
      },
    };
  }
  return { facade, emissions };
}

function activateBridge(bus: ReturnType<typeof makeSharedBus>, opts: { ready?: boolean } = {}) {
  const pluginFacade = bus.facade();
  // goal-plugin bridge shape: activate(ctx) where ctx is/carries `pi`.
  activate({ pi: { on: () => {}, events: pluginFacade } });
  // The MAIN bridge announces its plugin-message listener from its
  // session_start handler — AFTER extension load. Default: announced.
  if (opts.ready !== false) bus.facade().emit("dashboard:plugin-listener-ready", {});
  return pluginFacade;
}

const pluginMessages = (bus: ReturnType<typeof makeSharedBus>) =>
  bus.emissions.filter((e) => e.channel === "dashboard:plugin-message").map((e) => e.data) as Array<{
    pluginId: string;
    messageType: string;
    payload: { eventType: string; data: unknown };
  }>;

describe("invoicebot bridge entry — foreign emissions over the shared bus", () => {
  it("a FOREIGN facade emitting ib:invoice-state-changed yields exactly one dashboard:plugin-message with the exact envelope", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade(); // the invoice engine extension's facade

    const payload = { invoice_id: "inv-42", state: "approved", hold_reason: null };
    foreign.emit("ib:invoice-state-changed", payload);

    const msgs = pluginMessages(bus);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({
      pluginId: "invoicebot",
      messageType: "ib_domain_event",
      payload: { eventType: "ib_invoice_state_changed", data: payload },
    });
  });

  it("forwards a full cost payload verbatim (sub-cent numbers, absent model, final discriminator)", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade();

    const cost = {
      invoice_id: "inv-cost-1",
      currency: "USD",
      total: 0.000321,
      tokens: { input: 101, output: 17 },
      perStep: [
        { stepId: "extract", agent: "ib-extractor", tokensIn: 101, tokensOut: 17, cost: 0.000321 }, // model absent
      ],
      updatedAt: "2026-07-23T12:00:00.000Z",
      final: false,
    };
    foreign.emit("ib:invoice-cost-updated", cost);

    const msgs = pluginMessages(bus);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].payload.eventType).toBe("ib_invoice_cost_updated");
    expect(msgs[0].payload.data).toEqual(cost); // verbatim — nothing rounded/dropped/defaulted
  });

  it("every declared lifecycle channel forwards under its mechanical rename", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade();

    const channels = [
      "ib:invoice-state-changed", "ib:invoice-cost-updated", "ib:approval-requested",
      "ib:approval-decided", "ib:connector-registered", "ib:connector-health",
      "ib:connector-needs-auth", "ib:intake-paused", "ib:intake-resumed",
      "ib:intake-poll-complete", "ib:automation-toggled", "ib:automation-cadence-set",
      "ib:source-item-detected", "ib:source-item-dispatched", "ib:source-item-skipped",
      "ib:source-error",
    ];
    for (const ch of channels) foreign.emit(ch, { ch });

    const msgs = pluginMessages(bus);
    expect(msgs).toHaveLength(channels.length);
    expect(msgs.map((m) => m.payload.eventType)).toEqual(channels.map((c) => c.replace(/[:-]/g, "_")));
  });

  it("an UNDECLARED ib channel is not forwarded", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade();

    foreign.emit("ib:unknown-future-event", { nope: true });

    expect(pluginMessages(bus)).toHaveLength(0);
  });

  it("activation is a no-op without an events surface (never throws)", () => {
    expect(() => activate({ pi: {} })).not.toThrow();
    expect(() => activate({})).not.toThrow();
  });
});

// scoped-session-liveness — state-changed is invoice-addressable exactly like
// cost, and EVERY mid-flight transition is forwarded (none dropped/coalesced) on
// the same ib_domain_event road. See change: scoped-session-liveness.
describe("scoped-session-liveness — state rides the cost road, addressable + complete", () => {
  it("T.4 ib:invoice-state-changed forwards ib_invoice_state_changed with invoice_id preserved verbatim", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade();

    const payload = { invoice_id: "inv-addr", state: "needs_review", hold_reason: "missing_po" };
    foreign.emit("ib:invoice-state-changed", payload);

    const msgs = pluginMessages(bus);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].payload.eventType).toBe("ib_invoice_state_changed");
    expect((msgs[0].payload.data as { invoice_id: string }).invoice_id).toBe("inv-addr");
    expect(msgs[0].payload.data).toEqual(payload); // verbatim — invoice_id (and all fields) intact
  });

  it("T.5 a sequence of mid-flight ib:invoice-state-changed emissions each forward one frame — none dropped or collapsed", () => {
    const bus = makeSharedBus();
    activateBridge(bus);
    const foreign = bus.facade();

    const states = ["new", "extracting", "needs_review", "approved", "paid"];
    for (const state of states) foreign.emit("ib:invoice-state-changed", { invoice_id: "inv-seq", state });

    const msgs = pluginMessages(bus).filter((m) => m.payload.eventType === "ib_invoice_state_changed");
    expect(msgs).toHaveLength(states.length); // every transition forwarded, none coalesced
    expect(msgs.map((m) => (m.payload.data as { state: string }).state)).toEqual(states);
  });
});

describe("startup-ordering race — the hop the unit suite previously missed", () => {
  // Measured live: entry activates at extension load; the main bridge
  // registers its dashboard:plugin-message listener ~tens of ms later inside
  // session_start. Emissions in that window MUST be buffered, not dropped.

  it("an emission BEFORE listener-ready is buffered and flushed ON ready (nothing lost, order kept)", () => {
    const bus = makeSharedBus();
    activateBridge(bus, { ready: false }); // listener not yet announced
    const foreign = bus.facade();

    foreign.emit("ib:connector-registered", { connector: "boot-time" });
    foreign.emit("ib:invoice-state-changed", { invoice_id: "inv-1", state: "new" });
    expect(pluginMessages(bus)).toHaveLength(0); // held, not emitted into a listenerless channel

    bus.facade().emit("dashboard:plugin-listener-ready", {});

    const msgs = pluginMessages(bus);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.payload.eventType)).toEqual([
      "ib_connector_registered",
      "ib_invoice_state_changed",
    ]);
  });

  it("emissions AFTER ready forward immediately; a re-announce is an idempotent no-op", () => {
    const bus = makeSharedBus();
    activateBridge(bus); // ready announced
    const foreign = bus.facade();

    foreign.emit("ib:invoice-state-changed", { invoice_id: "inv-2", state: "approved" });
    expect(pluginMessages(bus)).toHaveLength(1);

    bus.facade().emit("dashboard:plugin-listener-ready", {}); // reload / re-init
    expect(pluginMessages(bus)).toHaveLength(1); // no duplicates
  });

  it("the pre-ready buffer is bounded (never-ready session cannot leak unboundedly)", () => {
    const bus = makeSharedBus();
    activateBridge(bus, { ready: false });
    const foreign = bus.facade();

    for (let i = 0; i < 200; i++) foreign.emit("ib:source-item-detected", { i });
    bus.facade().emit("dashboard:plugin-listener-ready", {});

    const msgs = pluginMessages(bus);
    expect(msgs.length).toBeLessThanOrEqual(64);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
