/**
 * Passkey relying-party context (design D2).
 *
 * `rpOrigin` = the resolved auth base (the SAME resolution that builds the
 * OAuth redirect URI and the cookie `Secure` flag — `resolveRedirectBase`), and
 * `rpId` = its hostname. No new resolution chain: one source of truth keeps
 * OAuth, cookies and passkeys on one origin.
 *
 * `stable` gates passkey ceremonies and invite minting: a WebAuthn credential
 * is bound to its RP ID forever, so enrolling under an origin that changes on
 * the next tunnel restart creates credentials that silently die.
 *
 * See change: add-passkey-user-auth.
 */
import net from "node:net";
import type { TunnelProviderId } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { type RedirectBaseSource, resolveRedirectBase } from "../auth.js";
import { effectiveReservedName, getPrimaryProvider } from "../../tunnel/tunnel.js";

export type UnstableReason =
  | "invalid_origin"
  | "not_https"
  | "ip_or_localhost"
  | "no_public_origin"
  | "ephemeral_tunnel";

export interface RpContext {
  rpOrigin: string;
  rpId: string;
  stable: boolean;
  reason?: UnstableReason;
}

export interface RpContextInput {
  /** Resolved auth base (`resolveRedirectBase().base`). */
  base: string;
  /** Which tier produced it. */
  source: RedirectBaseSource;
  /** Configured primary tunnel provider. */
  primary: TunnelProviderId;
  /** zrok reserved-name config (only consulted when zrok is primary). */
  zrok?: { reservedName?: string; persistent?: boolean };
}

function isIpOrLocalhost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || net.isIP(h) !== 0;
}

/** Is the tunnel-sourced base a long-lived name? */
function tunnelIsStable(input: RpContextInput): boolean {
  if (input.primary === "tailscale") return true;
  if (input.primary === "zrok") {
    const z = input.zrok;
    if (!z?.persistent || !z.reservedName) return false;
    // Serving the configured reserved name — not an ephemeral fallback share.
    return effectiveReservedName(input.base) === z.reservedName;
  }
  // ngrok / zerotier: no provider-reported stability yet → unstable.
  return false;
}

/** Pure RP-context derivation; unit-tested without a live tunnel. */
export function computeRpContext(input: RpContextInput): RpContext {
  let url: URL;
  try {
    url = new URL(input.base);
  } catch {
    return { rpOrigin: input.base, rpId: "", stable: false, reason: "invalid_origin" };
  }
  const rpOrigin = url.origin;
  const rpId = url.hostname.replace(/^\[|\]$/g, "");
  const unstable = (reason: UnstableReason): RpContext => ({ rpOrigin, rpId, stable: false, reason });

  if (input.source === "localhost") return unstable("no_public_origin");
  if (url.protocol !== "https:") return unstable("not_https");
  if (isIpOrLocalhost(url.hostname)) return unstable("ip_or_localhost");
  if (input.source === "tunnel" && !tunnelIsStable(input)) return unstable("ephemeral_tunnel");
  return { rpOrigin, rpId, stable: true };
}

/**
 * Live RP context: the redirect base the OAuth plugin resolves right now
 * (`auth.redirectBaseUrl` override → primary tunnel URL → localhost), plus
 * the primary provider and the zrok reserved-name config read from disk.
 * Called on passkey routes and the login page only — never per request.
 */
export function resolveRpContext(port: number, override: string | undefined): RpContext {
  const { base, source } = resolveRedirectBase(port, override);
  let zrok: RpContextInput["zrok"];
  try {
    zrok = loadConfig().tunnel?.zrok;
  } catch {
    zrok = undefined;
  }
  return computeRpContext({ base, source, primary: getPrimaryProvider(), zrok });
}
