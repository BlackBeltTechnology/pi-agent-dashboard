/**
 * No-weakening diff-assert (D8): given a unified diff of a test file, reject any
 * change that reaches green by degrading the test — an added `.only`/`skip`, a
 * deleted assertion, or a strong matcher weakened to a permissive one. A genuine
 * fix (changing an expected value, adding an assertion, editing non-test lines)
 * is allowed.
 *
 * Pure + side-effect free. See OpenSpec change: add-openspec-pipeline-orchestrators.
 */

export interface WeakenResult {
  ok: boolean;
  reasons: string[];
}

const ONLY_RE = /\.only\b/;
const SKIP_RE = /(\.skip\b|\bxit\b|\bxdescribe\b|\bxtest\b)/;
// Assertions that pin an exact/observable outcome.
const STRONG_MATCHER_RE =
  /\.(toBe|toEqual|toStrictEqual|toMatch|toMatchObject|toThrow|toHaveLength|toContain|toHaveBeenCalledWith|toBeGreaterThan|toBeLessThan|toBeCloseTo)\b/;
// Matchers that assert almost nothing — a common way to "pass" a broken test.
const PERMISSIVE_MATCHER_RE =
  /(\.toBeDefined\b|\.toBeTruthy\b|\.toBeFalsy\b|\.toBeUndefined\b|\.toBeNull\b|\.not\.toThrow\b)/;

// Global regex kept local to countExpects (via matchAll) so no shared lastIndex
// state can leak into a future .test()/.exec() call.
const countExpects = (lines: string[]): number =>
  lines.reduce(
    (n, l) => n + [...l.matchAll(/\bexpect\s*\(/g)].length,
    0,
  );

/** Parse a unified diff into its added / removed body lines (payload only). */
function splitDiff(diff: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue; // file headers
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

export function assertNoWeakening(diff: string): WeakenResult {
  const reasons: string[] = [];
  if (!diff) return { ok: true, reasons };

  const { added, removed } = splitDiff(diff);
  const addedText = added.join("\n");

  if (ONLY_RE.test(addedText)) reasons.push("added `.only` — isolates the suite");
  if (SKIP_RE.test(addedText)) reasons.push("added a skip (`.skip`/`xit`/`xdescribe`)");

  const addedExpects = countExpects(added);
  const removedExpects = countExpects(removed);
  if (removedExpects > addedExpects) {
    reasons.push(
      `deleted assertion(s): ${removedExpects} expect() removed vs ${addedExpects} added`,
    );
  }

  // Weakening swap: a strong matcher removed and a permissive one added.
  const removedStrong = removed.some((l) => STRONG_MATCHER_RE.test(l));
  const addedPermissive = added.some((l) => PERMISSIVE_MATCHER_RE.test(l));
  if (removedStrong && addedPermissive) {
    reasons.push("weakened an assertion (strong matcher → permissive matcher)");
  }

  return { ok: reasons.length === 0, reasons };
}
