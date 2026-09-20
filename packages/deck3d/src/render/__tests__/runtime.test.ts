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

/**
 * Controls live inside collapsible blocks and only the first starts open, so a
 * test that drives a control must open its block the way a presenter would.
 */
async function openAllBlocks(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#deck3d-hud .deck3d-hud-block")) (d as HTMLDetailsElement).open = true;
  });
}

describe.skipIf(!hasChromium)("configurator exposes per-effect params (#F21)", () => {
  it("generates controls from the effect's card and applies them live", async () => {
    // `lift` is declared in the card and read by the factory: the panel must
    // grow a control for it WITHOUT any panel code naming this effect.
    const src = [
      "export default function (ctx, params) {",
      "  const { THREE, palette } = ctx;",
      "  const lift = typeof params.lift === 'number' ? params.lift : 0;",
      "  const geo = new THREE.BoxGeometry(1, 1, 1);",
      "  const mat = new THREE.MeshBasicMaterial({ color: palette.accent });",
      "  const mesh = new THREE.Mesh(geo, mat);",
      "  mesh.position.y = lift;",
      "  const group = new THREE.Group();",
      "  group.add(mesh);",
      "  return { object: group, tick: function () {}, dispose: function () { geo.dispose(); mat.dispose(); } };",
      "}",
      "",
    ].join("\n");
    const { dir } = makeLocalDeck({
      effects: [{ name: "lifter", src, card: { params: { lift: { type: "number", default: 0, minimum: 0, maximum: 4 } } } }],
    });
    expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    try {
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");
      await openAllBlocks(page);

      const control = 'input[data-fxparam="local:lifter.lift"]';
      expect(await page.locator(control).count()).toBe(1);
      // Range bounds come from the card, not from panel code.
      expect(await page.getAttribute(control, "max")).toBe("4");

      const before = await page.evaluate(() => window.__deck3d!.debug.localFx()[0].digest);
      await page.locator(control).fill("3");
      await page.locator(control).dispatchEvent("input");
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => window.__deck3d!.debug.localFx()[0].digest);
      expect(after).not.toBe(before);
      // The edit must not rewrite the authored deck.
      expect(await page.evaluate(() => JSON.stringify(window.__DECK.overrides ?? {}))).not.toContain('"lift"');
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe.skipIf(!hasChromium)("local fx survive revisiting a slide (#F20)", () => {
  it("still animates after navigating away and back", async () => {
    // The module animates on `tick`, so a dead handle shows up as a frozen
    // transform — the symptom is "works the first time, not later".
    const { dir } = makeLocalDeck({
      markdown: "# Geo\n\n- one\n\n# Second\n\n- two\n",
      slide: "geo",
      effects: [{ name: "spinner" }],
    });
    const built = runCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(built.status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    try {
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      // Scoped to the local handle: `motion()` also walks the diagram and the
      // corpus background, which keep moving and mask a dead local effect.
      const probe = async (): Promise<{ live: number; moved: boolean }> => {
        const before = await page.evaluate(() => window.__deck3d!.debug.localFx());
        await page.waitForTimeout(700);
        const after = await page.evaluate(() => window.__deck3d!.debug.localFx());
        return { live: after.length, moved: JSON.stringify(before) !== JSON.stringify(after) };
      };
      expect(await probe()).toEqual({ live: 1, moved: true });
      // Nodes drawn by the effect, counted before leaving: reviving must not
      // stack a second copy on top of the disposed one.
      const nodes = async (): Promise<number> => page.evaluate(() => window.__deck3d!.debug.sceneNodes());
      const nodesBefore = await nodes();

      await page.evaluate(() => window.__deck3d!.gotoSlide(2));
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.__deck3d!.gotoSlide(1));
      await page.waitForTimeout(2000);
      expect(await probe()).toEqual({ live: 1, moved: true });
      expect(await nodes()).toBe(nodesBefore);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

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
      // The outgoing slide is disposed when the fly LANDS, not when it starts
      // (#F24), so the dispose error surfaces once the transition completes.
      await page.waitForFunction(() => window.__deck3d!.debug.look().anim === null, undefined, { timeout: 15_000 });
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

      await openAllBlocks(page);
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
      await openAllBlocks(page);
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
        await openAllBlocks(page);
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
      await openAllBlocks(page);
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

/**
 * F14 (task 13.9) — configurator: collapsible blocks.
 *
 * The panel groups controls into `<details>` blocks. What matters to a user is
 * that a block stays where they left it (across a scope switch, a slide change
 * and a reload) and that a block never offers a control the active scope cannot
 * express — `spacing` moves the whole rail, `diagram.*` only one slide.
 */
describe.skipIf(!hasChromium)("configurator blocks (chromium)", () => {
  const blocks = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll("#deck3d-hud .deck3d-hud-block")].map((d) => ({
        title: (d as HTMLElement).dataset.block ?? "",
        open: d.hasAttribute("open"),
        paths: [...d.querySelectorAll("[data-path]")].map((c) => (c as HTMLElement).dataset.path ?? ""),
      })),
    );

  const setScope = async (page: Page, scope: "deck" | "slide") => {
    await page.evaluate((s) => (document.querySelector(`#deck3d-hud [data-scope="${s}"]`) as HTMLElement).click(), scope);
  };

  it("scopes the Layout block: rail/spacing deck-wide, diagram/cardOffset per slide", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, await writeDeck());
      await page.keyboard.press("c");

      const deckLayout = (await blocks(page)).find((b) => b.title === "Layout");
      expect(deckLayout?.paths).toContain("rail");
      expect(deckLayout?.paths).toContain("spacing");
      expect(deckLayout?.paths.some((p) => p.startsWith("diagram."))).toBe(false);
      expect(deckLayout?.paths.some((p) => p.startsWith("cardOffset."))).toBe(false);

      await setScope(page, "slide");
      const slideLayout = (await blocks(page)).find((b) => b.title === "Layout");
      expect(slideLayout?.paths).toContain("diagram.kind");
      expect(slideLayout?.paths).toContain("cardOffset.x");
      expect(slideLayout?.paths).not.toContain("spacing");
      expect(slideLayout?.paths).not.toContain("rail");
    } finally {
      await browser.close();
    }
  });

  it("remembers each block's open state across scope, slide and reload", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const path = await writeDeck();
      const { page } = await open(browser, path);
      await page.keyboard.press("c");
      // Default: only the first block is open.
      expect((await blocks(page)).map((b) => b.open)).toEqual([true, false, false, false, false, false, false]);

      await page.evaluate(() => {
        const open = (title: string, want: boolean) => {
          const d = [...document.querySelectorAll("#deck3d-hud .deck3d-hud-block")].find(
            (n) => (n as HTMLElement).dataset.block === title,
          ) as HTMLDetailsElement;
          d.open = want;
        };
        open("Layout", true);
        open("Look", false);
      });
      // `toggle` is dispatched as a task, so the persist handler runs after the
      // assignment returns — wait for the state to actually carry the change.
      await page.waitForFunction(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith("deck3d:"));
        const open = key ? (JSON.parse(localStorage.getItem(key) as string).open ?? {}) : {};
        return open.Layout === true && open.Look === false;
      });

      await setScope(page, "slide");
      const afterScope = await blocks(page);
      expect(afterScope.find((b) => b.title === "Layout")?.open).toBe(true);
      expect(afterScope.find((b) => b.title === "Look")?.open).toBe(false);

      await page.evaluate(() => window.__deck3d?.gotoSlide(2));
      await page.evaluate(() => (document.querySelector("#deck3d-hud [data-scope=deck]") as HTMLElement).click());
      const afterSlide = await blocks(page);
      expect(afterSlide.find((b) => b.title === "Layout")?.open).toBe(true);

      await page.reload();
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.keyboard.press("c");
      const afterReload = await blocks(page);
      expect(afterReload.find((b) => b.title === "Layout")?.open).toBe(true);
      expect(afterReload.find((b) => b.title === "Look")?.open).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it("applies a rail change to every slide without mutating the embedded IR", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page, errors } = await open(browser, await writeDeck());
      await page.keyboard.press("c");
      const before = await page.evaluate(() => window.__deck3d?.debug?.anchors?.() ?? []);

      await page.evaluate(() => {
        const sel = document.querySelector('#deck3d-hud [data-path="rail"]') as HTMLSelectElement;
        sel.value = "orbit";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });

      const after = await page.evaluate(() => window.__deck3d?.debug?.anchors?.() ?? []);
      expect(after.length).toBe(before.length);
      // Slide 1 stays at the origin on every rail; the rest must have moved.
      expect(after.slice(1).some((a, i) => a.rotY !== before[i + 1].rotY || a.pos[2] !== before[i + 1].pos[2])).toBe(true);
      expect(await page.evaluate(() => window.__DECK.defaults.rail)).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});

/**
 * F15 — the deck animates on its own clock after boot.
 *
 * `boot()` primed the first frame with `applyTime(0)`, which also sets
 * `frozen`, so every deck shipped pinned at t=0: the render loop ran, slide
 * transitions still moved the camera, and nothing in the scene ever moved.
 * `debug.motion()` fingerprints the animated transforms, so this fails on the
 * symptom a screenshot diff cannot isolate from camera idle drift.
 */
describe.skipIf(!hasChromium)("runtime clock (chromium)", () => {
  it("animates diagrams, backgrounds and local fx after boot, and freezes only on setTime", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { page } = await open(browser, await writeDeck());
      const first = await page.evaluate(() => window.__deck3d?.debug.motion());
      await page.waitForTimeout(1200);
      const later = await page.evaluate(() => window.__deck3d?.debug.motion());
      expect(later).not.toBe(first);

      // `check` pins the clock through setTime; that must still hold.
      await page.evaluate(() => window.__deck3d?.setTime(3));
      const frozenA = await page.evaluate(() => window.__deck3d?.debug.motion());
      await page.waitForTimeout(800);
      expect(await page.evaluate(() => window.__deck3d?.debug.motion())).toBe(frozenA);
      // ...and the same time always yields the same pose (determinism).
      await page.evaluate(() => window.__deck3d?.setTime(9));
      await page.evaluate(() => window.__deck3d?.setTime(3));
      expect(await page.evaluate(() => window.__deck3d?.debug.motion())).toBe(frozenA);
    } finally {
      await browser.close();
    }
  });
});

/**
 * #F16 — `globe`, `loop`, `swarm` and `orbit-cluster` spin a group that
 * CONTAINS its captions. Before the engine billboarded labels, those captions
 * turned edge-on as soon as the clock advanced and then faced away entirely:
 * fully legible at t=0 (which is all `check` ever measures) and unreadable in
 * the room. The rendered width of a spun label must survive time passing.
 */
describe.skipIf(!hasChromium)("F16 spun diagram labels keep facing the viewer (chromium)", () => {
  const md = [
    "---",
    "title: Spin",
    "---",
    "",
    "# Globe",
    "",
    "- EMEA",
    "- AMER",
    "- APAC",
    "",
  ].join("\n");

  it("keeps caption width stable while the topology rotates", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { ir } = await deriveDeckIR(parseMarkdown(md), { harvest: (src, id) => harvestDiagram(src, id) });
      ir.slides[0].diagram = { kind: "globe", data: { labels: ["EMEA", "AMER", "APAC"] } };
      const path = join(mkdtempSync(join(tmpdir(), "deck3d-f16-")), "deck.html");
      writeFileSync(path, renderDeck(ir, { runtime: await ensureRuntime() }));
      const { page } = await open(browser, path);

      const facingAt = async (t: number): Promise<number[]> =>
        (await page.evaluate((time) => {
          window.__deck3d?.gotoSlide(1);
          window.__deck3d?.setTime(time);
          return window.__deck3d?.debug.labelFacing() ?? [];
        }, t)) as number[];

      const front = await facingAt(0);
      expect(front.length).toBeGreaterThan(0);

      // A quarter turn (globe spins at 0.18 rad/s) puts unbillboarded captions
      // exactly edge-on; a half turn puts them backwards.
      for (const t of [Math.PI / 2 / 0.18, Math.PI / 0.18]) {
        for (const f of await facingAt(t)) expect(f).toBeGreaterThan(0.9);
      }

      // Same time ⇒ same pose: billboarding must not break determinism.
      expect(await facingAt(0)).toEqual(front);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 180_000);

});

// #F22 — a finished transition must LAND. The idle-drift smoothing applied
// during the fly too, so `anim` went null ~1.5 s before the camera arrived and
// the previous slide's backdrop stayed on screen.
describe.skipIf(!hasChromium)("F22 a finished transition lands on its anchor (chromium)", () => {
  const md = ["---", "title: Land", "---", "", "# One", "", "text", "", "# Two", "", "text", "", "# Three", "", "text", ""].join("\n");

  it("leaves no camera lag once anim clears", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { ir } = await deriveDeckIR(parseMarkdown(md), { harvest: (src, id) => harvestDiagram(src, id) });
      const path = join(mkdtempSync(join(tmpdir(), "deck3d-f22-")), "deck.html");
      writeFileSync(path, renderDeck(ir, { runtime: await ensureRuntime() }));
      const { page } = await open(browser, path);

      await page.evaluate(() => window.__deck3d?.gotoSlide(3));
      await page.waitForFunction(() => window.__deck3d?.debug.look().anim === null, undefined, { timeout: 15000 });
      await page.waitForTimeout(100);
      const gap = await page.evaluate(() => {
        const look = window.__deck3d!.debug.look();
        const anchor = window.__deck3d!.debug.anchors()[2] as { pos: number[] };
        return Math.abs((look.cam as number[])[0] - anchor.pos[0]);
      });
      // Idle drift is ±0.25 on x, so past 1 unit is lag, not drift.
      expect(gap).toBeLessThan(1);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// #F23 — `buildLoop` drew every caption twice: an extruded `buildTitle` mesh
// on the node PLUS the canvas label `addPart` adds for measurability. Only the
// measurable one is billboarded and sized by `labels.size`, so the pair
// visibly diverged.
describe.skipIf(!hasChromium)("F23 built topologies draw each caption once (chromium)", () => {
  const md = ["---", "title: Loop", "---", "", "# Cycle", "", "- Audit accounts", "- Swap in proof", "- Name governance", ""].join("\n");

  it("renders no duplicate caption geometry", async () => {
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const { ir } = await deriveDeckIR(parseMarkdown(md), { harvest: (src, id) => harvestDiagram(src, id) });
      ir.slides[0].diagram = { kind: "loop", data: { labels: ["Audit accounts", "Swap in proof", "Name governance"] } };
      const path = join(mkdtempSync(join(tmpdir(), "deck3d-f23-")), "deck.html");
      writeFileSync(path, renderDeck(ir, { runtime: await ensureRuntime() }));
      const { page } = await open(browser, path);
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      await page.waitForTimeout(600);

      // One measurable label per node, and no extra text-bearing node beside it.
      const counts = await page.evaluate(() => {
        const labels = window.__deck3d!.measure().filter((m) => m.kind === "label");
        return { labels: labels.length, nodes: window.__deck3d!.debug.sceneNodes() };
      });
      expect(counts.labels).toBe(3);
      // 32 with the extruded duplicate, 20 without: each node carried an
      // extra glyph group drawing the same words.
      expect(counts.nodes).toBeLessThan(32);
      await page.close();
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// #F24 — `goTo` disposed the outgoing slide's local fx on its FIRST line, so
// the backdrop vanished the instant the camera started moving while the slide's
// content stayed in frame for the whole fly.
describe.skipIf(!hasChromium)("F24 the outgoing backdrop survives the fly (chromium)", () => {
  it("keeps the previous slide's local fx alive until the transition ends", async () => {
    const { dir } = makeLocalDeck({
      markdown: "# Geo\n\n- one\n\n# Second\n\n- two\n\n# Third\n\n- three\n",
      slide: "geo",
      effects: [{ name: "spinner" }],
    });
    expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    try {
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__deck3d!.debug.localFxAt(0))).toBeGreaterThan(0);

      await page.evaluate(() => window.__deck3d?.gotoSlide(2));
      await page.waitForTimeout(250); // mid-fly
      const midFly = await page.evaluate(() => ({
        anim: window.__deck3d!.debug.look().anim !== null,
        prev: window.__deck3d!.debug.localFxAt(0),
      }));
      expect(midFly.anim).toBe(true);
      expect(midFly.prev).toBeGreaterThan(0);

      // ...and is reclaimed once the move completes.
      await page.waitForFunction(() => window.__deck3d!.debug.look().anim === null, undefined, { timeout: 15_000 });
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => window.__deck3d!.debug.localFxAt(0))).toBe(0);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// #F25 — the configurator persisted its state to localStorage and restored it
// into the CONTROLS on reload, but never replayed it into the scene: the panel
// read "blackbelt" while the deck rendered its default palette.
describe.skipIf(!hasChromium)("F25 configurator state survives a reload (chromium)", () => {
  it("replays persisted edits into the scene, not just the panel", async () => {
    const { dir } = makeLocalDeck({
      markdown: "# Geo\n\n- one\n\n# Second\n\n- two\n",
      slide: "geo",
      effects: [{ name: "spinner" }],
    });
    expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
    try {
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      const booted = await page.evaluate(() => window.__deck3d!.debug.look().bg);

      await page.keyboard.press("c");
      await openAllBlocks(page);
      await page.evaluate(() => {
        const n = document.querySelector('#deck3d-hud [data-path="palette"]') as HTMLSelectElement;
        n.value = "ember";
        n.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(400);
      const edited = await page.evaluate(() => window.__deck3d!.debug.look().bg);
      expect(edited).not.toBe(booted);

      await page.reload();
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.waitForTimeout(600);
      // The scene must come back as it was left, not at the deck default.
      expect(await page.evaluate(() => window.__deck3d!.debug.look().bg)).toBe(edited);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

// #F26 — Export was a blob download only. Inside a sandboxed iframe without
// `allow-downloads` (the dashboard's live-server viewer) Chrome drops it
// SILENTLY, so the panel looked dead. The JSON must always be reachable.
describe.skipIf(!hasChromium)("F26 export survives a download-blocked frame (chromium)", () => {
  it("shows the overrides JSON in-panel when the download cannot fire", async () => {
    const { dir } = makeLocalDeck({
      markdown: "# Geo\n\n- one\n\n# Second\n\n- two\n",
      slide: "geo",
      effects: [{ name: "spinner" }],
    });
    expect(runCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
    // Host the deck inside an opaque-origin, download-blocked frame.
    writeFileSync(
      join(dir, "host.html"),
      '<!doctype html><iframe id="f" src="deck.html" sandbox="allow-scripts allow-forms allow-popups" style="width:900px;height:560px;border:0"></iframe>',
    );

    const browser = await chromium.launch({ channel: "chromium" });
    const page = await browser.newPage({ viewport: { width: 940, height: 600 } });
    try {
      await page.goto(pathToFileURL(join(dir, "host.html")).href);
      const frame = page.frameLocator("#f");
      await page.waitForTimeout(2500);
      await frame.locator("#deck3d-hud-toggle").click();
      await frame.locator("#deck3d-hud button:has-text('Export')").click();
      const text = await frame.locator("#deck3d-hud-payload textarea").inputValue();
      // Valid D1-grammar JSON, reachable without any download.
      expect(() => JSON.parse(text) as unknown).not.toThrow();
    } finally {
      await browser.close();
    }
  }, 120_000);
});
