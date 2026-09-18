/**
 * E42 (test-plan) — check: a clean deck reports zero findings and exits 0.
 *
 * Two probes:
 *  1. the specified input — build `fixtures/strategy-lab.md`, run `check`; the
 *     report must have zero findings and the CLI must exit 0.
 *  2. the underlying spec scenario ("every slide fits … → zero findings") on a
 *     minimal deck that actually fits, to prove `check` *can* report clean.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const STRATEGY_LAB = readFileSync(new URL("../../../fixtures/strategy-lab.md", import.meta.url), "utf8");

const MINIMAL_DECK = ["---", "mode: dark", "---", "", "# Hello", "", "# World", "", "- one", "- two", ""].join("\n");

interface Report {
  viewports: Array<{ viewport: string; findings: Array<{ severity: string; rule: string; slideIndex: number; detail: string }> }>;
}

function buildAndCheck(dir: string, source: string) {
  writeFileSync(join(dir, "deck.md"), source);
  const build = spawnSync(BIN, ["build", "deck.md", "-o", "deck.html"], { cwd: dir, encoding: "utf8" });
  const check = spawnSync(BIN, ["check", "deck.html", "-o", "r.json"], { cwd: dir, encoding: "utf8" });
  const report = JSON.parse(readFileSync(join(dir, "r.json"), "utf8")) as Report;
  return { build, check, report };
}

describe.skipIf(!hasChromium)("deck3d check on a clean deck (E42)", () => {
  it("reports zero findings and exits 0 for the built strategy-lab fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-e42-"));
    const { build, check, report } = buildAndCheck(dir, STRATEGY_LAB);

    expect(build.status, build.stderr).toBe(0);
    // Zero findings per viewport (count === 0 ⟺ the findings array is empty).
    const summary = report.viewports.map((v) => ({ viewport: v.viewport, findings: v.findings.length }));
    expect(summary).toEqual([
      { viewport: "1920x1080", findings: 0 },
      { viewport: "1280x720", findings: 0 },
    ]);
    expect(check.status, check.stderr).toBe(0);
  }, 180_000);

  it("reports zero findings and exits 0 when every slide fits (spec: clean deck)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-check-e42-clean-"));
    const { build, check, report } = buildAndCheck(dir, MINIMAL_DECK);

    expect(build.status, build.stderr).toBe(0);
    expect(report.viewports.map((v) => v.viewport)).toEqual(["1920x1080", "1280x720"]);
    expect(report.viewports.flatMap((v) => v.findings)).toEqual([]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("check: clean");
  }, 180_000);
});
