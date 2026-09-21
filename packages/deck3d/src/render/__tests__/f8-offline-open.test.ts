/**
 * F8 (task 10.58) — render: offline open.
 *
 * `deck.html` embeds the runtime, IR and font inline, so opening it with every
 * non-document request aborted must still boot: zero failed resource requests,
 * no network URLs requested at all, and slide 1's title glyphs > 0.
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

A bemutató diák.

\`\`\`mermaid
flowchart LR
  A[Alpha] --> B([Beta])
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F8 offline open (chromium)", () => {
  it("boots with every non-document request aborted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f8-"));
    writeFileSync(join(dir, "arch.md"), MD);
    expect(runCli(["parse", "arch.md", "-o", "arch.json"], dir).status).toBe(0);
    expect(runCli(["render", "arch.json", "-o", "arch.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      const failed: string[] = [];
      const requested: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("requestfailed", (r) => failed.push(r.url()));
      page.on("request", (r) => requested.push(r.url()));
      await page.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));

      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.ready());
      await page.evaluate(() => window.__deck3d?.setTime(0));

      expect(failed).toEqual([]);
      expect(requested.every((url) => url.startsWith("file:")), requested.join("\n")).toBe(true);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.__deck3d?.debug.titleGlyphs())).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
