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
export function realpathNearestAncestor(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathNearestAncestor(parent), path.basename(p));
  }
}

/** Inputs to the forbidden list. Every field defaults to the running process. */
export interface ForbiddenSubjectsEnv {
  homedir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** POSIX system roots, refused exactly. */
const POSIX_SYSTEM_DIRS = ["/etc", "/usr", "/var", "/Library", "/System", "/bin", "/sbin", "/opt"];

/** Windows system roots: the environment variable, else the `C:\` literal. */
const WINDOWS_SYSTEM_DIRS: ReadonlyArray<readonly [string, string]> = [
  ["SystemRoot", "C:\\Windows"],
  ["ProgramFiles", "C:\\Program Files"],
  ["ProgramFiles(x86)", "C:\\Program Files (x86)"],
  ["ProgramData", "C:\\ProgramData"],
];

/**
 * The forbidden set, as real paths, for ONE platform: the running one unless
 * `env.platform` says otherwise (design D8). Listing the other platform's
 * directories is not inert: `path.resolve("C:\\Windows")` on POSIX is
 * `<cwd>/C:\Windows`, and the both-directions containment rule then refused the
 * server's cwd and every ancestor of it.
 *
 * Windows directories come from `%SystemRoot%`, `%ProgramFiles%`,
 * `%ProgramFiles(x86)%` and `%ProgramData%`, so a system drive other than C: is
 * covered; the `C:\` literal is the fallback for an unset variable.
 *
 * Not memoised: the list depends on live filesystem state (a `~/.ssh` created
 * after boot, a home that becomes a symlink).
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
 *
 * See change: surface-denial-remedy-in-previews.
 */
export function forbiddenGrantSubjects(env?: ForbiddenSubjectsEnv): {
  whole: string[];
  sensitive: string[];
} {
  const platform = env?.platform ?? process.platform;
  const vars = env?.env ?? process.env;
  const home = env?.homedir ?? os.homedir();
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  // Real paths only for the host's own platform: the filesystem cannot resolve
  // the other platform's paths, and the test seam uses exactly that case.
  const canonical = (x: string): string => {
    const resolved = p.resolve(x);
    const hostIsWindows = process.platform === "win32"; // platform-branch-ok: same path family as the host? (not host behaviour)
    return windows === hostIsWindows ? realpathNearestAncestor(resolved) : resolved;
  };
  const system = windows
    ? WINDOWS_SYSTEM_DIRS.map(([name, fallback]) => vars[name] || fallback)
    : POSIX_SYSTEM_DIRS;
  const root = windows ? p.parse(p.resolve(vars.SystemRoot || "C:\\")).root : "/";
  const whole = [root, home, ...system];
  const sensitive = [p.join(home, ".ssh"), p.join(home, ".pi")];
  return { whole: whole.map(canonical), sensitive: sensitive.map(canonical) };
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
export function isForbiddenGrantSubject(
  subject: string,
  env?: ForbiddenSubjectsEnv,
  /** Precomputed `forbiddenGrantSubjects(env)`, so a caller builds it once. */
  sets?: ReturnType<typeof forbiddenGrantSubjects>,
): boolean {
  const real = realpathNearestAncestor(path.resolve(subject));
  const { whole, sensitive } = sets ?? forbiddenGrantSubjects(env);

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
  env?: ForbiddenSubjectsEnv,
  /** Precomputed `forbiddenGrantSubjects(env)`, for a caller testing many rungs. */
  sets?: ReturnType<typeof forbiddenGrantSubjects>,
): boolean {
  const real = realpathNearestAncestor(path.resolve(candidate));
  const { whole, sensitive } = sets ?? forbiddenGrantSubjects(env);
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
export function isUngrantableSubject(subject: string, env?: ForbiddenSubjectsEnv): boolean {
  // Built once per call and shared by both halves (design D7): ~18 realpaths, not ~35.
  const sets = forbiddenGrantSubjects(env);
  return isForbiddenGrantSubject(subject, env, sets) || subsumesForbiddenGrantSubject(subject, env, sets);
}
