/**
 * Core-side read of the browser login descriptor (D16/D19). Core needs whether
 * login is active, the owning `pluginId`, and — for a SEPARATE-VIEW provider —
 * the `loginUrl`/`logoutUrl` it redirects to. The plugin owns everything else,
 * so core never learns anything provider-specific (I1).
 *
 * Never throws: a network failure, a non-2xx, or an unconfigured server all read
 * as inactive, so the gate degrades to "no browser login" rather than crashing
 * the pre-shell route.
 */
import { getApiBase } from "../api/api-context.js";

export interface LoginConfig {
  active: boolean;
  /** Present only when active — the host-vouched owning resolver plugin id. */
  pluginId?: string;
  /** SEPARATE-VIEW provider (D19): same-origin path core redirects to for
   * sign-in. Absent for a bundled-component provider. */
  loginUrl?: string;
  /** SEPARATE-VIEW provider (D19): same-origin path core redirects to for
   * sign-out. */
  logoutUrl?: string;
}

export async function fetchLoginConfig(): Promise<LoginConfig> {
  try {
    const res = await fetch(`${getApiBase()}/api/identity/login-config`);
    if (!res.ok) return { active: false };
    const data = (await res.json()) as {
      active?: boolean;
      pluginId?: string;
      loginUrl?: string;
      logoutUrl?: string;
    };
    if (data.active !== true) return { active: false };
    return {
      active: true,
      pluginId: data.pluginId,
      ...(data.loginUrl ? { loginUrl: data.loginUrl } : {}),
      ...(data.logoutUrl ? { logoutUrl: data.logoutUrl } : {}),
    };
  } catch {
    return { active: false };
  }
}
