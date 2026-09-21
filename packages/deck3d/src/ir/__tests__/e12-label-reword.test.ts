/**
 * E12 (task 10.12) — ir: Reworded label.
 *
 * `overrides.nodes["arch/A"].label = "Ügyfél"` renders into the merged IR and
 * the runtime `measure()` row for node `A`; the embedded font subset carries the
 * `Ü` glyph. Browser-gated (parse harvests mermaid in chromium).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import opentype from "opentype.js";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A[Alpha] --> B[Beta]
\`\`\`
`;

describe.skipIf(!hasChromium)("E12 reworded node label (chromium)", () => {
  it("renders the override label and subsets its glyphs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e12-"));
    writeFileSync(join(dir, "arch.md"), MD);

    const parsed = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8")) as Record<string, unknown>;
    (ir.overrides as Record<string, unknown>).nodes = { "arch/A": { label: "Ügyfél" } };
    writeFileSync(join(dir, "arch.json"), JSON.stringify(ir, null, 2));

    const rendered = runCli(["render", "arch.json", "-o", "arch.html"], dir);
    expect(rendered.status, rendered.stderr).toBe(0);

    // The embedded @font-face subset must carry the `Ü` glyph.
    const html = readFileSync(join(dir, "arch.html"), "utf8");
    const encoded = /base64,([A-Za-z0-9+/=]+)\)/.exec(html)?.[1];
    expect(encoded).toBeTruthy();
    const bytes = Buffer.from(encoded as string, "base64");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const font = opentype.parse(buffer);
    expect(font.charToGlyph("Ü").index).toBeGreaterThan(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });

      const row = await page.evaluate(() => window.__deck3d?.measure().find((m) => m.id === "A" && m.kind === "label") ?? null);
      expect(row?.text).toBe("Ügyfél");

      const mergedLabel = await page.evaluate(
        () => window.__DECK.slides[0].diagram.nodes?.find((n) => n.id === "A")?.label,
      );
      expect(mergedLabel).toBe("Ügyfél");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
