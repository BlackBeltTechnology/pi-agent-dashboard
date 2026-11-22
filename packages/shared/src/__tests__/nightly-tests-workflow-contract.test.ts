/**
 * Repo-lint: `nightly-tests.yml` runs the FULL sharded suite on an active cron
 * (change: speed-up-ci-affected-tests, D6; test-plan E31).
 *
 * Affected-only selection on PRs and develop pushes is only safe because this
 * workflow runs everything — slow tier included — every night and names the
 * bisect range when it goes red. A commented-out cron, a missing shard
 * precondition (chromium, the built client) or a shard that verifies nothing
 * would each turn the safety net into a green no-op, so each is pinned here.
 * It must stay independent of the land-dark `nightly.yml` and never publish.
 *
 * change: stabilize-blocking-test-lanes extends it (E100–E107): the `budget`
 * job, no `concurrency` group, the attempt-1 record + `overwrite: true`
 * uploads, the rerun-once workflow `nightly-tests-rerun.yml`, the watchdog
 * `nightly-tests-watchdog.yml`, and the timing inequalities of design.md D7
 * ("Timing") derived from the parsed files and `DEFER_DEADLINE_UTC_MINUTE`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { DEFER_DEADLINE_UTC_MINUTE } from "../../../../scripts/test-selection/nightly-report.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const FILE = path.join(WORKFLOWS, "nightly-tests.yml");
const RERUN_FILE = path.join(WORKFLOWS, "nightly-tests-rerun.yml");
const WATCHDOG_FILE = path.join(WORKFLOWS, "nightly-tests-watchdog.yml");

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
};
type Job = {
  needs?: string | string[];
  if?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  steps?: Step[];
  strategy?: { matrix?: Record<string, unknown> };
};
type Workflow = {
  name?: string;
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: unknown;
  jobs: Record<string, Job>;
};

/** Pure: the `concurrency` keys of a workflow text, at workflow and job level (comments never count). */
function concurrencyKeys(src: string): string[] {
  const w = parseYaml(src) as Partial<Workflow> | null;
  const out: string[] = [];
  if (w && "concurrency" in w) out.push("workflow");
  for (const [name, job] of Object.entries(w?.jobs ?? {})) if (job && typeof job === "object" && "concurrency" in job) out.push(`job:${name}`);
  return out;
}

/** Pure (design.md D7 "Timing"): A = select + longest + report; D >= C + select + longest; W >= D + report + R + A + 120. */
function timingInequalities(v: { C: number; select: number; longest: number; report: number; R: number; D: number; W: number }) {
  const A = v.select + v.longest + v.report;
  return {
    A,
    deadline: v.D >= v.C + v.select + v.longest,
    watchdog: v.W >= v.D + v.report + v.R + A + 120,
  };
}

/** "m h * * *" → minute of the UTC day. */
function cronMinuteOfDay(cron: string): number {
  const [m, h, ...rest] = cron.trim().split(/\s+/);
  expect(rest, `cron "${cron}" must be a daily schedule`).toEqual(["*", "*", "*"]);
  expect(m).toMatch(/^\d+$/);
  expect(h).toMatch(/^\d+$/);
  return Number(h) * 60 + Number(m);
}

const nonComment = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const squash = (e: string | undefined) => (e ?? "").replace(/\s+/g, " ").trim();

const exists = fs.existsSync(FILE);
const text = exists ? fs.readFileSync(FILE, "utf8") : "";
const wf = (exists ? parseYaml(text) : { on: {}, jobs: {} }) as Workflow;
/** Non-comment lines only. */
const code = nonComment(text);
const runs = (job: string) => (wf.jobs[job]?.steps ?? []).map((s) => s.run ?? "").join("\n");
const needsOf = (job: string) => [wf.jobs[job]?.needs ?? []].flat();

