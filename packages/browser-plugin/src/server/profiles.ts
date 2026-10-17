/**
 * Chrome profile discovery (change: add-browser-relay, task 2.7 / spec
 * `browser-relay` "Profile discovery and capability").
 *
 * The source of truth is Chrome's own `Local State → profile.info_cache`,
 * which carries the stable `profileDirectory` key plus the user-editable
 * `name` label and the signed-in `user_name`. Labels are NOT unique (two
 * profiles can both be "Person 1"), which is exactly why every config map,
 * instance map and REST parameter is keyed by `profileDirectory`.
 *
 * Nothing here is privileged: reading `Local State` needs no Chrome
 * cooperation and no permissions.
 *
 * Two failure modes are normal, not errors, and both yield the SAME answer —
 * a single synthetic `Default` row plus a `warning` naming the path:
 *  - the user-data directory does not exist (Chrome never run on this host);
 *  - `Local State` is absent or unparseable (fresh profile / concurrent write).
 * The caller only loses the label/email decoration; `connect` still proceeds
 * to the `installed` check, which is what actually gates a connection.
 */
import {
  listChromeProfiles as listChromeProfilesShared,
  type ProfileDiscoveryDeps,
  type ProfileListResult,
  type ProfileSource,
} from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { isExtensionInstalledInProfile } from "./relay/vendor/playwright-core/src/tools/utils/extension.js";

export type { ProfileDiscoveryDeps, ProfileListResult, ProfileSource };

/**
 * Discover Chrome profiles. Never throws: any read/parse failure degrades to
 * the synthetic row + warning, which is a 200 (spec X9), not an error.
 * Parsing lives in shared (`chrome-profiles.ts`); the `installed` probe stays
 * the vendored upstream check. See change: add-operator-browser-relay (D8).
 */
export function listChromeProfiles(deps: ProfileDiscoveryDeps = {}): Promise<ProfileListResult> {
  return listChromeProfilesShared({
    ...deps,
    isInstalled: deps.isInstalled ?? ((profileDir: string) => isExtensionInstalledInProfile(profileDir)),
  });
}
