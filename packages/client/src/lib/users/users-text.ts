/**
 * User-facing copy for the passkey user directory: why passkeys are
 * unavailable on this origin (D2, shown — never hidden) and what a primary
 * switch would orphan (D3). Pure so it is unit-tested without React.
 * See change: add-passkey-user-auth.
 */
import { t } from "../i18n/i18n.js";
import type { CredentialImpact, UnstableReason } from "./users-api.js";

export function unstableReasonText(reason: UnstableReason | undefined): string {
  switch (reason) {
    case "ephemeral_tunnel":
      return t(
        "users.unstable.ephemeral",
        undefined,
        "The primary address is temporary (ephemeral tunnel). Use a reserved zrok name or Tailscale, or set auth.redirectBaseUrl.",
      );
    case "no_public_origin":
      return t("users.unstable.noPublic", undefined, "No public HTTPS address is configured for this dashboard.");
    case "not_https":
      return t("users.unstable.notHttps", undefined, "The dashboard's public address is not HTTPS.");
    case "ip_or_localhost":
      return t("users.unstable.ip", undefined, "Passkeys need a domain name, not an IP address or localhost.");
    case "invalid_origin":
      return t("users.unstable.invalid", undefined, "auth.redirectBaseUrl is not a valid URL.");
    default:
      return t("users.unstable.unknown", undefined, "Passkeys are unavailable on the current address.");
  }
}

/** Consequence line for a primary switch; null when nothing is orphaned. */
export function impactConsequence(impact: CredentialImpact | null): string | null {
  if (!impact || impact.orphaned === 0) return null;
  return t(
    "users.impact.consequence",
    { passkeys: impact.orphaned, users: impact.users },
    "{passkeys} passkey(s) for {users} user(s) will stop working; re-invite them or use sign in with phone. Switching back makes them usable again.",
  );
}
