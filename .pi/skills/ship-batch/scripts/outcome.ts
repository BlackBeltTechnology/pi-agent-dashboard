/**
 * Outcome classification (D5) + teardown plan (D6). No direct I/O: `classify`
 * receives its fetch / file probes and a sleep as injected functions;
 * `teardownPlan` is a pure decision table.
 *
 * See change: add-ship-batch-orchestrator.
 */
import { archivedChangeName } from "../../../../packages/shared/src/openspec-dependencies.ts";
import type { Outcome } from "./types.ts";

export const REFETCH_DELAY_MS = 30_000;
export const MAX_FETCH_ATTEMPTS = 3;
export const FETCH_BACKOFF_MS = 2_000;

export interface ClassifyInput {
  change: string;
  /** Archive directory names on `origin/develop` at plan time. */
  planArchive: readonly string[];
  /** `git fetch origin develop` + `git ls-tree` of `openspec/changes/archive/`; `null` = fetch failed. */
  fetchArchive: () => Promise<string[] | null>;
  /** `<worktree>/openspec/changes/<change>/SHIP_IT_BLOCKED.md` exists. */
  blockedFileExists: () => boolean;
  sleep: (ms: number) => Promise<void>;
}

export interface ClassifyResult {
  outcome: Outcome;
  fetches: number;
}

/** `<change>` archived now and not at plan time (exact name via the shared parser). */
function isNewlyArchived(change: string, dirs: readonly string[], planArchive: ReadonlySet<string>): boolean {
  return dirs.some((d) => archivedChangeName(d) === change && !planArchive.has(d));
}

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const plan = new Set(input.planArchive);
  let fetches = 0;
  const fetchOnce = async (): Promise<string[] | null> => {
    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      if (attempt > 0) await input.sleep(FETCH_BACKOFF_MS * 2 ** (attempt - 1));
      fetches++;
      const dirs = await input.fetchArchive();
      if (dirs) return dirs;
    }
    return null;
  };

  const first = await fetchOnce();
  if (first === null) return { outcome: "unknown", fetches };
  if (isNewlyArchived(input.change, first, plan)) return { outcome: "shipped", fetches };
  if (input.blockedFileExists()) return { outcome: "blocked", fetches };

  // Merge propagation: one re-fetch before deciding the change did not ship.
  await input.sleep(REFETCH_DELAY_MS);
  const second = await fetchOnce();
  if (second === null) return { outcome: "unknown", fetches };
  if (isNewlyArchived(input.change, second, plan)) return { outcome: "shipped", fetches };
  return { outcome: "incomplete", fetches };
}

// ── Teardown plan (D6) ──────────────────────────────────────────────

export type TeardownStep =
  | { op: "prune" }
  | { op: "branch-delete" }
  | { op: "wip-commit" }
  | { op: "push" }
  | { op: "remove"; force: true; deleteBranch: false };

export interface WorktreeFacts {
  /** The worktree is registered in `git worktree list`. */
  registered: boolean;
  /** Porcelain paths of pushable dirt (tracked changes + untracked non-ignored). */
  dirt: readonly string[];
  /** Commits on `os/<change>` not on `develop`. */
  aheadOfDevelop: number;
  /** MERGE_HEAD / rebase in progress / detached HEAD. */
  midOperation: boolean;
  /** Local branch `os/<change>` exists. */
  branchExists: boolean;
}

export type TeardownVerdict = "shipped" | "incomplete" | "failed" | "kept";

export interface TeardownPlan {
  steps: TeardownStep[];
  /** Final state of the item once every step succeeded. */
  result: TeardownVerdict;
  /** Set when `result === "kept"`. */
  keptReason?: string;
}

/** Worktree-local config that never counts as work (ship-it §4.5 keeps it unstaged). */
export const LOCAL_ONLY_PATHS: ReadonlySet<string> = new Set([".pi/settings.json"]);

export function workDirt(dirt: readonly string[]): string[] {
  return dirt.filter((p) => !LOCAL_ONLY_PATHS.has(p));
}

const kept = (keptReason: string, steps: TeardownStep[] = []): TeardownPlan => ({ steps, result: "kept", keptReason });

const BRANCH_DELETE: TeardownStep = { op: "branch-delete" };
const REMOVE: TeardownStep = { op: "remove", force: true, deleteBranch: false };

function shippedPlan(facts: WorktreeFacts): TeardownPlan {
  const deleteBranch = facts.branchExists ? [BRANCH_DELETE] : [];
  if (!facts.registered) return { steps: [{ op: "prune" }, ...deleteBranch], result: "shipped" };
  if (facts.midOperation) return kept("shipped but the worktree has a merge/rebase in progress or a detached HEAD");
  if (workDirt(facts.dirt).length > 0) return kept("shipped but the worktree has unpushable local changes");
  return { steps: [REMOVE, ...deleteBranch], result: "shipped" };
}

/** blocked / incomplete / failed — never lose work that is not on origin. */
function unshippedPlan(outcome: "blocked" | "incomplete" | "failed", facts: WorktreeFacts): TeardownPlan {
  if (!facts.registered) {
    return kept(facts.branchExists ? "worktree is not registered; local branch left as-is" : "worktree is not registered");
  }
  if (facts.midOperation) return kept("merge/rebase in progress or detached HEAD; nothing committed or removed");

  const dirty = workDirt(facts.dirt).length > 0;
  const hasWork = dirty || facts.aheadOfDevelop > 0;
  const steps: TeardownStep[] = [];
  if (dirty) steps.push({ op: "wip-commit" });
  if (hasWork || outcome === "blocked") steps.push({ op: "push" });

  if (outcome === "blocked") {
    // SHIP_IT_BLOCKED.md is gitignored, so the hand-back is unpushable: keep the worktree.
    return kept("blocked: SHIP_IT_BLOCKED.md is local only; WIP pushed, worktree kept", steps);
  }
  steps.push(REMOVE);
  if (!hasWork && facts.branchExists) steps.push(BRANCH_DELETE);
  return { steps, result: outcome };
}

export function teardownPlan(outcome: Outcome, facts: WorktreeFacts): TeardownPlan {
  if (outcome === "unknown") return kept("outcome unknown (fetch failed); nothing was changed");
  return outcome === "shipped" ? shippedPlan(facts) : unshippedPlan(outcome, facts);
}
