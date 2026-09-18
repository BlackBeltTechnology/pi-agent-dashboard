/**
 * F3 (task 10.53) — render: lifted message leaves frame at peak.
 *
 * `check` evaluates every slide at `t=0` and at each animation peak reported by
 * `__deck3d.peaks()` (spec: "Browser fit-and-legibility check"). For a sequence
 * slide whose scale override pushes the diagram past the safe margin, every one
 * of those times must produce an `error fit` row with the
 * `overrides.slides["<id>"].diagram.scale` suggestion, and `check` must exit
 * non-zero.
 *
 * Deviations from the literal plan observable (reported to the orchestrator):
 *  - `Finding` carries no `t` field, so a row cannot be tagged with its peak
 *    time; the number of rows per viewport (`peaks().length`, one row per time)
 *    is the observable proxy that every peak was evaluated.
 *  - The sequence builder ignores `diagram.scale` (it only affects flowcharts),
 *    so the override is passed verbatim but the overflow comes from the default
 *    camera distance. The fit rule still fires identically at each evaluated
 *    time, which is what this scenario guards.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { fitFindings } from "../../check/rules.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# Ciklus

\`\`\`mermaid
sequenceDiagram
  participant F as Fejlesztő
  participant A as Ágens
  participant E as Eszközök
  F->>A: egy
  A->>E: kettő
  E-->>A: három
  A->>E: négy
  A-->>F: öt
\`\`\`
`;

interface Report {
  viewports: Array<{ viewport: string; findings: Array<{ severity: string; rule: string; slide: string; detail: string; suggest: string }> }>;
}

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F3 lifted message fit at peak (chromium)", () => {
  it("check reports a fit error at every evaluated peak time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f3-"));
    writeFileSync(join(dir, "ciklus.md"), MD);
    expect(runCli(["parse", "ciklus.md", "-o", "ciklus.json"], dir).status).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "ciklus.json"), "utf8")) as {
      slides: Array<{ id: string }>;
      overrides: { slides?: Record<string, { diagram?: { scale?: number } }> };
    };
    const slideId = ir.slides[0].id;
    ir.overrides.slides = { [slideId]: { diagram: { scale: 2.5 } } };
    writeFileSync(join(dir, "ciklus.json"), `${JSON.stringify(ir, null, 2)}\n`);

    expect(runCli(["render", "ciklus.json", "-o", "ciklus.html"], dir).status).toBe(0);
    const check = runCli(["check", "ciklus.html", "-o", "report.json"], dir);
    expect(check.status, check.stderr).not.toBe(0);

    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
    expect(report.viewports.map((v) => v.viewport)).toEqual(["1920x1080", "1280x720"]);

    // Every peak time is evaluated; because the diagram overflows at all of
    // them the report holds exactly one fit row per evaluated time.
    const browser = await chromium.launch({ channel: "chromium" });
    let peaks: number[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "ciklus.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate((n) => window.__deck3d?.gotoSlide(n), 1);
      peaks = (await page.evaluate(() => window.__deck3d?.peaks() ?? [0])) as number[];
      // The peak set is the sequence's message schedule (5 messages, 1.1 s pulse).
      expect(peaks.map((t) => Number(t.toFixed(1)))).toEqual([0, 1.1, 2.2, 3.3, 4.4]);

      // Reproduce the rule at each evaluated time: a fit error is present at a
      // peak (not only at the static frame) and the measured frame differs.
      const rights: number[] = [];
      for (const t of [0, ...peaks.filter((x) => x > 0)]) {
        await page.evaluate((x) => window.__deck3d?.setTime(x), t);
        const rows = await page.evaluate(() => window.__deck3d?.measure() ?? []);
        const findings = fitFindings(rows, { w: 1920, h: 1080 }, { id: slideId, index: 1 });
        expect(findings.length, `t=${t}`).toBeGreaterThan(0);
        rights.push(Math.max(...rows.map((r) => r.rect.x + r.rect.w)));
      }
      expect(rights[rights.length - 1]).not.toBe(rights[0]);
      await page.close();
    } finally {
      await browser.close();
    }

    for (const viewport of report.viewports) {
      const fits = viewport.findings.filter((f) => f.rule === "fit");
      expect(fits).toHaveLength(peaks.length);
      for (const f of fits) {
        expect(f.severity).toBe("error");
        expect(f.slide).toBe(slideId);
        expect(f.suggest).toBe(`overrides.slides["${slideId}"].diagram.scale`);
      }
    }
  }, 180_000);
});
