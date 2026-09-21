/**
 * F1 (task 10.51) — render: measurement is stable.
 *
 * With a fixed viewport and a frozen deterministic clock, two `measure()` calls
 * at the same slide/time must be deep-equal (convergence), and every projected
 * rect must be finite (no NaN from an empty/degenerate object).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A[Alpha] --> B([Beta])
  B --> C{Megfigyelés}
  C -.-> A
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F1 measurement is stable (chromium)", () => {
  it("two measure() calls at slide arch / t=1.7 are deep-equal with finite rects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f1-"));
    writeFileSync(join(dir, "arch.md"), MD);
    expect(runCli(["parse", "arch.md", "-o", "arch.json"], dir).status).toBe(0);
    expect(runCli(["render", "arch.json", "-o", "arch.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(1.7);
      });
      await page.evaluate(() => window.__deck3d?.ready());
      const a = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      const b = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      expect(a.length).toBeGreaterThan(0);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const row of a) {
        expect(Number.isFinite(row.rect.x), `${row.id} x`).toBe(true);
        expect(Number.isFinite(row.rect.y), `${row.id} y`).toBe(true);
        expect(Number.isFinite(row.rect.w), `${row.id} w`).toBe(true);
        expect(Number.isFinite(row.rect.h), `${row.id} h`).toBe(true);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
