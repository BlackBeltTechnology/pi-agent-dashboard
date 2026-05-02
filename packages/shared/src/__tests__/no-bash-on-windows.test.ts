/**
 * Repo-level invariant: no GitHub Actions step that can run on a
 * Windows runner SHALL declare `shell: bash`. Bash on Windows runners
 * is provided by Git for Windows' MSYS2 layer, which translates Win32
 * paths to POSIX form (`D:\a\...` → `/d/a/...`) for any bash variable
 * produced by `pwd`, `dirname`, etc. That POSIX-form string is invisible
 * to native binaries (notably `node.exe`) when embedded in arguments,
 * producing a recurring class of `MODULE_NOT_FOUND` / `ENOENT` bugs.
 *
 * Cross-OS build orchestration MUST be expressed in `.mjs` scripts
 * invoked by `node`. POSIX-only steps MAY use `shell: bash` provided
 * they are gated by an `if:` filter that excludes Windows. Windows-only
 * steps MAY use `shell: pwsh`.
 *
 * If this test fails, port the offending step to `node` (cross-OS) or
 * split it per-OS (`bash` for POSIX, `pwsh` for Windows) and gate each
 * arm with an `if:` filter on `matrix.platform`.
 *
 * See change: eliminate-bash-on-windows-runners.
 *
 * Supported `if:` grammar (anything else fails closed → treated as
 * Windows-reachable, forcing the contributor to write a recognised form
 * or extend this evaluator):
 *
 *   - bare boolean       : `true` / `false`
 *   - matrix comparison  : `matrix.platform == 'X'`, `matrix.platform != 'X'`
 *                          `matrix.arch == 'X'`, `matrix.arch != 'X'`
 *   - conjunction        : `<expr> && <expr>`
 *   - disjunction        : `<expr> || <expr>`
 *   - negation           : `!(<expr>)`
 *   - parens             : `(<expr>)` are stripped
 *
 * The grammar is small because this repo's workflow YAML is small and
 * stable; if a future workflow needs richer `if:` expressions, extend
 * the evaluator (and the test grammar comment) rather than expand the
 * lint's allowlist.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** Workflow files this lint scans. */
const WORKFLOW_FILES: readonly string[] = [
  ".github/workflows/publish.yml",
  ".github/workflows/ci.yml",
];

/** A platform value present in `matrix.platform` of any job we care about. */
const WINDOWS_PLATFORMS = new Set(["win32"]);

/**
 * Extract the YAML body of a top-level job by name. Returns the lines
 * between `  <jobName>:` and the next sibling-indent (`  `) job, or EOF.
 *
 * Same pattern as `publish-workflow-contract.test.ts` —
 * regex-based extraction, no YAML library dep, tolerates the stable
 * 2-space indented format used in this repo.
 */
