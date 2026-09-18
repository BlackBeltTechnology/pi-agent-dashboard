import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser-layer gate for change `fix-long-session-ux-degradation` §7
 * (capability `ui-animation-energy`, design D8) — test-plan rows F16–F20.
 *
 * These assert the real Chrome computed `animation-play-state`, which jsdom
 * cannot produce: the `useIdleFx` unit suite proves the class lands, and this
 * suite proves the cascade does what the class promises — including the two
 * precedence inversions an exemption-only CSS form gets wrong (F19/F20).
 *
 * F16/F17 drive the live hook end to end (idle delay → class → resume), so they
 * require `useIdleFx()` to be mounted in `App.tsx` next to `useAppHidden()`.
 * F18–F20 pin the cascade directly by toggling the root classes, which is the
 * contract under test independent of the timer.
 *
 * The injected `#fx-e2e-fixture` carries the exact classes the spec names:
 * `animate-pulse` / `.tool-group-spin-pulse` (decorative — must pause),
 * `animate-spin` / `.fx-progress` (indeterminate rotation — exempt while idle),
 * plus `.fx-offscreen` copies for the off-screen precedence case. `fx-progress`
 * carries its `animation` as an INLINE style, mirroring `@mdi/react`'s `spin`.
 */

const IDLE_CLASS = "fx-idle";
const HIDDEN_CLASS = "app-hidden";

async function injectFxFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("#fx-e2e-fixture")?.remove();
    const host = document.createElement("div");
    host.id = "fx-e2e-fixture";
    host.style.cssText =
      "position:fixed;top:0;left:0;z-index:-1;pointer-events:none;width:1px;height:1px;overflow:visible";
    const box = "width:8px;height:8px;background:#000";
    host.innerHTML = `
      <div data-fx="pulse" class="animate-pulse" style="${box}"></div>
      <div data-fx="group-pulse" class="tool-group-spin-pulse" style="${box}"></div>
      <div data-fx="spin" class="animate-spin" style="${box}"></div>
      <div data-fx="progress" class="fx-progress" style="${box};animation:spin 1s linear infinite"></div>
      <div class="fx-offscreen"><div data-fx="offscreen-spin" class="animate-spin" style="${box}"></div></div>
      <div class="fx-offscreen"><div data-fx="offscreen-progress" class="fx-progress" style="${box};animation:spin 1s linear infinite"></div></div>
    `;
    document.body.appendChild(host);
  });
}

/** Computed `animation-play-state` for the first match of `selector`. */
function playState(page: Page, selector: string, pseudo?: "::before"): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el, p ?? undefined).animationPlayState, pseudo);
}

async function setRootClasses(page: Page, add: string[], remove: string[] = []): Promise<void> {
  await page.evaluate(
    ({ add, remove }) => {
      for (const c of remove) document.documentElement.classList.remove(c);
      for (const c of add) document.documentElement.classList.add(c);
    },
    { add, remove },
  );
}

const rootHasClass = (page: Page, cls: string) =>
  page.evaluate((c) => document.documentElement.classList.contains(c), cls);

test.describe("idle FX pause (ui-animation-energy)", () => {
  // ── F16: an idle but visible dashboard pauses decorative animations ─────────
  test("F16: no input for the idle delay pauses decorative animations", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    // Inject AFTER the spawn helper's navigation — a page load wipes the node.
    await injectFxFixture(page);

    await expect
      .poll(() => rootHasClass(page, IDLE_CLASS), { timeout: 15_000 })
      .toBe(true);

    // Decorative liveness (injected) and the selected card's real rotating glow
    // (`.card-glow-fx::before`) both report paused.
    expect(await playState(page, '[data-fx="pulse"]')).toBe("paused");
    expect(await playState(page, '[data-fx="group-pulse"]')).toBe("paused");
    expect(
      await playState(page, "[data-testid='session-card-desktop'] .card-glow-fx", "::before"),
    ).toBe("paused");
  });

  // ── F17: the first deliberate input resumes within a frame ──────────────────
  test("F17: a pointerdown clears the idle mark and resumes animations", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    // Inject AFTER the spawn helper's navigation — a page load wipes the node.
    await injectFxFixture(page);

    await expect
      .poll(() => rootHasClass(page, IDLE_CLASS), { timeout: 15_000 })
      .toBe(true);

    await page.mouse.down();
    await page.mouse.up();

    await expect.poll(() => rootHasClass(page, IDLE_CLASS), { timeout: 5_000 }).toBe(false);
    await expect.poll(() => playState(page, '[data-fx="pulse"]'), { timeout: 5_000 }).toBe("running");
  });

  test.describe("exemption ladder", () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
      await injectFxFixture(page);
    });

    // ── F18: indeterminate rotation keeps running while idle ──────────────────
    test("F18: animate-spin and fx-progress stay running under fx-idle", async ({ page }) => {
      await setRootClasses(page, [IDLE_CLASS], [HIDDEN_CLASS]);

      expect(await playState(page, '[data-fx="spin"]')).toBe("running");
      expect(await playState(page, '[data-fx="progress"]')).toBe("running");
      // …but decorative liveness stays subject to the pause.
      expect(await playState(page, '[data-fx="pulse"]')).toBe("paused");
      expect(await playState(page, '[data-fx="group-pulse"]')).toBe("paused");
    });

    // ── F19: the hidden-window pause beats the exemption ──────────────────────
    test("F19: app-hidden re-pauses the exempt indicators", async ({ page }) => {
      await setRootClasses(page, [IDLE_CLASS, HIDDEN_CLASS]);

      expect(await playState(page, '[data-fx="spin"]')).toBe("paused");
      expect(await playState(page, '[data-fx="progress"]')).toBe("paused");
    });

    // ── F20: the off-screen pause beats the exemption ─────────────────────────
    test("F20: an .fx-offscreen indicator stays paused while fx-idle", async ({ page }) => {
      await setRootClasses(page, [IDLE_CLASS], [HIDDEN_CLASS]);

      expect(await playState(page, '[data-fx="offscreen-spin"]')).toBe("paused");
      expect(await playState(page, '[data-fx="offscreen-progress"]')).toBe("paused");
      // The same indicators outside the off-screen container remain exempt.
      expect(await playState(page, '[data-fx="spin"]')).toBe("running");
      expect(await playState(page, '[data-fx="progress"]')).toBe("running");
    });
  });
});