describe("nightly-tests.yml", () => {
  it("exists", () => {
    expect(exists, ".github/workflows/nightly-tests.yml must exist").toBe(true);
  });

  it("has an ACTIVE cron and workflow_dispatch", () => {
    const schedule = wf.on.schedule as { cron: string }[] | undefined;
    expect(schedule?.length, "the cron must be uncommented — the nightly is the safety net").toBeGreaterThan(0);
    expect(schedule?.[0].cron).toMatch(/\S+ \S+ \S+ \S+ \S+/);
    expect(wf.on).toHaveProperty("workflow_dispatch");
  });

  it("is read-only by default; only the report job may write issues", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    const report = (wf.jobs.report as Job & { permissions?: Record<string, string> }).permissions;
    expect(report).toEqual({ contents: "read", issues: "write", actions: "read" });
    for (const job of ["select", "unit", "real-process", "ci-scenarios", "budget"]) {
      expect((wf.jobs[job] as Job & { permissions?: Record<string, string> }).permissions?.issues).toBeUndefined();
    }
  });

  it("is independent of nightly.yml", () => {
    expect(code).not.toMatch(/nightly\.yml/);
    for (const job of Object.keys(wf.jobs)) expect(needsOf(job).every((n) => n in wf.jobs)).toBe(true);
  });

  it("selects the FULL suite", () => {
    expect(runs("select")).toMatch(/select-affected-tests\.mjs --full/);
  });

  it("every unit shard installs chromium, asserts the built client and verifies what it executed", () => {
    const unit = runs("unit");
    expect(unit).toMatch(/playwright install chromium/);
    expect(unit).toMatch(/packages\/client\/dist\/index\.html/);
    expect(unit).toMatch(/pnpm run test:parallel/);
    expect(unit).toMatch(/verify-executed\.mjs selection\.json "?unit-/);
    expect(wf.jobs.unit.strategy?.matrix?.shard as number[] | undefined).toHaveLength(4);
  });

  it("every vitest job verifies execution and uploads a per-job report", () => {
    for (const [job, key] of [["real-process", "real-process"], ["ci-scenarios", "ci-scenarios"], ["budget", "budget"]] as const) {
      expect(runs(job)).toMatch(new RegExp(`verify-executed\\.mjs selection\\.json ${key}`));
    }
    for (const job of ["unit", "real-process", "ci-scenarios", "budget"]) {
      const upload = wf.jobs[job].steps?.find((s) => s.uses?.startsWith("actions/upload-artifact@"));
      expect(String(upload?.with?.name)).toMatch(/^vitest-report-/);
      expect(upload?.if).toMatch(/always\(\)/);
    }
  });

  it("the report job always runs, after every test job, even with no report artifacts", () => {
    expect(wf.jobs.report.if).toMatch(/always\(\)/);
    const download = wf.jobs.report.steps?.find((s) => s.uses?.startsWith("actions/download-artifact@")) as
      | (Step & { "continue-on-error"?: boolean })
      | undefined;
    expect(download?.["continue-on-error"], "an all-jobs-died night must still reach the reporter").toBe(true);
    expect(text).toMatch(/NEEDS_JSON:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/);
    expect(needsOf("report").sort()).toEqual(["budget", "ci-scenarios", "real-process", "select", "unit"]);
    expect(runs("report")).toMatch(/nightly-report\.mjs/);
    expect(runs("report")).toMatch(/--expected unit-1,unit-2,unit-3,unit-4,real-process,ci-scenarios,budget\b/);
  });

  it("never publishes, tags or releases", () => {
    expect(code).not.toMatch(/npm publish|pnpm publish/);
    expect(code).not.toMatch(/action-gh-release|gh release/);
    expect(code).not.toMatch(/git push|git tag/);
  });
});

const stepsOf = (w: Workflow, job: string) => w.jobs[job]?.steps ?? [];
const uploads = (w: Workflow) => Object.values(w.jobs).flatMap((j) => (j.steps ?? []).filter((s) => s.uses?.startsWith("actions/upload-artifact@")));

