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
 * so the browser mounts the matching `login-provider` contribution (D16, F6) —
 * or is redirected to the plugin's own view (D19).
 */
import type { BrowserLoginConfig } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** Descriptor fields a plugin supplies — the host stamps `pluginId` (D16, F6). */
export type PluginBrowserLoginConfig = Omit<BrowserLoginConfig, "pluginId">;

/**
 * Validate + narrow a plugin-supplied descriptor at the host trust boundary
 * (D19). The host never forwards a field it has not vetted:
 *
 * - `loginUrl` / `logoutUrl` are an OPEN-REDIRECT boundary core later acts on,
 *   so only a same-origin PATH survives. Absolute (`https://…`),
 *   scheme-relative (`//host`), and origin-less (`sso/login`) values are
 *   dropped; core's own gate routes (`/callback`, `/logout`) are refused
 *   outright — redirecting to them would loop.
 * - `issuer` / `clientId` are kept only as non-empty strings (COMPONENT
 *   providers, D16).
 * - Unknown fields are never forwarded.
 *
 * Returns `null` when nothing usable remains: a descriptor needs EITHER
 * `issuer`+`clientId` (component provider) OR a valid `loginUrl`
 * (separate-view provider).
 */
export function sanitizeBrowserLoginConfig(raw: PluginBrowserLoginConfig): PluginBrowserLoginConfig | null {
  const str = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const safePath = (v: unknown): string | undefined => {
    const s = str(v);
    if (!s?.startsWith("/") || s.startsWith("//")) return undefined;
    try {
      const pathname = new URL(s, "http://host.invalid").pathname;
      if (pathname === "/callback" || pathname === "/logout") return undefined;
    } catch {
      return undefined;
    }
    return s;
  };

  const issuer = str(raw.issuer);
  const clientId = str(raw.clientId);
  const loginUrl = safePath(raw.loginUrl);
  const logoutUrl = safePath(raw.logoutUrl);

  const componentKind = Boolean(issuer && clientId);
  if (!componentKind && !loginUrl) return null;

  return {
    ...(issuer ? { issuer } : {}),
    ...(clientId ? { clientId } : {}),
    ...(loginUrl ? { loginUrl } : {}),
    ...(logoutUrl ? { logoutUrl } : {}),
  };
}

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
