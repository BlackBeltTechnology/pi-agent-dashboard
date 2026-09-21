/**
 * Browser-login-config registry — the host seam that lets a TRUSTED resolver
 * plugin publish a pre-auth browser login descriptor without the dashboard core
 * importing anything provider-specific (openspec add-multi-user-identity-plane,
 * D16, invariant I1).
 *
 * The trust decision is enforced by the server plugin-context wiring (the same
 * `resolverRegistry.isTrusted(id)` gate that guards `registerPrincipalResolver`);
 * this registry only stores the single active descriptor and hands it to the
 * `GET /api/identity/login-config` route. The plugin registers a descriptor ONLY
 * when it is active AND a `browserClientId` is configured, so a stored descriptor
 * is exactly the "login available" signal.
 *
 * Last trusted registration wins; the descriptor carries its owning `pluginId`
 * so the browser mounts the matching `login-provider` contribution (D16, F6).
 */
import type { BrowserLoginConfig } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export class BrowserLoginConfigRegistry {
  private current: BrowserLoginConfig | null = null;

  /** Publish the active descriptor. Returns an unregister handle that clears it
   * only if it is still the one this call set (unregister is idempotent). */
  set(config: BrowserLoginConfig): () => void {
    this.current = config;
    return () => {
      if (this.current === config) this.current = null;
    };
  }

  /** The active descriptor, or `null` when no trusted resolver has published one. */
  get(): BrowserLoginConfig | null {
    return this.current;
  }
}
