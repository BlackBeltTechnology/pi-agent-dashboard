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
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const FILE = path.join(REPO_ROOT, ".github", "workflows", "nightly-tests.yml");

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; steps?: Step[]; strategy?: { matrix?: Record<string, unknown> } };
type Workflow = { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };

const exists = fs.existsSync(FILE);
const text = exists ? fs.readFileSync(FILE, "utf8") : "";
const wf = (exists ? parseYaml(text) : { on: {}, jobs: {} }) as Workflow;
/** Non-comment lines only. */
const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
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

  it("grants issues:write and actions:read, nothing broader for contents", () => {
    expect(wf.permissions?.issues).toBe("write");
    expect(wf.permissions?.actions).toBe("read");
    expect(wf.permissions?.contents).toBe("read");
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
    for (const [job, key] of [["real-process", "real-process"], ["ci-scenarios", "ci-scenarios"]] as const) {
      expect(runs(job)).toMatch(new RegExp(`verify-executed\\.mjs selection\\.json ${key}`));
    }
    for (const job of ["unit", "real-process", "ci-scenarios"]) {
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
    expect(needsOf("report").sort()).toEqual(["ci-scenarios", "real-process", "select", "unit"]);
    expect(runs("report")).toMatch(/nightly-report\.mjs/);
  });

  it("never publishes, tags or releases", () => {
    expect(code).not.toMatch(/npm publish|pnpm publish/);
    expect(code).not.toMatch(/action-gh-release|gh release/);
    expect(code).not.toMatch(/git push|git tag/);
  });
});
