/**
 * Principal-resolver registry — host trust boundary + deterministic dispatch
 * order for the identity plane.
 *
 * Responsibilities (openspec add-multi-user-identity-plane, §3 / design D4):
 *   - Trust grant: only the bundled `keycloak-resolver` OR a plugin named in
 *     operator-controlled `identity.trustedResolverPlugins` may register. A
 *     self-declared `manifest.priority` grants nothing.
 *   - Deterministic order: `(manifest.priority ASC, pluginId ASC)` — pluginId
 *     is the cross-boot tie-break so dispatch order never depends on load order.
 *   - Duplicate registration from one plugin fails.
 *   - Override-by-disable: a disabled bundled default (`plugins.keycloak-resolver
 *     .enabled: false`) simply never registers, so a trusted replacement is the
 *     only resolver — no silent fall-through.
 *
 * The registry stores resolver FUNCTIONS. Output validation (validate/copy/
 * freeze of a `PrincipalResolution`) lives in `principal-guard.ts` and is
 * applied by the dispatch hook, NOT here — a registry only owns registration
 * and ordering.
 */

import type { PrincipalResolverFn } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** The bundled resolver plugin id — trusted by the host without config. */
export const BUNDLED_RESOLVER_PLUGIN_ID = "keycloak-resolver";

export interface ResolverRegistration {
  pluginId: string;
  /** From the plugin manifest; ordering only, NEVER a trust signal. */
  priority: number;
  /** Configured and able to claim credentials. Defaults true for replacements. */
  active?: boolean;
  /** Resolver's own expiry clock tolerance, used by the host sanity guard. */
  clockSkewSeconds?: number;
  resolve: PrincipalResolverFn;
}

export class ResolverTrustError extends Error {
  constructor(public readonly pluginId: string) {
    super(`plugin '${pluginId}' is not permitted to register a principal resolver`);
    this.name = "ResolverTrustError";
  }
}

export class ResolverDuplicateError extends Error {
  constructor(public readonly pluginId: string) {
    super(`plugin '${pluginId}' already registered a principal resolver`);
    this.name = "ResolverDuplicateError";
  }
}

export class ResolverRegistry {
  private readonly byPlugin = new Map<string, ResolverRegistration>();

  /**
   * @param trustedPlugins operator-controlled ids from
   *   `identity.trustedResolverPlugins`. The bundled id is always trusted.
   */
  constructor(private readonly trustedPlugins: readonly string[]) {}

  /** Is a plugin permitted to register a resolver? (bundled OR in trust list) */
  isTrusted(pluginId: string): boolean {
    return pluginId === BUNDLED_RESOLVER_PLUGIN_ID || this.trustedPlugins.includes(pluginId);
  }

  /**
   * Register a resolver. Throws `ResolverTrustError` when the plugin is not
   * granted trust, `ResolverDuplicateError` on a second registration from the
   * same plugin. Returns an unregister handle.
   */
  register(reg: ResolverRegistration): () => void {
    if (!this.isTrusted(reg.pluginId)) throw new ResolverTrustError(reg.pluginId);
    if (this.byPlugin.has(reg.pluginId)) throw new ResolverDuplicateError(reg.pluginId);
    this.byPlugin.set(reg.pluginId, reg);
    return () => {
      const current = this.byPlugin.get(reg.pluginId);
      if (current === reg) this.byPlugin.delete(reg.pluginId);
    };
  }

  /** Number of registered resolvers. */
  get size(): number {
    return this.byPlugin.size;
  }

  /** True when at least one resolver is registered (configured or inert). */
  hasResolver(): boolean {
    return this.byPlugin.size > 0;
  }

  /** Active ⇔ a trusted resolver is registered AND configured (D1). */
  hasActiveResolver(): boolean {
    return [...this.byPlugin.values()].some((reg) => reg.active !== false);
  }

  /**
   * Active registrations in deterministic dispatch order:
   * `(priority ASC, pluginId ASC)`. A fresh array each call — callers may not
   * mutate internal state. Registered-but-unconfigured resolvers stay inert.
   */
  ordered(): ResolverRegistration[] {
    return [...this.byPlugin.values()].filter((reg) => reg.active !== false).sort(
      (a, b) => a.priority - b.priority || (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0),
    );
  }
}
