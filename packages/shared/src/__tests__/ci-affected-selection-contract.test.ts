/**
 * Repo-lint: `ci.yml` computes an affected-test selection (change:
 * speed-up-ci-affected-tests, D5; test-plan E30).
 *
 * The `select` job needs full history (`fetch-depth: 0`) for BOTH event kinds:
 * a shallow clone has no merge-base for a PR and no `before` SHA for a push,
 * and either silently degrades every run to `full`. The selection must reach
 * the run page as the `test-selection` artifact — it is the only record of
 * what CI skipped.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
// @ts-expect-error — untyped .mjs module; only the numeric constant is read.
import { SHARD_COUNT } from "../../../../scripts/test-selection/decide.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const CI_TEXT = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; id?: string };
type Job = { needs?: string | string[]; if?: string; steps?: Step[]; strategy?: { matrix?: Record<string, unknown> }; outputs?: Record<string, string> };
const CI = parseYaml(CI_TEXT) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
  concurrency?: Record<string, unknown>;
  permissions?: Record<string, string>;
};

const steps = (job: string): Step[] => CI.jobs[job]?.steps ?? [];
const runs = (job: string): string => steps(job).map((s) => s.run ?? "").join("\n");
const needsOf = (job: string): string[] => [CI.jobs[job]?.needs ?? []].flat();
/** Non-comment workflow text. */
const CODE = CI_TEXT.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("ci.yml — select job", () => {
  it("exists and checks out full history", () => {
    const checkout = steps("select").find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout, "select must check out the repo").toBeDefined();
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("runs the selector and uploads the test-selection artifact", () => {
    const runs = steps("select").map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/node scripts\/select-affected-tests\.mjs/);
    expect(runs).toMatch(/--merge-base/);
    expect(runs).toMatch(/--full/);
    const upload = steps("select").find((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.with?.name).toBe("test-selection");
  });

  it("reads the ci:full label from the pull request, and dispatch is always full", () => {
    expect(CI_TEXT).toMatch(/ci:full/);
    expect(CI_TEXT).toMatch(/workflow_dispatch/);
  });

  it("exposes mode, has_real_process and ci_scenarios as job outputs", () => {
    expect(Object.keys(CI.jobs.select.outputs ?? {}).sort()).toEqual(["ci_scenarios", "has_real_process", "mode"]);
  });

  it("the guards job keeps its name `ci`", () => {
    expect(CI.jobs.ci).toBeDefined();
  });
});

describe("ci.yml — parallel, selector-driven test jobs (E30)", () => {
  const TEST_JOBS = ["unit", "real-process", "ci-scenarios"];

  it("ci-result needs EVERY job, including select, runs always and runs check-result", () => {
    const others = Object.keys(CI.jobs).filter((j) => j !== "ci-result").sort();
    expect(needsOf("ci-result").sort()).toEqual(others);
    expect(needsOf("ci-result")).toContain("select");
    expect(CI.jobs["ci-result"].if).toMatch(/always\(\)/);
    expect(runs("ci-result")).toMatch(/scripts\/test-selection\/check-result\.mjs/);
    expect(CI_TEXT).toMatch(/NEEDS_JSON:\s*\$\{\{\s*toJSON\(needs\)\s*\}\}/);
  });

  it("the unit matrix length equals the selector's SHARD_COUNT", () => {
    expect(CI.jobs.unit.strategy?.matrix?.shard as number[] | undefined).toHaveLength(SHARD_COUNT);
  });

  it("every test job needs select, and the guards job `ci` needs no test job", () => {
    for (const j of TEST_JOBS) expect(needsOf(j)).toContain("select");
    for (const j of TEST_JOBS) expect(needsOf("ci")).not.toContain(j);
  });

  it("the pull_request trigger keeps the default types (no `labeled`)", () => {
    const pr = CI.on.pull_request as { types?: string[] } | null;
    expect(pr?.types ?? []).not.toContain("labeled");
  });

  it("concurrency is PR-scoped and never cancels a push", () => {
    expect(String(CI.concurrency?.group)).toMatch(/github\.event\.pull_request\.number/);
    expect(String(CI.concurrency?.["cancel-in-progress"])).toMatch(/github\.event_name == 'pull_request'/);
  });

  it("no job runs an unfiltered `pnpm test` or a bare `test:ci-scenarios`", () => {
    expect(CODE).not.toMatch(/run:\s*pnpm test\s*$/m);
    expect(CODE).not.toMatch(/pnpm run test:ci-scenarios\s*$/m);
    for (const j of ["ci", "docker-plugin-load", "music-pytest"]) expect(runs(j)).not.toMatch(/pnpm (run )?test\b/);
  });

  it("shards run through test:parallel / test:real-process / test:ci-scenarios with the assigned files", () => {
    expect(runs("unit")).toMatch(/pnpm run test:parallel "\$\{FILES\[@\]\}"/);
    expect(runs("real-process")).toMatch(/pnpm run test:real-process "\$\{FILES\[@\]\}"/);
    expect(runs("ci-scenarios")).toMatch(/pnpm run test:ci-scenarios "\$\{FILES\[@\]\}"/);
  });

  it("each unit shard installs chromium, asserts the built client, and verifies what it executed", () => {
    expect(runs("unit")).toMatch(/playwright install chromium/);
    expect(runs("unit")).toMatch(/packages\/client\/dist\/index\.html/);
    for (const [job, key] of [["unit", "unit-"], ["real-process", "real-process"], ["ci-scenarios", "ci-scenarios"]]) {
      expect(runs(job)).toMatch(new RegExp(`verify-executed\\.mjs selection\\.json "?${key}`));
    }
  });

  it("real-process and ci-scenarios run only when the selection expects them", () => {
    expect(CI.jobs["real-process"].if).toMatch(/needs\.select\.outputs\.has_real_process == 'true'/);
    expect(CI.jobs["ci-scenarios"].if).toMatch(/needs\.select\.outputs\.ci_scenarios == 'true'/);
  });

  it("the workflow token is read-only by default", () => {
    expect(CI.permissions).toEqual({ contents: "read" });
  });

  it("the guards job no longer installs chromium or runs the suite", () => {
    expect(runs("ci")).not.toMatch(/playwright install/);
  });
});

describe("publish.yml release gate is the FULL suite", () => {
  const PUB = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "publish.yml"), "utf8");
  it("ci-checks runs `pnpm test` and no longer claims to mirror ci.yml's ci job", () => {
    const pub = parseYaml(PUB) as { jobs: Record<string, Job> };
    expect(pub.jobs["ci-checks"].steps?.map((s) => s.run ?? "").join("\n")).toMatch(/pnpm test/);
    expect(PUB).not.toMatch(/Mirrors `ci\.yml`'s `ci` job/);
  });
});
