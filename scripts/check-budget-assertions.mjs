#!/usr/bin/env node
/**
 * Budget assertion guard (warn-only).
 *
 * A budget assertion is an assertion whose failure means "too slow" or "too
 * much memory": it bounds from above a value derived from a real-clock reading
 * (`performance.now()`, `Date.now()`, `new Date()` in arithmetic or through
 * `.getTime()`/`.valueOf()`, `process.hrtime()`, `process.uptime()`), a
 * process-memory reading (`process.memoryUsage()`, `getHeapStatistics()`,
 * `process.resourceUsage()`) or a named measurement helper (`rssBytes`,
 * `startLagMonitor`). Such a test fails with host load, so it must not run in
 * a blocking lane. Budget tests belong in `*.budget.test.*` files (their
 * structural rules are enforced by the blocking budget lane check, not here).
 *
 * This guard LISTS the budget assertions still sitting in blocking test files.
 * It is warn-only: in this change it fails nothing. `migrate-budget-assertions`
 * owns the hand pass, switches the `ci.yml` step to the no-flag mode and adds
 * the guard to ship-it.
 *
 * Modes and exit codes
 *   --warn   one `::warning file=<path>,line=<n>::budget assertion in a
 *            blocking lane: <form>` line per finding; with `GITHUB_STEP_SUMMARY`
 *            set, appends `### Budget assertions in blocking lanes: <count>`
 *            and a table. Exit 0 always; an internal error is printed as
 *            `::warning::budget guard error: <message>` and also exits 0.
 *   --list   every hit, allow-listed ones with the entry that applied. Exit 0.
 *   (none)   exit 1 on any finding or internal error (wired nowhere today).
 *   --root <dir>   scan a fixture tree instead of the repo root. The liveness
 *                  allow-list holds repo-relative entries, so it applies only
 *                  to the repo root; a fixture tree starts with an empty list.
 *   <prefix>...    path prefixes narrowing the scan (e.g. `packages/server/`).
 * Scope: git-tracked `*.test.{ts,tsx,mts,mjs,js}` minus `tests/e2e/`, `qa/`,
 * `**\/fixtures/**` and `*.budget.test.*` (a non-git root is walked instead).
 *
 * Analysis (textual, per file; scope of a taint is the test case)
 *   1. Source readings (above), except a clock faked for the case: the case, a
 *      `beforeEach` of an enclosing `describe`, or a module-level `beforeEach`
 *      / top-level statement calls `vi.useFakeTimers()` (no argument = fakes
 *      `Date`, `performance`, `hrtime`), `vi.useFakeTimers({toFake:[…]})`
 *      naming the clock, or `vi.setSystemTime(` (`Date` only).
 *   2. Taint to a fixed point: identifiers assigned from a reading or a tainted
 *      identifier (spreads read as plain identifiers), collections receiving
 *      one through `.push(`/`.set(` (arguments read up to three lines on), and
 *      same-file functions whose body holds one.
 *   3. Assertion statements read by parenthesis balance, across lines.
 *   4. Upper bounds only (`toBeLessThan[OrEqual]`, `toBeGreaterThan[OrEqual]`
 *      with the measurement as argument, `assert`/`.toBe(true)` over `<`/`<=`).
 *      Flagged when the measured side holds a reading and the bound side holds
 *      none, or holds one together with arithmetic (a relative budget). A bare
 *      reading on the bound side is an ordering check and is left alone.
 *   5. `LIVENESS_ALLOW` entries drop one flagged statement each; an entry with
 *      an empty reason, no match or more than one match is itself a finding.
 *
 * What the guard cannot detect (a hand pass covers these):
 *   - a measurement taken in another module (helper, fixture, setup file)
 *     unless it is on the named-helper list; a same-file function IS seen;
 *   - a measurement taken in a spawned child and returned as data;
 *   - a comparison done in a predicate, then asserted as a boolean
 *     (`expect(withinBudget(elapsed, n)).toBe(true)`);
 *   - scope errors of the indentation heuristic (unformatted file, a case
 *     body sharing an identifier name with an outer declaration);
 *   - a time budget without a clock read (`Promise.race` against `setTimeout`,
 *     `AbortSignal.timeout`, per-test timeouts used as a budget);
 *   - aliased or indirect readings (`performance.now.bind`, `globalThis["x"]`,
 *     `eval`, a reading inside a template string);
 *   - hand-thrown failures (`if (ms > X) throw …`), custom matchers, snapshot
 *     comparisons of timings, negated matchers (`.not.toBeLessThan`);
 *   - child-process memory or time read through `ps`, `/proc` or `time`
 *     without a listed helper;
 *   - a fake clock installed by a setup file, a `beforeAll`, or a project-level
 *     `fakeTimers.toFake` config; a fake inside a same-file helper function is
 *     read as a top-level statement (it exempts the whole file);
 *   - intent: whether an allow-listed deadline is really a liveness deadline
 *     (and whether its file is a real-process file, trade-off T-A12) is a
 *     review question; no `// budget-exempt` marker exists;
 *   - tests outside vitest: Playwright (`tests/e2e/`), `music-pytest`,
 *     `scripts/*.sh`.
 *
 * See change: stabilize-blocking-test-lanes (design D4, D5).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Liveness deadlines of real processes (A6): blocking by design, so they are
 * not findings. `assertion` is the normalized first line of the flagged
 * statement (trim, drop a trailing `// …` comment, drop a trailing `;`).
 * An entry needs a written reason and must match exactly one flagged statement.
 */
