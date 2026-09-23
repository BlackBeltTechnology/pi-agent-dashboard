/**
 * Core-side read of the browser login descriptors (D16/D19/D25). Core needs
 * whether login is active and, per provider, the owning `pluginId` and the
 * same-origin paths it redirects to. The plugin owns everything else, so core
 * never learns anything provider-specific (I1).
 *
 * D25: several login plugins may be installed (Keycloak AND GitHub); the login
 * page lists every entry of `providers`. The top-level fields mirror the first
 * provider (component-provider mount, older callers).
 *
 * Never throws: a network failure, a non-2xx, or an unconfigured server all read
 * as inactive, so the gate degrades to "no browser login" rather than crashing
 * the pre-shell route.
 */
import { getApiBase } from "../api/api-context.js";

export interface LoginProvider {
  /** The host-vouched owning plugin id. */
  pluginId: string;
  /** SEPARATE-VIEW provider (D19): same-origin path core redirects to for
   * sign-in. Absent for a bundled-component provider. */
  loginUrl?: string;
  /** SEPARATE-VIEW provider (D19): same-origin path core redirects to for
   * sign-out. */
  logoutUrl?: string;
  /** D22 dashboard-UI mode: where the SPA exchanges the one-time handoff code. */
  tokenUrl?: string;
  /** D22: where the plugin lands the browser after sign-out. */
  postLogoutUrl?: string;
  /** D22: provider name for the sign-in button and user line. */
  label?: string;
  /** D22: sign-out also ends the provider session. */
  endsProviderSession?: boolean;
  /** `loginUrl` honours OIDC prompt=none (no-click sign-in). */
  silentSignIn?: boolean;
}

export interface LoginConfig extends Partial<LoginProvider> {
  active: boolean;
  /** Every login provider (D25). Empty when inactive. */
  providers: LoginProvider[];
}

const INACTIVE: LoginConfig = { active: false, providers: [] };

export async function fetchLoginConfig(): Promise<LoginConfig> {
  try {
    const res = await fetch(`${getApiBase()}/api/identity/login-config`);
    if (!res.ok) return INACTIVE;
    const data = (await res.json()) as Record<string, unknown> & { active?: boolean; providers?: unknown };
    if (data.active !== true) return INACTIVE;
    const rawList = Array.isArray(data.providers) ? data.providers : [data];
    const providers = rawList.map(parseProvider).filter((p): p is LoginProvider => p !== null);
    return { active: true, ...providers[0], providers };
  } catch {
    return INACTIVE;
  }
}

/** The provider with this id, if the config lists it. */
export function providerById(config: LoginConfig, pluginId: string | null | undefined): LoginProvider | undefined {
  return pluginId ? config.providers.find((p) => p.pluginId === pluginId) : undefined;
}

function parseProvider(raw: unknown): LoginProvider | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" && d[k] !== "" ? { [k]: d[k] as string } : {});
  const bool = (k: string) => (typeof d[k] === "boolean" ? { [k]: d[k] as boolean } : {});
  if (typeof d.pluginId !== "string" || d.pluginId === "") return null;
  return {
    pluginId: d.pluginId,
    ...str("loginUrl"),
    ...str("logoutUrl"),
    ...str("tokenUrl"),
    ...str("postLogoutUrl"),
    ...str("label"),
    ...bool("endsProviderSession"),
    ...bool("silentSignIn"),
  };
}
