import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { makeLocalDeck, runCli } from "../../__tests__/helpers/local-fx.js";
import type { Defaults } from "../../ir/types.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { harvestDiagram } from "../../parse/harvest/index.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { ensureRuntime, renderDeck } from "../index.js";

const hasChromium = await chromiumAvailable();
const FIXTURE = readFileSync(new URL("../../../fixtures/harvest.md", import.meta.url), "utf8");

async function writeDeck(overrides: Defaults = {}): Promise<string> {
  const { ir } = await deriveDeckIR(parseMarkdown(FIXTURE), {
    harvest: (src, id) => harvestDiagram(src, id),
  });
  ir.defaults = { ...ir.defaults, ...overrides };
  const html = renderDeck(ir, { runtime: await ensureRuntime() });
  const path = join(mkdtempSync(join(tmpdir(), "deck3d-rt-")), "deck.html");
  writeFileSync(path, html);
  return path;
}

async function open(browser: Browser, path: string, onRoute?: (page: Page) => Promise<void>): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  if (onRoute) await onRoute(page);
  await page.goto(new URL(`file://${path}`).href);
  await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
  return { page, errors };
}

describe.skipIf(!hasChromium)("runtime (chromium)", () => {
  it("boots, measures deterministically, and logs no console error", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, await writeDeck());
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const a = await page.evaluate(() => window.__deck3d?.measure());
      const b = await page.evaluate(() => window.__deck3d?.measure());
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a?.length).toBeGreaterThan(0);
      expect(a?.every((m) => Number.isFinite(m.rect.x) && Number.isFinite(m.rect.y))).toBe(true);
      // 7c.1: every labelled object reports a raycast hit; node geometry is measured too.
      expect(a?.some((m) => m.kind === "node")).toBe(true);
      expect(a?.every((m) => m.hit === null || typeof m.hit === "string")).toBe(true);
      const glyphs = await page.evaluate(() => window.__deck3d?.debug.titleGlyphs());
      expect(glyphs).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("honours a 1-based hash deep-link", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const path = await writeDeck();
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`${new URL(`file://${path}`).href}#2`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(2);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("quality tiers gate the bloom pass", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const low = await open(browser, await writeDeck({ quality: "low" }));
      const lowPasses = await low.page.evaluate(() => window.__deck3d?.effects().active);
      expect(lowPasses).not.toContain("UnrealBloomPass");
      await low.page.close();

      const high = await open(browser, await writeDeck({ quality: "high" }));
      const highPasses = await high.page.evaluate(() => window.__deck3d?.effects().active);
      expect(highPasses).toContain("UnrealBloomPass");
      await high.page.close();
    } finally {
      await browser.close();
    }
  }, 180_000);

  it("opens fully offline (all non-document requests blocked)", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, await writeDeck(), async (p) => {
        await p.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
      });
      const glyphs = await page.evaluate(() => window.__deck3d?.debug.titleGlyphs());
      expect(glyphs).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * Local-effect sandbox and error containment (design D1).
 * ------------------------------------------------------------------ */

/**
 * The identifiers a local module must not be able to reach. `eval` and
 * `Function` are in the shadowed set too, but a module may not even NAME them
 * (the validate-time lint rejects it, covered by #E6), so they cannot appear in
 * a runtime probe.
 */
const SHADOWED_IDENTIFIERS = [
  "window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "Image", "Worker", "WebAssembly", "navigator", "location", "localStorage", "sessionStorage",
  "indexedDB", "postMessage", "setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask",
  "Promise", "Date", "performance", "crypto", "importScripts",
];

/** Build + render a one-slide deck carrying a single local module. */
function localDeck(src: string, prefix: string): string {
  const { dir } = makeLocalDeck({ effects: [{ name: "x", src }] }, prefix);
  const r = runCli(["render", "deck.json", "-o", "deck.html"], dir);
  expect(r.status, r.stderr).toBe(0);
  return join(dir, "deck.html");
}

