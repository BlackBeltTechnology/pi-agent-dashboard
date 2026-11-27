/**
 * L3 — scripted-frame player: fixed pre-measured stage, pane scroll guard, step controls.
 * Config: playwright.mock-site.config.ts (self-started site, no docker harness).
 * See change: mock-player-step-controls (test-plan P1, P2, F1-F19, X1, X3-X5).
 */

import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { EARLY_FOCUS_PANE, GUARD_MOCK, readMarker, SCRIPTED_MOCK, STAGE_MOCK, STEP_MOCK } from "./fixture.js";

const M = () => readMarker();
const url = (h = "") => `${M().url}/${h ? `#${h}` : ""}`;
const ready = async (page: Page) => { await expect(page.locator(".mk-frame").first()).toBeVisible(); await page.waitForTimeout(300); };
const S = SCRIPTED_MOCK;
const ST = STAGE_MOCK;
const G = GUARD_MOCK;
const P = STEP_MOCK;
const iframe = (page: Page, spec: string) => page.locator(`iframe[data-pane="${spec}"]`);
/** An isolated pane, scrolled near so its lazy iframe mounts. */
const pane = async (page: Page, spec: string) => {
  await page.locator(`[id="r-${spec}"]`).scrollIntoViewIfNeeded();
  return page.frameLocator(`iframe[data-pane="${spec}"]`);
};
const frameOf = async (page: Page, spec: string) => (await (await iframe(page, spec).elementHandle())!.contentFrame())!;
const staged = (page: Page, spec: string, timeout = 20_000) => expect(iframe(page, spec)).toHaveAttribute("data-mk-stage", "done", { timeout });
/** The iframe's set height (content box, px). */
const heightOf = (page: Page, spec: string) => iframe(page, spec).evaluate((el) => parseFloat((el as HTMLElement).style.height));
const topOf = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().top + scrollY);
const hostY = (page: Page) => page.evaluate(() => window.scrollY);
const health = (page: Page, spec: string) => page.locator(`[data-pane-health="${spec}"]`);
const completed = async (page: Page, spec: string) => Number(/loops: (\d+) completed/.exec((await health(page, spec).textContent()) ?? "")?.[1] ?? 0);
const ctl = (page: Page, spec: string) => {
  const h = health(page, spec);
  return { pause: h.locator(".mk-pp"), back: h.locator('[aria-label="Step back"]'), fwd: h.locator('[aria-label="Step forward"]') };
};
/** Pause, then step back until the pane rests at `0/n start`. */
async function pauseAtStart(page: Page, spec: string, n: number) {
  const c = ctl(page, spec);
  const cap = (await pane(page, spec)).locator(".mk-caption");
  await c.pause.click();
  await expect.poll(async () => {
    if ((await cap.textContent()) === `0/${n} start`) return "start";
    if ((await c.back.isVisible()) && (await c.back.getAttribute("aria-disabled")) !== "true") await c.back.click();
    await page.waitForTimeout(400);
    return (await cap.textContent()) === `0/${n} start` ? "start" : "moving";
  }, { timeout: 30_000, intervals: [100] }).toBe("start");
  return { c, cap };
}
/** Press an enabled control, then wait for the caption it lands on. */
async function press(b: Locator, cap: Locator, want: string) {
  await expect(b).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
  await b.click();
  await expect(cap).toHaveText(want, { timeout: 15_000 });
  await expect(b).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
}

// ── Fixed stage ────────────────────────────────────────────────────────────────

