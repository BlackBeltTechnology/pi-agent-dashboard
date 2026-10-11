/**
 * Repo-lint guard for browser-E2E quarantine (change: stabilize-browser-e2e,
 * task 4.1; design D5).
 *
 * Triage of the red baseline may quarantine a spec that fails for a PRODUCT
 * reason. Quarantine hides regressions, so every conditional `test.fixme` MUST
 * link the issue that tracks the real fix — an unlinked one is an invisible
 * hole in the strongest gate on the ship-it path.
 *
 *   test.fixme(true, "flaky")                     → REJECTED (no issue link)
 *   test.fixme(true, "…/issues/42")               → ok
 *   test.fixme("a title", async () => {})          → ok (unconditional skip
 *                                                    with a documented reason,
 *                                                    not a quarantine)
 *
 * File-level skips (#701.2). A conditional `test.skip(<cond>, "<reason>")` at
 * FILE scope removes the whole spec from every shard — the same invisible hole.
 * Its reason must carry an `issues/<n>` URL or name, backtick-quoted, the id of
 * a `ci-e2e-browser.yml` job that runs `playwright test` (the leg that DOES run
 * the file):
 *
 *   test.skip(!x, "flaky env")                    → REJECTED
 *   test.skip(!x, "runs on `e2e-browser-relay`")  → ok (spec-running job)
 *   test.skip(!x, "only `merge-report`")          → REJECTED (runs no specs)
 *   test.skip(!x, "playwright.team.config.ts")    → REJECTED (no CI runs it)
 *   test.skip(!x, "e2e flake")                    → REJECTED (bare word, not
 *                                                    a quoted job id)
 *     test.skip(!port, "…")  (indented)           → ignored (runtime guard)
 *   test.skip("title", async () => {})            → ignored (unconditional)
 *
 * "File scope" = a line whose FIRST character starts `test.skip(` (design D3).
 * Known miss, accepted: a file-scope skip wrapped in `if (…) {}` or an IIFE is
 * indented and therefore not seen — this is a tripwire for the shape the suite
 * uses, not a proof. The call may span lines (paren depth, string-aware).
 *
 * This file owns ONLY the fixme/skip rules; `scripts/check-e2e-fixture-import.mjs`
 * owns the import rule. See change: close-e2e-tooling-followups.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { jobBlock, jobIds } from "./workflow-jobs.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "tests", "e2e");
const BROWSER_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci-e2e-browser.yml");

/**
 * Conditional `test.fixme(<cond>, "<reason>")` calls whose reason has no
 * `/issues/<n>` link. The first argument is captured only up to `,` or `(` so a
 * string-literal first arg (the unconditional `test.fixme(title, body)` form)
 * is recognized and skipped.
 */