describe("nightly-tests.yml: no concurrency group (E100, task 5.4)", () => {
  const base = "on: {workflow_dispatch: {}}\njobs:\n  unit:\n    runs-on: ubuntu-latest\n    steps: []\n";

  it("E100: the real file has no `concurrency` key at workflow or job level", () => {
    expect(concurrencyKeys(text)).toEqual([]);
    expect(code).not.toMatch(/^\s*concurrency\s*:/m);
  });

  it("E100: (a) no key and (b) a comment pass; (c) a job-level key and (d) a top-level key fail", () => {
    expect(concurrencyKeys(base)).toEqual([]);
    expect(concurrencyKeys(`# concurrency: removed\n${base}`)).toEqual([]);
    expect(concurrencyKeys(base.replace("    steps: []", "    concurrency: {group: g}\n    steps: []"))).toEqual(["job:unit"]);
    expect(concurrencyKeys(`concurrency:\n  group: nightly-tests\n${base}`)).toEqual(["workflow"]);
  });
});

describe("nightly-tests.yml: job `budget` (E101, tasks 5.1/5.2)", () => {
  const budget = wf.jobs.budget;
  const stepRuns = stepsOf(wf, "budget").map((s) => s.run ?? "");

  it("exists, on its own ubuntu runner after `select`, with a provisional-or-sized timeout", () => {
    expect(budget, "the nightly needs a `budget` job (design.md D3)").toBeDefined();
    expect(budget["runs-on"]).toBe("ubuntu-latest");
    expect(needsOf("budget")).toEqual(["select"]);
    expect(budget["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("assigns its files with `assigned.mjs selection.json budget`", () => {
    expect(runs("budget")).toMatch(/assigned\.mjs selection\.json budget\b/);
  });

  it("runs the budget runtime: BLENDER_WASM_E2E=1 and the blender runtime cache keyed on the pin", () => {
    const envs = [budget.env, ...stepsOf(wf, "budget").map((s) => s.env)];
    expect(envs.some((e) => e?.BLENDER_WASM_E2E === "1")).toBe(true);
    expect(stepRuns.join("\n")).toMatch(/packages\/blender\/src\/pin\.ts/);
    const cache = stepsOf(wf, "budget").find((s) => s.uses?.startsWith("actions/cache@"));
    expect(String(cache?.with?.key)).toMatch(/blender-wasm-/);
  });

  it("runs `pnpm run test:budget \"${FILES[@]}\"` unconditionally: an empty FILES still runs vitest and uploads a report", () => {
    const vitest = stepsOf(wf, "budget").find((s) => /pnpm run test:budget/.test(s.run ?? ""));
    expect(vitest?.run).toContain('pnpm run test:budget "${FILES[@]}"');
    expect(vitest?.if, "no skip step on an empty assignment (design.md D3)").toBeUndefined();
    for (const s of stepsOf(wf, "budget")) expect(s.if ?? "", `${s.name ?? s.uses ?? s.run}: no empty-skip`).not.toMatch(/empty/);
  });

  it("verifies execution strictly and uploads vitest-report-budget with if: always()", () => {
    expect(runs("budget")).toMatch(/verify-executed\.mjs selection\.json budget test-results\/vitest\.json/);
    const upload = stepsOf(wf, "budget").find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.name).toBe("vitest-report-budget");
    expect(upload?.if).toBe("always()");
  });

  it("runs only the budget lane: no unit / real-process / ci-scenarios command", () => {
    expect(runs("budget")).not.toMatch(/test:parallel|test:real-process|test:ci-scenarios/);
  });

  it("no job sets job-level continue-on-error (a swallowed red would hide the lane)", () => {
    for (const [name, job] of Object.entries(wf.jobs)) expect(job["continue-on-error"], name).toBeUndefined();
  });
});

describe("nightly-tests.yml: attempt-1 record and artifact overwrite (E102, task 6.2)", () => {
  it("every upload-artifact step sets overwrite: true", () => {
    const all = uploads(wf);
    expect(all.length).toBeGreaterThan(0);
    for (const u of all) expect(u.with?.overwrite, String(u.with?.name)).toBe(true);
    expect((text.match(/overwrite: true/g) ?? []).length).toBe((text.match(/uses: actions\/upload-artifact/g) ?? []).length);
  });

  it("the attempt-1 record is uploaded only on attempt 1, kept 30 days, and ignored when absent", () => {
    const up = uploads(wf).find((u) => u.with?.name === "nightly-attempt-1");
    expect(up, "an upload step named nightly-attempt-1").toBeDefined();
    expect(up?.if).toBe("always() && github.run_attempt == 1");
    expect(up?.with).toMatchObject({ path: "reports/attempt-1.json", "if-no-files-found": "ignore", "retention-days": 30, overwrite: true });
    expect(wf.jobs.report.steps).toContain(up);
  });

  it("the record is downloaded only on attempt >= 2 with a step-level continue-on-error", () => {
    const dl = stepsOf(wf, "report").find((s) => s.uses?.startsWith("actions/download-artifact@") && s.with?.name === "nightly-attempt-1");
    expect(dl, "a download step for nightly-attempt-1").toBeDefined();
    expect(dl?.if).toBe("github.run_attempt > 1");
    expect(dl?.["continue-on-error"]).toBe(true);
  });

  it("the report command defers the first attempt and reads the previous record; GITHUB_RUN_ATTEMPT is passed", () => {
    const step = stepsOf(wf, "report").find((s) => /nightly-report\.mjs/.test(s.run ?? ""));
    expect(step?.run).toMatch(/--defer-first-attempt/);
    expect(step?.run).toMatch(/--previous \S+/);
    expect(step?.env?.GITHUB_RUN_ATTEMPT).toBe("${{ github.run_attempt }}");
  });

  it("the report job's permissions stay exactly contents: read, issues: write, actions: read", () => {
    expect(wf.jobs.report.permissions).toEqual({ contents: "read", issues: "write", actions: "read" });
  });
});

describe("nightly-tests-rerun.yml (E103, task 6.3)", () => {
  const rerunExists = fs.existsSync(RERUN_FILE);
  const rerunText = rerunExists ? fs.readFileSync(RERUN_FILE, "utf8") : "";
  const rerun = (rerunExists ? parseYaml(rerunText) : { on: {}, jobs: {} }) as Workflow;
  const job = rerun.jobs.rerun;
  const steps = job?.steps ?? [];

  it("exists", () => {
    expect(rerunExists, "nightly-tests-rerun.yml must exist").toBe(true);
  });

  it("triggers only on workflow_run of `Nightly tests`, completed", () => {
    expect(Object.keys(rerun.on)).toEqual(["workflow_run"]);
    expect(rerun.on.workflow_run).toEqual({ workflows: ["Nightly tests"], types: ["completed"] });
    expect(wf.name).toBe("Nightly tests");
  });

  it("holds no permission at the top level and exactly actions: write on the single job", () => {
    expect(rerun.permissions).toEqual({});
    expect(Object.keys(rerun.jobs)).toEqual(["rerun"]);
    expect(job.permissions).toEqual({ actions: "write" });
    expect(job["timeout-minutes"]).toBe(5);
  });

  it("`if:` = failed or cancelled (spike item (h)), first attempt, scheduled, on develop", () => {
    expect(squash(job.if)).toBe(
      "(github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'cancelled') && github.event.workflow_run.run_attempt == 1 && github.event.workflow_run.event == 'schedule' && github.event.workflow_run.head_branch == 'develop'",
    );
  });

  it("checks out nothing, restores no cache and installs nothing", () => {
    const rerunCode = nonComment(rerunText);
    expect(rerunCode).not.toMatch(/actions\/(checkout|cache|setup-node|setup-python|download-artifact)@|pnpm\/action-setup|cache:/);
  });

  it("has exactly two steps: `record` reads the attempt-1 record, `rerun` reruns on deferred == 'true'", () => {
    expect(steps).toHaveLength(2);
    const [record, rr] = steps;
    expect(record.id).toBe("record");
    expect(record.run).toMatch(/gh run download "\$RUN_ID" --name nightly-attempt-1 --dir rec/);
    expect(record.run).toContain("jq -e '.deferred == true' rec/attempt-1.json");
    expect(record.run).toMatch(/deferred=true/);
    expect(record.run).toMatch(/deferred=false/);
    expect(record.run).toMatch(/exit 1/); // an unreadable record fails the step
    expect(rr.if).toBe("steps.record.outputs.deferred == 'true'");
    expect(rr.run).toMatch(/gh run rerun "\$RUN_ID" --failed/);
  });

  it("passes RUN_ID and GH_TOKEN through env; no `${{` appears inside any run script", () => {
    for (const s of steps) {
      expect(s.env?.RUN_ID).toBe("${{ github.event.workflow_run.id }}");
      expect(s.env?.GH_TOKEN).toBe("${{ github.token }}");
      expect(s.run ?? "", "untrusted/expression input must reach the script only via env").not.toContain("${{");
    }
  });

  it("no continue-on-error anywhere (a failed record read must fail the job)", () => {
    expect(rerunText).not.toMatch(/continue-on-error/);
  });
});

describe("nightly-tests-watchdog.yml (E104, task 6.3)", () => {
  const exists2 = fs.existsSync(WATCHDOG_FILE);
  const wtext = exists2 ? fs.readFileSync(WATCHDOG_FILE, "utf8") : "";
  const wd = (exists2 ? parseYaml(wtext) : { on: {}, jobs: {} }) as Workflow;
  const job = wd.jobs.watchdog;
  const steps = job?.steps ?? [];

  it("exists, on cron 47 7 * * * and workflow_dispatch", () => {
    expect(exists2, "nightly-tests-watchdog.yml must exist").toBe(true);
    expect(wd.on.schedule).toEqual([{ cron: "47 7 * * *" }]);
    expect(wd.on).toHaveProperty("workflow_dispatch");
    expect(Object.keys(wd.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  it("top-level permissions are empty; the one job has contents: read, issues: write, actions: read and 10 minutes", () => {
    expect(wd.permissions).toEqual({});
    expect(Object.keys(wd.jobs)).toEqual(["watchdog"]);
    expect(job.permissions).toEqual({ contents: "read", issues: "write", actions: "read" });
    expect(job["timeout-minutes"]).toBe(10);
  });

  it("checks out, sets up Node 26 with no cache, and runs the watchdog (--dry-run when not scheduled)", () => {
    expect(steps.some((s) => s.uses?.startsWith("actions/checkout@"))).toBe(true);
    const node = steps.find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(node?.with?.["node-version"]).toBe(26);
    expect(node?.with ?? {}).not.toHaveProperty("cache");
    expect(nonComment(wtext)).not.toMatch(/actions\/cache@/);
    const command = (s: Step) => squash(s.run);
    const live = steps.find((s) => command(s) === "node scripts/test-selection/nightly-report.mjs --watchdog");
    const dry = steps.find((s) => command(s) === "node scripts/test-selection/nightly-report.mjs --watchdog --dry-run");
    expect(live?.if).toBe("github.event_name == 'schedule'");
    expect(dry?.if).toBe("github.event_name != 'schedule'");
    for (const s of [live, dry]) expect(s?.env?.GITHUB_TOKEN).toBe("${{ github.token }}");
  });
});

describe("nightly timing inequalities (E105/E106, design.md D7 \"Timing\")", () => {
  const today = { C: 180, select: 15, longest: 50, report: 10, R: 5, D: 245, W: 467 };

  it("E105: today's values satisfy both inequalities (A = 75)", () => {
    const t = timingInequalities(today);
    expect(t).toEqual({ A: 75, deadline: true, watchdog: true });
  });

  it("E105: each mutant fails: W = 454, a nightly cron at minute 181, unit timeout 51", () => {
    expect(timingInequalities({ ...today, W: 454 }).watchdog).toBe(false);
    expect(timingInequalities({ ...today, W: 455 }).watchdog).toBe(true);
    expect(timingInequalities({ ...today, C: 181 }).deadline).toBe(false);
    expect(timingInequalities({ ...today, longest: 51 }).deadline).toBe(false);
  });

  it("E106: a 60-minute budget job needs D and W to move together (owner decision C2)", () => {
    const sixty = { ...today, longest: 60 };
    expect(timingInequalities(sixty).A).toBe(85);
    expect(timingInequalities(sixty).deadline).toBe(false); // (a) 245 < 255
    expect(timingInequalities({ ...sixty, W: 475 }).deadline).toBe(false); // (b) only W moved
    expect(timingInequalities({ ...sixty, D: 255, W: 475 })).toEqual({ A: 85, deadline: true, watchdog: true }); // (c)
  });

  it("the checked-in files satisfy both inequalities", () => {
    const rerunDoc = parseYaml(fs.readFileSync(RERUN_FILE, "utf8")) as Workflow;
    const wdDoc = parseYaml(fs.readFileSync(WATCHDOG_FILE, "utf8")) as Workflow;
    const timeout = (j: Job, n: string) => {
      expect(j["timeout-minutes"], `${n} needs timeout-minutes`).toBeGreaterThan(0);
      return j["timeout-minutes"] as number;
    };
    const testJobs = Object.keys(wf.jobs).filter((n) => !["select", "report"].includes(n));
    expect(testJobs.sort()).toEqual(["budget", "ci-scenarios", "real-process", "unit"]);
    const values = {
      C: cronMinuteOfDay((wf.on.schedule as { cron: string }[])[0].cron),
      select: timeout(wf.jobs.select, "select"),
      longest: Math.max(...testJobs.map((n) => timeout(wf.jobs[n], n))),
      report: timeout(wf.jobs.report, "report"),
      R: timeout(rerunDoc.jobs.rerun, "rerun"),
      D: DEFER_DEADLINE_UTC_MINUTE,
      W: cronMinuteOfDay((wdDoc.on.schedule as { cron: string }[])[0].cron),
    };
    const t = timingInequalities(values);
    expect(t.deadline, `D ${values.D} >= C ${values.C} + select ${values.select} + longest ${values.longest}`).toBe(true);
    expect(t.watchdog, `W ${values.W} >= D + report + R + A ${t.A} + 120; a budget timeout above 50 moves D and W together`).toBe(true);
  });
});

describe("no CI retry or rerun outside the nightly (E107)", () => {
  it("only the real-process config sets vitest `retry` (CI ? 1 : 0)", () => {
    const files = execFileSync("git", ["ls-files", "--", "*vitest*.ts", "*vitest*.mts", "*vitest*.mjs", "*vitest*.js"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /(^|\/)vitest[^/]*\.(config|workers|workspace)[^/]*\.[cm]?[tj]s$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const withRetry = files.filter((f) => /^\s*retry\s*:/m.test(nonComment(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))));
    expect(withRetry).toEqual(["packages/server/vitest.real-process.config.ts"]);
    expect(fs.readFileSync(path.join(REPO_ROOT, withRetry[0]), "utf8")).toMatch(/retry:\s*process\.env\.CI \? 1 : 0/);
  });

  it("no workflow reacts to CI with workflow_run or reruns ci.yml", () => {
    for (const f of fs.readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
      const raw = fs.readFileSync(path.join(WORKFLOWS, f), "utf8");
      const doc = parseYaml(raw) as Workflow;
      const trigger = doc.on?.workflow_run as { workflows?: string[] } | undefined;
      if (trigger) expect(trigger.workflows, `${f} workflow_run`).toEqual(["Nightly tests"]);
      for (const j of Object.values(doc.jobs ?? {})) {
        for (const s of j.steps ?? []) {
          if (/gh run rerun/.test(s.run ?? "")) expect(`${f}: ${s.run}`, "gh run rerun must not target ci.yml").not.toMatch(/ci\.yml|workflow=CI/);
        }
      }
    }
  });
});
