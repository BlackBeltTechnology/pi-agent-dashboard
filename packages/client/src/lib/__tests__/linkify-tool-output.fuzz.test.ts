import { describe, it, expect } from "vitest";
import { tokenize, type Token } from "../chat/linkify-tool-output.js";

/**
 * Adversarial-ish corpus of prose strings drawn from common bash/grep/tsc/lint
 * output AND English prose phrasing. None of these contain a real code
 * extension token in a path-shaped position; the tokenizer MUST emit zero
 * `file` tokens for every entry.
 *
 * See spec `tool-output-linkification` (negative cases) and design D2.
 */
const PROSE_CORPUS = [
  "version 1.0.0 installed",
  "updated to v1.2.3 today",
  "math.PI is approximately 3.14",
  "decide and/or skip the step",
  "his/her preferences saved",
  "see README for instructions",
  "config loaded from default profile",
  "warning: deprecated API usage",
  "ok 1 test passed in 12ms",
  "PASS 3 tests, 0 failures",
  "echo hello world from shell",
  "node v18.17.0 detected",
  "npm WARN deprecated foo@1.2.3",
  "compile target es2020 module commonjs",
  "0 errors, 0 warnings",
  "Cannot find module 'foo' or its corresponding type declarations",
  "TS2322: Type 'string' is not assignable to type 'number'.",
  "ESLint found 0 problems",
  "ENOENT: no such file or directory",
  "Permission denied",
  "Connection refused on port 8080",
  "Hello, world!",
  "the quick brown fox jumps over the lazy dog",
  "1 2 3 4 5 6 7 8 9 10",
  "lorem ipsum dolor sit amet consectetur adipiscing elit",
  "git status reports clean working tree",
  "branch is up to date with origin/main",
  "fatal: not a git repository",
  "Author: Jane Doe <jane@example.org>",
  "Date: Tue Jan 1 00:00:00 2026 +0000",
  "make: Nothing to be done for 'all'",
  "cc1: warning: ignoring option",
  "error: linker command failed with exit code 1",
  "Stopped at breakpoint 1",
  "Run 'foo --help' for usage",
  "press q to quit",
  "loaded 12 of 12 packages",
  "Cache hit: 42%, miss: 58%",
  "elapsed time 1m 23s",
  "deployed to staging environment",
  "feature flag enabled for cohort A",
  "ratio of true positives to false positives is 9:1",
  "score: 99/100",
  "expected vs actual diff is 0.0",
  "min 0.0 max 1.0 avg 0.5",
  "ratio 3:2 in favor of A",
  "checksum mismatch on entry 7",
  "retry attempt 3 of 5",
  "no input given, abort",
  "system shutdown initiated",
  "powered by foo and bar",
  "see also: appendix B",
  "TODO: revisit this later",
];

describe("tokenize — fuzz/corpus (zero false-positive file links)", () => {
  it(`covers >= 50 prose strings (corpus size = ${PROSE_CORPUS.length})`, () => {
    expect(PROSE_CORPUS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(PROSE_CORPUS.map((s, i) => [i, s] as const))(
    "[%i] %s — no file token, no spurious URL",
    (_i, prose) => {
      const toks = tokenize(prose);
      const files = toks.filter((t: Token) => t.kind === "file");
      expect(files).toEqual([]);
      // Coverage MUST also hold for every prose string.
      expect(toks.map((t) => t.text).join("")).toBe(prose);
    },
  );
});
