/**
 * Locality resolution for the OpenSpec auto-attach gate.
 *
 * Answers "does this change name belong to THIS session's project?" as a
 * TRI-STATE over the in-memory OpenSpec poll cache — never a fresh poll.
 * `openSpecChangeExistsInCache` in `event-wiring.ts` is deliberately left
 * untouched: the deleted-proposal bypass depends on its fail-open boolean.
 *
 * See change: scope-openspec-auto-attach-to-session-cwd (design D6/D7/D8).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Cache-read-only slice of `DirectoryService` the gate is allowed to touch. */
export interface OpenSpecCacheReader {
  getOpenSpecData(cwd: string): { initialized?: boolean; changes?: Array<{ name: string }> } | undefined;
}

export type Locality = "present" | "absent" | "unknown";

/** Session fields the gate reads. Keeps unit tests free of full fixtures. */
export type LocalitySession = Pick<DashboardSession, "cwd" | "gitWorktree" | "isGitRepo"> & {
  /** Server-internal: bridge has reported worktree state at least once. */
  gitWorktreeReported?: boolean;
};

/**
 * A session's worktree state is RESOLVED once the bridge has reported it, or
 * when the session is definitively not a git repo (a non-git session never
 * receives a `git_info_update` at all, so the flag would never flip).
 */
export function isWorktreeResolved(session: LocalitySession): boolean {
  return session.gitWorktreeReported === true || session.isGitRepo === false;
}

export interface CandidateRoots {
  /** Concrete roots to consult in the poll cache. */
  roots: string[];
  /** True when an additional UNKNOWN root participates (dominates → allow). */
  hasUnknownRoot: boolean;
}

/**
 * Candidate roots are orthogonal: a present `mainPath` ALWAYS contributes a
 * root, and resolvedness independently controls whether an unknown root is
 * added. See design D8's table.
 */
export function candidateRoots(session: LocalitySession): CandidateRoots {
  const roots: string[] = [];
  if (session.cwd) roots.push(session.cwd);
  const mainPath = session.gitWorktree?.mainPath;
  if (mainPath && !roots.includes(mainPath)) roots.push(mainPath);
  return { roots, hasUnknownRoot: !isWorktreeResolved(session) };
}

/**
 * Tri-state resolution over the union of candidate roots:
 * - any root positively lists the name  → `present`
 * - every root is initialized and none lists it → `absent`
 * - otherwise (an uninitialized root, or an unknown root) → `unknown`
 *
 * Cache reads only — never triggers a poll.
 */
export function resolveChangeLocality(
  cache: OpenSpecCacheReader,
  session: LocalitySession,
  changeName: string,
  opts: { includeUnknownRoot?: boolean } = {},
): Locality {
  const { roots, hasUnknownRoot } = candidateRoots(session);
  let sawUnknown = opts.includeUnknownRoot === false ? false : hasUnknownRoot;
  for (const root of roots) {
    const data = cache.getOpenSpecData(root);
    if (!data || !data.initialized) {
      sawUnknown = true;
      continue;
    }
    if ((data.changes ?? []).some((c) => c.name === changeName)) return "present";
  }
  if (sawUnknown) return "unknown";
  return roots.length === 0 ? "unknown" : "absent";
}

/** The gate itself: reject ONLY on a positive absence (design D6). */
export function localityGateAllows(
  cache: OpenSpecCacheReader,
  session: LocalitySession,
  changeName: string,
): boolean {
  return resolveChangeLocality(cache, session, changeName) !== "absent";
}

/**
 * Branch-4 deleted-proposal bypass predicate (design D9): the same CONCRETE
 * candidate roots (cwd + a present worktree `mainPath`), collapsed to a
 * boolean with `unknown → still exists` so the bypass keeps its fail-open
 * disposition on an uninitialized cache.
 *
 * The gate's *unknown root* (D8, injected while worktree state is unresolved)
 * is deliberately NOT applied here: it exists to keep an availability-
 * preserving gate from rejecting on ignorance, whereas injecting it into the
 * bypass would make `attachedStillExists` permanently true for every
 * not-yet-reported session and suppress branch 4 — regressing the existing
 * `Deleted attached proposal bypasses dialog` contract. Only the ROOT SET
 * widens here, exactly as D9 states.
 */
export function attachedStillExistsInCandidateRoots(
  cache: OpenSpecCacheReader,
  session: LocalitySession,
  changeName: string,
): boolean {
  return resolveChangeLocality(cache, session, changeName, { includeUnknownRoot: false }) !== "absent";
}
