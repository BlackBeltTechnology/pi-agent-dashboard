/**
 * Server-side cwd allowlist for the acquire path (D11).
 *
 * An untrusted embed visitor controls the requested `cwd`, so — before ever
 * spawning a `pi` there — acquire validates the realpath-resolved cwd against a
 * configured set of allowed roots (the same containment idiom as the localhost
 * file routes). An empty allowlist means "unconfigured" and, for safety, denies
 * every request (the caller enables the feature by configuring roots).
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import { realpathSync } from "node:fs";
import { caseInsensitiveFilesystem } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { within } from "../lib/path-containment.js";

export interface AllowlistOptions {
  /** Test seam for `realpathSync`. */
  realpath?: (p: string) => string;
  /** Force case-insensitivity (defaults to darwin/win32 detection). */
  caseInsensitive?: boolean;
}

/**
 * True when `cwd` (realpath-resolved) is contained by at least one allowed root
 * (also realpath-resolved). A realpath failure on the cwd falls back to the raw
 * path; a failure on a root drops that root. An empty `allowedRoots` denies.
 */
export function isCwdAllowed(
  cwd: string,
  allowedRoots: readonly string[],
  opts: AllowlistOptions = {},
): boolean {
  if (allowedRoots.length === 0) return false;
  const realpath = opts.realpath ?? realpathSync;
  const caseInsensitive = opts.caseInsensitive ?? caseInsensitiveFilesystem();
  const resolve = (p: string): string => {
    let r: string;
    try {
      r = realpath(p);
    } catch {
      r = p;
    }
    // Case-normalize on case-insensitive filesystems so a realpath'd cwd and an
    // allowed root differing only by casing still contain — matching how
    // `identity-key.ts` canonicalizes the cwd (else a valid cwd is rejected).
    return caseInsensitive ? r.toLowerCase() : r;
  };
  const realCwd = resolve(cwd);
  return allowedRoots.some((root) => within(realCwd, resolve(root)));
}
