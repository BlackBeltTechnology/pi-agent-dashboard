/**
 * Workflow contract for the sharded browser-E2E CI job (change:
 * stabilize-browser-e2e, task 3.1; issue #433 part 2).
 *
 * `tests/e2e/` is 168+ specs against the Docker harness. It is the strongest
 * gate on the ship-it path but nothing ran it on develop, so the baseline
 * drifted red unnoticed. The new workflow must be a COORDINATED set of shards,
 * not a single unbounded job:
 *
 *   - triggers: `workflow_dispatch` (on demand, optional `shards` input),
 *     `pull_request` GATED on the `e2e-browser` label (no per-PR cost by
 *     default), and a `schedule` cron that lands DARK until the baseline is
 *     green — exactly one of active/commented, never both;
 *   - NO `push` trigger (the PR path is label-opt-in and cost-bounded);
 *   - the matrix `shard` list length MUST equal every `--shard=i/N` denominator,
 *     or a shard silently runs no specs;
 *   - every job carries `timeout-minutes` — this is the ONLY whole-run budget
 *     once `playwright.config.ts` drops `globalTimeout` (#450);
 *   - the harness is torn down `if: always()` (a shard that dies must not leak a
 *     4 GiB container into the next matrix leg on a reused runner);
 *   - a `merge-report` job joins the per-shard `blob` reports into one HTML
 *     artifact, so a sharded run still yields ONE verdict;
 *   - the PR path is `continue-on-error` — the workflow is ADVISORY until two
 *     clean nightlies, then flipped in a separate change.
 *
 * Pattern: packages/shared/src/__tests__/nightly-workflow-contract.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci-e2e-browser.yml");

const yaml = fs.readFileSync(WORKFLOW, "utf8");

/** Non-comment lines only (drops YAML full-line `#` comments). */
function codeLines(text: string): string[] {
  return text.split("\n").filter((l) => !/^\s*#/.test(l));
}
const code = codeLines(yaml);

function count(re: RegExp): number {
  return (yaml.match(re) ?? []).length;
}

describe("ci-e2e-browser.yml — triggers", () => {
  it("supports workflow_dispatch (with a shards input for experiments)", () => {
    expect(code.some((l) => /^\s{2}workflow_dispatch:/.test(l))).toBe(true);
    expect(yaml).toMatch(/^\s{6}shards:/m);
  });

  it("gates the pull_request trigger on the e2e-browser label", () => {
    expect(code.some((l) => /^\s{2}pull_request:/.test(l))).toBe(true);
    expect(yaml).toMatch(
      /contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'e2e-browser'\)/,
    );
  });

  it("has no push trigger (the label opt-in bounds per-PR cost)", () => {
    const offenders = code.filter((l) => /^\s{2}push:/.test(l));
    expect(offenders, "ci-e2e-browser.yml must not run on push").toEqual([]);
  });

  it("declares the schedule cron in exactly one of active / land-dark form", () => {
    const active = /^schedule:/m.test(yaml);
    const dark = /^\s*#\s*schedule:/m.test(yaml);
    expect(
      active !== dark,
      `schedule must be either active or commented as land-dark, never both ` +
        `(active=${active}, dark=${dark})`,
    ).toBe(true);

    if (active) {
      expect(yaml, "an active schedule needs a cron").toMatch(
        /^\s{2}-\s+cron:\s*'[^']+'/m,
      );
    } else {
      // Land-dark is a decision, not an accident: the comment must say when to
      // flip it on, mirroring nightly.yml.
      expect(yaml, "land-dark schedule must document the enabling condition").toMatch(
        /uncomment|after .*(green|baseline)|task 5\.5/i,
      );
    }
  });
});

describe("ci-e2e-browser.yml — shard matrix", () => {
  const shardList = (yaml.match(/^\s*shard:\s*\[([0-9,\s]+)\]/m)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  it("declares a non-empty shard matrix", () => {
    expect(shardList.length).toBeGreaterThan(1);
  });

  it("every --shard=i/N denominator equals the matrix length", () => {
    const denominators = [
      ...yaml.matchAll(/--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(
      denominators.length,
      "no `--shard=${{ matrix.shard }}/N` invocation found",
    ).toBeGreaterThan(0);
    for (const d of denominators) {
      expect(
        d,
        `--shard denominator ${d} must equal the matrix length ${shardList.length}`,
      ).toBe(shardList.length);
    }
  });

  it("gives every job a timeout-minutes (the only whole-run budget left)", () => {
    const runsOn = count(/^\s+runs-on:/gm);
    const timeouts = count(/^\s+timeout-minutes:/gm);
    expect(runsOn).toBeGreaterThan(0);
    expect(timeouts).toBeGreaterThanOrEqual(runsOn);
  });

  it("seeds the harness (PI_E2E_SEED) so scenario specs can pin + spawn", () => {
    expect(yaml).toMatch(/PI_E2E_SEED:\s*"?1"?/);
  });
});

describe("ci-e2e-browser.yml — teardown + merged report", () => {
  it("tears the harness down on a step that always runs", () => {
    expect(count(/\$\{\{\s*always\(\)\s*\}\}/g)).toBeGreaterThanOrEqual(2);
    expect(yaml).toMatch(/docker\/test-down\.sh/);
    // The down step itself must not be gated on success: look at the step
    // header (`- name: Tear down harness`) and the few lines that follow it
    // rather than a fixed-width window (the run: block is long).
    const lines = yaml.split("\n");
    const header = lines.findIndex((l) => /-\s+name:\s*Tear down harness/.test(l));
    expect(header, "no `Tear down harness` step found").toBeGreaterThanOrEqual(0);
    expect(lines.slice(header, header + 5).join("\n")).toMatch(
      /if:\s*\$\{\{\s*always\(\)\s*\}\}/,
    );
  });

  it("uploads each shard's blob report", () => {
    expect(yaml).toMatch(/blob-report/);
    expect(yaml).toMatch(/upload-artifact@v\d/);
  });

  it("merges the shard reports into one playwright-report artifact", () => {
    expect(yaml).toMatch(/^\s{2}merge-report:/m);
    expect(yaml).toMatch(/merge-reports/);
    expect(yaml).toMatch(/^\s+name:\s*playwright-report\s*$/m);
  });

  it("is advisory on the PR path (continue-on-error), not on dispatch/nightly", () => {
    expect(yaml).toMatch(
      /continue-on-error:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
  });
});
