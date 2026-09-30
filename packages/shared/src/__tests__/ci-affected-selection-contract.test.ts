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

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const CI_TEXT = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; id?: string };
type Job = { needs?: string | string[]; if?: string; steps?: Step[]; strategy?: { matrix?: Record<string, unknown> }; outputs?: Record<string, string> };
const CI = parseYaml(CI_TEXT) as { on: Record<string, unknown>; jobs: Record<string, Job>; concurrency?: Record<string, unknown> };

const steps = (job: string): Step[] => CI.jobs[job]?.steps ?? [];

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
