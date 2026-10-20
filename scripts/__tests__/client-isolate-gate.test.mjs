/**
 * Gate for `isolate: false` on the jsdom client project (test-plan F1, F2, F3, P2).
 *
 * `isolate: false` may only be set while the suite is order-independent and not slower than the
 * isolated baseline. This file makes that a fact, not a comment:
 *  - while the config keeps the default `isolate: true` (the current decision; measurements are in
 *    the archived change's design.md), it asserts the decision is recorded in the config and
 *    nothing else runs;
 *  - the moment someone sets `isolate: false`, the `RUN_CI_SCENARIOS` block runs the shuffled
 *    and repeated client runs that must be green (F1, P2), and fails the build if they are not.
 *
 * See change: test-trust-audit (design D6, D8).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const config = readFileSync(resolve(REPO_ROOT, "packages/client/vitest.config.ts"), "utf8");
// Isolated baseline (design.md `## Measurements`): 48.4 s wall for the jsdom client project.
const ISOLATED_BASELINE_MS = 48_400;
const adopted = /^\s*isolate:\s*false\b/m.test(config.replace(/\/\/.*$/gm, ""));

function runClient(extra) {
  const started = Date.now();
  const res = spawnSync(
    "npx",
    ["vitest", "run", "--project", "@blackbelt-technology/pi-dashboard-web", "--reporter=json", ...extra],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: "" } },
  );
  const json = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
  return { status: res.status, passed: json.numPassedTests, failed: json.numFailedTests, wallMs: Date.now() - started };
}

describe("client isolate gate", () => {
  it("the gate decision is recorded next to the setting it governs", () => {
    // The change's design.md moves on archive; the decision must live where the flag would be.
    expect(config).toMatch(/isolate gate/i);
  });

  it.skipIf(adopted)("isolate stays true while the gate is not adopted", () => {
    expect(config).not.toMatch(/^\s*isolate:\s*false\b/m);
  });

  describe.skipIf(!adopted || !CI_SCENARIOS)("isolate:false is adopted, so its conditions must hold", () => {
    it("F1: shuffled order (two seeds) gives the same pass/fail counts as the default order", () => {
      const base = runClient([]);
      expect(base.status).toBe(0);
      for (const seed of [1, 2]) {
        const r = runClient(["--sequence.shuffle", `--sequence.seed=${seed}`]);
        expect(r.status, `seed ${seed}`).toBe(0);
        expect(r.passed).toBe(base.passed);
        expect(r.failed).toBe(base.failed);
      }
    }, 3_600_000);

    it("P2: three consecutive runs are green and the median wall time is not above the isolated baseline", () => {
      const walls = [];
      for (let i = 0; i < 3; i++) {
        const r = runClient([]);
        expect(r.status, `run ${i + 1}`).toBe(0);
        walls.push(r.wallMs);
      }
      const median = walls.sort((a, b) => a - b)[1];
      expect(median, `median wall ${median} ms vs isolated baseline ${ISOLATED_BASELINE_MS} ms`).toBeLessThanOrEqual(ISOLATED_BASELINE_MS);
    }, 3_600_000);
  });
});

// #E22 (task 2.15): the unused client dependency on keycloak-resolver-plugin is dropped; the plugin is
// still shipped by `piDashboard.bundledPlugins` (npm-global discovery never reads node_modules).
describe("client entries bundled — keycloak dep dropped (E22)", () => {
  const clientPkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/client/package.json"), "utf8"));
  const serverPkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/server/package.json"), "utf8"));
  const KEYCLOAK = "@blackbelt-technology/pi-dashboard-keycloak-resolver-plugin";

  it("packages/client declares no keycloak-resolver-plugin dependency in any field", () => {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      expect(clientPkg[field]?.[KEYCLOAK], field).toBeUndefined();
    }
  });

  it("the plugin is still bundled by the server's piDashboard.bundledPlugins", () => {
    expect(serverPkg.piDashboard.bundledPlugins).toContain("keycloak-resolver-plugin");
  });

  it("its allowlist row is deleted and the boundary gate exits 0", () => {
    const rows = JSON.parse(readFileSync(resolve(REPO_ROOT, "scripts/plugin-boundary-allowlist.json"), "utf8")).rows;
    expect(rows.find((r) => r.to === "keycloak-resolver-plugin")).toBeUndefined();
    const res = spawnSync(process.execPath, [resolve(REPO_ROOT, "scripts/check-plugin-boundary.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
  });
});
