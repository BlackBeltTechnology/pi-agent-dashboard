/**
 * Derived review state for ship-it step 4.5 (design D3, D4).
 *
 * State is DERIVED from the run's recorded files, never asserted by the
 * orchestrator — so a miscount or a context compaction cannot silently renew
 * the review budget. Layout of one run directory
 * (`$(git rev-parse --git-dir)/ship-it/<change>/<run-id>/`):
 *
 *   review-r<N>.md             well-formed reply of round N (one per round)
 *   review-r<N>.attempt-<k>.md malformed attempt k of round N (never a round)
 *   fix-ledger-r<N>.json       ledger answering review-r<N>.md
 *   ledger-failures.log        one line `r<pending round> …` per failed validation
 *   approvals.log              one line per human "one more round" answer
 *
 * Reviewer text is never read for approvals: only `approvals.log` counts.
 *
 * See change: harden-review-and-fix-loop.
 */
import fs from "node:fs";
import path from "node:path";

export interface DerivedReviewState {
  /** Completed (well-formed) rounds. */
  round: number;
  approvedExtraRounds: number;
  /** Malformed attempts for the pending round (`round + 1`). */
  malformedRetries: number;
  /** Recorded ledger-validation failures for the pending round. */
  ledgerFailures: number;
}

export const LEDGER_FAILURES_FILE = "ledger-failures.log";
export const APPROVALS_FILE = "approvals.log";

/** Run directory — inside the per-worktree git dir, so never committed. */
export function runDirPath(gitDir: string, change: string, runId: string): string {
  return path.join(gitDir, "ship-it", change, runId);
}

/** Invocation start timestamp, filesystem-safe (e.g. `2026-10-01T10-00-00Z`). */
export function newRunId(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

/**
 * Allocate this invocation's run directory ATOMICALLY: the leaf `mkdir` is
 * non-recursive, so an existing directory (another invocation started in the
 * same second) fails with EEXIST and we take the next `-<k>` suffix instead of
 * sharing its round files and approvals.
 */
export function createRunDir(gitDir: string, change: string, now: Date = new Date()): string {
  const base = runDirPath(gitDir, change, newRunId(now));
  fs.mkdirSync(path.dirname(base), { recursive: true });
  for (let k = 1; ; k++) {
    const dir = k === 1 ? base : `${base}-${k}`;
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

const nonEmptyLines = (file: string) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "")
    : [];

export function deriveReviewState(runDir: string): DerivedReviewState {
  let names: string[] = [];
  try {
    names = fs.readdirSync(runDir);
  } catch {
    return { round: 0, approvedExtraRounds: 0, malformedRetries: 0, ledgerFailures: 0 };
  }

  const rounds = new Set(
    names.flatMap((n) => {
      const m = /^review-r(\d+)\.md$/.exec(n);
      return m ? [Number(m[1])] : [];
    }),
  );
  // Contiguous from 1: a gap means a round was never recorded, so it did not happen.
  let round = 0;
  while (rounds.has(round + 1)) round++;

  const pending = round + 1;
  const attemptRe = new RegExp(`^review-r${pending}\\.attempt-\\d+\\.md$`);
  const malformedRetries = names.filter((n) => attemptRe.test(n)).length;
  const ledgerFailures = nonEmptyLines(path.join(runDir, LEDGER_FAILURES_FILE)).filter((l) =>
    l.startsWith(`r${pending} `),
  ).length;
  const approvedExtraRounds = nonEmptyLines(path.join(runDir, APPROVALS_FILE)).length;

  return { round, approvedExtraRounds, malformedRetries, ledgerFailures };
}