export const LIVENESS_ALLOW = [
  {
    file: "packages/server/src/__tests__/cli-stop-real.test.ts",
    assertion: "expect(Date.now() - t0).toBeLessThan(150_000)",
    reason:
      "time from boot to the stop command's full reap of the owned server (it stops answering and the meta pid is gone); the bound equals the case's own timeout 150_000",
  },
  {
    file: "packages/server/src/__tests__/cli-foreground-real.test.ts",
    assertion: "expect(Date.now() - t0).toBeLessThan(10_000 + 20_000)",
    reason:
      "a second foreground wrapper exits after classifying the live owned server; 10 s classify budget plus 20 s boot slack, under the spawnSync timeout 60_000",
  },
  {
    file: "packages/server/src/__tests__/shutdown-terminates-any-strategy.test.ts",
    assertion: `expect(elapsed, "shutdown took longer than the ladder's own bound").toBeLessThan(8000)`,
    reason: "the shutdown escalation ladder's own bound: 1.5 s grace plus 2 s SIGTERM window",
  },
  {
    file: "packages/server/src/rpc-keeper/__tests__/keeper.test.ts",
    assertion: "expect(maxLatencyMs).toBeLessThan(1050)",
    reason: "the production WRITE_RPC_ATTEMPT_TIMEOUT_MS 350 × 3 budget",
  },
];

// ---------------------------------------------------------------------------
// Source readings (D4 a/b/c)
// ---------------------------------------------------------------------------

