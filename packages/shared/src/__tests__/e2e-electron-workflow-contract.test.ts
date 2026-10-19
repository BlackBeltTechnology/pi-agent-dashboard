/**
 * Workflow contract for `.github/workflows/ci-e2e-electron.yml` (change:
 * add-missing-ci-legs, #531; design D4).
 *
 * The macOS leg is billed at 10x, so its cadence is a contract, not a habit:
 *   - the `electron-e2e` matrix is a `fromJSON` expression keyed on
 *     `github.event_name` ONLY — `schedule` → macOS only, `workflow_dispatch` →
 *     all three OSes, `pull_request` → Linux + Windows (never macOS);
 *   - no `labeled` PR trigger (a label event would cancel the in-flight run);
 *   - every OS the matrix can produce has a step that actually runs the suite
 *     (a matrix OS with no run step goes green running nothing);
 *   - every job other than `electron-e2e` is skipped on `schedule`, so a job
 *     added later cannot silently join the nightly;
 *   - NO job is `continue-on-error` (a darwin regression must turn the run
 *     red); the key is banned on every job, any value; `electron-e2e`'s report
 *     artifact is OS-scoped (legs must not collide).
 *
 * No YAML dependency (mirrors e2e-browser-workflow-contract.test.ts); the matrix
 * and `if:` expressions are evaluated by the tiny evaluator below, which
 * implements exactly the GitHub-Actions subset the workflow uses.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { jobBlock, jobIds } from "./workflow-jobs.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const yaml = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci-e2e-electron.yml"), "utf8");

// ── expression evaluator (strings, ==, !=, !, &&, ||, parens, context refs, always()) ──

type Value = string | boolean;
type Ctx = Record<string, string>;

function tokenize(src: string): string[] {
  const tokens = src.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[()!]|[A-Za-z_][\w.]*(?:\(\))?/g);
  return tokens ?? [];
}

const truthy = (v: Value): boolean => (typeof v === "boolean" ? v : v !== "");

/** Evaluate a GitHub Actions expression body (no `${{ }}`) against a flat context. */
export function evalExpr(src: string, ctx: Ctx): Value {
  const toks = tokenize(src);
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const next = (): string => toks[i++];
  function primary(): Value {
    const t = next();
    if (t === "(") {
      const v = orExpr();
      next(); // ")"
      return v;
    }
    if (t === "!") return !truthy(primary());
    if (t.startsWith("'")) return t.slice(1, -1).replaceAll("''", "'");
    if (t === "always()") return true;
    if (t in ctx) return ctx[t];
    throw new Error(`unsupported token in expression: ${t}`);
  }
  function cmp(): Value {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = next();
      const right = primary();
      const eq = String(left).toLowerCase() === String(right).toLowerCase();
      left = op === "==" ? eq : !eq;
    }
    return left;
  }
  function andExpr(): Value {
    let left = cmp();
    while (peek() === "&&") {
      next();
      const right = cmp();
      left = truthy(left) ? right : left;
    }
    return left;
  }
  function orExpr(): Value {
    let left = andExpr();
    while (peek() === "||") {
      next();
      const right = andExpr();
      left = truthy(left) ? left : right;
    }
    return left;
  }
  return orExpr();
}

// ── workflow slicing ──

function stripExpr(s: string): string {
  const m = s.trim().match(/^\$\{\{([\s\S]*)\}\}$/);
  return (m ? m[1] : s).trim();
}

