/**
 * F5 (task 10.55) — render: label on round node.
 *
 * A `stadium` node's label must sit fully inside the viewport (in front of the
 * surface, not clipped or pushed off screen) and the `occlusion` rule must not
 * flag it: the first raycast hit through its centre is its own node, never some
 * other object.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { occlusionFindings } from "../../check/rules.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();
const VIEWPORT = { width: 1920, height: 1080 };

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A([Felhasználó]) --> B[Beta]
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F5 label on a round node (chromium)", () => {
  it("the stadium label is inside the viewport and unoccluded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f5-"));
    writeFileSync(join(dir, "arch.md"), MD);
    expect(runCli(["parse", "arch.md", "-o", "arch.json"], dir).status).toBe(0);
    expect(runCli(["render", "arch.json", "-o", "arch.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const rows = await page.evaluate(() => window.__deck3d?.measure() ?? []);

      const label = rows.find((r) => r.id === "A" && r.kind === "label");
      expect(label?.text).toBe("Felhasználó");
      const rect = label?.rect;
      expect(rect).toBeTruthy();
      expect(rect?.x).toBeGreaterThanOrEqual(0);
      expect(rect?.y).toBeGreaterThanOrEqual(0);
      expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeLessThanOrEqual(VIEWPORT.width);
      expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeLessThanOrEqual(VIEWPORT.height);

      // Its raycast hit is its own node (or nothing), never another object.
      expect(label?.hit === null || label?.hit === "A").toBe(true);
      expect(occlusionFindings(rows, { id: "arch", index: 1 })).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
