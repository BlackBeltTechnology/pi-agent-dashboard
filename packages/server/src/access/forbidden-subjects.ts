/**
 * Subjects that may never be granted, whatever denial named them (design D15).
 *
 * One reflexive click must not be able to grant the entire filesystem, the
 * operator's home directory, their SSH keys, or the dashboard's own `~/.pi`
 * control plane. The system directories are included because `/etc` is the most
 * obvious target of a grant-the-parent sequence — the first draft of D15 omitted
 * them.
 *
 * Comparison is on **real paths**: `realpath("/etc")` is `/private/etc` on
 * macOS, and a home directory may itself be a symlink, so a lexical compare
 * would be trivially bypssed. The filter applies identically to a named subject
 * and to every rung of an offered-ancestor ladder (task 7b.2), so a ladder can
 * never walk up into a forbidden directory.
 *
 * See change: add-access-grants-and-review.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

/** Resolve symlinks in the nearest existing ancestor, re-appending the tail. */
function realpathNearestAncestor(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathNearestAncestor(parent), path.basename(p));
  }
}

/**
 * The forbidden set, as real paths. Platform system directories are listed for
 * POSIX and for Windows; entries that do not exist simply drop out.
 *
 * The `whole` list holds subjects that are refused **exactly**: granting them
 * would hand over the entire filesystem (`/`) or the entire user home (`$HOME`),
 * or a platform system root. They are deliberately NOT "and everything beneath
 * them": every ordinary project directory lives under `$HOME`, so a descendant
 * rule would make the feature unable to grant anything at all, and `/var` would
 * sweep in macOS temp dirs (`/private/var/folders/...`) plus legitimate data
 * roots such as `/var/www`.
 *
 * The `sensitive` list is refused **exactly and for every descendant**: these
 * hold secrets or the agent's own control plane, so a grant for a directory
 * inside them (`~/.ssh/keys`) is refused as well. This descendant rule is what
 * stops an offered-ancestor ladder from climbing into a secret store.
 */
export function forbiddenGrantSubjects(env?: { homedir?: string }): {
  whole: string[];
  sensitive: string[];
} {
  const home = env?.homedir ?? os.homedir();
  const whole = [
    path.parse(path.resolve("/")).root, // "/" (or "C:\" on Windows)
    home,
    "/etc",
    "/usr",
    "/var",
    "/Library",
    "/System",
    "/bin",
    "/sbin",
    "/opt",
    // Windows equivalents
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
  ];
  const sensitive = [path.join(home, ".ssh"), path.join(home, ".pi")];
  return {
    whole: whole.map((p) => realpathNearestAncestor(path.resolve(p))),
    sensitive: sensitive.map((p) => realpathNearestAncestor(path.resolve(p))),
  };
}

/**
 * True when `subject` is a forbidden grant subject: an exact match on the
 * whole-directory list (`/`, `$HOME`, the platform system roots), or an exact
 * match **or descendant** of a sensitive directory (`~/.ssh`, `~/.pi`).
 *
 * The same function is applied to a named subject and to every rung of an
 * offered-ancestor ladder (task 7b.2), so a ladder can never offer a secret
 * store or climb through one.
 */
export function isForbiddenGrantSubject(subject: string, env?: { homedir?: string }): boolean {
  const real = realpathNearestAncestor(path.resolve(subject));
  const { whole, sensitive } = forbiddenGrantSubjects(env);

  if (whole.some((f) => samePath(real, f))) return true;

  for (const forbidden of sensitive) {
    if (samePath(real, forbidden)) return true;
    const rel = path.relative(forbidden, real);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

/** True when `candidate` equals, or sits under, `other`. */
function subsumes(candidate: string, other: string): boolean {
  if (samePath(candidate, other)) return true;
  const rel = path.relative(candidate, other);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * True when granting `candidate` would make a forbidden subject readable —
 * either because `candidate` IS forbidden, or because it is an ANCESTOR of one
 * and would therefore admit it.
 *
 * The ancestor case is load-bearing and was found by a test: on macOS
 * `realpath("/etc")` is `/private/etc`, so an offered-ancestor ladder for
 * `/etc/passwd` produced the rung `/private` — which is not itself forbidden,
 * yet granting it admits `/private/etc` and every secret below it. The same
 * applies to `/Users` for a home directory. A ladder must therefore never offer
 * a rung that subsumes a forbidden subject (task 7b.2's "the filter SHALL apply
 * identically to a ladder rung").
 */
export function subsumesForbiddenGrantSubject(
  candidate: string,
  env?: { homedir?: string },
): boolean {
  const real = realpathNearestAncestor(path.resolve(candidate));
  const { whole, sensitive } = forbiddenGrantSubjects(env);
  return [...whole, ...sensitive].some((forbidden) => subsumes(real, forbidden));
}

/**
 * The complete grantability test: forbidden in its own right, OR an ancestor
 * that would subsume a forbidden subject.
 *
 * Both enforcement points need this EXACT pair — the grant route's validation
 * and the store's post-normalization backstop — so it is named once here rather
 * than re-spelled as a `||` at each site, where one of the two halves could be
 * dropped without any test noticing. Callers must pass the subject that will be
 * PERSISTED, not a pre-normalization input (design D15).
 */
export function isUngrantableSubject(subject: string, env?: { homedir?: string }): boolean {
  return isForbiddenGrantSubject(subject, env) || subsumesForbiddenGrantSubject(subject, env);
}