/** The `matrix.os` scalar of `electron-e2e`, whitespace-folded like YAML would. */
function matrixOsExpr(workflow: string): string {
  const block = jobBlock(workflow, "electron-e2e");
  const m = block.match(/^ {8}os:\s*([\s\S]*?)(?=^ {4}\S|^ {6}\S)/m);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** OS list the matrix yields for an event; null when it is a literal list. */
export function matrixFor(workflow: string, eventName: string): string[] {
  const expr = matrixOsExpr(workflow);
  if (!expr.startsWith("${{")) {
    return (expr.match(/\[([^\]]*)\]/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  const inner = stripExpr(expr);
  const fj = inner.match(/^fromJSON\(([\s\S]*)\)$/);
  if (!fj) throw new Error(`matrix expression is not fromJSON(...): ${inner}`);
  return JSON.parse(String(evalExpr(fj[1], { "github.event_name": eventName }))) as string[];
}

interface Step {
  name: string;
  cond: string;
  run: string;
  text: string;
}

function steps(workflow: string, jobId: string): Step[] {
  const block = jobBlock(workflow, jobId);
  const parts = block.split(/^ {6}- /m).slice(1);
  return parts.map((text) => ({
    text,
    name: text.match(/name:\s*(.+)/)?.[1].trim() ?? "",
    cond: text.match(/^ {8}if:\s*(.+)$/m)?.[1].trim() ?? "",
    run: text.match(/^ {8}run:\s*(.+)$/m)?.[1].trim() ?? "",
  }));
}

const RUNNER_OS: Record<string, string> = { ubuntu: "Linux", windows: "Windows", macos: "macOS" };
const osOf = (label: string): string => RUNNER_OS[label.split("-")[0]] ?? label;

/** `on.pull_request.types`, or [] when absent. */
function pullRequestTypes(workflow: string): string[] {
  const on = workflow.split("\n");
  const start = on.findIndex((l) => /^ {2}pull_request:/.test(l));
  if (start === -1) return [];
  const body: string[] = [];
  for (const l of on.slice(start + 1)) {
    if (/^ {2}\S/.test(l) || /^\S/.test(l)) break;
    body.push(l);
  }
  const types = body.join("\n").match(/^ {4}types:\s*\[([^\]]*)\]/m)?.[1] ?? "";
  return types.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Every contract violation, each naming the offending job / OS / event. */
export function electronWorkflowViolations(workflow: string): string[] {
  const out: string[] = [];
  const events = ["schedule", "workflow_dispatch", "pull_request"] as const;

  if (/github\.event\.pull_request/.test(matrixOsExpr(workflow))) {
    out.push("electron-e2e: matrix expression references github.event.pull_request (undefined on schedule/dispatch)");
  }
  let byEvent: Record<string, string[]> = {};
  try {
    byEvent = Object.fromEntries(events.map((e) => [e, matrixFor(workflow, e)]));
  } catch (e) {
    return [...out, `electron-e2e: matrix not evaluable (${(e as Error).message})`];
  }
  const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every((x) => a.includes(x));
  if (!sameSet(byEvent.schedule, ["macos-latest"])) out.push(`schedule: matrix must be macOS only (got ${JSON.stringify(byEvent.schedule)})`);
  if (!sameSet(byEvent.workflow_dispatch, ["ubuntu-latest", "windows-latest", "macos-latest"])) {
    out.push(`workflow_dispatch: matrix must be all three OSes (got ${JSON.stringify(byEvent.workflow_dispatch)})`);
  }
  if (!sameSet(byEvent.pull_request, ["ubuntu-latest", "windows-latest"])) {
    out.push(`pull_request: matrix must be Linux + Windows, never macOS (got ${JSON.stringify(byEvent.pull_request)})`);
  }

  if (pullRequestTypes(workflow).includes("labeled")) out.push("pull_request.types includes `labeled` (a label event cancels the in-flight run)");

  // Every OS the matrix can produce needs an admitting suite-running step.
  const suiteSteps = steps(workflow, "electron-e2e").filter((s) => /test:e2e:electron/.test(s.run));
  for (const label of new Set(Object.values(byEvent).flat())) {
    const os = osOf(label);
    const admitted = suiteSteps.some((s) => s.cond === "" || truthy(evalExpr(stripExpr(s.cond), { "runner.os": os })));
    if (!admitted) out.push(`${label}: no \`test:e2e:electron\` step admits runner.os == ${os} (leg would run nothing)`);
  }

  // Every job but electron-e2e must be skipped on `schedule`.
  for (const id of jobIds(workflow).filter((j) => j !== "electron-e2e")) {
    const cond = jobBlock(workflow, id).match(/^ {4}if:\s*(.+)$/m)?.[1];
    const runsOnSchedule = cond === undefined || truthy(evalExpr(stripExpr(cond), { "github.event_name": "schedule" }));
    if (runsOnSchedule) out.push(`${id}: not skipped on \`schedule\` (add \`if: github.event_name != 'schedule'\`)`);
  }

  // No job may carry `continue-on-error` (any value): a darwin regression must turn the run red.
  for (const id of jobIds(workflow)) {
    if (/^ {4}continue-on-error:/m.test(jobBlock(workflow, id))) out.push(`${id}: must not be continue-on-error (a darwin regression would go green)`);
  }

  const upload = steps(workflow, "electron-e2e").find((s) => /upload-artifact/.test(s.text));
  const artifactName = upload?.text.match(/^ {10}name:\s*(.+)$/m)?.[1].trim() ?? "";
  if (!/\$\{\{\s*(matrix\.os|runner\.os)\s*\}\}/.test(artifactName)) out.push(`electron-e2e: report artifact \`${artifactName}\` is not OS-scoped (legs collide)`);
  return out;
}

describe("ci-e2e-electron.yml — macOS leg contract (#531)", () => {
  const mutate = (from: string | RegExp, to: string): string => {
    const next = yaml.replace(from, to);
    expect(next, "fixture mutation did not change the workflow").not.toBe(yaml);
    return next;
  };

  it("the real workflow satisfies the whole contract", () => {
    expect(electronWorkflowViolations(yaml)).toEqual([]);
  });

  it("(E10) the matrix is event-keyed: schedule→macOS, dispatch→3 OSes, PR→Linux+Windows", () => {
    expect(matrixFor(yaml, "schedule")).toEqual(["macos-latest"]);
    expect(matrixFor(yaml, "workflow_dispatch").sort()).toEqual(["macos-latest", "ubuntu-latest", "windows-latest"]);
    expect(matrixFor(yaml, "pull_request").sort()).toEqual(["ubuntu-latest", "windows-latest"]);
  });

  it("(E10) a pull_request reference in the matrix expression fails", () => {
    const bad = mutate("github.event_name == 'schedule' &&", "github.event.pull_request.number == 1 || github.event_name == 'schedule' &&");
    expect(electronWorkflowViolations(bad).join("\n")).toContain("references github.event.pull_request");
  });

  it("(E10) macOS on the PR fallback fails", () => {
    const bad = mutate(`'["ubuntu-latest","windows-latest"]') }}`, `'["ubuntu-latest","windows-latest","macos-latest"]') }}`);
    expect(electronWorkflowViolations(bad).join("\n")).toContain("pull_request: matrix must be Linux + Windows");
  });

  it("(E11) pull_request.types: absent/plain pass, `labeled` fails", () => {
    expect(pullRequestTypes(yaml)).toEqual([]);
    const plain = mutate("  pull_request:\n    branches: [develop]\n", "  pull_request:\n    branches: [develop]\n    types: [opened, synchronize, reopened]\n");
    expect(electronWorkflowViolations(plain)).toEqual([]);
    const labeled = mutate("  pull_request:\n    branches: [develop]\n", "  pull_request:\n    branches: [develop]\n    types: [opened, synchronize, reopened, labeled]\n");
    expect(electronWorkflowViolations(labeled).join("\n")).toContain("`labeled`");
  });

  it("(E12) an OS with no admitting suite step fails naming it", () => {
    const bad = mutate("if: runner.os != 'Linux'", "if: runner.os == 'Windows'");
    const v = electronWorkflowViolations(bad).join("\n");
    expect(v).toContain("macos-latest: no `test:e2e:electron` step admits runner.os == macOS");
    expect(v).not.toContain("windows-latest: no");
  });

  it("(E13) every job other than electron-e2e is skipped on schedule (enumerated, not hard-coded)", () => {
    expect(jobIds(yaml)).toEqual(expect.arrayContaining(["electron-e2e", "runtime-overlay-e2e"]));
    expect(jobIds(yaml)).not.toContain("job-object-windows");
    const extra = `${yaml.trimEnd()}\n\n  foo:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    expect(electronWorkflowViolations(extra).join("\n")).toContain("foo: not skipped on `schedule`");
    const noGate = mutate("  runtime-overlay-e2e:\n    if: github.event_name != 'schedule'\n", "  runtime-overlay-e2e:\n");
    expect(electronWorkflowViolations(noGate).join("\n")).toContain("runtime-overlay-e2e: not skipped on `schedule`");
  });

  it("(E14) electron-e2e carries no continue-on-error", () => {
    for (const value of ["true", "${{ matrix.os == 'macos-latest' }}"]) {
      const bad = mutate("  electron-e2e:\n    strategy:", `  electron-e2e:\n    continue-on-error: ${value}\n    strategy:`);
      expect(electronWorkflowViolations(bad).join("\n")).toContain("electron-e2e: must not be continue-on-error");
    }
    expect(electronWorkflowViolations(yaml)).toEqual([]);
  });

  it("(E16) continue-on-error is banned on every job (enumerated, any value)", () => {
    for (const value of ["true", "false"]) {
      const bad = mutate("  runtime-overlay-e2e:\n", `  runtime-overlay-e2e:\n    continue-on-error: ${value}\n`);
      expect(electronWorkflowViolations(bad).join("\n")).toContain("runtime-overlay-e2e: must not be continue-on-error");
    }
    const extra = `${yaml.trimEnd()}\n\n  foo:\n    continue-on-error: true\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
    expect(electronWorkflowViolations(extra).join("\n")).toContain("foo: must not be continue-on-error");
  });

  it("(E17) a comment mentioning continue-on-error is not a violation", () => {
    const ok = mutate("  runtime-overlay-e2e:\n", "  runtime-overlay-e2e:\n    # continue-on-error: true is forbidden here\n");
    expect(electronWorkflowViolations(ok).join("\n")).not.toContain("must not be continue-on-error");
  });

  it("(E15) the report artifact name is OS-scoped", () => {
    const bad = mutate("name: playwright-report-electron-${{ matrix.os }}", "name: playwright-report-electron");
    expect(electronWorkflowViolations(bad).join("\n")).toContain("not OS-scoped");
  });
});

describe("evalExpr — the GitHub-Actions subset", () => {
  it("&& / || return operands (Actions semantics) and == is case-insensitive", () => {
    expect(evalExpr("a == 'x' && 'yes' || 'no'", { a: "X" })).toBe("yes");
    expect(evalExpr("a == 'x' && 'yes' || 'no'", { a: "y" })).toBe("no");
    expect(evalExpr("!(a != 'x')", { a: "x" })).toBe(true);
    expect(evalExpr("always()", {})).toBe(true);
  });
});