test("measuring is bounded; loading cover at stored / placeholder height, no caption (P1, F7)", async ({ browser }) => {
  test.setTimeout(120_000);
  const spec = `${ST}/3/proposed`;
  for (const stored of [null, 700]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
    if (stored) await ctx.addInitScript(([k, v]) => sessionStorage.setItem(k, v), [`mk-h:${spec}`, String(stored)]);
    const page = await ctx.newPage();
    await page.goto(url(`${ST}/3`));
    await expect(iframe(page, spec)).toHaveAttribute("data-mk-stage", "measuring");
    const t0 = Date.now();
    expect(await heightOf(page, spec)).toBe(stored ?? 240);
    await expect(page.locator(`[id="r-${spec}"] .mk-phone-load`)).toBeVisible();
    await expect((await frameOf(page, spec)).locator(".mk-caption.on")).toHaveCount(0);
    await staged(page, spec, 17_000);
    expect(Date.now() - t0).toBeLessThanOrEqual(16_000);
    await expect(page.locator(`[id="r-${spec}"] .mk-phone-load`)).toHaveCount(0);
    await ctx.close();
  }
});

test("the site does not move while a script expands and collapses (F6)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1600 });
  const spec = `${ST}/1/proposed`;
  await page.goto(url(`${ST}/1`)); await ready(page);
  await staged(page, spec);
  const h0 = await heightOf(page, spec);
  const below = page.locator(`[id="r-${ST}/2"]`);
  const t0 = await topOf(below);
  const c0 = await completed(page, spec);
  while ((await completed(page, spec)) < c0 + 3) {
    expect(await heightOf(page, spec)).toBe(h0);
    expect(await topOf(below)).toBe(t0);
    await page.waitForTimeout(250);
  }
  await expect(health(page, spec)).toContainText("0 failed");
});

test("an edited mock is re-measured on reload (F8)", async ({ page }) => {
  test.setTimeout(120_000);
  const id = "2026-10-04-e2e-edit";
  const dir = path.join(M().root, "mockups", id);
  const src = (h: number) => `import { useState } from "react";
function Tall() { const [o, setO] = useState(false); return <div><button type="button" data-testid="g" onClick={() => setO(true)}>g</button>{o ? <div data-testid="tall" style={{ height: ${h} }}>tall</div> : null}</div>; }
export default { title: "E2E edit", category: "Fixture", frames: [{ title: "Edit", loop: false, proposed: <Tall />, script: [{ say: "grow", target: "g", act: "click", expect: "tall" }] }] };
`;
  const spec = `${id}/1/proposed`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mock.tsx"), src(900));
  try {
    const load = async () => { await page.goto(url(`${id}/1`)); await page.reload(); await staged(page, spec, 25_000); return heightOf(page, spec); };
    let h1 = 0;
    await expect.poll(async () => { h1 = await load(); return h1; }, { timeout: 40_000 }).toBeGreaterThan(900);
    fs.writeFileSync(path.join(dir, "mock.tsx"), src(500));
    await expect.poll(async () => Math.abs(h1 - (await load()) - 400), { timeout: 40_000 }).toBeLessThanOrEqual(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await expect(page.locator(".mk-item", { hasText: "E2E edit" })).toHaveCount(0, { timeout: 15_000 }); // removal landed before the next test
});

test("content taller in the live loop grows the stage once, never shrinks (F10)", async ({ page }) => {
  // Fixture block appears after 1500 ms (plan: 800 ms): safely after the ~0.6 s fast pre-measure on a loaded machine.
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${G}/6/proposed`;
  await page.goto(url(`${G}/6`)); await ready(page);
  await staged(page, spec);
  await pane(page, spec); // panes above took their stages: bring this one back on screen (hidden panes hold)
  const h0 = await heightOf(page, spec);
  const c0 = await completed(page, spec);
  const seen = [h0];
  while ((await completed(page, spec)) < c0 + 2) {
    const h = await heightOf(page, spec);
    if (h !== seen[seen.length - 1]) seen.push(h);
    await page.waitForTimeout(100);
  }
  expect(seen.length).toBe(2); // exactly one growth
  expect(Math.abs(seen[1] - h0 - 200)).toBeLessThanOrEqual(4);
});

test("a typed suggestion list is part of the stage; height constant across loops (F9)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${G}/5/proposed`;
  await page.goto(url(`${G}/5`)); await ready(page);
  await staged(page, spec);
  await pane(page, spec); // panes above took their stages: bring this one back on screen (hidden panes hold)
  const h0 = await heightOf(page, spec);
  const f = await frameOf(page, spec);
  await expect(f.getByTestId("sugg")).toHaveCount(1, { timeout: 15_000 });
  const bottom = await f.getByTestId("sugg").evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
  expect(h0).toBeGreaterThanOrEqual(bottom);
  const c0 = await completed(page, spec);
  while ((await completed(page, spec)) < c0 + 2) {
    expect(await heightOf(page, spec)).toBe(h0);
    await page.waitForTimeout(250);
  }
});

test("reduced-motion step panes follow their own content (F11)", async ({ browser }) => {
  // A monotonic frame (plan: the F6 expand/collapse frame): non-scripted panes are grow-only since
  // before this change, so a step pane that passes through the expanded state keeps that height.
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 2400 } });
  const page = await ctx.newPage();
  await page.goto(url(`${ST}/10`));
  const s1 = `${ST}/10/proposed/step-1`;
  const s2 = `${ST}/10/proposed/step-2`;
  await pane(page, s1); await pane(page, s2);
  await expect((await frameOf(page, s2)).getByTestId("b2")).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(async () => (await heightOf(page, s2)) - (await heightOf(page, s1)), { timeout: 10_000 }).toBeGreaterThanOrEqual(296);
  expect((await heightOf(page, s2)) - (await heightOf(page, s1))).toBeLessThanOrEqual(304);
  await ctx.close();
});

