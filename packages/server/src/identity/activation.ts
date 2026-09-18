/**
 * Activation state + pre-`listen()` startup readiness for the identity plane
 * (openspec §2 / design D1, D8, D9).
 *
 * There is NO `identity.mode`. The plane's state is DERIVED:
 *   - active  ⇔ at least one trusted resolver is registered (a resolver only
 *     registers when its plugin is enabled AND configured, e.g. the bundled
 *     keycloak resolver has issuer+audience — the plugin owns that decision).
 *   - inert   ⇔ no resolver registered ⇒ behavior is byte-for-byte as before.
 *
 * Readiness (throws `IdentityStartupError`, aborting boot before `listen()`):
 *   - a named `trustedPolicyPlugin` MUST resolve to exactly one registered
 *     policy — zero (named-but-absent) or duplicate fails; an unset/empty
 *     policy is valid (no policy ⇒ non-session roads ungated);
 *   - when the resolver is ACTIVE, a non-empty `auth.providers` (confidential
 *     login connectors) is a configuration error (D8) — two principal sources
 *     and a principal-less cookie bypass are forbidden while a bearer resolver
 *     owns identity.
 */

/** Thrown to abort startup on an unsatisfiable identity configuration. */
export class IdentityStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityStartupError";
  }
}

export interface IdentityReadinessInput {
  /** Is at least one trusted resolver registered AND configured? (registry.hasActiveResolver()) */
  resolverActive: boolean;
  /** Configured `identity.trustedPolicyPlugin` (undefined ⇒ no policy). */
  trustedPolicyPlugin?: string;
  /** How many policies actually registered under that id (0, 1, or >1). */
  registeredPolicyCount: number;
  /** Count of confidential-login connectors in `auth.providers`. */
  authProviderCount: number;
}

/**
 * Validate identity configuration against the registered reality. Call once,
 * after plugins have loaded and before `fastify.listen()`. Throws on any
 * unsatisfiable combination; returns nothing on success.
 */
export function assertIdentityReadiness(input: IdentityReadinessInput): void {
  const { resolverActive, trustedPolicyPlugin, registeredPolicyCount, authProviderCount } = input;

  if (trustedPolicyPlugin) {
    if (registeredPolicyCount === 0) {
      throw new IdentityStartupError(
        `identity.trustedPolicyPlugin '${trustedPolicyPlugin}' is named but no policy was registered`,
      );
    }
    if (registeredPolicyCount > 1) {
      throw new IdentityStartupError(
        `identity.trustedPolicyPlugin '${trustedPolicyPlugin}' resolved to ${registeredPolicyCount} policies; exactly one is required`,
      );
    }
  }

  if (resolverActive && authProviderCount > 0) {
    throw new IdentityStartupError(
      `an active principal resolver excludes confidential login connectors, but auth.providers has ${authProviderCount} entr${authProviderCount === 1 ? "y" : "ies"} (design D8)`,
    );
  }
}
