/**
 * InvoiceBot domain-event declarations — the SINGLE owner of the `ib:*`
 * channel vocabulary. Core (`packages/extension`, `packages/server`) carries
 * no invoicebot channel knowledge; the plugin bridge entry subscribes to
 * exactly this set and the plugin server rebroadcasts the resulting frames.
 *
 * The wire name is the MECHANICAL rename of the bus channel (`:` and `-` →
 * `_`), e.g. `ib:invoice-state-changed` → `ib_invoice_state_changed` — a rule,
 * not a lookup table that can drift. See change:
 * relocate-ib-domain-events-to-plugin.
 */

/** Plugin id used on the generic `dashboard:plugin-message` envelope. */
export const IB_PLUGIN_ID = "invoicebot";

/** `messageType` for domain-event frames on the generic plugin channel. */
export const IB_DOMAIN_EVENT_MESSAGE = "ib_domain_event";

/** The declared lifecycle channel set (spec: invoicebot-event-bridge). */
export const IB_CHANNELS: readonly string[] = [
  "ib:invoice-state-changed",
  "ib:invoice-cost-updated",
  "ib:approval-requested",
  "ib:approval-decided",
  "ib:connector-registered",
  "ib:connector-health",
  "ib:connector-needs-auth",
  "ib:intake-paused",
  "ib:intake-resumed",
  "ib:intake-poll-complete",
  "ib:automation-toggled",
  "ib:automation-cadence-set",
  "ib:source-item-detected",
  "ib:source-item-dispatched",
  "ib:source-item-skipped",
  "ib:source-error",
];

/**
 * The greeting RENDER channel — a rendering domain event, NOT a lifecycle event.
 * Declared SEPARATELY from `IB_CHANNELS` so the lifecycle set's meaning (and the
 * test that pins it to exactly the 16 lifecycle channels) stays intact. The
 * producer emits its per-state greeting render event here; the bridge subscribes
 * to it ALONGSIDE the lifecycle set and forwards it through the identical
 * envelope + mechanical rename (`ib:greeting` → `ib_greeting`, matching the
 * shared IB_GREETING_EVENT_TYPE the server + client classify on). Keeping it out
 * of the lifecycle set means a consumer that reasons over lifecycle transitions
 * is never handed a render event. See change: restore-assistant-greeting-stream.
 */
export const IB_GREETING_CHANNEL = "ib:greeting";

/** Every channel the bridge subscribes to: the lifecycle set PLUS the separately
 *  declared greeting render channel. */
export const IB_SUBSCRIBED_CHANNELS: readonly string[] = [...IB_CHANNELS, IB_GREETING_CHANNEL];

const DECLARED = new Set(IB_CHANNELS);

/** Mechanical bus-channel → wire-name rename: every `:` and `-` becomes `_`. */
export function renameIbChannel(channel: string): string {
  return channel.replace(/[:-]/g, "_");
}

/** True only for channels in the declared lifecycle set. */
export function isDeclaredIbChannel(channel: string): boolean {
  return DECLARED.has(channel);
}
