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
 * The `sensitive` list also holds the CLI credential directories (`~/.aws`, `~/.config/gh`,
 * `~/.gnupg`, `~/.kube`, `~/.docker`), the exact file `~/.netrc` and the browser user-data
 * roots of the running platform (`browserProfileRoots`). Because every consumer funnels through
 * this module (agent gate flag, grant backstop, ladder, planes, YOLO roots + auto-allow,
 * provisioning, cwd verdicts, allow-once admission, agent grant acceptance, trust-mirror deny,
 * browse roots), one edit here makes them sensitive everywhere. Residual drift: the local lists in
 * `server/src/access/provisioning.ts` and `shared/src/pi-trust-mirror.ts` are left alone (supersets
 * are verified); a fourth list is NOT added.
 *
 * See change: add-access-grants-and-review; harden-agent-tool-guards (D7).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { samePath } from "./platform/paths.js";

/** Resolve symlinks in the nearest existing ancestor, re-appending the tail. Used for a caller-supplied subject. */
export function realpathNearestAncestor(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realpathNearestAncestor(parent), path.basename(p));
  }
}

/**
 * Same resolution for the LISTED credential locations (home-derived constants, never request input).
 *
 * Most listed entries do not exist on a given host, and each miss throws ENOENT from `realpathSync`.
 * With the extended sensitive list (harden-agent-tool-guards D7, ~30 entries) that was a measurable
 * cost on the denial path, almost all of it capturing a stack trace nobody reads. The caller
 * (`forbiddenGrantSubjects`) therefore zeroes `Error.stackTraceLimit` around the whole list build, and
 * `cache` shares the parent resolution across entries. No extra fs probe is added: an `lstat` here was a
 * CodeQL js/path-injection sink, while `realpathSync` is not.
 */
function realpathListedAncestor(p: string, cache: Map<string, string>): string {
  const hit = cache.get(p);
  if (hit !== undefined) return hit;
  let result: string;
  try {
    result = fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    result = parent === p ? p : path.join(realpathListedAncestor(parent, cache), path.basename(p));
  }
  cache.set(p, result);
  return result;
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
/**
 * Path semantics for the selected platform: its `path` flavour, a canonicaliser
 * (real paths only when the platform shares the host's path family — the
 * filesystem cannot resolve the other family, which is exactly the test seam)
 * and its equality. Shared by the list and every predicate, so a simulated
 * `win32` is Windows end to end (design D8).
 */
function pathOps(env?: ForbiddenSubjectsEnv, cache?: Map<string, string>) {
  const platform = env?.platform ?? process.platform;
  const windows = platform === "win32";
  const p = windows ? path.win32 : path.posix;
  const hostIsWindows = process.platform === "win32"; // platform-branch-ok: same path family as the host? (not host behaviour)
  const canonical = (x: string): string => {
    const resolved = p.resolve(x);
    if (windows !== hostIsWindows) return resolved;
    return cache ? realpathListedAncestor(resolved, cache) : realpathNearestAncestor(resolved);
  };
  const same = (a: string, b: string): boolean => samePath(a, b, platform);
  return { platform, windows, p, canonical, same };
}

/**
 * Browser user-data roots per platform (design D7, NORMATIVE; one test row per browser and platform
 * asserts this table by equality). Chrome equals `chromeUserDataDir` (`chrome-profiles.ts`).
 * Brave is the VENDOR root (`BraveSoftware`, which contains `Brave-Browser/User Data`).
 * Snap / flatpak locations (`~/snap/firefox`, `~/.var/app/*`) are a recorded residual.
 *
 * To add a browser: add its root to the matching platform branch below, add a row to
 * `forbidden-subjects.test.ts` (and the design D7 table), nothing else - every consumer follows.
 */
export function browserProfileRoots(
  platform: NodeJS.Platform,
  home: string,
  vars: NodeJS.ProcessEnv,
): string[] {
  if (platform === "win32") {
    const local = vars.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    const roaming = vars.APPDATA || path.win32.join(home, "AppData", "Roaming");
    return [
      path.win32.join(local, "Google", "Chrome", "User Data"),
      path.win32.join(local, "Microsoft", "Edge", "User Data"),
      path.win32.join(local, "BraveSoftware"),
      path.win32.join(roaming, "Mozilla"),
    ];
  }
  if (platform === "darwin") {
    const support = path.posix.join(home, "Library", "Application Support");
    return ["Google/Chrome", "Chromium", "Microsoft Edge", "BraveSoftware", "Firefox"].map((d) => path.posix.join(support, d));
  }
  const config = path.posix.join(home, ".config");
  return [
    ...["google-chrome", "chromium", "microsoft-edge", "BraveSoftware"].map((d) => path.posix.join(config, d)),
    path.posix.join(home, ".mozilla"),
  ];
}

/** CLI credential directories and files under `$HOME` (same on every platform). */
const HOME_CREDENTIAL_SUBPATHS: ReadonlyArray<readonly string[]> = [
  [".aws"],
  [".config", "gh"],
  [".gnupg"],
  [".kube"],
  [".docker"],
  // exact file only: `~/.netrc.*` siblings and Windows `_netrc` are a recorded residual
  [".netrc"],
];

export function forbiddenGrantSubjects(env?: ForbiddenSubjectsEnv): {
  whole: string[];
  sensitive: string[];
} {
  // One resolution cache per call: the ~30 listed paths share parents (`~/.config/*`, `~/Library/...`).
  const { platform, windows, p, canonical } = pathOps(env, new Map());
  const vars = env?.env ?? process.env;
  const home = env?.homedir ?? os.homedir();
  const system = windows
    ? WINDOWS_SYSTEM_DIRS.map(([name, fallback]) => vars[name] || fallback)
    : POSIX_SYSTEM_DIRS;
  const root = windows ? p.parse(p.resolve(vars.SystemRoot || "C:\\")).root : "/";
  const whole = [root, home, ...system];
  const sensitive = [
    p.join(home, ".ssh"),
    p.join(home, ".pi"),
    ...HOME_CREDENTIAL_SUBPATHS.map((sub) => p.join(home, ...sub)),
    ...browserProfileRoots(platform, home, vars),
  ];
  return withoutStackTraces(() => ({ whole: whole.map(canonical), sensitive: sensitive.map(canonical) }));
}

/** Run `fn` with error stack capture off: a missing path throws ENOENT from `realpathSync`, and the stack is never read. */
function withoutStackTraces<T>(fn: () => T): T {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
    return fn();
  } finally {
    Error.stackTraceLimit = limit;
  }
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
  const ops = pathOps(env);
  const real = ops.canonical(subject);
  const { whole, sensitive } = sets ?? forbiddenGrantSubjects(env);

  if (whole.some((f) => ops.same(real, f))) return true;
  return sensitive.some((forbidden) => subsumes(forbidden, real, ops));
}