describe.skipIf(!hasChromium)("local effect sandbox (chromium)", () => {
  // test-plan #E9 — the module self-checks and throws when an identifier it
  // must not see is reachable, so a leak surfaces as a recorded create error
  // naming the identifier rather than as a silent pass.
  it("shadows every non-deterministic and I/O global, keeping Math.random callable", async () => {
    const probe = [
      "export default function (ctx, params) {",
      "  const reachable = [];",
      ...SHADOWED_IDENTIFIERS.map((id) => `  if (typeof ${id} !== "undefined") reachable.push(${JSON.stringify(id)});`),
      '  if (typeof Math.random !== "function") reachable.push("Math.random");',
      '  if (reachable.length) throw new Error("reachable: " + reachable.join(","));',
      "  return { object: new ctx.THREE.Group(), dispose: function () {} };",
      "}",
      "",
    ].join("\n");

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, localDeck(probe, "deck3d-e9-"));
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      const recorded = await page.evaluate(() => window.__deck3d?.effects().errors ?? []);
      expect(errors.join(" "), "console").not.toContain("reachable:");
      expect(recorded).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);

  // test-plan #X1 — a throwing factory disables that effect only.
  it("contains a throw in the factory and keeps the slide measurable", async () => {
    const src = 'export default function (ctx, params) { throw new Error("boom"); }\n';
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, localDeck(src, "deck3d-x1-"));
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      expect(await page.evaluate(() => window.__deck3d?.effects().errors ?? [])).toEqual([
        { slide: "geo", effectId: "local:x", phase: "create" },
      ]);
      // The slide still renders: its title is measurable.
      const measured = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      expect(measured.some((m) => m.kind === "title")).toBe(true);
    } finally {
      await browser.close();
    }
  }, 180_000);

  // test-plan #X2 — a throw in `tick` is recorded once and the object removed;
  // a throw in `dispose` must still let navigation complete.
  it("contains throws in tick and in dispose", async () => {
    const tickThrower = [
      "export default function (ctx, params) {",
      "  const group = new ctx.THREE.Group();",
      "  let n = 0;",
      "  return {",
      "    object: group,",
      '    tick: function (t) { n++; if (n >= 3) throw new Error("tick boom"); },',
      "    dispose: function () {},",
      "  };",
      "}",
      "",
    ].join("\n");

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, localDeck(tickThrower, "deck3d-x2-"));
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      for (const t of [0, 1, 2, 3]) await page.evaluate((v) => window.__deck3d?.setTime(v), t);
      const errors = await page.evaluate(() => window.__deck3d?.effects().errors ?? []);
      expect(errors.filter((e) => e.phase === "tick")).toHaveLength(1);
      // The deck still responds after the effect was disabled.
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(1);
    } finally {
      await browser.close();
    }
  }, 180_000);

  it("records a throwing dispose on navigation and still navigates", async () => {
    const disposeThrower = [
      "export default function (ctx, params) {",
      "  return {",
      "    object: new ctx.THREE.Group(),",
      "    tick: function (t) {},",
      '    dispose: function () { throw new Error("dispose boom"); },',
      "  };",
      "}",
      "",
    ].join("\n");

    const { dir } = makeLocalDeck(
      { markdown: "# Geo\n\n- one\n\n# Next\n\n- two\n", effects: [{ name: "x", src: disposeThrower }] },
      "deck3d-x2b-",
    );
    expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, join(dir, "deck.html"));
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      await page.evaluate(() => window.__deck3d?.gotoSlide(2));
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(2);
      const errors = await page.evaluate(() => window.__deck3d?.effects().errors ?? []);
      expect(errors).toContainEqual({ slide: "geo", effectId: "local:x", phase: "dispose" });
    } finally {
      await browser.close();
    }
  }, 180_000);

  // test-plan #X3 — timers are shadowed, so calling one throws in `create` and
  // nothing is ever scheduled.
  it("rejects setTimeout in the factory and schedules nothing", async () => {
    const src = [
      "export default function (ctx, params) {",
      "  setTimeout(function () {}, 0);",
      "  return { object: new ctx.THREE.Group(), dispose: function () {} };",
      "}",
      "",
    ].join("\n");

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, localDeck(src, "deck3d-x3-"));
      await page.evaluate(() => {
        (window as unknown as { __fired: number }).__fired = 0;
        window.__deck3d?.gotoSlide(1);
      });
      const errors = await page.evaluate(() => window.__deck3d?.effects().errors ?? []);
      expect(errors).toEqual([{ slide: "geo", effectId: "local:x", phase: "create" }]);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => (window as unknown as { __fired: number }).__fired)).toBe(0);
    } finally {
      await browser.close();
    }
  }, 180_000);
});

/* ------------------------------------------------------------------ *
 * Configurator (design D4).
 * ------------------------------------------------------------------ */

/** A 3-slide deck with a couple of overrides, for the panel suites. */
function hudDeck(prefix: string, overrides?: Record<string, unknown>, markdown?: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "deck.md"), markdown ?? "# Geo\n\n- one\n\n# Ai\n\n- two\n\n# Last\n\n- three\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  if (overrides) {
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    deck.overrides = { ...deck.overrides, ...overrides };
    writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));
  }
  expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
  return join(dir, "deck.html");
}

const hudDisplay = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.getElementById("deck3d-hud") as HTMLElement).display);

