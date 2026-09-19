/**
 * Navigation and slide model (spec `deck3d-render` → "Navigation and slide model").
 *
 * The deck steps through slides with the keyboard (`ArrowRight`/`ArrowLeft`/
 * `Space`), with a click/tap, and follows a `#<n>` hash change live — not only
 * at load. Chromium-gated like every other browser-driving suite here.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumAvailable } from "./helpers/chromium.js";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# One

- a

# Two

- b

# Three

- c
`;

describe.skipIf(!hasChromium)("navigation (keyboard / click / hash)", () => {
  let html: string;
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-nav-"));
    writeFileSync(join(dir, "talk.md"), MD);
    const r = spawnSync(BIN, ["build", "talk.md", "-o", "talk.html"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    html = join(dir, "talk.html");
    browser = await chromium.launch({ channel: "chromium" });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function open() {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    return page;
  }

  const current = (page: Awaited<ReturnType<typeof open>>) => page.evaluate(() => window.__deck3d?.current());

  it("advances and retreats with the arrow keys", async () => {
    const page = await open();
    expect(await current(page)).toBe(1);

    await page.keyboard.press("ArrowRight");
    expect(await current(page)).toBe(2);

    await page.keyboard.press("ArrowRight");
    expect(await current(page)).toBe(3);

    await page.keyboard.press("ArrowLeft");
    expect(await current(page)).toBe(2);
    await page.close();
  }, 60_000);

  it("advances with Space and jumps with Home/End, clamped at both edges", async () => {
    const page = await open();
    await page.keyboard.press("Space");
    expect(await current(page)).toBe(2);

    await page.keyboard.press("End");
    expect(await current(page)).toBe(3);
    await page.keyboard.press("ArrowRight");
    expect(await current(page)).toBe(3); // clamped, no wrap past the last slide

    await page.keyboard.press("Home");
    expect(await current(page)).toBe(1);
    await page.keyboard.press("ArrowLeft");
    expect(await current(page)).toBe(1); // clamped at the first slide
    await page.close();
  }, 60_000);

  it("advances on a click", async () => {
    const page = await open();
    await page.mouse.click(400, 300);
    expect(await current(page)).toBe(2);
    await page.close();
  }, 60_000);

  it("follows a hash change after load", async () => {
    const page = await open();
    await page.evaluate(() => {
      window.location.hash = "#3";
    });
    await page.waitForFunction(() => window.__deck3d?.current() === 3, undefined, { timeout: 5_000 });
    expect(await current(page)).toBe(3);
    await page.close();
  }, 60_000);

  it("keeps the hash in sync with keyboard navigation", async () => {
    const page = await open();
    await page.keyboard.press("ArrowRight");
    expect(new URL(page.url()).hash).toBe("#2");
    await page.close();
  }, 60_000);
});