/** True when `candidate` equals, or is an ancestor of, `other` (selected platform's semantics). */
function subsumes(candidate: string, other: string, ops: ReturnType<typeof pathOps>): boolean {
  if (ops.same(candidate, other)) return true;
  // POSIX `relative` is a case-sensitive resolve + split: a descendant must be a string-prefix match, so the
  // costly relative() is skipped for the (many) unrelated pairs of the ~30-entry sensitive list.
  if (!ops.windows && !other.startsWith(candidate)) return false;
  const rel = ops.p.relative(candidate, other);
  // `..x` is a child NAME; only `..` or `..<sep>…` leaves the candidate.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${ops.p.sep}`) && !ops.p.isAbsolute(rel);
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
  const ops = pathOps(env);
  const real = ops.canonical(candidate);
  const { whole, sensitive } = sets ?? forbiddenGrantSubjects(env);
  return [...whole, ...sensitive].some((forbidden) => subsumes(real, forbidden, ops));
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
export function isUngrantableSubject(
  subject: string,
  env?: ForbiddenSubjectsEnv,
  /** Precomputed `forbiddenGrantSubjects(env)`, for a caller testing many subjects (e.g. a stored list). */
  sets?: ReturnType<typeof forbiddenGrantSubjects>,
): boolean {
  // Built once per call (or by the caller) and shared by both halves (design D7); the subject is
  // canonicalised once, not once per half.
  const ops = pathOps(env);
  const real = withoutStackTraces(() => ops.canonical(subject));
  const { whole, sensitive } = sets ?? forbiddenGrantSubjects(env);
  return (
    whole.some((f) => ops.same(real, f)) ||
    sensitive.some((f) => subsumes(f, real, ops)) ||
    [...whole, ...sensitive].some((f) => subsumes(real, f, ops))
  );
}
