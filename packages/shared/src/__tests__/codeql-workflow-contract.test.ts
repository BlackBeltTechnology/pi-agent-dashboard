/**
 * Static contract for `.github/workflows/codeql.yml` (test-plan #E1).
 *
 * The advanced-setup workflow replaces GitHub's default setup, so its
 * categories MUST equal the ones default setup used (otherwise the 38 existing
 * alert dismissals are orphaned), it MUST read the same config the local ratchet
 * reads, and it MUST NOT add an install or cache step (a cache step would be a
 * new actions/cache-poisoning site; build-mode none needs no install).
 *
 * See change: add-local-codeql-ratchet.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Wf = {
  on?: Record<string, { branches?: string[] } | Array<{ cron?: string }> | undefined>;
  permissions?: Record<string, string>;
  jobs?: Record<string, { strategy?: { matrix?: { language?: string[] } }; steps?: Step[] }>;
};

const wf = parseYaml(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "codeql.yml"), "utf8")) as Wf;
const jobs = Object.values(wf.jobs ?? {});
const steps = jobs.flatMap((j) => j.steps ?? []);
const stepUsing = (prefix: string) => steps.find((s) => s.uses?.startsWith(prefix));

describe("codeql.yml contract (#E1)", () => {
  it("analyses exactly actions, javascript-typescript and python", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0].strategy?.matrix?.language).toEqual(["actions", "javascript-typescript", "python"]);
  });

  it("pins the analyze category to default setup's /language:<language>", () => {
    expect(stepUsing("github/codeql-action/analyze")?.with?.category).toBe("/language:${{ matrix.language }}");
  });

  it("init reads the shared config, in build mode none", () => {
    const init = stepUsing("github/codeql-action/init");
    expect(init?.with?.["config-file"]).toBe("./.github/codeql/codeql-config.yml");
    expect(init?.with?.["build-mode"]).toBe("none");
    expect(fs.existsSync(path.join(repoRoot, ".github", "codeql", "codeql-config.yml"))).toBe(true);
  });

  it("runs on develop pushes, develop pull requests and a schedule", () => {
    expect((wf.on?.push as { branches?: string[] })?.branches).toEqual(["develop"]);
    expect((wf.on?.pull_request as { branches?: string[] })?.branches).toEqual(["develop"]);
    const schedule = wf.on?.schedule;
    expect(Array.isArray(schedule) ? schedule.length : 0).toBeGreaterThan(0);
  });

  it("can upload results: top-level security-events write", () => {
    expect(wf.permissions?.["security-events"]).toBe("write");
  });

  it("has no cache step and no dependency install step", () => {
    for (const s of steps) {
      expect(s.uses ?? "").not.toMatch(/^actions\/cache/);
      expect(s.run ?? "").not.toMatch(/\b(pnpm|npm|yarn)\s+(install|ci|i)\b/);
      expect(Object.keys(s.with ?? {})).not.toEqual(expect.arrayContaining(["cache"]));
    }
  });
});
