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

  // test-plan #E26 — the whole accepted key matrix, in one pass, with the hash tracking every step.
  it("walks the full key matrix and mirrors every step into the hash", async () => {
    const page = await open();
    const hash = () => page.evaluate(() => window.location.hash);

    const steps: Array<[string, number]> = [
      ["ArrowRight", 2],
      ["ArrowRight", 3],
      ["ArrowLeft", 2],
      ["Space", 3],
      ["End", 3],
      ["Home", 1],
      ["PageDown", 2],
      ["ArrowUp", 1],
    ];

    for (const [key, expected] of steps) {
      await page.keyboard.press(key);
      expect(await current(page), `after ${key}`).toBe(expected);
      expect(await hash(), `hash after ${key}`).toBe(`#${expected}`);
    }
    await page.close();
  }, 60_000);

  // test-plan #E27 — clamping at both edges, and modified keys left to the browser.
  it("clamps at both edges and ignores modified arrow keys", async () => {
    const page = await open();

    await page.keyboard.press("ArrowLeft");
    expect(await current(page)).toBe(1); // already first

    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    expect(await current(page)).toBe(3); // already last
    await page.mouse.click(400, 300);
    expect(await current(page)).toBe(3); // click does not wrap either

    await page.keyboard.press("Home");
    await page.keyboard.press("Meta+ArrowRight");
    expect(await current(page)).toBe(1); // modifier held → not a deck key
    await page.close();
  }, 60_000);

  // test-plan #E28 — a live hash change drives navigation; out-of-range falls back to slide 1.
  it("follows in-range and out-of-range hash changes", async () => {
    const page = await open();
    const setHash = async (h: string, expected: number) => {
      await page.evaluate((v) => {
        window.location.hash = v;
      }, h);
      await page.waitForFunction((n) => window.__deck3d?.current() === n, expected, { timeout: 5_000 });
      expect(await current(page), `after ${h}`).toBe(expected);
    };

    await setHash("#3", 3);
    await setHash("#0", 1);
    await setHash("#99", 1);
    await page.close();
  }, 60_000);
});

/**
 * Configurator vs navigation (design D4/D8). The panel and the deck share the
 * keyboard and the pointer, so the boundaries are explicit: a focused input
 * owns every key including `C`, and clicks inside the panel never advance.
 */
describe.skipIf(!hasChromium)("navigation with the configurator", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let deckHtml: string;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-hudnav-"));
    writeFileSync(join(dir, "talk.md"), MD);
    const r = spawnSync(BIN, ["build", "talk.md", "-o", "talk.html"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    deckHtml = join(dir, "talk.html");
    browser = await chromium.launch({ channel: "chromium" });
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function openHud() {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(deckHtml).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    return page;
  }

  // test-plan #F4
  it("suppresses navigation and the C toggle while an input has focus", async () => {
    const page = await openHud();
    await page.keyboard.press("c");
    // Controls live in collapsible blocks; a closed block's input cannot take focus.
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
    });
    await page.focus('#deck3d-hud input[data-path="durationSec"]');

    await page.keyboard.type("2");
    await page.keyboard.press("Space");
    await page.keyboard.press("c");
    await page.keyboard.press("ArrowRight");

    expect(await page.evaluate(() => window.__deck3d?.current())).toBe(1);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("deck3d-hud") as HTMLElement).display)).toBe("block");
    await page.close();
  }, 120_000);

  // test-plan #F5
  it("does not advance on a click inside the panel or on the gear", async () => {
    const page = await openHud();
    await page.keyboard.press("c");

    await page.click("#deck3d-hud-counter");
    expect(await page.evaluate(() => window.__deck3d?.current())).toBe(1);

    await page.click("#deck3d-hud-toggle");
    expect(await page.evaluate(() => window.__deck3d?.current())).toBe(1);
    await page.close();
  }, 120_000);

  // test-plan #F8 — with the panel closed a click is still a plain advance.
  it("advances on a scene click while the panel is closed", async () => {
    const page = await openHud();
    await page.mouse.click(400, 300);
    expect(await page.evaluate(() => window.__deck3d?.current())).toBe(2);
    await page.close();
  }, 120_000);
});
