/**
 * Deliverable B — `check.ignore` suppresses findings.
 *
 * Pure rule: `filterIgnored` drops a finding whose `rule` matches an ignore
 * entry (`contrast`) or whose object `id` matches one. The chromium leg proves
 * the merge+wire: a slide tuned (via inline `<!-- deck3d -->` overrides) so it
 * would report `fit` errors reports none once `check.ignore: ["fit"]` is set.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { contrastFindings, filterIgnored, fitFindings, legibilityFindings, type Measurement, type SlideRef } from "../rules.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const SLIDE: SlideRef = { id: "arch", index: 2 };

function label(id: string, rect: { x: number; y: number; w: number; h: number }, capHeight: number, extra: Partial<Measurement> & { bgLuminance?: number } = {}): Measurement & { bgLuminance?: number } {
  return { kind: "label", id, text: id, rect, capHeight, ...extra };
}

describe("check filterIgnored suppresses by rule or object id (B)", () => {
  it("drops a finding whose rule is listed", () => {
    const contrast = contrastFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { color: "#888888", bgLuminance: 0.5 })], SLIDE);
    expect(contrast).toHaveLength(1);
    expect(filterIgnored(contrast, ["contrast"])).toEqual([]);
  });

  it("drops a finding whose object id is listed", () => {
    const legibility = legibilityFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 1)], 1080, SLIDE);
    expect(legibility).toHaveLength(1);
    expect(filterIgnored(legibility, ["A"])).toEqual([]);
  });

  it("keeps findings that match neither, and passes through empty/undefined", () => {
    const fit = fitFindings([label("A", { x: 0, y: 0, w: 5000, h: 10 }, 20)], { w: 1920, h: 1080 }, SLIDE);
    expect(fit.length).toBeGreaterThan(0);
    expect(filterIgnored(fit, ["contrast"])).toEqual(fit);
    expect(filterIgnored(fit, [])).toEqual(fit);
    expect(filterIgnored(fit, undefined)).toEqual(fit);
  });
});

interface Report {
  viewports: Array<{ viewport: string; findings: Array<{ rule: string }> }>;
}

function writeTunedDeck(dir: string, ignore: string[]): void {
  writeFileSync(join(dir, "deck.md"), "# Arch\n\n- one\n- two\n");
  const parse = spawnSync(BIN, ["parse", "deck.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" });
  expect(parse.status, parse.stderr).toBe(0);
  const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
  // Close camera ⇒ the extents overflow the safe margin, so `fit` fires.
  ir.overrides.slides = { arch: { camera: { distance: 6 }, check: { ignore } } };
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  const render = spawnSync(BIN, ["render", "deck.json", "-o", "deck.html"], { cwd: dir, encoding: "utf8" });
  expect(render.status, render.stderr).toBe(0);
}

function checkReport(dir: string): Report {
  const check = spawnSync(BIN, ["check", "deck.html", "--viewport", "1920x1080", "-o", "report.json"], { cwd: dir, encoding: "utf8" });
  void check;
  return JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
}

describe.skipIf(!hasChromium)("deck3d check applies per-slide check.ignore (B)", () => {
  it("reports the fit rule without the ignore and suppresses it with the ignore", () => {
    const control = mkdtempSync(join(tmpdir(), "deck3d-ignore-control-"));
    writeTunedDeck(control, []);
    expect(checkReport(control).viewports[0].findings.some((f) => f.rule === "fit")).toBe(true);

    const ignored = mkdtempSync(join(tmpdir(), "deck3d-ignore-on-"));
    writeTunedDeck(ignored, ["fit"]);
    expect(checkReport(ignored).viewports[0].findings.some((f) => f.rule === "fit")).toBe(false);
  }, 180_000);
});
