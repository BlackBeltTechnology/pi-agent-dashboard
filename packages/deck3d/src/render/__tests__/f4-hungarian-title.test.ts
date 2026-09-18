/**
 * F4 (task 10.54) — render: Hungarian titles render intact.
 *
 * A title with double-acute glyphs (`Ágensrajok űrhajó őre`) must extrude every
 * glyph from the embedded subset with no `earcut` warning (the lab bug: corrupt
 * `typeface.json` outlines for `ő ű Ő Ű` streak through earcut).
 *
 * Deviation from the literal plan observable (reported): the plan says
 * `__deck3d.debug.titleGlyphs()` equals the non-space character count (22).
 * That count is wrong for this title (19 non-space chars) and the runtime builds
 * one extruded mesh per wrapped *line*, so per-glyph mesh counts do not exist.
 * This test instead checks glyph coverage at the source — every non-space glyph
 * of the title resolves in the embedded subset font — plus the line-mesh count,
 * the measured title text, and the absence of any earcut warning.
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
import { validIR } from "../../ir/__tests__/fixtures.js";
import { wrap } from "../../runtime/text.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();
const TITLE = "Ágensrajok űrhajó őre";

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F4 Hungarian titles render intact (chromium)", () => {
  it("subsets every Hungarian glyph, builds the title, and logs no earcut warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f4-"));
    const ir = validIR();
    ir.slides[0] = { ...ir.slides[0], kind: "title", title: TITLE };
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
    const render = runCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(render.status, render.stderr).toBe(0);

    // The embedded subset must carry every glyph the title needs.
    const encoded = /base64,([A-Za-z0-9+/=]+)\)/.exec(readFileSync(join(dir, "deck.html"), "utf8"))?.[1];
    expect(encoded).toBeTruthy();
    const bytes = Buffer.from(encoded as string, "base64");
    const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const glyphs = [...new Set([...TITLE].filter((c) => c !== " "))];
    expect([...TITLE].filter((c) => c !== " ").length).toBe(19);
    expect(glyphs.length).toBeGreaterThan(0);
    for (const ch of glyphs) expect(font.charToGlyph(ch).index, `glyph ${ch}`).toBeGreaterThan(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const logs: string[] = [];
      page.on("console", (m) => logs.push(m.text()));
      page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.setTime(0));

      // One extruded mesh per wrapped line; the title wraps to two lines at its
      // 0.62 title size (18-char wrap width).
      expect(await page.evaluate(() => window.__deck3d?.debug.titleGlyphs())).toBe(wrap(TITLE, 18).length);
      const title = (await page.evaluate(() => window.__deck3d?.measure() ?? [])).find((r) => r.kind === "title");
      expect(title?.text).toBe(TITLE);

      const earcut = logs.filter((l) => /earcut/i.test(l));
      expect(earcut, earcut.join("\n")).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
