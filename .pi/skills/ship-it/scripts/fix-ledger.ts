/**
 * Fix ledger for ship-it step 4.5 (design D3).
 *
 * Every `issue(blocking)` finding of review round N gets one entry in
 * `fix-ledger-r<N>.json` before round N+1 may be requested. The entry is
 * EVIDENCE, never a verdict: there is deliberately no status field, and free
 * text that asserts a status ("is fixed", "no further", "should pass") is
 * rejected — the verification round, not the author, judges resolution.
 *
 * Validation checks presence and shape only. Whether the test really exercises
 * the finding, or the sibling sites were really checked, is the verification
 * round's job (D2).
 *
 * Pure + side-effect free. See change: harden-review-and-fix-loop.
 */

export interface FixLedgerEntry {
  /** The finding id from the reviewer's reply, e.g. "B3". */
  id: string;
  /** A regression test in the change's diff, or why no automated test can observe it. */
  test: { path: string } | { untestable: string };
  /** The pattern/command searched for other instances; `sites` may be empty. */
  siblings: { searched: string; sites: string[] };
  /** Commit sha (7–40 lowercase hex) or "worktree" (uncommitted). */
  fixedIn: string;
}

export interface LedgerProblem {
  id: string;
  problems: string[];
}

export interface LedgerValidation {
  ok: boolean;
  /** Blocking ids with no entry at all. */
  missing: string[];
  /** Entries present but failing a presence/shape rule. */
  incomplete: LedgerProblem[];
}

export const MIN_UNTESTABLE_REASON = 20;

const FIXED_IN_RE = /^(?:[0-9a-f]{7,40}|worktree)$/;

/**
 * Status assertions, not words (test-plan C1). "passes the lock check" or
 * `rg -w fixedIn` stay legal; "is fixed", "already resolved", "no further",
 * "should pass" do not.
 */
export const VERDICT_LANGUAGE: readonly RegExp[] = [
  /\b(is|are|was|were|been|now|already)\s+(fixed|resolved|verified|addressed|done)\b/i,
  /\bno further\b/i,
  /\b(should|will|now)\s+pass\b/i,
];

const isVerdict = (s: string) => VERDICT_LANGUAGE.some((re) => re.test(s));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** `test` is `{ path }` in the diff, or `{ untestable }` with a long-enough reason. */
function checkTest(test: unknown, inDiff: (path: string) => boolean, problems: string[], freeText: string[]): void {
  if (isObj(test) && typeof test.path === "string" && test.path.trim() !== "") {
    if (!inDiff(test.path)) problems.push(`test.path ${test.path} is not in the change's diff`);
    return;
  }
  if (isObj(test) && typeof test.untestable === "string") {
    if (test.untestable.trim().length < MIN_UNTESTABLE_REASON) {
      problems.push(`test.untestable reason shorter than ${MIN_UNTESTABLE_REASON} characters`);
    }
    freeText.push(test.untestable);
    return;
  }
  problems.push("test must be { path } or { untestable }");
}

/** The sibling search must be recorded; `sites` may be empty. */
function checkSiblings(siblings: unknown, problems: string[], freeText: string[]): void {
  const obj = isObj(siblings) ? siblings : {};
  if (typeof obj.searched === "string" && obj.searched.trim() !== "") freeText.push(obj.searched);
  else problems.push("siblings.searched is empty — record the pattern/command used");

  const sites = obj.sites;
  if (Array.isArray(sites) && sites.every((s) => typeof s === "string")) freeText.push(...sites);
  else problems.push("siblings.sites must be a string array (may be empty)");
}

function checkEntry(entry: Record<string, unknown>, inDiff: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const freeText: string[] = [];
  checkTest(entry.test, inDiff, problems, freeText);
  checkSiblings(entry.siblings, problems, freeText);

  if (typeof entry.fixedIn !== "string" || !FIXED_IN_RE.test(entry.fixedIn)) {
    problems.push('fixedIn must be a 7–40 char lowercase hex sha or "worktree"');
  }

  if (freeText.some(isVerdict)) {
    problems.push("free text asserts a status (verdict language) — the ledger is evidence, not a verdict");
  }
  return problems;
}

/**
 * @param blockingIds the round's `issue(blocking)` ids (from `parseReviewReply`)
 * @param ledger      parsed `fix-ledger-r<N>.json` — typed loosely, it is read from disk
 * @param inDiff      whether a path is part of the change's diff
 */
export function validateFixLedger(
  blockingIds: readonly string[],
  ledger: unknown,
  inDiff: (path: string) => boolean,
): LedgerValidation {
  const entries = Array.isArray(ledger) ? ledger.filter(isObj) : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    if (typeof e.id === "string" && !byId.has(e.id)) byId.set(e.id, e);
  }

  const missing: string[] = [];
  const incomplete: LedgerProblem[] = [];
  for (const id of blockingIds) {
    const entry = byId.get(id);
    if (!entry) {
      missing.push(id);
      continue;
    }
    const problems = checkEntry(entry, inDiff);
    if (problems.length) incomplete.push({ id, problems });
  }
  return { ok: missing.length === 0 && incomplete.length === 0, missing, incomplete };
}