test("a failing step during measurement: stage = height after step 1; failure counted once (X1)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${ST}/6/proposed`;
  await page.goto(url(`${ST}/6`)); await ready(page);
  await staged(page, spec);
  const h = await heightOf(page, spec);
  expect(h).toBeGreaterThan(330);
  await expect(health(page, spec)).toContainText("loops: 0 completed, 1 failed", { timeout: 15_000 });
  const content = await (await frameOf(page, spec)).evaluate(() => document.body.scrollHeight);
  expect(Math.abs(content - h)).toBeLessThanOrEqual(2);
  await page.waitForTimeout(1000);
  await expect(health(page, spec)).toContainText("loops: 0 completed, 1 failed");
});

test("a 300-char error keeps the health bar one line; the site does not move (F15)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${ST}/4/proposed`;
  await page.goto(url(`${ST}/4`)); await ready(page);
  await staged(page, spec);
  const below = page.locator(`[id="r-${ST}/5"]`);
  const t0 = await topOf(below);
  const bar = health(page, spec);
  const h0 = await bar.evaluate((el) => el.getBoundingClientRect().height);
  await expect(bar).toContainText("1 failed", { timeout: 15_000 });
  expect(await bar.evaluate((el) => el.getBoundingClientRect().height)).toBe(h0);
  expect(await topOf(below)).toBe(t0);
  const err = bar.locator(".mk-health-err");
  expect((await err.getAttribute("title"))!.length).toBeGreaterThan(300);
  expect(await err.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test("step controls do not change a phone frame's height (F17)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${ST}/7/proposed`;
  await page.goto(url(`${ST}/7`)); await ready(page);
  await staged(page, spec);
  const wrap = page.locator(`[id="r-${spec}"] .mk-phone-wrap`);
  const below = page.locator(`[id="r-${ST}/8"]`);
  const box = async () => [await wrap.evaluate((el) => el.getBoundingClientRect().height), await topOf(below)];
  const before = await box();
  const c = ctl(page, spec);
  await c.pause.click();
  await expect(c.back).toBeVisible();
  expect(await box()).toEqual(before);
  await c.pause.click();
  await expect(c.back).toBeHidden();
  expect(await box()).toEqual(before);
});

test("deep link to a ring inside a scripted pane lands after its stage (F18)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const spec = `${ST}/9/proposed`;
  await page.goto(url(`${spec}/1`));
  await staged(page, spec, 25_000);
  const f = await frameOf(page, spec);
  await expect.poll(() => f.locator(".mk-ring.mk-hit").count(), { timeout: 10_000 }).toBe(1);
  const inView = await page.evaluate((s) => {
    const fr = document.querySelector<HTMLIFrameElement>(`iframe[data-pane="${s}"]`)!;
    const ring = fr.contentDocument!.querySelector(".mk-ring")!.getBoundingClientRect();
    const top = fr.getBoundingClientRect().top + ring.top;
    return top >= 0 && top + ring.height <= innerHeight;
  }, spec);
  expect(inView).toBe(true);
});