export function unlinkedFixmes(source: string): string[] {
  const findings: string[] = [];
  const re =
    /test\.fixme\(\s*([^,(]+?)\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const m of source.matchAll(re)) {
    const first = m[1].trim();
    if (/^["'`]/.test(first)) continue; // unconditional skip, not a quarantine
    const reason = m[2].slice(1, -1);
    if (!/issues\/\d+/.test(reason)) findings.push(reason);
  }
  return findings;
}

/** Ids of the workflow jobs whose body runs specs (`playwright test`). */
export function specRunningJobIds(workflowYaml: string): string[] {
  return jobIds(workflowYaml).filter((id) => /playwright test\b/.test(jobBlock(workflowYaml, id)));
}

/**
 * Split the argument list of the call whose `(` sits at `open` into top-level
 * arguments. Returns null when the call never closes. String-aware so a `,` or
 * paren inside a quoted reason never splits or ends the call.
 */
/** Index of the quote that closes the string literal opening at `i` (escape-aware). */
function stringEnd(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
  return j;
}

function callArgs(src: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = stringEnd(src, i);
    } else if ("([{".includes(c)) {
      depth++;
    } else if (")]}".includes(c) && --depth === 0) {
      args.push(src.slice(start, i));
      const trimmed = args.map((a) => a.trim());
      if (trimmed.at(-1) === "") trimmed.pop(); // trailing comma
      return trimmed;
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

const ID_CHAR = "[A-Za-z0-9_-]";

/** True when `reason` attributes the skip: an issue URL, or a backtick-quoted spec-running job id. */
function attributesSkip(reason: string, jobs: readonly string[]): boolean {
  if (/issues\/\d+/.test(reason)) return true;
  return jobs.some((id) => {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\`${esc}\`(?!${ID_CHAR})`).test(reason);
  });
}

/**
 * File-scope conditional `test.skip(<cond>, "<reason>")` calls whose reason
 * attributes the skip to neither an issue nor a spec-running CI job. Returns
 * the offending reasons (or the raw call text when no string reason exists).
 */
export function unlinkedFileSkips(source: string, jobs: readonly string[]): string[] {
  const findings: string[] = [];
  const re = /^test\.skip\(/gm;
  for (const m of source.matchAll(re)) {
    const open = (m.index ?? 0) + "test.skip".length;
    const args = callArgs(source, open);
    if (!args || args.length === 0) continue;
    if (/^["'`]/.test(args[0])) continue; // unconditional test.skip(title, body)
    const raw = args[1] ?? "";
    const reason = /^(["'`])[\s\S]*\1$/.test(raw) ? raw.slice(1, -1) : raw;
    if (!attributesSkip(reason, jobs)) findings.push(reason || source.slice(m.index ?? 0, open + 1));
  }
  return findings;
}

/** Every `*.spec.ts` under tests/e2e/ (recursive). */
function specFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".spec.ts")) out.push(p);
    }
  };
  walk(E2E_DIR);
  return out;
}

describe("e2e fixme guard", () => {
  it("rejects a conditional fixme whose reason has no issue link", () => {
    expect(unlinkedFixmes(`test.fixme(true, "flaky");`)).toEqual(["flaky"]);
  });

  it("accepts a conditional fixme linked to an issue", () => {
    expect(
      unlinkedFixmes(`test.fixme(true, "https://github.com/o/r/issues/42");`),
    ).toEqual([]);
  });

  it("ignores the unconditional test.fixme(title, body) form", () => {
    // Pre-existing specs use this with a justification comment + an L1
    // equivalent; it is a deliberate permanent skip, not a quarantine.
    expect(unlinkedFixmes(`test.fixme("payload renders", async () => {});`)).toEqual([]);
  });

  it("every conditional fixme under tests/e2e/ links its issue", () => {
    const offenders: string[] = [];
    for (const file of specFiles()) {
      for (const reason of unlinkedFixmes(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: test.fixme(..., "${reason}")`);
      }
    }
    expect(
      offenders,
      "quarantined E2E specs must link an issue: test.fixme(true, \"<issue url>\")",
    ).toEqual([]);
  });
});

describe("e2e file-level skip guard (#701.2)", () => {
  const jobs = specRunningJobIds(fs.readFileSync(BROWSER_WORKFLOW, "utf8"));

  it("derives the spec-running job ids from ci-e2e-browser.yml (merge-report excluded)", () => {
    expect(jobs).toEqual(expect.arrayContaining(["e2e", "e2e-browser-relay"]));
    expect(jobs).not.toContain("merge-report");
  });

  it("(E6) rejects a column-0 conditional skip with an unattributed reason", () => {
    expect(unlinkedFileSkips(`test.skip(!x, "flaky env");`, jobs)).toEqual(["flaky env"]);
  });

  it("(E7) matches a CI job id only as a whole, quoted, spec-running token", () => {
    const verdict = (reason: string) =>
      unlinkedFileSkips(`test.skip(!x, ${JSON.stringify(reason)});`, jobs).length === 0;
    expect(verdict("runs on `e2e-browser-relay`")).toBe(true);
    expect(verdict("e2e flake")).toBe(false);
    expect(verdict("`e2e-browser-relax`")).toBe(false);
    expect(verdict("`merge-report`")).toBe(false);
    expect(verdict("playwright.team.config.ts")).toBe(false);
  });

  it("(E8) accepts a column-0 skip whose reason links an issue", () => {
    expect(
      unlinkedFileSkips(`test.skip(!hasPi, "needs pi — https://github.com/o/r/issues/123");`, jobs),
    ).toEqual([]);
  });

  it("(E9) ignores space- and tab-indented runtime guards", () => {
    expect(unlinkedFileSkips(`  test.skip(!port, "no gateway port");`, jobs)).toEqual([]);
    expect(unlinkedFileSkips(`\ttest.skip(!port, "no gateway port");`, jobs)).toEqual([]);
  });

  it("(E10) parses a multi-line file-scope call and accepts it via its CI leg", () => {
    const src = [
      "test.skip(",
      '  process.env.PI_BROWSER_RELAY_FAKE !== "1",',
      '  "variant harness: runs on the `e2e-browser-relay` CI leg (PI_BROWSER_RELAY_FAKE=1); see .github/workflows/ci-e2e-browser.yml",',
      ");",
    ].join("\n");
    expect(unlinkedFileSkips(src, jobs)).toEqual([]);
    // Same shape, unattributed reason → still found (proves the reason was parsed).
    expect(unlinkedFileSkips(src.replace("`e2e-browser-relay`", "relay"), jobs)).toHaveLength(1);
  });

  it("(E11) ignores the unconditional test.skip(title, body) form", () => {
    expect(unlinkedFileSkips(`test.skip("title", async () => {});`, jobs)).toEqual([]);
  });

  it("(E12) every file-level conditional skip under tests/e2e/ is attributed", () => {
    const offenders: string[] = [];
    for (const file of specFiles()) {
      for (const reason of unlinkedFileSkips(fs.readFileSync(file, "utf8"), jobs)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: test.skip(..., "${reason}")`);
      }
    }
    expect(
      offenders,
      "a file-level test.skip drops the whole spec from every shard: link an issue or name the `<job>` that runs it",
    ).toEqual([]);
  });
});
