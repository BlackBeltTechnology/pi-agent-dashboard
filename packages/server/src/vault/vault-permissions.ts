/**
 * Owner-only check for `vault.json`.
 *
 * POSIX: observed from the mode bits (no group/other access).
 * Windows: `chmod` is a no-op, so the guarantee rests on the inherited NTFS ACL
 * of the user profile directory (the `pi-gateway-auth` secret-file convention:
 * checked, not assumed). The file must therefore live under the profile home;
 * the access-denied observation for a second local user is manual task 7.1 of
 * add-credential-vault.
 *
 * See change: add-credential-vault (D1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type OwnerOnlyBasis = "mode" | "profile-acl-inherited" | "outside-profile" | "missing";

export interface OwnerOnlyResult {
  ok: boolean;
  basis: OwnerOnlyBasis;
}

export function checkOwnerOnly(
  filePath: string,
  env: { platform?: NodeJS.Platform; home?: string } = {},
): OwnerOnlyResult {
  const platform = env.platform ?? process.platform;
  if (!fs.existsSync(filePath)) return { ok: false, basis: "missing" };
  if (platform !== "win32") {
    const mode = fs.statSync(filePath).mode & 0o777;
    return { ok: (mode & 0o077) === 0, basis: "mode" };
  }
  const home = path.resolve(env.home ?? os.homedir()).toLowerCase();
  const target = path.resolve(filePath).toLowerCase();
  const inside = target === home || target.startsWith(home.endsWith(path.sep) ? home : home + path.sep);
  return inside ? { ok: true, basis: "profile-acl-inherited" } : { ok: false, basis: "outside-profile" };
}
