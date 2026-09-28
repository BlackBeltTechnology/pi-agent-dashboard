/**
 * First-party plugin identity: the npm scope `@blackbelt-technology/`.
 *
 * Single predicate shared by the providerAuth seam gate (server.ts) and the
 * `firstParty` projection on `GET /api/plugins` rows (settings nav promotion).
 * NOT `priority` — that is plugin-authored and doubles as render order.
 *
 * See change: publish-quota-plugin (providerAuth gate),
 * promote-model-roles-settings (shared helper + `firstParty` row field).
 */
import type { PluginAuthCredential, PluginProviderAuth } from "./server-context.js";

export const FIRST_PARTY_PLUGIN_SCOPE = "@blackbelt-technology/";

/** True iff `packageName` is in the first-party npm scope. Empty/undefined → false. */
export function isFirstPartyPluginPackage(packageName: string | null | undefined): boolean {
  return typeof packageName === "string" && packageName.startsWith(FIRST_PARTY_PLUGIN_SCOPE);
}

/**
 * Build the providerAuth seam for one plugin: returns stored provider
 * credentials only to first-party plugins; a read failure degrades to
 * `undefined`.
 */
export function createGatedProviderAuth(
  packageName: string,
  readAuth: () => Record<string, PluginAuthCredential | undefined>,
): PluginProviderAuth {
  return {
    getCredential: (provider: string) => {
      if (!isFirstPartyPluginPackage(packageName)) return undefined;
      try {
        return readAuth()[provider];
      } catch {
        return undefined;
      }
    },
  };
}
