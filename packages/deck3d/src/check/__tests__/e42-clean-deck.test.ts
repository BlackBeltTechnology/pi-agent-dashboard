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
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { clearHudState } from "../index.js";

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

/**
 * test-plan #X9 — the configurator persists per-deck state, so `check` must
 * measure the deck a fresh viewer sees. Verified on the real mechanism
 * (`clearHudState`), since each `runCheck` already gets a new browser context.
 */
describe.skipIf(!hasChromium)("X9 check ignores persisted configurator state", () => {
  it("clears the deck3d: key and measures the fresh-profile result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x9-"));
    const { build } = buildAndCheck(dir, MINIMAL_DECK);
    expect(build.status, build.stderr).toBe(0);
    const url = pathToFileURL(join(dir, "deck.html")).href;

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();

      // A fresh profile is the reference.
      await page.goto(url);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      const hash = await page.evaluate(() => (window.__DECK as unknown as { derivedHash?: string }).derivedHash ?? "x");
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const fresh = JSON.stringify(await page.evaluate(() => window.__deck3d?.measure() ?? []));

      // Seed HUD state, then let `check`'s own clearing run on reload.
      await page.evaluate((k) => localStorage.setItem(`deck3d:${k}`, JSON.stringify({ quality: "low" })), hash);
      expect(await page.evaluate((k) => localStorage.getItem(`deck3d:${k}`), hash)).not.toBeNull();

      await clearHudState(page);
      await page.reload();
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      expect(JSON.stringify(await page.evaluate(() => window.__deck3d?.measure() ?? []))).toBe(fresh);
      expect(await page.evaluate((k) => localStorage.getItem(`deck3d:${k}`), hash)).toBeNull();
    } finally {
      await browser.close();
    }
  }, 240_000);
});
