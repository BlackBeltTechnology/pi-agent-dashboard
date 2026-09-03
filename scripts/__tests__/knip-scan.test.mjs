/**
 * Live Knip scan assertions (test-plan #G3, #G5, #G6, #D2, #D3, #P1).
 *
 * `ci`-level, behind RUN_CI_SCENARIOS=1 and run by `npm run test:ci-scenarios`
 * (ci.yml), following the precedent in dependency-declarations.test.mjs: this
 * burns ~8s of CPU across the whole workspace, and left in the default parallel
 * run it starves unrelated 5s-timeout tests, which fails the suite somewhere
 * else entirely — a far worse signal than the check is worth.
 *
 * One scan, many assertions: re-running Knip per assertion would multiply the
 * cost for no extra coverage.
 *
 * See change: add-knip-dead-code-oracle.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { countIssues, GATED_CLASSES } from "../knip-ratchet.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const SCAN_TIMEOUT_MS = 180_000;

describe.skipIf(!CI_SCENARIOS)("live knip scan", () => {
  let report;
  let unusedFiles;
  let elapsedMs;

  beforeAll(() => {
    const started = Date.now();
    let raw;
    try {
      // Non-zero exit is the normal state while the baseline is above zero.
      raw = execSync("npx knip --reporter json --no-progress", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      raw = err.stdout ?? "";
    }
    elapsedMs = Date.now() - started;
    report = JSON.parse(raw);
    unusedFiles = new Set((report.issues ?? []).filter((e) => (e.files ?? []).length > 0).map((e) => e.file));
  }, SCAN_TIMEOUT_MS);

  it("#G3 does not report an application entry as unused", () => {
    for (const entry of [
      "packages/client/src/main.tsx",
      "packages/electron/src/main.ts",
      "packages/electron/src/preload.ts",
      "packages/server/src/cli.ts",
    ]) {
      expect(unusedFiles, `${entry} is an application entry`).not.toContain(entry);
    }
  });

  it("#G5 does not report a shell-invoked script as unused", () => {
    // Measured false positives before scripts/** was rooted.
    for (const script of ["scripts/ab-context/extract.mjs", "scripts/lib/smoke-spawn-session.mjs"]) {
      expect(unusedFiles, `${script} is invoked from a shell script`).not.toContain(script);
    }
  });

  it("#G6 does not report a directly-imported module as unused", () => {
    // canvas-tool.ts is imported by bridge.ts; the unrooted spike called it dead.
    for (const mod of [
      "packages/extension/src/canvas-tool.ts",
      "packages/flows-plugin/src/bridge/flow-question-adapter.ts",
    ]) {
      expect(unusedFiles, `${mod} is imported directly`).not.toContain(mod);
    }
  });

  it("#D2 reports zero findings in every dependency class", () => {
    const depClasses = ["unlisted", "binaries", "dependencies", "devDependencies", "optionalPeerDependencies", "unresolved"];
    for (const cls of depClasses) {
      const total = (report.issues ?? []).reduce((n, e) => n + (Array.isArray(e[cls]) ? e[cls].length : 0), 0);
      expect(total, `${cls} is owned by Biome, not Knip`).toBe(0);
    }
  });

  it("#D3 does not re-litigate a Biome-exempted tree", () => {
    // biome.json exempts **/__tests__/**, **/vitest.config.ts, tests/e2e/**,
    // qa/scripts/**, .pi/skills/**/scripts/** from noUndeclaredDependencies.
    // Knip must not report dependency findings there either.
    const exempt = /(__tests__|vitest\.config|^tests\/e2e\/|^qa\/scripts\/|^\.pi\/skills\/)/;
    const offenders = (report.issues ?? [])
      .filter((e) => exempt.test(e.file))
      .filter((e) => ["unlisted", "devDependencies", "dependencies", "binaries"].some((c) => (e[c] ?? []).length > 0));
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("#P1 completes within the 30s budget", () => {
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it("reports a count for every gated class", () => {
    const counts = countIssues(report);
    for (const cls of GATED_CLASSES) expect(typeof counts[cls]).toBe("number");
  });
});