function extractJobBlock(yaml: string, jobName: string): string | null {
  const lines = yaml.split("\n");
  const headerRe = new RegExp(`^  ${jobName}:\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const siblingRe = /^  [a-z][a-z0-9-]*:\s*$/;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (siblingRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Pull the matrix.include[*].platform values from a job block. */
function extractMatrixPlatforms(jobBlock: string): string[] {
  // Each matrix entry starts with `- os:` at a deeper indent. Capture
  // the `platform:` line that sibling-belongs to it (the next platform
  // line after each `- os:`).
  const out: string[] = [];
  const lines = jobBlock.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s+-\s*os:/.test(lines[i])) continue;
    // Look at the next ~6 lines for a sibling `platform:` key.
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (/^\s+-\s*os:/.test(lines[j])) break; // next entry
      const m = lines[j].match(/^\s+platform:\s*['"]?([\w-]+)['"]?\s*$/);
      if (m) {
        out.push(m[1]);
        break;
      }
    }
  }
  return out;
}

/**
 * Step-level extraction. Each step starts with `      - name:` (6-space
 * indent under `    steps:`). For each step we capture the line number,
 * the `name:` value, the `shell:` value (if any), and the `if:` value
 * (if any).
 */
interface Step {
  line: number; // 1-indexed
  name: string;
  shell: string | null;
  if_: string | null;
}

function extractSteps(jobBlock: string, baseLine: number): Step[] {
  const lines = jobBlock.split("\n");
  const steps: Step[] = [];
  let cur: Step | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stepHeader = line.match(/^      -\s*name:\s*(.+?)\s*$/);
    if (stepHeader) {
      if (cur) steps.push(cur);
      cur = {
        line: baseLine + i,
        name: stepHeader[1].replace(/^['"]|['"]$/g, ""),
        shell: null,
        if_: null,
      };
      continue;
    }
    if (cur) {
      // 8-space indented sibling keys of the step.
      const sh = line.match(/^        shell:\s*(\S+)\s*$/);
      if (sh) {
        cur.shell = sh[1];
        continue;
      }
      const ifM = line.match(/^        if:\s*(.+?)\s*$/);
      if (ifM) {
        // Strip a single layer of YAML-double-quote wrapping, e.g.
        //   if: "!(matrix.platform == 'win32' && matrix.arch == 'arm64')"
        // Single quotes inside the expression must be preserved.
        let v = ifM[1];
        if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
          v = v.slice(1, -1);
        }
        cur.if_ = v;
        continue;
      }
      // A step body line at any non-step-header indent — keep accumulating.
    }
  }
  if (cur) steps.push(cur);
  return steps;
}

/**
 * Pure evaluator: does an `if:` expression evaluate to `true` for ANY
 * concrete (platform, arch) tuple in {windows} × {x64, arm64}? If yes,
 * the step is reachable on Windows.
 *
 * Returns true if the expression is unrecognised (fail closed — force
 * the contributor to write a recognisable form or extend the grammar).
 */
function reachableOnWindows(ifExpr: string | null, archs: string[]): boolean {
  if (ifExpr == null || ifExpr === "") return true;
  for (const arch of archs) {
    for (const plat of WINDOWS_PLATFORMS) {
      try {
        if (evaluate(ifExpr, { platform: plat, arch })) return true;
      } catch {
        // Unrecognised — fail closed
        return true;
      }
    }
  }
  return false;
}

/**
 * Evaluate a small grammar of `matrix.X op 'literal'` boolean expressions.
 * Throws on unrecognised input.
 */
function evaluate(
  expr: string,
  ctx: { platform: string; arch: string },
): boolean {
  const e = expr.trim();
  if (e === "true") return true;
  if (e === "false") return false;

  // Negation: `!(...)` — must have matching outer parens
  if (e.startsWith("!(") && e.endsWith(")")) {
    return !evaluate(e.slice(2, -1), ctx);
  }

  // Strip outer parens
  if (e.startsWith("(") && e.endsWith(")") && balanced(e.slice(1, -1))) {
    return evaluate(e.slice(1, -1), ctx);
  }

  // Top-level `&&` or `||` — split at the first unparenthesized operator
  const splitAt = (op: string): [string, string] | null => {
    let depth = 0;
    for (let i = 0; i < e.length - op.length + 1; i++) {
      if (e[i] === "(") depth += 1;
      else if (e[i] === ")") depth -= 1;
      else if (depth === 0 && e.slice(i, i + op.length) === op) {
        return [e.slice(0, i).trim(), e.slice(i + op.length).trim()];
      }
    }
    return null;
  };
  const andSplit = splitAt("&&");
  if (andSplit) return evaluate(andSplit[0], ctx) && evaluate(andSplit[1], ctx);
  const orSplit = splitAt("||");
  if (orSplit) return evaluate(orSplit[0], ctx) || evaluate(orSplit[1], ctx);

  // Atomic: `matrix.<key> <op> '<literal>'`
  const atom = e.match(
    /^matrix\.(platform|arch)\s*(==|!=)\s*['"]([^'"]+)['"]$/,
  );
  if (atom) {
    const [, key, op, lit] = atom;
    const ctxVal = key === "platform" ? ctx.platform : ctx.arch;
    return op === "==" ? ctxVal === lit : ctxVal !== lit;
  }

  throw new Error(`unrecognised if-expression: ${expr}`);
}

function balanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe("no `shell: bash` step is reachable on a Windows runner", () => {
  for (const wf of WORKFLOW_FILES) {
    const abs = path.join(REPO_ROOT, wf);
    if (!fs.existsSync(abs)) continue;
    const yaml = fs.readFileSync(abs, "utf8");

    // Find every job that has a Windows-able matrix.
    const jobMatches = [...yaml.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)];
    const jobNames = jobMatches.map((m) => m[1]);

    for (const jobName of jobNames) {
      const block = extractJobBlock(yaml, jobName);
      if (!block) continue;

      const platforms = extractMatrixPlatforms(block);
      const hasWindows = platforms.some((p) => WINDOWS_PLATFORMS.has(p));
      // Also count jobs whose runs-on directly names windows-*
      const directWindows = /runs-on:\s*['"]?windows-[\w.-]+['"]?/.test(block);
      if (!hasWindows && !directWindows) continue;

      // Compute the matrix archs available; default to ['x64','arm64'].
      const archs = [
        ...new Set(
          [...block.matchAll(/arch:\s*['"]?([\w-]+)['"]?/g)].map((m) => m[1]),
        ),
      ];
      const archList = archs.length > 0 ? archs : ["x64"];

      const baseLine = yaml.slice(0, yaml.indexOf(block)).split("\n").length;
      const steps = extractSteps(block, baseLine);

      it(`${wf} — job '${jobName}': no shell:bash steps reachable on Windows`, () => {
        const offenders: string[] = [];
        for (const s of steps) {
          if (s.shell !== "bash") continue;
          if (reachableOnWindows(s.if_, archList)) {
            offenders.push(
              `  ${wf}:${s.line} step '${s.name}' uses shell: bash` +
                ` and is reachable on Windows (if: ${s.if_ ?? "<none>"})`,
            );
          }
        }
        if (offenders.length > 0) {
          throw new Error(
            `Found ${offenders.length} bash-on-Windows step(s).\n` +
              offenders.join("\n") +
              `\n\nPort each offender to .mjs (cross-OS) OR split per-OS ` +
              `(bash gated by 'matrix.platform != \\'win32\\'' for POSIX, ` +
              `pwsh for Windows).\n` +
              `See change: eliminate-bash-on-windows-runners.`,
          );
        }
        expect(offenders).toEqual([]);
      });
    }
  }
});