// ── Pane scroll guard ──────────────────────────────────────────────────────────

/** Host scrolled so the pane's iframe top sits at `y` in the viewport. */
async function placePane(page: Page, spec: string, y: number) {
  const top = await topOf(iframe(page, spec));
  await page.evaluate((t) => scrollTo(0, t), top - y);
  await page.waitForTimeout(300);
  return hostY(page);
}
/** Load the guard mock at a 600 px viewport; the early-focus pane (frame 1) settled. */
async function guardPage(page: Page, frame: number) {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(url(`${G}/${frame}`)); await ready(page);
  await expect((await frameOf(page, EARLY_FOCUS_PANE)).getByTestId("early")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(`[id="r-${EARLY_FOCUS_PANE}"] .mk-phone-load`)).toHaveCount(0);
}

test("module-level focus in the app module does not scroll the page (F4)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 260 }); // the pane is cut by the fold: a native focus scroll would move the page
  await page.goto(url(G)); await ready(page);
  const f = await frameOf(page, EARLY_FOCUS_PANE);
  await expect(f.getByTestId("early")).toHaveCount(1, { timeout: 15_000 });
  expect(await f.evaluate(() => (window as unknown as { __mkEarlyFocused?: boolean }).__mkEarlyFocused)).toBe(true); // focus landed
  await page.waitForTimeout(1000);
  expect(await hostY(page)).toBe(0);
});

test("component focus + scrollIntoView on open never scroll the page, over 5 loops (P2, F2)", async ({ page }) => {
  test.setTimeout(150_000);
  const spec = `${G}/2/proposed`;
  await guardPage(page, 2);
  await staged(page, spec);
  const y0 = await placePane(page, spec, 100);
  const f = await frameOf(page, spec);
  const c0 = await completed(page, spec);
  let focused = false;
  while ((await completed(page, spec)) < c0 + 5) {
    expect(await hostY(page)).toBe(y0);
    if ((await f.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)) === "focused") focused = true;
    await page.waitForTimeout(150);
  }
  expect(focused).toBe(true);
  await expect(health(page, spec)).toContainText("0 failed");
});

test("a runner click on a target above the viewport does not scroll the page (F1)", async ({ page }) => {
  test.setTimeout(90_000);
  const spec = `${G}/3/proposed`;
  await guardPage(page, 3);
  await staged(page, spec);
  const y0 = await placePane(page, spec, -300);
  const f = await frameOf(page, spec);
  await expect.poll(async () => {
    expect(await hostY(page)).toBe(y0);
    return f.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid);
  }, { timeout: 30_000, intervals: [100] }).toBe("top");
  expect(await hostY(page)).toBe(y0);
});

test("inner scroll containers still reveal their rows; the page stays put (F3)", async ({ page }) => {
  const spec = `${G}/4/proposed`;
  await guardPage(page, 4);
  await staged(page, spec);
  const y0 = await placePane(page, spec, 100);
  await expect(health(page, spec)).toContainText("loops: 1 completed", { timeout: 15_000 });
  const f = await frameOf(page, spec);
  for (const id of ["list-auto", "list-hidden"]) {
    const r = await f.getByTestId(id).evaluate((l) => {
      const row = l.querySelector<HTMLElement>("[data-row='40']")!.getBoundingClientRect();
      const box = l.getBoundingClientRect();
      return { st: l.scrollTop, inside: row.top >= box.top - 1 && row.bottom <= box.bottom + 1 };
    });
    expect(r.st).toBeGreaterThan(0);
    expect(r.inside).toBe(true);
  }
  expect(await hostY(page)).toBe(y0);
});

