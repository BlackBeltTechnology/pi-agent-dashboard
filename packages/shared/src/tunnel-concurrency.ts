/**
 * Resolving WHICH providers run, and in which mode, when several may be live.
 *
 * `tunnel.provider` is retained and redefined as **the primary**; extras opt in
 * via `tunnel.<id>.enabled`. That choice is what keeps this change small:
 * `getTunnelUrl()` returns the primary's URL, so every existing OAuth, cookie
 * and redirect-URI requirement stays true verbatim and the legacy
 * `reservedToken` migration is untouched.
 *
 * The one thing it does NOT leave untouched is mode. `tunnel.mode` is a single
 * field, and `PROVIDER_MODES` makes zerotier private-only while zrok and ngrok
 * are public-only — so "zrok primary + zerotier enabled" is inexpressible under
 * one shared mode. Hence `tunnel.<id>.mode`, defaulted only where a provider
 * has exactly ONE supported mode (inferring a mode for tailscale, which
 * supports both, would be a coin flip disguised as a default).
 *
 * See change: add-zrok-custom-reserved-name (D3).
 */
import {
  PROVIDER_MODES,
  type TunnelMode,
  type TunnelProviderId,
  providerSupportsMode,
} from "./tunnel-provider.js";

/** One entry of the resolved run-set. */
export interface ResolvedTunnelProvider {
  provider: TunnelProviderId;
  mode: TunnelMode;
  /** Exactly one entry is the primary — the one that mints OAuth redirect URIs. */
  primary: boolean;
}

export interface TunnelResolutionError {
  provider: TunnelProviderId;
  /** `no-mode` — several supported modes and none configured. `unsupported-mode` — configured but illegal. */
  kind: "no-mode" | "unsupported-mode";
  message: string;
}

export interface ResolvedTunnelPlan {
  providers: ResolvedTunnelProvider[];
  errors: TunnelResolutionError[];
  /**
   * The whole connect is refused. True only when the PRIMARY is unresolvable:
   * an unsupported mode on the primary refuses the connect exactly as before
   * this change, while the same fault on a non-primary disables that provider
   * alone.
   */
  refuseConnect: boolean;
}

/** The provider's sole mode, or undefined when it supports more than one. */
export function soleMode(provider: TunnelProviderId): TunnelMode | undefined {
  const modes = PROVIDER_MODES[provider];
  return modes.length === 1 ? modes[0] : undefined;
}

type TunnelBlock = {
  provider?: TunnelProviderId;
  mode?: TunnelMode;
} & Partial<Record<TunnelProviderId, { enabled?: boolean; mode?: TunnelMode } | undefined>>;

/**
 * Resolve the set of providers to run.
 *
 * Absent `enabled` means false, so an existing single-provider config resolves
 * to exactly the primary and behaves identically — the migration-free property
 * this design is built on.
 */
export function resolveTunnelPlan(tunnel: TunnelBlock | undefined): ResolvedTunnelPlan {
  const primaryId = tunnel?.provider;
  const providers: ResolvedTunnelProvider[] = [];
  const errors: TunnelResolutionError[] = [];
  let refuseConnect = false;

  if (primaryId) {
    // The primary keeps reading the TOP-LEVEL mode: that is the field every
    // pre-concurrency config already carries.
    const configured = tunnel?.[primaryId]?.mode ?? tunnel?.mode ?? soleMode(primaryId);
    if (!configured) {
      errors.push({
        provider: primaryId,
        kind: "no-mode",
        message: `${primaryId} supports ${PROVIDER_MODES[primaryId].join(" and ")}; set tunnel.mode to choose one.`,
      });
      refuseConnect = true;
    } else if (!providerSupportsMode(primaryId, configured)) {
      errors.push({
        provider: primaryId,
        kind: "unsupported-mode",
        message: `${primaryId} does not support mode ${configured} (supports ${PROVIDER_MODES[primaryId].join(", ")}).`,
      });
      // Unchanged from before this change: a bad mode on the primary refuses
      // the whole connect rather than quietly running something else.
      refuseConnect = true;
    } else {
      providers.push({ provider: primaryId, mode: configured, primary: true });
    }
  }

  for (const id of Object.keys(PROVIDER_MODES) as TunnelProviderId[]) {
    if (id === primaryId) continue;
    if (tunnel?.[id]?.enabled !== true) continue;

    // Non-primary providers never inherit the top-level mode — that field
    // describes the primary, and applying it here is what makes "zrok public
    // primary + zerotier" resolve zerotier to an illegal public mode.
    const configured = tunnel[id]?.mode ?? soleMode(id);
    if (!configured) {
      errors.push({
        provider: id,
        kind: "no-mode",
        message: `${id} supports ${PROVIDER_MODES[id].join(" and ")}; set tunnel.${id}.mode to choose one.`,
      });
      continue;
    }
    if (!providerSupportsMode(id, configured)) {
      errors.push({
        provider: id,
        kind: "unsupported-mode",
        message: `${id} does not support mode ${configured} (supports ${PROVIDER_MODES[id].join(", ")}).`,
      });
      continue;
    }
    providers.push({ provider: id, mode: configured, primary: false });
  }

  return { providers, errors, refuseConnect };
}

/**
 * The provider whose URL mints OAuth redirect URIs and sets the cookie origin.
 *
 * Deliberately returns the CONFIGURED primary even when it is not connected.
 * Promoting some other live tunnel would move the sign-in origin without the
 * operator asking, via a path that bypasses the confirmation a deliberate
 * primary switch carries. When the primary is down the redirect base falls back
 * exactly as it did before this change.
 */
export function primaryOf(plan: ResolvedTunnelPlan): ResolvedTunnelProvider | undefined {
  return plan.providers.find((p) => p.primary);
}