/** `clock` is the fake-timers key that fakes this reading (null = never faked). */
const READINGS = [
  {
    kind: "performance.now()",
    clock: "performance",
    re: /(?<![\w$])(?:(?:window|globalThis|self)\.)?performance\.now\s*\(/,
  },
  {
    kind: "Date.now()",
    clock: "Date",
    re: /(?<![\w$])(?:(?:window|globalThis|self)\.)?Date\.now\s*\(/,
  },
  {
    kind: "new Date()",
    clock: "Date",
    re: /new\s+Date\s*\(\s*\)\s*\.\s*(?:getTime|valueOf)\s*\(|[-+*/]\s*new\s+Date\s*\(\s*\)|new\s+Date\s*\(\s*\)\s*(?:[-*/]|\+(?!\+))/,
  },
  { kind: "process.hrtime()", clock: "hrtime", re: /(?<![\w$.])process\.hrtime(?:\.bigint)?\s*\(/ },
  { kind: "process.uptime()", clock: null, re: /(?<![\w$.])process\.uptime\s*\(/ },
  { kind: "process.memoryUsage()", clock: null, re: /(?<![\w$.])process\.memoryUsage(?:\.rss)?\s*\(/ },
  { kind: "getHeapStatistics()", clock: null, re: /(?<![\w$])(?:v8\.)?getHeapStatistics\s*\(/ },
  { kind: "process.resourceUsage()", clock: null, re: /(?<![\w$.])process\.resourceUsage\s*\(/ },
  { kind: "rssBytes()", clock: null, re: /(?<![\w$])(?<!function\s+)rssBytes\s*\(/ },
  { kind: "startLagMonitor()", clock: null, re: /(?<![\w$])(?<!function\s+)startLagMonitor\s*\(/ },
];

/** Cheap prefilter: a file without any of these tokens cannot hold a reading. */
const READING_PREFILTER =
  /performance|Date|hrtime|uptime|memoryUsage|getHeapStatistics|resourceUsage|rssBytes|startLagMonitor/;

const ALL_CLOCKS = ["Date", "performance", "hrtime"];

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Blank comments, string/template contents and regex literals with spaces,
 * keeping every offset and newline, so structure scans are not fooled by
 * parentheses inside strings.
 */
function maskSource(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let lastSig = "";
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      lastSig = c;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const e = src[j];
        if (e === "\\") {
          j += 2;
          continue;
        }
        if (depth === 0 && e === "`") break;
        if (e === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && e === "{") depth++;
        else if (depth > 0 && e === "}") depth--;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
      lastSig = "`";
      continue;
    }
    if (c === "/" && (lastSig === "" || "(,=:[!&|?{};".includes(lastSig))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && src[j] !== "\n") {
        const e = src[j];
        if (e === "\\") {
          j += 2;
          continue;
        }
        if (e === "[") inClass = true;
        else if (e === "]") inClass = false;
        else if (e === "/" && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        blank(i + 1, j);
        i = j + 1;
        lastSig = ")";
        continue;
      }
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join("");
}

const OPENERS = "([{";
const CLOSERS = ")]}";

/** Index of the bracket closing the one at `open`, or -1. */
function matchClose(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `s` at top-level occurrences of the single char `sep`. */
function splitTop(s, sep = ",") {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) depth--;
    else if (depth === 0 && c === sep) {
      parts.push(s.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(s.slice(from));
  return parts;
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOfOffset(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Normalize an assertion's first line for allow-list comparison (D5). */
export function normalizeAssertionLine(line) {
  let end = line.length;
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "/" && line[i + 1] === "/") {
      end = i;
      break;
    }
  }
  let s = line.slice(0, end).trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trimEnd();
  return s;
}

// ---------------------------------------------------------------------------
// Structure: describe / it / hook calls
// ---------------------------------------------------------------------------

const CALL_RE =
  /(?<![\w$.])(describe|suite|it|test|beforeEach|beforeAll|afterEach|afterAll)((?:\.\w+)*)\s*\(/g;
const CURRIED = /\.(?:each|for|skipIf|runIf)\b/;

function findCalls(masked, orig) {
  const calls = [];
  for (const m of masked.matchAll(CALL_RE)) {
    const open = m.index + m[0].length - 1;
    let close = matchClose(masked, open);
    if (close < 0) continue;
    let titleOpen = open;
    if (CURRIED.test(m[2])) {
      let k = close + 1;
      while (k < masked.length && /\s/.test(masked[k])) k++;
      if (masked[k] === "(") {
        const c2 = matchClose(masked, k);
        if (c2 > 0) {
          titleOpen = k;
          close = c2;
        }
      }
    }
    const name = m[1];
    const kind =
      name === "describe" || name === "suite"
        ? "describe"
        : name === "it" || name === "test"
          ? "case"
          : name === "beforeEach"
            ? "beforeEach"
            : "hook";
    const t = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/s.exec(orig.slice(titleOpen + 1, titleOpen + 400));
    calls.push({ kind, start: m.index, end: close + 1, title: t ? t[2] : "" });
  }
  return calls;
}

function innermost(calls, offset, filter = () => true) {
  let best = null;
  for (const c of calls) {
    if (c.start <= offset && offset < c.end && filter(c) && (!best || c.end - c.start < best.end - best.start)) {
      best = c;
    }
  }
  return best;
}

/** Every `vi.useFakeTimers` / `vi.setSystemTime` with the clocks it fakes and its scope range. */
function findFakes(masked, orig, calls) {
  const fakes = [];
  for (const m of masked.matchAll(/(?<![\w$.])vi\.(useFakeTimers|setSystemTime)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open);
    const args = close < 0 ? "" : orig.slice(open + 1, close);
    let clocks;
    if (m[1] === "setSystemTime") clocks = new Set(["Date"]);
    else if (!/toFake/.test(args)) clocks = new Set(ALL_CLOCKS);
    else clocks = new Set([...args.matchAll(/["'](Date|performance|hrtime)["']/g)].map((x) => x[1]));
    if (clocks.size === 0) continue;
    const owner = innermost(calls, m.index);
    let range;
    if (!owner) range = [0, masked.length];
    else if (owner.kind === "case" || owner.kind === "describe") range = [owner.start, owner.end];
    else if (owner.kind === "beforeEach") {
      const d = innermost(calls, owner.start, (c) => c.kind === "describe" && c !== owner && c.start < owner.start);
      range = d ? [d.start, d.end] : [0, masked.length];
    } else continue; // beforeAll / afterEach / afterAll: not honoured (D4)
    fakes.push({ range, clocks });
  }
  return fakes;
}

// ---------------------------------------------------------------------------
// Statements (for taint): declarations, assignments, push/set, functions
// ---------------------------------------------------------------------------

const CONT_PREV = /[=,(+\-*/&|?:<>.[{!%^~]/;
const CONT_NEXT = /[.?:+\-*/&|,=<>%^]/;

function lastSigChar(s, i) {
  for (let k = i - 1; k >= 0; k--) if (!/\s/.test(s[k])) return s[k];
  return "";
}
function nextSigChar(s, i) {
  for (let k = i; k < s.length; k++) if (!/\s/.test(s[k])) return s[k];
  return "";
}

/** End offset of the expression starting at `from` (statement end, by balance). */
function exprEnd(s, from) {
  let d = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (OPENERS.includes(c)) d++;
    else if (CLOSERS.includes(c)) {
      if (d === 0) return i;
      d--;
    } else if (d === 0) {
      if (c === ";") return i;
      if (c === "\n") {
        const prev = lastSigChar(s, i);
        const next = nextSigChar(s, i + 1);
        const arrowOrOp = prev !== "" && CONT_PREV.test(prev);
        const contNext = next !== "" && CONT_NEXT.test(next);
        if (!arrowOrOp && !contNext) return i;
      }
    }
  }
  return s.length;
}

const IDENT_RE = /[A-Za-z_$][\w$]*/g;

function identsOf(text) {
  return [...text.matchAll(IDENT_RE)].map((m) => m[0]).filter((x) => !/^(?:const|let|var|as|of|in)$/.test(x));
}

function collectStatements(masked, starts) {
  const stmts = [];
  const indentAt = (offset) => {
    const ls = starts[lineOfOffset(starts, offset) - 1];
    let k = ls;
    while (k < masked.length && (masked[k] === " " || masked[k] === "\t")) k++;
    return k - ls;
  };
  const declEquals = new Set();

  // Declarations: const|let|var <target> [: type] [= expr]
  for (const m of masked.matchAll(/(?<![\w$.])(?:const|let|var)\s+/g)) {
    let i = m.index + m[0].length;
    const targetStart = i;
    if (masked[i] === "{" || masked[i] === "[") {
      const c = matchClose(masked, i);
      if (c < 0) continue;
      i = c + 1;
    } else {
      const id = /^[A-Za-z_$][\w$]*/.exec(masked.slice(i, i + 200));
      if (!id) continue;
      i += id[0].length;
    }
    const targetText = masked.slice(targetStart, i);
    let eq = -1;
    let d = 0;
    let j = i;
    for (; j < masked.length; j++) {
      const c = masked[j];
      if (OPENERS.includes(c)) d++;
      else if (CLOSERS.includes(c)) {
        if (d === 0) break;
        d--;
      } else if (d === 0 && c === ";") break;
      else if (d === 0 && c === "\n") break;
      else if (d === 0 && c === "=" && masked[j + 1] !== ">" && masked[j + 1] !== "=" && !"<>!=".includes(masked[j - 1])) {
        eq = j;
        break;
      }
    }
    const indent = indentAt(m.index);
    if (eq < 0) {
      // `let a, b;` — names only, so later assignments can resolve their scope.
      const tail = masked.slice(targetStart, j);
      stmts.push({ names: identsOf(tail), expr: "", start: m.index, indent, decl: true, kind: "decl" });
      continue;
    }
    declEquals.add(eq);
    const end = exprEnd(masked, eq + 1);
    stmts.push({
      names: identsOf(targetText),
      expr: masked.slice(eq + 1, end),
      start: m.index,
      indent,
      decl: true,
      kind: "decl",
    });
  }

  // Plain assignments: x = e, x += e
  for (const m of masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:\*\*|\?\?|\|\||&&|[-+*/%])?=(?![=>])/g)) {
    const eq = m.index + m[0].length - 1;
    if (declEquals.has(eq)) continue;
    if (/^(?:if|while|for|return|const|let|var)$/.test(m[1])) continue;
    const end = exprEnd(masked, eq + 1);
    stmts.push({
      names: [m[1]],
      expr: masked.slice(eq + 1, end),
      start: m.index,
      indent: indentAt(m.index),
      decl: false,
      kind: "assign",
    });
  }

  // Collections: recv.push(args) / recv.set(args)
  for (const m of masked.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(?:push|set)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    let close = matchClose(masked, open);
    if (close < 0) close = masked.length;
    // arguments are read up to three lines on
    let limit = open;
    for (let n = 0; n < 4; n++) {
      const nl = masked.indexOf("\n", limit + (n === 0 ? 0 : 1));
      if (nl < 0) {
        limit = masked.length;
        break;
      }
      limit = nl;
    }
    const segs = m[1].split(".");
    stmts.push({
      names: [...new Set([segs[0], segs[segs.length - 1]])],
      expr: masked.slice(open + 1, Math.min(close, limit)),
      start: m.index,
      indent: indentAt(m.index),
      decl: false,
      kind: "collection",
    });
  }

  // Same-file function declarations
  for (const m of masked.matchAll(
    /(?<![\w$.])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(/g,
  )) {
    const open = m.index + m[0].length - 1;
    const pc = matchClose(masked, open);
    if (pc < 0) continue;
    const brace = masked.indexOf("{", pc);
    if (brace < 0) continue;
    const bc = matchClose(masked, brace);
    if (bc < 0) continue;
    stmts.push({
      names: [m[1]],
      expr: masked.slice(m.index, bc + 1),
      start: m.index,
      indent: indentAt(m.index),
      decl: true,
      kind: "function",
    });
  }
  return stmts;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function parseAssertions(masked) {
  const out = [];
  for (const m of masked.matchAll(/(?<![\w$.])(expect(?:\.soft)?|assert(?:\.ok)?)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(masked, open);
    if (close < 0) continue;
    const isExpect = m[1].startsWith("expect");
    const a = { start: m.index, kind: isExpect ? "expect" : "assert", args: masked.slice(open + 1, close), calls: [], negated: false, end: close + 1 };
    if (isExpect) {
      let pos = close + 1;
      for (;;) {
        let p = pos;
        while (p < masked.length && /\s/.test(masked[p])) p++;
        if (masked[p] !== ".") break;
        p++;
        while (p < masked.length && /\s/.test(masked[p])) p++;
        const id = /^[A-Za-z_$][\w$]*/.exec(masked.slice(p, p + 80));
        if (!id) break;
        p += id[0].length;
        let q = p;
        while (q < masked.length && /\s/.test(masked[q])) q++;
        if (masked[q] === "(") {
          const c2 = matchClose(masked, q);
          if (c2 < 0) break;
          a.calls.push({ name: id[0], args: masked.slice(q + 1, c2) });
          pos = c2 + 1;
        } else {
          if (id[0] === "not") a.negated = !a.negated;
          pos = p;
        }
      }
      a.end = pos;
    }
    out.push(a);
  }
  return out;
}

/** `M < X` style comparisons inside a boolean expression → upper-bound candidates. */
function fromBoolean(expr, form) {
  let e = expr.trim();
  while (e.startsWith("(") && matchClose(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  // split on top-level && / ||
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) depth--;
    else if (depth === 0 && ((c === "&" && e[i + 1] === "&") || (c === "|" && e[i + 1] === "|"))) {
      parts.push(e.slice(from, i));
      from = i + 2;
      i++;
    }
  }
  parts.push(e.slice(from));
  const cands = [];
  for (const part of parts) {
    let d = 0;
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (OPENERS.includes(c)) d++;
      else if (CLOSERS.includes(c)) d--;
      else if (d === 0 && (c === "<" || c === ">")) {
        if (part[i + 1] === c || part[i - 1] === c || part[i - 1] === "=" || part[i - 1] === "-") continue;
        const orEq = part[i + 1] === "=";
        const lhs = part.slice(0, i);
        const rhs = part.slice(i + (orEq ? 2 : 1));
        cands.push(c === "<" ? { measured: lhs, bound: rhs, form } : { measured: rhs, bound: lhs, form });
        break;
      }
    }
  }
  return cands;
}

/** Upper-bound candidates of an assertion (D4 "bounds from above"), possibly none. */
function upperBounds(a) {
  if (a.kind === "assert") return fromBoolean(splitTop(a.args)[0] ?? "", "assert");
  const m = a.calls[a.calls.length - 1];
  if (!m || a.negated) return [];
  const expArg = splitTop(a.args)[0] ?? "";
  const mArg = splitTop(m.args)[0] ?? "";
  switch (m.name) {
    case "toBeLessThan":
    case "toBeLessThanOrEqual":
      return [{ measured: expArg, bound: mArg, form: m.name }];
    case "toBeGreaterThan":
    case "toBeGreaterThanOrEqual":
      return [{ measured: mArg, bound: expArg, form: m.name }];
    case "toBe":
      return mArg.trim() === "true" ? fromBoolean(expArg, "toBe(true)") : [];
    case "toBeTruthy":
      return fromBoolean(expArg, "toBeTruthy");
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

const TEST_FILE_RE = /\.test\.(?:ts|tsx|mts|mjs|js)$/;
const isBudgetFile = (path) => /\.budget\.test\.[^/]+$/.test(path);

function holdsKinds(text, readings, tainted) {
  const kinds = new Set();
  for (const r of readings) if (r.re.test(text)) kinds.add(r.kind);
  if (tainted.size > 0) {
    for (const m of text.matchAll(IDENT_RE)) {
      const t = tainted.get(m[0]);
      if (!t) continue;
      if (text[m.index - 1] === "." && text.slice(m.index - 3, m.index) !== "...") continue;
      for (const k of t) kinds.add(k);
    }
  }
  return kinds;
}

function detectHits(path, text) {
  if (!READING_PREFILTER.test(text) || !/\b(?:expect|assert)\b/.test(text)) return [];
  const masked = maskSource(text);
  const starts = lineIndex(text);
  const calls = findCalls(masked, text);
  const fakes = findFakes(masked, text, calls);
  const stmts = collectStatements(masked, starts);
  const hits = [];

  for (const a of parseAssertions(masked)) {
    const cands = upperBounds(a);
    if (cands.length === 0) continue;

    const kase = innermost(calls, a.start, (c) => c.kind === "case");
    const faked = new Set();
    for (const f of fakes) {
      if (f.range[0] <= a.start && a.start < f.range[1]) for (const c of f.clocks) faked.add(c);
    }
    const readings = READINGS.filter((r) => r.clock === null || !faked.has(r.clock));

    // statements in scope: the case up to the assertion + shallower declarations
    // and assignments to names declared there.
    const caseIndent = kase ? (() => {
      const ls = starts[lineOfOffset(starts, kase.start) - 1];
      let k = ls;
      while (k < masked.length && (masked[k] === " " || masked[k] === "\t")) k++;
      return k - ls;
    })() : Infinity;
    const inCase = (s) => (kase ? s.start >= kase.start && s.start < a.start : s.start < a.start);
    const outside = (s) => (kase ? s.start < kase.start || s.start >= kase.end : false);
    // a declaration shallower than (or level with) the case, in a block that encloses it
    const encloses = (s) => {
      const owner = innermost(calls, s.start);
      return !owner || (kase !== null && owner.kind === "describe" && owner.start <= kase.start && kase.end <= owner.end);
    };
    const isOuterDecl = (s) => s.decl && outside(s) && s.indent <= caseIndent && encloses(s);
    const outerDecl = new Set();
    for (const s of stmts) if (isOuterDecl(s)) for (const n of s.names) outerDecl.add(n);
    const scope = stmts.filter(
      (s) => inCase(s) || isOuterDecl(s) || (outside(s) && !s.decl && outerDecl.has(s.names[0])),
    );

    const tainted = new Map();
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (const s of scope) {
        if (!s.expr) continue;
        const kinds = holdsKinds(s.expr, readings, tainted);
        if (kinds.size === 0) continue;
        for (const name of s.names) {
          const cur = tainted.get(name) ?? new Set();
          const before = cur.size;
          for (const k of kinds) cur.add(k);
          if (cur.size !== before || !tainted.has(name)) {
            tainted.set(name, cur);
            changed = true;
          }
        }
      }
    }

    for (const c of cands) {
      const measuredKinds = holdsKinds(c.measured, readings, tainted);
      if (measuredKinds.size === 0) continue;
      const boundKinds = holdsKinds(c.bound, readings, tainted);
      const relative = boundKinds.size > 0;
      if (relative && !/[*/+\-%]/.test(c.bound)) continue; // ordering check
      const lineNo = lineOfOffset(starts, a.start);
      const firstLine = text.split("\n", lineNo)[lineNo - 1] ?? "";
      hits.push({
        line: lineNo,
        form: `${[...measuredKinds].join(" + ")} ${relative ? "relative " : ""}upper bound (${c.form})`,
        caseTitle: kase?.title ?? "",
        norm: normalizeAssertionLine(firstLine),
      });
      break;
    }
  }
  return hits;
}

/**
 * Analyse one test file. Reads no file system: `path` is the repo-relative
 * path, `text` the file's content. Returns `{ findings, allowed }`:
 * `findings` are budget assertions (kind "budget") and bad allow-list entries
 * for this file (kind "allow-entry"); `allowed` are exempted assertions with
 * the entry that exempted them.
 */
export function analyzeBudgetAssertions(path, text, allow = LIVENESS_ALLOW) {
  const hits = isBudgetFile(path) ? [] : detectHits(path, text);
  const findings = [];
  const allowed = [];
  const exempt = new Set();
  for (const entry of allow.filter((e) => e.file === path)) {
    const matches = hits.filter((h) => h.norm === entry.assertion);
    const label = `${path}: ${entry.assertion}`;
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      findings.push({ kind: "allow-entry", file: path, line: matches[0]?.line ?? 1, form: `allow-list entry has an empty reason (${label})`, caseTitle: "", entry });
    } else if (matches.length === 0) {
      findings.push({ kind: "allow-entry", file: path, line: 1, form: `stale allow-list entry, no flagged assertion matches (${label})`, caseTitle: "", entry });
    } else if (matches.length > 1) {
      findings.push({ kind: "allow-entry", file: path, line: matches[0].line, form: `ambiguous allow-list entry, ${matches.length} flagged assertions match (${label})`, caseTitle: "", entry });
    } else {
      exempt.add(matches[0]);
      allowed.push({ kind: "budget", file: path, line: matches[0].line, form: matches[0].form, caseTitle: matches[0].caseTitle, entry });
    }
  }
  for (const h of hits) {
    if (exempt.has(h)) continue;
    findings.push({ kind: "budget", file: path, line: h.line, form: h.form, caseTitle: h.caseTitle });
  }
  findings.sort((a, b) => a.line - b.line);
  allowed.sort((a, b) => a.line - b.line);
  return { findings, allowed };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "out", ".worktrees"]);

function walk(root) {
  const files = [];
  const rec = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) rec(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) files.push(rel ? `${rel}/${e.name}` : e.name);
    }
  };
  rec(root, "");
  return files;
}

export function isScopedTestFile(rel) {
  return (
    TEST_FILE_RE.test(rel) &&
    !isBudgetFile(rel) &&
    !/(?:^|\/)tests\/e2e\//.test(rel) &&
    !/^qa\//.test(rel) &&
    !/(?:^|\/)fixtures\//.test(rel) &&
    !/(?:^|\/)node_modules\//.test(rel)
  );
}

/** Scoped test files under `root`: `git ls-files` at a repo root, else a directory walk. */
export function listScopedFiles(root) {
  let rel;
  try {
    const run = (args) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    if (run(["rev-parse", "--show-prefix"]).trim() !== "") throw new Error("not a repo root");
    rel = run(["ls-files", "-z"]).split("\0").filter(Boolean);
  } catch {
    rel = walk(root);
  }
  return rel.filter(isScopedTestFile).filter((f) => existsSync(join(root, f))).sort();
}

const normPrefix = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * Run `analyze(path, text, allow)` over every scoped file. A file the analyzer
 * throws on (or that cannot be read) becomes an entry of `errors`; the other
 * files are still analysed. Allow-list entries whose file was not analysed
 * (missing, or not a scoped test file) are reported as stale.
 */
export function runBudgetGuard({ root = REPO_ROOT, prefixes = [], analyze = analyzeBudgetAssertions, allow } = {}) {
  const allowList = allow ?? (resolve(root) === REPO_ROOT ? LIVENESS_ALLOW : []);
  const wanted = prefixes.map(normPrefix);
  const inScope = (f) => wanted.length === 0 || wanted.some((p) => f === p || f.startsWith(p));
  const files = listScopedFiles(root).filter(inScope);
  const findings = [];
  const allowed = [];
  const errors = [];
  for (const file of files) {
    try {
      const res = analyze(file, readFileSync(join(root, file), "utf8"), allowList);
      findings.push(...res.findings);
      allowed.push(...res.allowed);
    } catch (err) {
      errors.push({ file, message: err instanceof Error ? err.message : String(err) });
    }
  }
  const seen = new Set(files);
  for (const entry of allowList) {
    if (seen.has(entry.file) || !inScope(entry.file)) continue;
    findings.push({
      kind: "allow-entry",
      file: entry.file,
      line: 1,
      form: `stale allow-list entry, file not found among scanned test files (${entry.file}: ${entry.assertion})`,
      caseTitle: "",
      entry,
    });
  }
  return { files: files.length, findings, allowed, errors };
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/**
 * The CLI, with its streams injected. Returns the exit code.
 * `env` defaults to `process.env`; `out` receives one line per call.
 */
export function runCli({ argv = [], env = process.env, out = (l) => console.log(l), analyze = analyzeBudgetAssertions } = {}) {
  let mode = "strict";
  let root = REPO_ROOT;
  const prefixes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--warn") mode = mode === "list" ? mode : "warn";
    else if (a === "--list") mode = "list";
    else if (a === "--root") root = resolve(argv[++i] ?? ".");
    else if (a.startsWith("--root=")) root = resolve(a.slice(7));
    else if (a.startsWith("--")) out(`::warning::budget guard error: unknown option ${esc(a)}`);
    else prefixes.push(a);
  }
  let res;
  try {
    res = runBudgetGuard({ root, prefixes, analyze });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out(`::warning::budget guard error: ${esc(message)}`);
    return mode === "strict" ? 1 : 0;
  }
  const { findings, allowed, errors } = res;
  const errLines = errors.map((e) => `::warning::budget guard error: ${esc(`${e.file}: ${e.message}`)}`);

  if (mode === "list") {
    for (const f of findings) out(`FINDING  ${f.file}:${f.line}  ${f.form}${f.caseTitle ? `  (case: ${f.caseTitle})` : ""}`);
    for (const a of allowed) {
      out(`ALLOWED  ${a.file}:${a.line}  ${a.form}${a.caseTitle ? `  (case: ${a.caseTitle})` : ""}  -- allow-list entry \`${a.entry.assertion}\`: ${a.entry.reason}`);
    }
    for (const l of errLines) out(l);
    out(`${res.files} test file(s) scanned · ${findings.length} finding(s) · ${allowed.length} allow-listed · ${errors.length} error(s)`);
    return 0;
  }

  if (mode === "warn") {
    for (const f of findings) {
      out(`::warning file=${esc(f.file)},line=${f.line}::budget assertion in a blocking lane: ${esc(f.form)}`);
    }
    for (const l of errLines) out(l);
    const summary = env.GITHUB_STEP_SUMMARY;
    if (summary) {
      try {
        const rows = findings.map((f) => `| ${cell(`${f.file}:${f.line}`)} | ${cell(f.form)} | ${cell(f.caseTitle)} |`);
        appendFileSync(
          summary,
          `### Budget assertions in blocking lanes: ${findings.length}\n\n| Location | Form | Case |\n| --- | --- | --- |\n${rows.join("\n")}${rows.length ? "\n" : ""}`,
        );
      } catch (err) {
        out(`::warning::budget guard error: ${esc(err instanceof Error ? err.message : String(err))}`);
      }
    }
    return 0;
  }

  for (const f of findings) out(`${f.file}:${f.line}: ${f.form}${f.caseTitle ? ` (case: ${f.caseTitle})` : ""}`);
  for (const l of errLines) out(l);
  out(`${res.files} test file(s) scanned · ${findings.length} finding(s)`);
  return findings.length > 0 || errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exit(runCli({ argv: process.argv.slice(2) }));
}
