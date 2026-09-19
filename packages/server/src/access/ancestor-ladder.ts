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
import { subsumesForbiddenGrantSubject } from "./forbidden-subjects.js";

const PROBE_TIMEOUT_MS = 2_000;

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
  const real = realpathNearestAncestor(path.resolve(subject));
  const start = path.dirname(real);

  // Nothing to offer without offering $HOME itself.
  if (samePath(start, realHome)) return [];

  // A git checkout root, if any, terminates the ladder (inclusive).
  let checkoutRoot: string | null = null;
  try {
    const roots = await checkoutRootsAsync({ cwd: real, timeout: PROBE_TIMEOUT_MS });
    const candidate = roots?.thisCheckout;
    if (candidate && !samePath(candidate, real) && !samePath(candidate, start)) {
      checkoutRoot = realpathNearestAncestor(candidate);
    }
  } catch {
    /* degraded git → no-repo boundary rules, never a wider ladder */
  }

  const rungs: string[] = [];
  const fsRoot = path.parse(real).root;
  let cur = start;

  while (!samePath(cur, fsRoot)) {
    if (checkoutRoot && samePath(cur, checkoutRoot)) {
      if (!subsumesForbiddenGrantSubject(cur, { homedir: home })) rungs.push(cur);
      break;
    }
    if (samePath(cur, realHome)) break; // home is exclusive, never a rung
    // Refuse a rung that IS forbidden, and also one that SUBSUMES a forbidden
    // subject: `/private` (macOS) would admit `/private/etc`, and `/Users` would
    // admit a home directory. Either stops the climb.
    if (subsumesForbiddenGrantSubject(cur, { homedir: home })) break;
    rungs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return rungs;
}
