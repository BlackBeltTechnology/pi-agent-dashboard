/**
 * Activation state for the identity plane (openspec §2 / design D1, D8, D9, D21).
 *
 * There is NO `identity.mode`. The plane is ENFORCED only when it is fully and
 * consistently configured; anything less leaves it INERT (byte-for-byte the
 * pre-identity behavior) and logs why. Misconfiguration never aborts boot and
 * never locks the operator out (D21 — a failed startup is itself a lockout).
 *
 * Enforced ⇔ all of:
 *   - a trusted resolver is registered AND configured (the plugin owns "configured",
 *     e.g. the bundled keycloak resolver has issuer+audience);
 *   - a trusted plugin registered a browser login descriptor (humans can sign in);
 *   - no MOUNTED legacy `auth.providers` cookie connector competes as a second
 *     principal source (D8) — keyed on what actually resolved and mounted, not
 *     on config keys (an unresolvable entry mounts nothing and must not disarm);
 *   - a named `identity.trustedPolicyPlugin` resolved to exactly one registered
 *     policy (D9) — unset/empty is valid (no policy ⇒ non-session roads ungated).
 *
 * `server.ts` evaluates this ONCE after plugins load and failed registrations are
 * released, then latches it AND freezes the registrations for the process
 * lifetime: runtime unregister / late registration take effect on restart, so no
 * road ever sees a mixed armed/disarmed state.
 */

export interface IdentityEnforcementInput {
  /** A trusted resolver is registered AND configured (registry.hasActiveResolver()). */
  resolverActive: boolean;
  /** A trusted plugin published a browser login descriptor (login-config registry). */
  loginProviderRegistered: boolean;
  /** The legacy `auth.providers` cookie auth plugin resolved ≥1 provider and mounted (D8 conflict). */
  legacyConnectorsActive: boolean;
  /** Configured `identity.trustedPolicyPlugin` (undefined ⇒ no policy). */
  trustedPolicyPlugin: string | undefined;
  /** Policies actually registered under that id (0, 1, or >1). */
  registeredPolicyCount: number;
}

/** Why a (partially) configured plane is NOT enforced; empty ⇒ no conflict. */
function disarmReasons(input: IdentityEnforcementInput): string[] {
  const reasons: string[] = [];
  if (input.resolverActive && !input.loginProviderRegistered) reasons.push("no login provider is registered");
  if (!input.resolverActive && input.loginProviderRegistered) {
    reasons.push("a login provider is registered but no principal resolver is active");
  }
  if (input.resolverActive && input.legacyConnectorsActive) {
    reasons.push("auth.providers confidential cookie connectors are active (design D8)");
  }
  if (input.trustedPolicyPlugin && input.registeredPolicyCount !== 1) {
    reasons.push(
      `identity.trustedPolicyPlugin '${input.trustedPolicyPlugin}' registered ${input.registeredPolicyCount} policies; exactly one is required (design D9)`,
    );
  }
  return reasons;
}

/** Self-lockout guard (D21): enforce only when fully and consistently configured. */
export function isIdentityEnforced(input: IdentityEnforcementInput): boolean {
  return input.resolverActive && input.loginProviderRegistered && disarmReasons(input).length === 0;
}

/** Operator warning when identity is partially configured but NOT enforced; null otherwise. */
export function identityDisarmedWarning(input: IdentityEnforcementInput): string | null {
  const reasons = disarmReasons(input);
  if (reasons.length === 0) return null;
  return (
    `[identity] identity is NOT enforced — ${reasons.join("; ")}. ` +
    "The dashboard stays in its pre-identity mode to prevent self-lockout; complete the identity setup to arm it."
  );
}
