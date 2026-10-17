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
import { jobBlock, jobIds } from "./workflow-jobs.js";

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

/** Jobs whose OWN block lacks a job-level (4-space) `timeout-minutes`. */
function jobsWithoutTimeout(text: string): string[] {
  return jobIds(text).filter((id) => !/^ {4}timeout-minutes:/m.test(jobBlock(text, id)));
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
    const active = /^\s{2}schedule:/m.test(yaml);
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

  it("gives every job its own timeout-minutes (the only whole-run budget left)", () => {
    // Per job, not a global count: one job with two timeouts must not mask a
    // sibling with none (#701 review comment). See change: close-e2e-tooling-followups.
    expect(jobIds(yaml)).toEqual(expect.arrayContaining(["e2e", "e2e-browser-relay", "merge-report"]));
    for (const id of ["e2e", "e2e-browser-relay", "merge-report"]) {
      expect(jobBlock(yaml, id), `job \`${id}\` has no job-level timeout-minutes`).toMatch(
        /^ {4}timeout-minutes:/m,
      );
    }
    expect(jobsWithoutTimeout(yaml)).toEqual([]);
  });

  it("flags a job without a timeout even when a sibling carries two", () => {
    const fixture = [
      "on: workflow_dispatch",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 10",
      "    timeout-minutes: 20",
      "  b:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: true",
      "        timeout-minutes: 5",
    ].join("\n");
    expect(jobsWithoutTimeout(fixture)).toEqual(["b"]);
  });

  it("seeds the harness (PI_E2E_SEED) so scenario specs can pin + spawn", () => {
    expect(yaml).toMatch(/PI_E2E_SEED:\s*"?1"?/);
  });

  it("raises the harness boot timeout above the 180s local default", () => {
    // A CI runner has no Docker layer cache, so `test-up.sh --build` is ~6-8 min
    // of build. globalSetup starts its health poll right after spawning the
    // detached build, so the 180s LOCAL default made every shard die at exactly
    // 180s with "container never became healthy". The workflow must override it.
    const m = yaml.match(/PW_E2E_BOOT_TIMEOUT_MS:\s*"?(\d+)"?/);
    expect(m, "ci workflow must set PW_E2E_BOOT_TIMEOUT_MS for the cold build").toBeTruthy();
    expect(Number(m?.[1])).toBeGreaterThan(180_000);
  });

  it("runs the harness in COPY mode on CI (runners refuse the overlay mount)", () => {
    // GitHub-hosted runners reject the entrypoint's `mount -t overlay`
    // ("cannot mount overlay read-only", exit 32) so the container crash-looped
    // 6 times per shard and NEVER answered /api/health. TEST_COPY_MODE=1 is the
    // spec-sanctioned no-added-capability fallback (`cp -a` instead of overlay;
    // test-up.sh then omits compose.test.cap.yml). Costless here: globalSetup
    // boots from an EMPTY throwaway workspace, so the copy source is empty.
    expect(yaml).toMatch(/TEST_COPY_MODE:\s*"1"\s*$/m);
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

  it("uploads the harness failure bundle when the boot never goes healthy", () => {
    // test-up.sh's output ends at "Container ... Started" (compose returns as
    // soon as the container is up), so an entrypoint that then crash-loops left
    // NO diagnosable trace — exactly how the first CI dispatches failed. The
    // shard must upload globalSetup's container state + log snapshot.
    //
    // Structural, not a bare substring match: a comment naming the file would
    // keep `/harness-failure\.log/` green even after the upload step is deleted.
    const lines = yaml.split("\n");
    const header = lines.findIndex((l) => /-\s+name:\s*Upload harness failure bundle/.test(l));
    expect(header, "no `Upload harness failure bundle` step found").toBeGreaterThanOrEqual(0);
    const step = lines.slice(header, header + 8).join("\n");
    expect(step).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    expect(step).toMatch(/path:\s*test-results\/harness-failure\.log/);
  });

  it("parses the managed-run marker as JSON, not via require()", () => {
    // globalSetup writes `JSON.stringify({workspace, pid, logPath})`. `require()`
    // of an extensionless file loads it as JS and throws, so the `|| true` left
    // the workspace empty and this belt-and-braces teardown silently no-op'd on
    // every run — the exact case (a KILLED Playwright process) it exists for.
    expect(yaml).toMatch(/JSON\.parse\(require\('node:fs'\)\.readFileSync\(/);
    expect(yaml).not.toMatch(/require\(['"]\.\/test-results\/\.e2e-managed/);
  });

  it("merges the shard reports into one playwright-report artifact", () => {
    expect(yaml).toMatch(/^\s{2}merge-report:/m);
    expect(yaml).toMatch(/merge-reports/);
    expect(yaml).toMatch(/^\s+name:\s*playwright-report\s*$/m);
  });

  it("does not run merge-report when the label gate SKIPPED the shard job", () => {
    // A bare `if: always()` would run the merge on an unlabeled PR: zero blob
    // artifacts, `merge-reports` fails, red check on every PR — the exact red
    // wall the advisory design exists to avoid. The skip guard is load-bearing.
    const lines = yaml.split("\n");
    const header = lines.findIndex((l) => /^\s{2}merge-report:/.test(l));
    expect(header, "no merge-report job found").toBeGreaterThanOrEqual(0);
    const jobHead = lines.slice(header, header + 8).join("\n");
    expect(jobHead).toMatch(/needs:\s*\[\s*e2e\s*,\s*e2e-browser-relay\s*\]/);
    expect(jobHead).toMatch(/always\(\)\s*&&\s*needs\.e2e\.result\s*!=\s*'skipped'/);
  });

  it("derives the merge toolchain from the repo pin, not a hardcoded literal", () => {
    // Blobs are written by the shards' @playwright/test; a hardcoded merger
    // version drifts on the next pin bump and can reject a newer blob format.
    expect(yaml).not.toMatch(/playwright@\d+\.\d+\.\d+/);
    expect(yaml).toMatch(/pnpm exec playwright merge-reports/);
  });

  it("is advisory on the PR path (continue-on-error), not on dispatch/nightly", () => {
    expect(yaml).toMatch(
      /continue-on-error:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
  });

  it("keeps merge-report advisory on the PR path too", () => {
    // A bare (non-advisory) merge job reds a PR whose shards all died before
    // their blob reporter produced a directory: `download-artifact` matches
    // nothing and this job fails — the red wall the advisory design exists to
    // avoid.
    const lines = yaml.split("\n");
    const header = lines.findIndex((l) => /^\s{2}merge-report:/.test(l));
    const body = lines.slice(header, lines.findIndex((l, i) => i > header && /^\s{2}[a-zA-Z][\w-]*:\s*$/.test(l)));
    expect(body.join("\n")).toMatch(
      /continue-on-error:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
  });
});

describe("ci-e2e-browser.yml — browser-relay variant leg", () => {
  // The relay spec needs a harness booted with PI_BROWSER_RELAY_FAKE=1, and that
  // faucet cannot be a shared-harness default (a live relay occludes the chat
  // for every other spec — systemic cause S2). So it gets its own leg. Without
  // one, `browser-relay.spec.ts` skips in EVERY shard and the file's coverage
  // disappears with nothing tracking it — the invisible-hole class this
  // change's `e2e-fixme-guard` exists to prevent.
  const job = jobBlock(yaml, "e2e-browser-relay");

  it("exists, so the relay spec is not silently dropped from CI", () => {
    expect(
      job,
      "no `e2e-browser-relay` job — tests/e2e/browser-relay.spec.ts would never run in CI",
    ).not.toBe("");
  });

  it("boots the harness with the relay faucet and runs only the relay spec", () => {
    expect(job).toMatch(/PI_BROWSER_RELAY_FAKE:\s*"?1"?/);
    expect(job).toMatch(/tests\/e2e\/browser-relay\.spec\.ts/);
    // The faucet is mandatory here, so this leg needs the seed too.
    expect(job).toMatch(/PI_E2E_SEED:\s*"?1"?/);
    expect(job).toMatch(/blob-report-relay/);
  });

  it("is bounded, label-gated, advisory on the PR path, and tears down always", () => {
    expect(job).toMatch(/^\s{4}timeout-minutes:/m);
    expect(job).toMatch(
      /contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'e2e-browser'\)/,
    );
    expect(job).toMatch(
      /continue-on-error:\s*\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/,
    );
    expect(job).toMatch(/-\s+name:\s*Tear down harness/);
    expect(job).toMatch(/docker\/test-down\.sh/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variant legs `e2e-team` / `e2e-identity-matrix` (change: add-missing-ci-legs,
// #861). The pure check below takes the three artifacts as strings so every
// failure class is exercised on a mutated copy of the real workflow.
// ─────────────────────────────────────────────────────────────────────────────

const DOCKERFILE = fs.readFileSync(path.join(REPO_ROOT, "docker", "Dockerfile"), "utf8");
const PLAYWRIGHT_CONFIG = fs.readFileSync(path.join(REPO_ROOT, "playwright.config.ts"), "utf8");

const TEAM_BUILD = "build:app --workspace=@blackbelt-technology/pi-dashboard-team-plugin";
const REPORT_NAME: Record<string, string> = {
  "e2e-team": "playwright-report-team",
  "e2e-identity-matrix": "playwright-report-identity-matrix",
};
const LEG_CONFIG: Record<string, string> = {
  "e2e-team": "playwright.team.config.ts",
  "e2e-identity-matrix": "playwright.identity-matrix.config.ts",
};

/** Normalised job-level `if:` expression of `id` ("" when absent). */
function jobIf(block: string): string {
  const m = block.match(/^ {4}if:\s*>-?\n((?: {6}.*\n?)+)/m) ?? block.match(/^ {4}if:\s*(.+)$/m);
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** The exact `continue-on-error:` line of a job ("" when absent). */
function jobContinueOnError(block: string): string {
  return block.match(/^ {4}continue-on-error:.*$/m)?.[0].trim() ?? "";
}

/** Pinned `pi-coding-agent@<v>` literal in a text, or null. */
function piPin(text: string): string | null {
  return text.match(/@earendil-works\/pi-coding-agent@(\S+)/)?.[1] ?? null;
}

/** Every contract violation of the two variant legs; each names job id + clause. */
export function variantLegViolations(workflow: string, dockerfile: string, config: string): string[] {
  const out: string[] = [];
  const shard = jobBlock(workflow, "e2e");
  const shardIf = jobIf(shard);
  const shardCoe = jobContinueOnError(shard);
  const ignoresTeam = /testIgnore:[^\]]*tests\/e2e\/team\/\*\*/.test(config);
  const ignoresIdentity = /testIgnore:[^\]]*tests\/e2e\/identity-matrix\/\*\*/.test(config);

  for (const id of Object.keys(LEG_CONFIG)) {
    const block = jobBlock(workflow, id);
    if (block === "") {
      // Spike-fallback shape (design D3): team leg + its testIgnore entry may be
      // absent TOGETHER; the identity leg is unconditional.
      if (id !== "e2e-team" || ignoresTeam) out.push(`${id}: job missing`);
      continue;
    }
    if (jobIf(block) !== shardIf) out.push(`${id}: \`if:\` gate differs from the shard matrix's`);
    if (jobContinueOnError(block) !== shardCoe) out.push(`${id}: \`continue-on-error\` differs from the shard matrix's`);
    if (!/^ {4}timeout-minutes:\s*\d+\s*$/m.test(block)) out.push(`${id}: timeout-minutes missing`);

    const runAt = block.search(/playwright test\b/);
    const buildClient = block.search(/run:\s*pnpm run build\s*$/m);
    if (buildClient === -1 || (runAt !== -1 && buildClient > runAt)) out.push(`${id}: \`pnpm run build\` step missing or after playwright test`);
    if (id === "e2e-team") {
      const teamBuild = block.search(new RegExp(`run:\\s*npm run ${TEAM_BUILD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
      if (teamBuild === -1 || (runAt !== -1 && teamBuild > runAt)) out.push(`${id}: team-app build step missing or after playwright test (no reliance on pretest:*)`);
    }

    const pin = piPin(block);
    const dockerPin = piPin(dockerfile);
    if (pin !== dockerPin) out.push(`${id}: pi pin \`${pin}\` != docker/Dockerfile pin \`${dockerPin}\``);

    if (!block.includes(`--config ${LEG_CONFIG[id]}`)) out.push(`${id}: does not run ${LEG_CONFIG[id]}`);
    if (!/--reporter=list,html\b/.test(block)) out.push(`${id}: no \`--reporter=list,html\` (own HTML report)`);
    const upload = block.match(/- name: Upload HTML report\n((?: {8}.*\n?)+)/)?.[1] ?? "";
    if (!/if:\s*\$\{\{\s*always\(\)\s*\}\}/.test(upload)) out.push(`${id}: report upload missing or not \`if: always()\``);
    const artifact = upload.match(/name:\s*(\S+)/)?.[1];
    if (artifact !== REPORT_NAME[id]) out.push(`${id}: report artifact \`${artifact}\` must be named \`${REPORT_NAME[id]}\``);
  }

  const needs = jobBlock(workflow, "merge-report").match(/^ {4}needs:\s*\[([^\]]*)\]/m)?.[1].replace(/\s+/g, "");
  if (needs !== "e2e,e2e-browser-relay") out.push(`merge-report: needs must stay [e2e, e2e-browser-relay] (got [${needs}])`);

  // Cross-read with playwright.config.ts: ownership must match the legs that exist.
  const hasTeamJob = jobBlock(workflow, "e2e-team") !== "";
  if (ignoresTeam && !hasTeamJob) out.push("tests/e2e/team ignored but no leg runs playwright.team.config.ts");
  if (!ignoresTeam && hasTeamJob) out.push("e2e-team exists but the default config still collects tests/e2e/team");
  if (!ignoresIdentity) out.push("tests/e2e/identity-matrix not ignored by the default config (double run)");
  return out;
}

describe("ci-e2e-browser.yml — team / identity-matrix variant legs (#861)", () => {
  const check = (wf = yaml, df = DOCKERFILE, cfg = PLAYWRIGHT_CONFIG) => variantLegViolations(wf, df, cfg);
  const mutate = (from: string | RegExp, to: string, text = yaml): string => {
    const next = text.replace(from, to);
    expect(next, "fixture mutation did not change the workflow").not.toBe(text);
    return next;
  };
  /** Mutate only inside one job block. */
  const mutateJob = (id: string, from: string | RegExp, to: string): string => {
    const block = jobBlock(yaml, id);
    return yaml.replace(block, mutate(from, to, block));
  };

  it("the real workflow satisfies the whole variant-leg contract", () => {
    expect(check()).toEqual([]);
  });

  it("(E1) a deleted leg fails naming the job id", () => {
    for (const id of ["e2e-team", "e2e-identity-matrix"]) {
      const without = yaml.replace(jobBlock(yaml, id), "");
      expect(check(without).join("\n")).toContain(`${id}: job missing`);
    }
  });

  it("(E2) the gate and continue-on-error must be the shard matrix's verbatim copy", () => {
    expect(check(mutateJob("e2e-team", /\n {6}contains\(github\.event\.pull_request\.labels\.\*\.name, 'e2e-browser'\)/, "\n      true")).join("\n")).toContain("e2e-team: `if:` gate");
    expect(check(mutateJob("e2e-team", /continue-on-error:.*/, "continue-on-error: true")).join("\n")).toContain("e2e-team: `continue-on-error`");
    expect(check(mutateJob("e2e-identity-matrix", /\n {4}continue-on-error:.*/, "")).join("\n")).toContain("e2e-identity-matrix: `continue-on-error`");
  });

  it("(E4) explicit, correctly ordered build steps — identity needs no team build", () => {
    expect(check(mutateJob("e2e-team", /\n {6}- name: Build team app\n.*\n.*\n/, "\n")).join("\n")).toContain("e2e-team: team-app build");
    // `pnpm run build` moved after the playwright step
    const block = jobBlock(yaml, "e2e-team");
    const buildStep = block.match(/ {6}- name: Build client\n.*\n/)![0];
    const moved = block.replace(buildStep, "").replace(/(\n {6}- name: Upload HTML report)/, `\n${buildStep.trimEnd()}$1`);
    expect(check(yaml.replace(block, moved)).join("\n")).toContain("e2e-team: `pnpm run build`");
    // identity leg carries no team build and still passes
    expect(jobBlock(yaml, "e2e-identity-matrix")).not.toContain("build:app");
    expect(check().filter((v) => v.startsWith("e2e-identity-matrix"))).toEqual([]);
  });

  it("(E5) every variant leg declares timeout-minutes", () => {
    expect(check(mutateJob("e2e-identity-matrix", /\n {4}timeout-minutes:.*/, "")).join("\n")).toContain("e2e-identity-matrix: timeout-minutes missing");
  });

  it("(E3) the pi pin equals the Dockerfile pin exactly; the package.json floor is never consulted", () => {
    const dockerLiteral = piPin(DOCKERFILE);
    expect(dockerLiteral, "docker/Dockerfile no longer pins pi").toMatch(/^\d+\.\d+\.\d+$/);
    for (const wrong of ["1.1.1", "1.0.9", "latest", ">=1.1.0"]) {
      const v = check(mutateJob("e2e-team", /pi-coding-agent@\S+/, `pi-coding-agent@${wrong}`)).join("\n");
      expect(v).toContain(`pi pin \`${wrong}\` != docker/Dockerfile pin \`${dockerLiteral}\``);
    }
    const unpinned = check(mutateJob("e2e-team", /pi-coding-agent@\S+/, "pi-coding-agent")).join("\n");
    expect(unpinned).toContain("pi pin `null`");
    // Dockerfile bumped, workflow not → fails naming both literals.
    const bumped = DOCKERFILE.replace(`pi-coding-agent@${dockerLiteral}`, "pi-coding-agent@1.2.0");
    expect(check(yaml, bumped).join("\n")).toContain(`\`${dockerLiteral}\` != docker/Dockerfile pin \`1.2.0\``);
  });

  it("(E34) each variant leg publishes its own HTML report and stays out of merge-report", () => {
    expect(check(mutateJob("e2e-team", "--reporter=list,html", "--reporter=list")).join("\n")).toContain("e2e-team: no `--reporter=list,html`");
    const noUpload = jobBlock(yaml, "e2e-team").replace(/ {6}- name: Upload HTML report\n(?: {8}.*\n?)+/, "");
    expect(check(yaml.replace(jobBlock(yaml, "e2e-team"), noUpload)).join("\n")).toContain("e2e-team: report upload missing");
    expect(check(mutateJob("e2e-team", /(Upload HTML report\n {8}if: )\$\{\{ always\(\) \}\}/, "$1success()")).join("\n")).toContain("not `if: always()`");
    expect(check(mutateJob("e2e-team", "name: playwright-report-team", "name: blob-report-team")).join("\n")).toContain("`blob-report-team` must be named `playwright-report-team`");
    expect(check(mutateJob("e2e-identity-matrix", "name: playwright-report-identity-matrix", "name: playwright-report")).join("\n")).toContain("e2e-identity-matrix: report artifact `playwright-report`");
    expect(check(mutate("needs: [e2e, e2e-browser-relay]", "needs: [e2e, e2e-browser-relay, e2e-team]")).join("\n")).toContain("merge-report: needs must stay");
  });

  it("(E8) the workflow legs and the default config's testIgnore agree", () => {
    const both = PLAYWRIGHT_CONFIG;
    expect(check(yaml, DOCKERFILE, both)).toEqual([]);
    // (b) spike-fallback shape: identity only — no team job, no team ignore entry
    const noTeamJob = yaml.replace(jobBlock(yaml, "e2e-team"), "");
    const identityOnlyCfg = both.replace(', "tests/e2e/team/**"', "");
    expect(identityOnlyCfg).not.toBe(both);
    expect(check(noTeamJob, DOCKERFILE, identityOnlyCfg)).toEqual([]);
    // (c) team ignored but no leg runs it
    expect(check(noTeamJob, DOCKERFILE, both).join("\n")).toContain("tests/e2e/team ignored but no leg runs playwright.team.config.ts");
    // (d) identity ignore removed
    const noIdentityIgnore = both.replace(', "tests/e2e/identity-matrix/**"', "");
    expect(check(yaml, DOCKERFILE, noIdentityIgnore).join("\n")).toContain("tests/e2e/identity-matrix not ignored");
  });
});