test("a top-level pane keeps native scrolling (F5)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto(`${M().url}/?pane=${encodeURIComponent(`${G}/3/proposed`)}`);
  await expect.poll(() => hostY(page), { timeout: 20_000 }).toBeGreaterThan(0);
});

// ── Step controls ──────────────────────────────────────────────────────────────

test("step forward / back walk the script with resting captions; Back replays fresh fixtures (F12)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1600 });
  const spec = `${S}/5/proposed`;
  await page.goto(url(`${S}/5`)); await ready(page);
  await staged(page, spec);
  const f = await pane(page, spec);
  const { c, cap } = await pauseAtStart(page, spec, 3);
  const loops = await health(page, spec).textContent();
  await expect(f.locator("[data-flag=off]")).toHaveCount(1);
  await press(c.fwd, cap, "1/3 Toggle the flag");
  await expect(f.locator("[data-flag=on]")).toHaveCount(1);
  await press(c.fwd, cap, "2/3 Flag is on");
  await press(c.back, cap, "1/3 Toggle the flag");
  await expect(f.locator("[data-flag=on]")).toHaveCount(1); // replayed once on fresh fixtures
  await press(c.back, cap, "0/3 start");
  await expect(f.locator("[data-flag=off]")).toHaveCount(1);
  expect(await health(page, spec).textContent()).toBe(loops);
});

test("Forward at the end of a looping script remounts; a finished one-shot steps back (F13)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 3000 });
  const loopSpec = `${S}/5/proposed`;
  await page.goto(url(`${S}/5`)); await ready(page);
  await staged(page, loopSpec);
  const f = await pane(page, loopSpec);
  const { c, cap } = await pauseAtStart(page, loopSpec, 3);
  await press(c.fwd, cap, "1/3 Toggle the flag");
  await press(c.fwd, cap, "2/3 Flag is on");
  await press(c.fwd, cap, "3/3 Hover the toggle");
  await press(c.fwd, cap, "0/3 start");
  await expect(f.locator("[data-flag=off]")).toHaveCount(1);

  const oneShot = `${S}/9/proposed`;
  const g = await pane(page, oneShot);
  await staged(page, oneShot);
  await expect(health(page, oneShot)).toContainText("loops: 1 completed", { timeout: 20_000 });
  await expect(g.getByTestId("count")).toHaveText("count: 3");
  const o = ctl(page, oneShot);
  const ocap = g.locator(".mk-caption");
  await o.pause.click();
  await expect(o.back).toBeVisible();
  await press(o.back, ocap, "2/3 two");
  await expect(g.getByTestId("count")).toHaveText("count: 2");
});

test("controls are aria-disabled while a rewind replays; focus stays; extra presses ignored (F14)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1600 });
  const spec = `${P}/1/proposed`;
  await page.goto(url(`${P}/1`)); await ready(page);
  await staged(page, spec);
  const { c, cap } = await pauseAtStart(page, spec, 3);
  await press(c.fwd, cap, "1/3 first");
  await press(c.fwd, cap, "2/3 second");
  await press(c.fwd, cap, "3/3 third");
  await c.back.focus();
  await page.keyboard.press("Enter");
  await expect(c.back).toHaveAttribute("aria-disabled", "true");
  await expect(c.fwd).toHaveAttribute("aria-disabled", "true");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Step back");
  await page.keyboard.press("Enter"); // ignored while busy
  await expect(cap).toHaveText("2/3 second", { timeout: 15_000 });
  await expect(c.back).not.toHaveAttribute("aria-disabled", "true");
  await page.waitForTimeout(1500);
  await expect(cap).toHaveText("2/3 second");
});

