#!/usr/bin/env node
/**
 * Fixed-tick wait guard.
 *
 * Bans the "await a bare-resolve `setTimeout` as an async barrier, then assert
 * one-shot" pattern in client tests. That barrier guesses a tick count; under
 * parallel-fork contention the guess loses, and the one-shot assertion fails
 * with `expected … got 0` — the rotating red set that made local runs
 * untrustworthy while CI stayed green. The shipped `parallel-test-execution`
 * requirement says async assertions poll (`waitFor`) instead.
 *
 *   violation · `await new Promise((<id>) => setTimeout(<id>, …))` in a
 *               client test file                                    · barrier
 *
 * A deliberate timer use that gates no assertion (a mock-internal macrotask
 * yield, or a test exercising timer behaviour itself) opts out PER OCCURRENCE:
 * an inline comment naming the reason on the line directly above the awaited
 * timer:
 *
 *   // fixed-tick-waits: opt-out — <reason>
 *
 * A per-file waiver would silently excuse any barrier added to that file
 * later; the opt-out therefore never spans more than the annotated occurrence.
 * False positives are the known cost of a textual guard — the opt-out is the
 * release valve without the blast radius.
 *
 * Scope: every `*.test.ts` / `*.test.tsx` under `packages/client/src`
 * (client-scoped by design; server/plugin tests are a stated non-goal).
 * Pass a root as the first argument to scan a different tree.
 *
 * Exit code: non-zero iff at least one violation.
 *
 * See change: make-test-suite-deterministic.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Default scan target: the client test suite. */
export const CLIENT_SRC = join(REPO_ROOT, "packages", "client", "src");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out"]);

/**
 * The barrier: an awaited promise whose executor is (or leads within a few
 * chars to) a bare setTimeout call. Deliberately tolerant of the forms a
 * reviewer would actually write or a formatter would produce: arrow and
 * function executors, one- and two-parameter executors, and line-wrapped
 * `await new Promise((r) =>\n  setTimeout(...))`.
 */
const BARRIER_PATTERN =
  /await\s+new\s+Promise\s*\(\s*(?:function\s*)?\(?\s*\w+\s*(?:,\s*\w+\s*)?\)?\s*(?:=>\s*\{?)?[\s\S]{0,60}?setTimeout\s*\(/g;
/**
 * A Promise-setTimeout helper DEFINED in a test file (`const sleep = (ms) =>
 * new Promise((r) => setTimeout(r, ms))`) — it moves setTimeout off the await
 * line and would hollow the rule if only awaited barriers were flagged.
 * Single-line form; the definition is the violation, not its call sites.
 */
const HELPER_PATTERN =
  /(?:const|let|var)\s+\w+\s*=[^;\n]*new\s+Promise\s*\([^;\n]{0,40}setTimeout/g;
/** Line-scoped opt-out marker — must sit on the line directly above. */
const OPT_OUT_PATTERN = /fixed-tick-waits:\s*opt-out/;
const TEST_FILE_PATTERN = /\.test\.(ts|tsx)$/;

/** Recursively list test files under `root`, pruning heavy dirs. */
function listTestFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Analyse every client test file under `root` for fixed-tick barriers.
 * Returns `{ files, violations }` — `files` is how many test files were
 * scanned, `violations` names each un-annotated barrier by file and line.
 */
export function analyzeFixedTickWaits(root = CLIENT_SRC) {
  const violations = [];
  const files = listTestFiles(root);
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    const text = lines.join("\n");
    // Offset → 1-based line, without re-scanning per match.
    const lineAt = (offset) => text.slice(0, offset).split("\n").length;
    const flagged = new Map(); // line → text (first hit wins)
    for (const pattern of [BARRIER_PATTERN, HELPER_PATTERN]) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) {
        const line = lineAt(m.index);
        if (!flagged.has(line)) flagged.set(line, lines[line - 1].trim());
      }
    }
    for (const [line, lineText] of flagged) {
      // The opt-out applies to this occurrence only: the line directly above
      // must carry the marker.
      const prev = lines[line - 2] ?? "";
      if (OPT_OUT_PATTERN.test(prev)) continue;
      violations.push({ file: relative(root, file).split(sep).join("/"), line, text: lineText });
    }
  }
  violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { files: files.length, violations };
}

function formatViolation(root, v) {
  return `fixed-tick-wait [barrier] ${join(root, v.file)}:${v.line}: ${v.text}`;
}

function main() {
  const root = resolve(process.argv[2] ?? CLIENT_SRC);
  const { files, violations } = analyzeFixedTickWaits(root);
  // Violations go to stderr with the file named, so the CI step's log points
  // straight at the offending test.
  for (const v of violations) console.error(formatViolation(root, v));
  const stream = violations.length > 0 ? console.error : console.log;
  stream(
    `\n${files} test file(s) checked · ${violations.length} fixed-tick barrier violation(s)`,
  );
  process.exit(violations.length > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
