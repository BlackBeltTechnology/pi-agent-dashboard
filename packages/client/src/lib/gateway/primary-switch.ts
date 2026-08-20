/**
 * Designating the primary provider (D10) — pure eligibility + copy + patch.
 *
 * `tunnel.provider` names the PRIMARY, and the primary alone mints the OAuth
 * redirect URI (`resolveRedirectBase()`). Switching it therefore re-points the
 * sign-in origin: any OAuth app holding the previous URI byte-for-byte rejects
 * sign-in until the new one is registered. That is not a one-click toggle, so
 * the eligibility rule and the consequence copy live here — pure — and the
 * component only renders them.
 *
 * See change: add-zrok-custom-reserved-name (D10).
 */

import type {
  ProviderReadinessState,
  TunnelProviderId,
} from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";

/**
 * "Make primary" is offered ONLY for a connected non-primary.
 *
 * `not-installed`/`not-set`/`disconnected` are excluded because promoting a
 * provider that cannot serve would mint a redirect URI nobody can reach — the
 * breakage of a switch with none of its benefit. The current primary is
 * excluded because a no-op that still shows the scary confirmation trains the
 * operator to click through it.
 */
export function canMakePrimary(input: {
  state: ProviderReadinessState;
  isPrimary: boolean;
}): boolean {
  return input.state === "connected" && !input.isPrimary;
}

/**
 * The consequence, stated BEFORE it applies. Names the redirect-URI re-mint and
 * the sign-in breakage explicitly — "are you sure?" is not a statement of
 * consequence, and the spec requires the consequence, not the ceremony.
 */
export function primarySwitchConsequence(next: TunnelProviderId, current?: string): string {
  const from = current ? `from ${current} ` : "";
  return (
    `Making ${next} primary moves the OAuth redirect URI ${from}to ${next}'s URL. ` +
    `Any sign-in provider registered with the previous redirect URI will reject sign-in ` +
    `until the new one is registered with it.`
  );
}

/**
 * The write. `tunnel` is deep-merged server-side, so naming only `provider`
 * leaves every per-provider key (`tunnel.<id>.mode`, `tunnel.zrok.reservedName`)
 * untouched — a switch must not silently disable the provider it demotes.
 */
export function buildPrimarySwitchPatch(next: TunnelProviderId): Record<string, unknown> {
  return { tunnel: { provider: next } };
}
