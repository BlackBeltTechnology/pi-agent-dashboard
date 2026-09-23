/**
 * The offered-ancestor ladder for a denied subject (design D15, task 7b.1a).
 *
 * A denial names a containing directory; the remedy may also offer to grant a
 * directory *above* it, because the refused file is usually one level below a
 * boundary the operator actually cares about (`/repo/a/b/c.txt` denied, grant
 * `/repo`). The ladder is what keeps that widening explicit and bounded.
 *
 * Rules, each a test:
 *   - Computed from the subject's **real path**, so a symlink's lexical parent
 *     is never offered — it is a link, not a directory the operator saw.
 *   - Truncated at the nearest boundary: a **git checkout root is included** and
 *     terminates the ladder (never offering the directory holding unrelated
 *     repos); with no repository, the ladder stops **below** `$HOME` (exclusive)
 *     and the filesystem root is never a rung (mount point exclusive).
 *   - Parent is `$HOME` → **empty ladder**: there is nothing to widen to without
 *     offering the home directory, which D15 forbids outright.
 *   - Every rung passes the forbidden-subject filter, so a ladder can never
 *     climb into `/etc`, `/usr`, `~/.ssh`, `~/.pi`, or the home directory.
 *
 * See change: add-access-grants-and-review.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkoutRootsAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { forbiddenGrantSubjects, subsumesForbiddenGrantSubject } from "./forbidden-subjects.js";

const PROBE_TIMEOUT_MS = 2_000;

/**
 * Checkout-root lookups are cached per real directory (change:
 * add-access-grant-dialog, test-plan #P3). The probe spawns `git`; uncached,
 * every denial paid ~20 ms and a denial flood spawned a process per denial.
 * Staleness is bounded by the TTL: a repository created or removed in the last
 * few seconds may be missed, and the ladder is still forbidden-filtered and
 * only ever offered. A probe that throws is not cached; a `null` answer ("no
 * checkout" or degraded git, which the probe does not distinguish) is, and both
 * mean the narrower no-repo boundary.
 */
export const CHECKOUT_ROOT_CACHE_TTL_MS = 5_000;
export const CHECKOUT_ROOT_CACHE_MAX = 256;
const checkoutRootCache = new Map<string, { root: string | null; at: number }>();

/** Test seam. */
export function __resetCheckoutRootCache(): void {
  checkoutRootCache.clear();
}

async function cachedCheckoutRoot(real: string): Promise<string | null> {
  const now = Date.now();
  const hit = checkoutRootCache.get(real);
  if (hit && now - hit.at < CHECKOUT_ROOT_CACHE_TTL_MS) return hit.root;
  const roots = await checkoutRootsAsync({ cwd: real, timeout: PROBE_TIMEOUT_MS });
  const root = roots?.thisCheckout ?? null;
  checkoutRootCache.delete(real);
  if (checkoutRootCache.size >= CHECKOUT_ROOT_CACHE_MAX) {
    const oldest = checkoutRootCache.keys().next().value;
    if (oldest !== undefined) checkoutRootCache.delete(oldest);
  }
  checkoutRootCache.set(real, { root, at: now });
  return root;
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** The real checkout root containing `real`, or null (none, or degraded git). */
async function checkoutBoundary(real: string): Promise<string | null> {
  try {
    const candidate = await cachedCheckoutRoot(real);
    return candidate ? realpathNearestAncestor(candidate) : null;
  } catch {
    return null; // degraded git → no-repo boundary rules, never a wider ladder
  }
}

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
 * Ancestors of `subject`, nearest-first, already bounded and filtered. Returned
 * values are real paths. An empty array is a legitimate answer, not an error.
 */
export async function offeredAncestorLadder(
  subject: string,
  opts?: { homedir?: string },
): Promise<string[]> {
  const home = opts?.homedir ?? os.homedir();
  const realHome = realpathNearestAncestor(path.resolve(home));
  // A subject that does not resolve is refused, never compared unresolved: a
  // lexical tail (a dangling symlink, a not-yet-created directory) would offer
  // rungs whose real identity is unknown (test-plan #X8).
  const real = realpathOrNull(path.resolve(subject));
  if (real === null) return [];
  const start = path.dirname(real);

  // Nothing to offer without offering $HOME itself.
  if (samePath(start, realHome)) return [];

  // A git checkout root, if any, terminates the ladder (inclusive).
  const checkoutRoot = await checkoutBoundary(real);
  // The boundary IS the subject: the ladder starts at the subject's PARENT,
  // which already sits above the boundary, so nothing may be offered. Both
  // of the old exclusions here (`boundary !== real` AND `boundary !== start`)
  // instead nulled the boundary, so the climb ran past the checkout and
  // offered the directory holding EVERY sibling repository — the one-click
  // widening this module exists to prevent (found by the task 8.7 review).
  // `boundary === start` (subject is a direct child of the repo root) is NOT
  // excluded: `start` is the first rung and the loop's boundary check
  // terminates on it, offering exactly the repo root and nothing above it.
  if (checkoutRoot && samePath(checkoutRoot, real)) return [];


  // Derived once per ladder, not once per rung (test-plan #P3).
  const forbidden = forbiddenGrantSubjects({ homedir: home });
  const rungs: string[] = [];
  const fsRoot = path.parse(real).root;
  let cur = start;

  while (!samePath(cur, fsRoot)) {
    if (checkoutRoot && samePath(cur, checkoutRoot)) {
      if (!subsumesForbiddenGrantSubject(cur, { homedir: home }, forbidden)) rungs.push(cur);
      break;
    }
    if (samePath(cur, realHome)) break; // home is exclusive, never a rung
    // Refuse a rung that IS forbidden, and also one that SUBSUMES a forbidden
    // subject: `/private` (macOS) would admit `/private/etc`, and `/Users` would
    // admit a home directory. Either stops the climb.
    if (subsumesForbiddenGrantSubject(cur, { homedir: home }, forbidden)) break;
    rungs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return rungs;
}