describe.skipIf(!hasChromium)("configurator (chromium)", () => {
  // test-plan #F1
  it("toggles with C, Escape and the gear, and shows the slide counter", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, hudDeck("deck3d-f1-"));
      expect(await hudDisplay(page)).toBe("none");

      await page.keyboard.press("c");
      expect(await hudDisplay(page)).toBe("block");
      expect(await page.evaluate(() => document.getElementById("deck3d-hud-counter")?.textContent)).toBe("1 / 3");

      await page.keyboard.press("Escape");
      expect(await hudDisplay(page)).toBe("none");

      await page.click("#deck3d-hud-toggle");
      expect(await hudDisplay(page)).toBe("block");
    } finally {
      await browser.close();
    }
  }, 240_000);

  // test-plan #F3 — live apply must not touch the embedded IR.
  it("applies a palette change live while leaving __DECK untouched", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, hudDeck("deck3d-f3-"));
      await page.keyboard.press("c");
      const before = await page.evaluate(() => window.__DECK.defaults.palette);

      await page.selectOption('#deck3d-hud select[data-path="palette"]', "ember");
      await page.waitForTimeout(100);

      expect(await page.evaluate(() => window.__DECK.defaults.palette)).toBe(before);
      // The panel staged it, so a re-render of the panel shows the new value.
      expect(await page.evaluate(() => (document.querySelector('#deck3d-hud select[data-path="palette"]') as HTMLSelectElement).value)).toBe("ember");
    } finally {
      await browser.close();
    }
  }, 240_000);

  // test-plan #F6 — panel state survives a reload, keyed by the derived hash.
  it("restores stored state on reload and starts clean for a different deck", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const path = hudDeck("deck3d-f6-");
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      await page.goto(pathToFileURL(path).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });

      await page.keyboard.press("c");
      await page.selectOption('#deck3d-hud select[data-path="quality"]', "low");
      await page.waitForTimeout(100);

      await page.reload();
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");
      expect(await page.evaluate(() => (document.querySelector('#deck3d-hud select[data-path="quality"]') as HTMLSelectElement).value)).toBe("low");

      // A different deck has a different derivedHash ⇒ no stored state.
      await page.goto(pathToFileURL(hudDeck("deck3d-f6b-", undefined, "# Other\n\n- x\n")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");
      expect(await page.evaluate(() => (document.querySelector('#deck3d-hud select[data-path="quality"]') as HTMLSelectElement).value)).toBe("high");
    } finally {
      await browser.close();
    }
  }, 240_000);

  // test-plan #F7 — the `●` marker tells the agent which knobs are already pinned.
  it("marks exactly the controls whose value came from an override", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const path = hudDeck("deck3d-f7-", {
        deck: { mode: "light" },
        slides: { geo: { camera: { distance: 11 } } },
      });
      const { page } = await open(browser, path);
      await page.keyboard.press("c");

      const marked = () =>
        page.evaluate(() =>
          [...document.querySelectorAll("#deck3d-hud .deck3d-hud-row span")]
            .filter((s) => s.textContent?.startsWith("●"))
            .map((s) => s.textContent?.replace("● ", "")),
        );
      expect(await marked()).toEqual(["mode"]);

      await page.click('#deck3d-hud button[data-scope="slide"]');
      expect(await marked()).toEqual(["camera.distance"]);
    } finally {
      await browser.close();
    }
  }, 240_000);

  // test-plan #E40 — autoplay is bounded, and a rejected value changes nothing.
  it("accepts 0/1/600 for autoplay and rejects 601, 0.5 and -1", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, hudDeck("deck3d-e40-"));
      await page.keyboard.press("c");

      const set = async (value: string) => {
        await page.fill("#deck3d-hud-autoplay", value);
        await page.dispatchEvent("#deck3d-hud-autoplay", "change");
        return page.inputValue("#deck3d-hud-autoplay");
      };

      expect(await set("0")).toBe("0");
      expect(await set("1")).toBe("1");
      expect(await set("600")).toBe("600");
      // Rejected values restore the last accepted one (600).
      for (const bad of ["601", "0.5", "-1"]) expect(await set(bad), bad).toBe("600");
    } finally {
      await browser.close();
    }
  }, 240_000);

  // test-plan #E41 — the export is a D1-grammar merge target, not a screenshot.
  it("exports only the scopes the presenter touched", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, hudDeck("deck3d-e41-"));
      await page.keyboard.press("c");
      await page.click('#deck3d-hud button[data-scope="slide"]');
      await page.selectOption('#deck3d-hud select[data-path="mode"]', "light");
      await page.fill('#deck3d-hud input[data-path="camera.distance"]', "11");
      await page.dispatchEvent('#deck3d-hud input[data-path="camera.distance"]', "change");

      // Uncheck one effect on slide 2 so the export pins that slide's list.
      await page.evaluate(() => window.__deck3d?.gotoSlide(2));
      await page.evaluate(() => {
        const box = document.querySelector("#deck3d-hud .deck3d-hud-effect input") as HTMLInputElement;
        box.checked = false;
        box.dispatchEvent(new Event("change"));
      });

      // Capture the real download rather than a test-only hook.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.click("#deck3d-hud-export"),
      ]);
      expect(download.suggestedFilename()).toBe("overrides.json");
      const target = join(mkdtempSync(join(tmpdir(), "deck3d-e41-dl-")), "overrides.json");
      await download.saveAs(target);
      const exported = JSON.parse(readFileSync(target, "utf8")) as {
        deck?: unknown;
        slides: Record<string, Record<string, unknown>>;
      };

      expect(exported.slides.geo).toMatchObject({ mode: "light", camera: { distance: 11 } });
      expect(exported.slides.ai.effects).toEqual([]);
      // Deck scope was never touched, so it must not appear at all.
      expect(exported).not.toHaveProperty("deck");
    } finally {
      await browser.close();
    }
  }, 240_000);
});
