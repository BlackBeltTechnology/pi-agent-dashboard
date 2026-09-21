/**
 * Core-side read of the browser login descriptor (D16). Core needs only whether
 * login is active and the owning `pluginId` — enough to mount the matching
 * `login-provider` (F6). The plugin fetches this same endpoint again for
 * issuer/clientId, so core never learns anything provider-specific (I1).
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
}

export async function fetchLoginConfig(): Promise<LoginConfig> {
  try {
    const res = await fetch(`${getApiBase()}/api/identity/login-config`);
    if (!res.ok) return { active: false };
    const data = (await res.json()) as { active?: boolean; pluginId?: string };
    return data.active === true ? { active: true, pluginId: data.pluginId } : { active: false };
  } catch {
    return { active: false };
  }
}
