/**
 * relocate-ib-domain-events-to-plugin · unit: the declared channel list and
 * the MECHANICAL rename (`:` and `-` → `_`) live in the plugin — core owns no
 * invoicebot vocabulary. Every declared channel maps to its `ib_*` wire name;
 * an undeclared channel is rejected by the declaration predicate.
 */
import { describe, it, expect } from "vitest";
import {
  IB_CHANNELS,
  IB_GREETING_CHANNEL,
  IB_SUBSCRIBED_CHANNELS,
  IB_PLUGIN_ID,
  IB_DOMAIN_EVENT_MESSAGE,
  renameIbChannel,
  isDeclaredIbChannel,
} from "../shared/ib-events.js";

/** The full lifecycle set (spec table, invoicebot-event-bridge). */
const LIFECYCLE: ReadonlyArray<readonly [string, string]> = [
  ["ib:invoice-state-changed", "ib_invoice_state_changed"],
  ["ib:invoice-cost-updated", "ib_invoice_cost_updated"],
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
];

describe("ib-events declaration + mechanical rename", () => {
  it("declares exactly the 16 lifecycle channels", () => {
    expect([...IB_CHANNELS].sort()).toEqual(LIFECYCLE.map(([c]) => c).sort());
  });

  it.each(LIFECYCLE)("renames %s → %s mechanically", (channel, wire) => {
    expect(renameIbChannel(channel)).toBe(wire);
    // The rename IS the mechanical rule, not a lookup that can drift.
    expect(renameIbChannel(channel)).toBe(channel.replace(/[:-]/g, "_"));
  });

  it("rejects an undeclared channel", () => {
    expect(isDeclaredIbChannel("ib:unknown-future-event")).toBe(false);
    expect(isDeclaredIbChannel("flow:complete")).toBe(false);
  });

  it("envelope constants match the generic plugin channel contract", () => {
    expect(IB_PLUGIN_ID).toBe("invoicebot");
    expect(IB_DOMAIN_EVENT_MESSAGE).toBe("ib_domain_event");
  });
});

/**
 * The greeting RENDER channel is declared SEPARATELY from the lifecycle set
 * (option b): a render event is not a lifecycle domain event, so it must not
 * dilute IB_CHANNELS' meaning nor the assertion above. See change:
 * restore-assistant-greeting-stream.
 */
describe("greeting render channel — declared separately from the lifecycle set", () => {
  it("is ib:greeting and renames mechanically to the shared ib_greeting wire type", () => {
    expect(IB_GREETING_CHANNEL).toBe("ib:greeting");
    expect(renameIbChannel(IB_GREETING_CHANNEL)).toBe("ib_greeting");
  });

  it("is NOT part of the lifecycle set (IB_CHANNELS meaning preserved)", () => {
    expect(IB_CHANNELS).not.toContain("ib:greeting");
    // A render event is not a declared LIFECYCLE channel.
    expect(isDeclaredIbChannel("ib:greeting")).toBe(false);
  });

  it("is included in the bridge's subscribed set alongside every lifecycle channel", () => {
    expect(IB_SUBSCRIBED_CHANNELS).toContain("ib:greeting");
    for (const ch of IB_CHANNELS) expect(IB_SUBSCRIBED_CHANNELS).toContain(ch);
    expect(IB_SUBSCRIBED_CHANNELS).toHaveLength(IB_CHANNELS.length + 1);
  });
});