test("controls show only when the reviewer paused, not when merely off-screen (F16)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const spec = `${P}/1/proposed`;
  await page.goto(url(`${P}/1`)); await ready(page);
  await staged(page, spec);
  const c = ctl(page, spec);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await expect(c.back).toBeHidden();
  await placePane(page, spec, 700); // partly back in view
  await expect(c.back).toBeHidden();
  await expect(c.fwd).toBeHidden();
  await c.pause.click();
  await expect(c.back).toBeVisible();
  await expect(c.fwd).toBeVisible();
});

test("a queued step waits while the pane is off-screen, runs once back (F19)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const spec = `${P}/1/proposed`;
  await page.goto(url(`${P}/1`)); await ready(page);
  await staged(page, spec);
  const f = await pane(page, spec);
  const { c, cap } = await pauseAtStart(page, spec, 3);
  await c.fwd.click();
  // a second Forward while step 1 runs (the shell disables its button while busy: post it as the shell does)
  await page.evaluate((s) => document.querySelector<HTMLIFrameElement>(`iframe[data-pane="${s}"]`)!.contentWindow!.postMessage({ mkStep: 1 }, "*"), spec);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3500);
  await expect(cap).toHaveText("1/3 first");
  await expect(f.getByTestId("n")).toHaveText("n: 1");
  await placePane(page, spec, 100);
  await expect(cap).toHaveText("2/3 second", { timeout: 15_000 });
  await expect(f.getByTestId("n")).toHaveText("n: 2", { timeout: 15_000 });
});

test("a step message from a sibling frame is ignored (X3)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  const spec = `${P}/1/proposed`;
  await page.goto(url(`${P}/1`)); await ready(page);
  await staged(page, spec);
  await pane(page, `${P}/3/proposed`);
  const f = await pane(page, spec);
  const { c, cap } = await pauseAtStart(page, spec, 3);
  const sib = await frameOf(page, `${P}/3/proposed`);
  await sib.evaluate((s) => parent.document.querySelector<HTMLIFrameElement>(`iframe[data-pane="${s}"]`)!.contentWindow!.postMessage({ mkStep: 1 }, "*"), spec);
  await page.waitForTimeout(1500);
  await expect(cap).toHaveText("0/3 start");
  await expect(f.getByTestId("n")).toHaveText("n: 0");
  await expect(c.back).not.toHaveAttribute("aria-disabled", "true");
});

test("an iframe reload never shrinks the stage and resets the controls (X4)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  const spec = `${P}/1/proposed`;
  await page.goto(url(`${P}/1`)); await ready(page);
  await staged(page, spec);
  const h0 = await heightOf(page, spec);
  const c = ctl(page, spec);
  await c.pause.click();
  await expect(c.back).toBeVisible();
  const f = await frameOf(page, spec);
  await f.evaluate(([s, h]) => parent.postMessage({ mkStage: s, h }, "*"), [spec, Math.max(1, h0 - 50)] as const); // a smaller second stage
  await page.waitForTimeout(500);
  expect(await heightOf(page, spec)).toBe(h0);
  await iframe(page, spec).evaluate((el) => (el as HTMLIFrameElement).contentWindow!.location.reload());
  await expect(c.pause).toHaveText("Pause", { timeout: 15_000 });
  await expect(c.back).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await heightOf(page, spec)).toBeGreaterThanOrEqual(h0);
});

test("no step controls after a failed loop (X5)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2400 });
  const spec = `${ST}/4/proposed`;
  await page.goto(url(`${ST}/4`)); await ready(page);
  await expect(health(page, spec)).toContainText("1 failed", { timeout: 25_000 });
  const c = ctl(page, spec);
  await c.pause.click();
  await page.waitForTimeout(800);
  await expect(c.back).toBeHidden();
  await expect(c.fwd).toBeHidden();
});
