/**
 * F9 (task 10.59) — render: byte-identical re-render with a warm props cache.
 *
 * An IR with one CC0 prop resolves its cached GLB, verifies the pinned sha256 and
 * embeds it as base64. Rendering twice must produce byte-identical HTML — the
 * cache read and prop-embedding path adds no nondeterminism. Chromium-gated per
 * the manifest; the browser is used to confirm the prop deck still boots.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import type { PropOverride } from "../../ir/types.js";
import { sha256 } from "../../props/fetch.js";
import { vendoredPath } from "../../props/search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F9 byte-identical re-render with props (chromium)", () => {
  it("two renders with a warm CC0 prop cache are byte-identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f9-"));
    const bytes = new Uint8Array(readFileSync(vendoredPath("cube")));
    mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
    writeFileSync(join(dir, ".deck3d", "props", "vendored-cube.glb"), bytes);

    const ir = validIR();
    const prop: PropOverride = {
      source: "vendored",
      id: "cube",
      licence: "CC0-1.0",
      author: "deck3d corpus",
      sha256: sha256(bytes),
      slide: "intro",
      role: "illustration",
      anim: "float",
    };
    ir.overrides.props = [prop];
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);

    expect(runCli(["render", "deck.json", "-o", "a.html"], dir).status).toBe(0);
    expect(runCli(["render", "deck.json", "-o", "b.html"], dir).status).toBe(0);
    expect(readFileSync(join(dir, "a.html"))).toEqual(readFileSync(join(dir, "b.html")));

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      await page.goto(pathToFileURL(join(dir, "a.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.setTime(0));
      expect(errors).toEqual([]);
      expect((await page.evaluate(() => window.__deck3d?.measure() ?? [])).length).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
