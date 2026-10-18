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
import { existsSync } from "node:fs";
import path from "node:path";
import {
  chromeUserDataDir,
  listChromeProfiles as listChromeProfilesShared,
  type ProfileDiscoveryDeps,
  type ProfileSource as SharedProfileSource,
} from "@blackbelt-technology/pi-dashboard-shared/chrome-profiles.js";
import { isExtensionInstalledInProfile } from "./relay/vendor/playwright-core/src/tools/utils/extension.js";

export type { ProfileDiscoveryDeps };

/**
 * Password-manager extensions the dedicated/relay recipe warns about: a
 * password field on a page can make such an extension close the debug session.
 * Ids verified against the Web Store 2026-10-17; add others only after the same
 * verification. See change: add-dedicated-agent-browser (D10).
 */
const PASSWORD_MANAGER_IDS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "hdokiejnpimakedhajhdlcegeplioahd", name: "LastPass" },
  { id: "pejdijmoenmkgeppbflobdenhhabjlaj", name: "iCloud Passwords" },
];

/** A discovered profile plus the password managers installed in it. */
export type ProfileSource = SharedProfileSource & {
  /** Display names from `PASSWORD_MANAGER_IDS`; `[]` when none. Optional only so literals in older callers still type-check. */
  passwordManagers?: string[];
};

export interface ProfileListResult {
  profiles: ProfileSource[];
  warning?: string;
}

/** Names of the table's password managers whose `Extensions/<id>` dir exists in `profileDir`. */
export function detectPasswordManagers(
  profileDir: string,
  exists: (p: string) => boolean = existsSync,
): string[] {
  return PASSWORD_MANAGER_IDS.filter(({ id }) => exists(path.join(profileDir, "Extensions", id))).map(
    ({ name }) => name,
  );
}

/**
 * Discover Chrome profiles. Never throws: any read/parse failure degrades to
 * the synthetic row + warning, which is a 200 (spec X9), not an error.
 * Parsing lives in shared (`chrome-profiles.ts`); the `installed` probe stays
 * the vendored upstream check. See change: add-operator-browser-relay (D8).
 */
export async function listChromeProfiles(deps: ProfileDiscoveryDeps = {}): Promise<ProfileListResult> {
  const result = await listChromeProfilesShared({
    ...deps,
    isInstalled: deps.isInstalled ?? ((profileDir: string) => isExtensionInstalledInProfile(profileDir)),
  });
  const userDataDir =
    deps.userDataDir ?? chromeUserDataDir(deps.platform ?? process.platform, deps.env ?? process.env);
  const exists = deps.exists ?? existsSync;
  return {
    ...result,
    profiles: result.profiles.map((p) => ({
      ...p,
      passwordManagers: detectPasswordManagers(path.join(userDataDir, p.profileDirectory), exists),
    })),
  };
}
