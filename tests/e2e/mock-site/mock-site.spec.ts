/**
 * L3 — live-component mock site, rendered (self-started site, no docker harness).
 * Config: playwright.mock-site.config.ts. See change: add-live-component-mock-site
 * (test-plan E20, P1, F1-F16, X5-X7), fix-mock-site-ux (test-plan U2-U11) and
 * add-mock-site-exact-env (test-plan E11, E12, F1-F5, F7-F11, X11; task 3.5 / 6.3).
 */
import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIXTURE_MOCK, PILLS_MOCK, REPO_ROOT, SCRIPTED_MOCK, SOLID_MOCK, readMarker } from "./fixture.js";

const M = () => readMarker();
const url = (h = "") => `${M().url}/${h ? `#${h}` : ""}`;
const decisionFile = (id: string) => path.join(M().root, "mockups", id, "decision.json");
const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(REPO_ROOT, "packages/mockup-loop/src/mock-site/cli.mjs"), ...args], { cwd: M().root, encoding: "utf8" });
const ready = async (page: Page) => { await expect(page.locator(".mk-frame").first()).toBeVisible(); await page.waitForTimeout(300); };
const reset = () => { for (const id of [PILLS_MOCK, FIXTURE_MOCK, SCRIPTED_MOCK]) fs.rmSync(decisionFile(id), { force: true }); };
const S = SCRIPTED_MOCK;
/** An isolated pane, scrolled near so its lazy iframe mounts. */
const isoPane = async (page: Page, spec: string) => {
  await page.locator(`[id="r-${spec}"]`).scrollIntoViewIfNeeded();
  return page.frameLocator(`iframe[data-pane="${spec}"]`);
};
const health = (page: Page, spec: string) => page.locator(`[data-pane-health="${spec}"]`);
const PKG = path.join(REPO_ROOT, "packages/mockup-loop");

test.beforeEach(() => reset());
test.afterAll(() => reset());

test("every part carries its ref id (F13)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const ids = await page.$$eval("[id^='r-']", (es) => es.map((e) => e.id));
  for (const s of ["/1", "/1/current", "/1/proposed", "/1/current/1", "/1/current/2", "/1/proposed/1", "/1/proposed/2", "/2", "/2/current", "/2/proposed"]) expect(ids).toContain(`r-${PILLS_MOCK}${s}`);
});

test("ring lint: TIP > 40 and BAD N (E20)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  const ring1 = page.locator(`[id="r-${FIXTURE_MOCK}/1/current/1"]`);
  await expect(ring1).toBeVisible();
  await expect(ring1.locator(".mk-long")).toHaveCount(0);
  await expect(page.locator(`[id="r-${FIXTURE_MOCK}/1/current/x-2"] .mk-long`)).toHaveText("TIP > 40");
  await expect(page.locator(".mk-long", { hasText: "BAD N" })).toHaveCount(1);
  expect(await page.$$eval("[id]", (es) => es.filter((e) => e.id.includes("a/b")).length)).toBe(0);
});

test("badges stay locked to their rings while scrolling (P1)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(PILLS_MOCK)); await ready(page);
  let worst = 0;
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 120);
    const d = await page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => {
      let m = 0;
      for (const ring of document.querySelectorAll(".mk-ring")) {
        const b = ring.querySelector(".mk-ring-n"); if (!b) continue;
        const a = ring.getBoundingClientRect(), n = b.getBoundingClientRect();
        m = Math.max(m, Math.abs(n.top - a.top + 15), Math.abs(n.left - a.left + 15));
      }
      r(m);
    })));
    worst = Math.max(worst, d);
  }
  expect(worst).toBeLessThanOrEqual(0.5);
});

test("badges pass under the sticky bar (F1)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const ring = page.locator(`[id="r-${PILLS_MOCK}/1/current/1"]`);
  const barH = await page.locator(".mk-bar").evaluate((b) => b.getBoundingClientRect().height);
  const top = await ring.evaluate((r) => r.getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => scrollTo(0, y), top - 10);
  const hit = await page.evaluate(() => {
    const b = document.querySelector(".mk-ring .mk-ring-n") as HTMLElement;
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".mk-bar") !== null;
  });
  expect(barH).toBeGreaterThan(20);
  expect(hit).toBe(true);
});

test("hover tip shows above the bar, closes on scroll and leave (F2)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const ring = page.locator(`[id="r-${PILLS_MOCK}/1/proposed/2"]`);
  await ring.scrollIntoViewIfNeeded();
  await ring.hover();
  const tip = page.locator(".mk-tip");
  await expect(tip).toHaveText("Banner with recovery actions");
  const z = await tip.evaluate((t) => Number(getComputedStyle(t).zIndex));
  const barZ = await page.locator(".mk-bar").evaluate((b) => Number(getComputedStyle(b).zIndex));
  expect(z).toBeGreaterThan(barZ);
  await page.mouse.wheel(0, 100);
  await expect(tip).toHaveCount(0);
  await ring.hover();
  await expect(tip).toHaveCount(1);
  await page.mouse.move(2, 2);
  await expect(tip).toHaveCount(0);
});

test("phone frame is a real 375px viewport sized to content (F3)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const frame = page.frameLocator("iframe.mk-phone").first();
  await expect(frame.locator(".mk-canvas")).toBeVisible();
  const handle = await page.locator("iframe.mk-phone").first().elementHandle();
  const f = await handle!.contentFrame();
  expect(await f!.evaluate(() => innerWidth)).toBe(375);
  await expect.poll(async () => {
    const h = await page.locator("iframe.mk-phone").first().evaluate((e) => (e as HTMLIFrameElement).clientHeight);
    const sh = await f!.evaluate(() => document.documentElement.scrollHeight);
    return Math.abs(h - sh);
  }).toBeLessThanOrEqual(1);
});

test("edge ring badge is fully inside the phone pane (F4)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  const el = await page.locator(`[id="r-${FIXTURE_MOCK}/2/current"] iframe`).elementHandle();
  const f = (await el!.contentFrame())!;
  await expect.poll(() => f.locator(".mk-ring-n").count()).toBe(1);
  const r = await f.evaluate(() => { const b = document.querySelector(".mk-ring-n")!.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, w: innerWidth }; });
  expect(r.l).toBeGreaterThanOrEqual(0);
  expect(r.t).toBeGreaterThanOrEqual(0);
  expect(r.r).toBeLessThanOrEqual(r.w);
});

for (const cs of ["light", "dark"] as const) {
  test(`system theme default follows ${cs} (F5)`, async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: cs });
    const page = await ctx.newPage();
    await page.goto(url(PILLS_MOCK)); await ready(page);
    await expect(page.locator(".mk-theme button", { hasText: "System" })).toHaveAttribute("aria-pressed", "true");
    const attr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(attr).toBe(cs === "light" ? "light" : null);
    const f = (await (await page.locator("iframe.mk-phone").first().elementHandle())!.contentFrame())!;
    await expect.poll(() => f.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(cs === "light" ? "light" : null);
    await ctx.close();
  });
}

test("OS switch re-applies without reload (F6)", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(url(PILLS_MOCK)); await ready(page);
  let loads = 0; page.on("load", () => loads++);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(null);
  const f = (await (await page.locator("iframe.mk-phone").first().elementHandle())!.contentFrame())!;
  await expect.poll(() => f.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(null);
  expect(loads).toBe(0);
  await ctx.close();
});

test("sticky bar colour equals page colour in every theme (F7)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  for (const label of ["System", "Dark", "Light"]) {
    await page.locator(".mk-theme button", { hasText: label }).click();
    const [body, bar] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector(".mk-bar")!).backgroundColor]);
    expect(bar, label).toBe(body);
  }
});

test("no decision controls; CLI decisions show read-only; decide endpoint gone (F11 add-mock-site-exact-env)", async ({ page }) => {
  expect(cli("accept", FIXTURE_MOCK, "fine").status).toBe(0);
  await page.goto(url(PILLS_MOCK)); await ready(page);
  await expect(page.getByRole("button", { name: /^(Accept page|Reject page|Reopen)/ })).toHaveCount(0);
  await expect(page.locator(".mk-ch .mk-pill")).toHaveText(/open/i);
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await expect(page.locator(".mk-ch .mk-pill")).toHaveText(/accepted/i);
  await expect(page.locator(".mk-by")).toHaveText(/by agent/);
  await expect(page.getByRole("button", { name: /^(Accept page|Reject page|Reopen)/ })).toHaveCount(0);
  const r = await page.request.post(`${M().url}/__mock/decide`, { data: { id: PILLS_MOCK, status: "accepted" } });
  expect(r.status()).toBe(404);
  expect(fs.existsSync(decisionFile(PILLS_MOCK))).toBe(false);
});

test("CLI decisions reach the open tab without reload (F9)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  let loads = 0; page.on("load", () => loads++);
  expect(cli("reject", PILLS_MOCK, "why not").status).toBe(0);
  await expect(page.locator(".mk-by")).toHaveText(/by agent/);
  await expect(page.locator(".mk-note")).toHaveText("why not");
  expect(cli("reopen", PILLS_MOCK).status).toBe(0);
  await expect(page.locator(".mk-ch .mk-pill")).toHaveText(/open/i);
  expect(loads).toBe(0);
});

test("deep link to a ring scrolls + highlights it (F10)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(`${PILLS_MOCK}/1/proposed/2`));
  const ring = page.locator(`[id="r-${PILLS_MOCK}/1/proposed/2"]`);
  await expect(ring).toHaveClass(/mk-hit/);
  await expect(ring).toBeInViewport();
});

test("deep link to a ring inside a phone frame (F11)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(`${PILLS_MOCK}/2/current/1`));
  const iframe = page.locator(`[id="r-${PILLS_MOCK}/2/current"] iframe`);
  const f = (await (await iframe.elementHandle())!.contentFrame())!;
  await expect.poll(() => f.locator(".mk-ring.mk-hit").count(), { timeout: 8000 }).toBe(1);
  const inView = await page.evaluate(async () => {
    const fr = document.querySelector<HTMLIFrameElement>(`iframe.mk-phone`)!;
    const ring = fr.contentDocument!.querySelector(".mk-ring")!.getBoundingClientRect();
    const top = fr.getBoundingClientRect().top + ring.top;
    return top >= 0 && top + ring.height <= innerHeight;
  });
  expect(inView).toBe(true);
});

test("ref links copy their URL; iframe ring click navigates the top page (F12)", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await page.goto(url(PILLS_MOCK)); await ready(page);
  await page.locator(".mk-fh .mk-ref").first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${M().url}/#${PILLS_MOCK}/1`);
  const f = page.frameLocator(`[id="r-${PILLS_MOCK}/2/current"] iframe`);
  await f.locator(".mk-ring-n").first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${PILLS_MOCK}/2/current/1`);
  await ctx.close();
});

test("Tailwind classes from mock and app sources are generated (F14)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await expect(page.getByTestId("tw-mock")).toHaveCSS("margin-top", "13px");
  // InlineMessage's own `rounded-xl` (a class used only in app sources) must be generated.
  const radius = await page.getByText("app css", { exact: true }).evaluate((e) => {
    for (let n: Element | null = e; n; n = n.parentElement) { const r = parseFloat(getComputedStyle(n).borderTopLeftRadius); if (r > 0 && !n.classList.contains("mk-canvas")) return r; }
    return 0;
  });
  expect(radius).toBeGreaterThan(0);
});

test("fixed app part stays inside its pane (F15)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await page.mouse.wheel(0, 200);
  const [c, p] = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='fixed-child']")!;
    const pane = el.closest(".mk-canvas")!;
    const a = el.getBoundingClientRect(), b = pane.getBoundingClientRect();
    return [{ t: a.top, l: a.left, r: a.right }, { t: b.top, l: b.left, r: b.right }];
  });
  expect(c.t).toBeGreaterThanOrEqual(p.t - 1);
  expect(c.l).toBeGreaterThanOrEqual(p.l - 1);
  expect(c.r).toBeLessThanOrEqual(p.r + 1);
  const barTop = await page.evaluate(() => { const b = document.querySelector(".mk-bar")!.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest(".mk-bar") !== null; });
  expect(barTop).toBe(true);
});

test("new / removed mock dirs appear and disappear (F16)", async ({ page }) => {
  const dir = path.join(M().root, "mockups", "2026-11-09-late");
  await page.goto(url(PILLS_MOCK)); await ready(page);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mock.tsx"), "export default { title: 'Late arrival', category: 'Fixture', frames: [{ title: 'x', proposed: 'late' }] };\n");
  await expect(page.locator(".mk-item", { hasText: "Late arrival" })).toHaveCount(1, { timeout: 15_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  await expect(page.locator(".mk-item", { hasText: "Late arrival" })).toHaveCount(0, { timeout: 15_000 });
});

test("bad pane spec shows an error panel (X5)", async ({ page }) => {
  for (const spec of [`${PILLS_MOCK}/9/current`, `${PILLS_MOCK}/x/current`]) {
    await page.goto(`${M().url}/?pane=${encodeURIComponent(spec)}`);
    await expect(page.locator(".mk-error")).toContainText(spec);
  }
});

test("duplicate ids are reported, others still listed (X6)", async ({ page }) => {
  const dup = path.join(M().root, "openspec/changes/x/mockups", PILLS_MOCK);
  fs.mkdirSync(dup, { recursive: true });
  fs.copyFileSync(path.join(M().root, "mockups", PILLS_MOCK, "mock.tsx"), path.join(dup, "mock.tsx"));
  try {
    await page.goto(url()); await page.waitForTimeout(1500); await page.reload();
    await expect(page.locator(".mk-problems")).toContainText(`duplicate mock id ${PILLS_MOCK}`);
    await expect(page.locator(".mk-item", { hasText: "E2E fixture" })).toHaveCount(1);
  } finally {
    fs.rmSync(path.join(M().root, "openspec/changes/x"), { recursive: true, force: true });
  }
  await page.waitForTimeout(1500);
});

test("malformed decision file: listed as open with a warning (X7)", async ({ page }) => {
  fs.writeFileSync(decisionFile(FIXTURE_MOCK), "{");
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await expect(page.locator(".mk-item", { hasText: "E2E fixture" })).toHaveCount(1);
  await expect(page.locator(".mk-problems")).toContainText(path.join(FIXTURE_MOCK, "decision.json"));
});

// ---- fix-mock-site-ux (test-plan U2-U11) ----

test("steps render side by side with step refs (U2)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const steps = page.locator(`[id="r-${PILLS_MOCK}/3"] .mk-step`);
  await expect(steps).toHaveCount(3);
  await expect(steps.locator(".mk-step-l b")).toHaveText(["3a", "3b", "3c"]);
  for (const k of [1, 2, 3]) await expect(page.locator(`[id="r-${PILLS_MOCK}/3/proposed/step-${k}"]`)).toHaveCount(1);
});

test("deep link to a step scrolls + highlights it (U3)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(`${PILLS_MOCK}/3/proposed/step-2`));
  const step = page.locator(`[id="r-${PILLS_MOCK}/3/proposed/step-2"]`);
  await expect(step).toHaveClass(/mk-hit/);
  await expect(step).toBeInViewport();
});

test("animated steps advance and stop on Pause (U4)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  const player = page.locator(`[id="r-${FIXTURE_MOCK}/3"] .mk-player`);
  await expect(player.locator(".mk-scene.on")).toHaveCount(1);
  await expect(player.locator(".mk-scene.on")).toHaveText("scene one");
  await expect(player.locator(".mk-scene.on")).toHaveText("scene two", { timeout: 4000 });
  await player.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(3000);
  await expect(player.locator(".mk-scene.on")).toHaveText("scene two");
});

test("reduced motion renders animated steps side by side (U5)", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  const frame = page.locator(`[id="r-${FIXTURE_MOCK}/3"]`);
  await expect(frame.locator(".mk-player")).toHaveCount(0);
  await expect(frame.locator(".mk-step")).toHaveCount(2);
  await ctx.close();
});

test("steps plus panes: reported, steps shown (U6)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await expect(page.locator(".mk-problems")).toContainText(`${FIXTURE_MOCK} frame 4`);
  await expect(page.locator(`[id="r-${FIXTURE_MOCK}/4"]`)).toContainText("step wins");
  await expect(page.locator(`[id="r-${FIXTURE_MOCK}/4"]`)).not.toContainText("ignored");
});

test("overview cards link to their frame (U7)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const cards = page.locator("section.mk-change", { has: page.locator(`h1 a.mk-ref`, { hasText: `#${PILLS_MOCK}` }) }).locator(".mk-ov-card");
  await expect(cards).toHaveCount(4);
  await cards.nth(1).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#${PILLS_MOCK}/2`);
});

test("frame reason renders; long reason is linted (U8)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  await expect(page.locator(`[id="r-${PILLS_MOCK}/1"] .mk-why`)).toContainText("Missing folder wins");
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  await expect(page.locator(`[id="r-${FIXTURE_MOCK}/1"] .mk-why .mk-long`)).toHaveText("WHY > 120");
});

test("phone badge does not cover the ringed content (U9)", async ({ page }) => {
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const f = (await (await page.locator(`[id="r-${PILLS_MOCK}/2/current"] iframe`).elementHandle())!.contentFrame())!;
  await expect.poll(() => f.locator(".mk-ring-n").count()).toBeGreaterThan(0);
  const overlap = await f.evaluate(() => {
    const ring = document.querySelector(".mk-ring")!, b = ring.querySelector(".mk-ring-n")!;
    const r = ring.getBoundingClientRect(), n = b.getBoundingClientRect();
    return !(n.bottom <= r.top || n.top >= r.bottom || n.right <= r.left || n.left >= r.right);
  });
  expect(overlap).toBe(false);
});

test("a ring keeps its items on one row (U10)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url(PILLS_MOCK)); await ready(page);
  const mids = await page.locator(`[id="r-${PILLS_MOCK}/1/current/1"]`).evaluate((r) =>
    [...r.children].filter((c) => !c.classList.contains("mk-ring-n") && !c.classList.contains("mk-long")).map((c) => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; }));
  expect(mids.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(1);
});

test("no mocks shows the empty state (U11)", async ({ page }) => {
  const mockups = path.join(M().root, "mockups");
  const aside = path.join(M().root, "aside");
  fs.mkdirSync(aside, { recursive: true });
  const all = [PILLS_MOCK, FIXTURE_MOCK, SCRIPTED_MOCK, SOLID_MOCK];
  for (const id of all) fs.renameSync(path.join(mockups, id), path.join(aside, id));
  try {
    await page.waitForTimeout(1500);
    await page.goto(url());
    await expect(page.locator(".mk-none")).toContainText("No mocks yet", { timeout: 15_000 });
    await expect(page.locator(".mk-none")).toContainText("mockups/<yyyy-mm-dd-slug>/mock.tsx");
  } finally {
    for (const id of all) fs.renameSync(path.join(aside, id), path.join(mockups, id));
  }
  await page.waitForTimeout(1500);
  await page.goto(url());
  await expect(page.locator(".mk-item", { hasText: "E2E fixture" })).toHaveCount(1, { timeout: 15_000 });
});

test("a phone steps frame renders each step in a 375px iframe (U12)", async ({ page }) => {
  await page.goto(url(FIXTURE_MOCK)); await ready(page);
  const frames = page.locator(`[id="r-${FIXTURE_MOCK}/5"] iframe.mk-phone`);
  await expect(frames).toHaveCount(2);
  await expect(frames.first()).toHaveAttribute("src", `?pane=${encodeURIComponent(`${FIXTURE_MOCK}/5/proposed/step-1`)}`);
  const f = (await frames.first().elementHandle())!.contentFrame();
  await expect.poll(async () => (await f)!.locator("text=phone one").count()).toBe(1);
});

// ---- add-mock-site-exact-env ----

test("unsupported framework: page error, other mocks render (F1)", async ({ page }) => {
  await page.goto(url(SOLID_MOCK));
  await expect(page.locator(".mk-main .mk-error")).toContainText('framework "solid" has no mock-site adapter (supported: react)');
  await expect(page.locator(".mk-problems")).toContainText(SOLID_MOCK);
  await page.goto(url(PILLS_MOCK)); await ready(page);
  await expect(page.locator(`[id="r-${PILLS_MOCK}/1/proposed/1"]`)).toBeVisible();
});

test("fixture + script frame renders real components in same-origin iframes (F2)", async ({ page }) => {
  await page.goto(url(`${PILLS_MOCK}/4`)); await ready(page);
  const f = await isoPane(page, `${PILLS_MOCK}/4/proposed`);
  await expect(f.locator("text=/no longer exists|Re-linked/").first()).toBeVisible({ timeout: 15_000 });
  const el = await page.locator(`iframe[data-pane="${PILLS_MOCK}/4/proposed"]`).elementHandle();
  const frame = (await el!.contentFrame())!;
  expect(new URL(frame.url()).origin).toBe(new URL(page.url()).origin);
  await expect(health(page, `${PILLS_MOCK}/4/proposed`)).toContainText(/loops: [1-9]\d* completed, 0 failed/, { timeout: 20_000 });
});

test("bounded waits: late target passes; missing / slow targets fail naming the step (E11)", async ({ page }) => {
  await page.goto(url(`${S}/1`)); await ready(page);
  for (const n of [1, 2, 3]) await isoPane(page, `${S}/${n}/proposed`);
  await expect(health(page, `${S}/1/proposed`)).toContainText("loops: 1 completed, 0 failed", { timeout: 15_000 });
  await expect(health(page, `${S}/2/proposed`)).toContainText('Step 1/1 "click never" failed: no element matches `never` within 4000 ms', { timeout: 15_000 });
  await expect(health(page, `${S}/3/proposed`)).toContainText('Step 1/1 "click slow" failed: no element matches `slow` within 1000 ms', { timeout: 15_000 });
  await expect((await isoPane(page, `${S}/2/proposed`)).locator(".mk-caption.mk-cap-err")).toContainText("`never`");
});

test("unless skips a step whose goal holds; a failed expect names the step (E12)", async ({ page }) => {
  await page.goto(url(`${S}/4`)); await ready(page);
  const f = await isoPane(page, `${S}/4/proposed`);
  await expect(health(page, `${S}/4/proposed`)).toContainText('Step 2/2 "expect the impossible" failed: expect `nope` did not hold within 500 ms', { timeout: 15_000 });
  await expect(f.getByTestId("raw-clicks")).toHaveText("clicks: 0");
});

test("stateful fixtures: panes isolated, pointer aims before the click, captions per step, loops reset (F3, F8, F9)", async ({ page }) => {
  await page.goto(url(`${S}/5`)); await ready(page);
  const cur = await isoPane(page, `${S}/5/current`);
  const pro = await isoPane(page, `${S}/5/proposed`);
  const cap = pro.locator(".mk-caption");
  for (const t of ["1/3 Toggle the flag", "2/3 Flag is on", "3/3 Hover the toggle"]) await expect(cap).toHaveText(t, { timeout: 15_000 });
  await expect(pro.locator("[data-flag=on]")).toHaveCount(1);
  await expect(cur.locator("[data-flag=off]")).toHaveCount(1);
  await expect(pro.getByTestId("aim")).toHaveText("on-target");
  await expect(pro.locator(".mk-cursor")).toHaveCSS("pointer-events", "none");
  // loop 2 starts from the original fixture data (else its "toggle → on" expect fails)
  await expect(pro.locator("[data-flag=off]")).toHaveCount(1, { timeout: 15_000 });
  await expect(health(page, `${S}/5/proposed`)).toContainText(/loops: ([2-9]|\d{2,}) completed, 0 failed/, { timeout: 30_000 });
  await expect(cur.locator("[data-flag=off]")).toHaveCount(1);
});

test("WebSocket fixture reaches the app (F4)", async ({ page }) => {
  await page.goto(url(`${S}/6`)); await ready(page);
  await expect((await isoPane(page, `${S}/6/proposed`)).getByTestId("feed")).toHaveText("hello from fixture", { timeout: 15_000 });
});

test("unfixtured request: 501 in the pane, listed once as a missing fixture (F5)", async ({ page }) => {
  await page.goto(url(`${S}/7`)); await ready(page);
  await expect((await isoPane(page, `${S}/7/proposed`)).getByTestId("unmocked")).toHaveText("status 501", { timeout: 15_000 });
  const panel = page.locator(".mk-missing");
  await expect(panel.locator("li", { hasText: "GET /api/unmocked" })).toHaveCount(1);
  await expect(panel).toContainText(`#${S}/7/proposed`);
});

test("two scripted frames run together without crossing over (F7)", async ({ page }) => {
  await page.goto(url(`${S}/5`)); await ready(page);
  const a = await isoPane(page, `${S}/5/proposed`);
  const b = await isoPane(page, `${S}/8/proposed`);
  await expect(health(page, `${S}/8/proposed`)).toContainText(/loops: [1-9]\d* completed, 0 failed/, { timeout: 20_000 });
  await expect(health(page, `${S}/5/proposed`)).toContainText(/loops: [1-9]\d* completed, 0 failed/, { timeout: 20_000 });
  await expect(b.getByTestId("name")).toHaveValue(/^(|h|he|hel|hell|hello)$/);
  await expect(a.locator("input")).toHaveCount(0);
});

test("reduced motion: one live pane per step, paused after it; step ref scrolls + flashes (F10)", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url(`${S}/9/proposed/step-2`));
  const step2 = page.locator(`[id="r-${S}/9/proposed/step-2"]`);
  await expect(step2).toHaveClass(/mk-hit/);
  await expect(step2).toBeInViewport();
  await expect(page.locator(`[id^="r-${S}/9/proposed/step-"]`)).toHaveCount(3);
  await expect(page.locator(`[id="r-${S}/9/proposed"] .mk-step-l`)).toHaveText(["9a one", "9b two", "9c three"]);
  for (const k of [1, 2, 3]) {
    const f = await isoPane(page, `${S}/9/proposed/step-${k}`);
    await expect(f.getByTestId("count")).toHaveText(`count: ${k}`, { timeout: 15_000 });
    await expect(f.locator(".mk-cursor")).toHaveCount(0);
  }
  await ctx.close();
});

test("mock-check passes 10 loops and mock-video writes a webm (task 3.5, 6.3)", async () => {
  test.setTimeout(240_000);
  const bin = (f: string, ...a: string[]) => spawnSync(process.execPath, [path.join(PKG, "src/mock-site", f), ...a], { cwd: M().root, encoding: "utf8", timeout: 180_000 });
  const c = bin("check.mjs", `#${PILLS_MOCK}/4`, "--loops", "10", "--url", M().url);
  expect(c.stderr + c.stdout).toContain("completed 10, failed 0");
  expect(c.status).toBe(0);
  const bad = bin("check.mjs", `#${S}/2`, "--loops", "2", "--url", M().url);
  expect(bad.status).toBe(1);
  expect(bad.stderr).toContain("completed 0, failed 2");
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mv-")), "loop.webm");
  const v = bin("video.mjs", `#${PILLS_MOCK}/4`, "--out", out, "--url", M().url);
  expect(v.status, v.stderr).toBe(0);
  expect(v.stdout).toContain(out);
  expect(fs.statSync(out).size).toBeGreaterThan(1000);
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});

test("installs from the packed tarball into a fresh vite+react project (X11)", async ({ page }) => {
  test.setTimeout(180_000);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-tarball-")));
  const proj = path.join(tmp, "proj");
  const child: { pid?: number; kill?: (s: NodeJS.Signals) => boolean } = {};
  try {
    const tgz = execFileSync("npm", ["pack", "--silent", "--pack-destination", tmp], { cwd: PKG, encoding: "utf8" }).trim().split("\n").pop()!;
    const dest = path.join(proj, "node_modules/@blackbelt-technology/frontend-mockup-loop");
    fs.mkdirSync(dest, { recursive: true });
    execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", dest, "--strip-components=1"]);
    for (const dep of ["react", "react-dom", "scheduler", "vite", "@vitejs/plugin-react"]) {
      fs.mkdirSync(path.dirname(path.join(proj, "node_modules", dep)), { recursive: true });
      fs.symlinkSync(path.join(REPO_ROOT, "node_modules", dep), path.join(proj, "node_modules", dep), "dir");
    }
    fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "fresh", private: true, type: "module" }));
    fs.writeFileSync(path.join(proj, "vite.config.mjs"), 'import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };\n');
    fs.mkdirSync(path.join(proj, "mockups/2026-01-02-hello"), { recursive: true });
    fs.writeFileSync(path.join(proj, "mockups/2026-01-02-hello/mock.tsx"), `import { Fix, Issue, type Mock } from "mock-site/kit";
const mock: Mock = { title: "Hello", category: "Fresh", frames: [{ title: "One", current: <Issue n={1} tip="old"><b>old</b></Issue>, proposed: <Fix n={1} tip="new"><b>new</b></Fix> }] };
export default mock;
`);
    const { prepareMockSite } = await import(path.join(dest, "src/mock-site/env.mjs"));
    const prep = await prepareMockSite(proj);
    expect(prep.ok, prep.error).toBe(true);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const c = spawn(process.execPath, [prep.launcher, "--config", prep.generated, "--port", String(port), "--strictPort"], { cwd: proj, stdio: "ignore" });
    child.pid = c.pid; child.kill = (s) => c.kill(s);
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/__mock/decisions`).then((r) => r.json()).catch(() => null))?.mockSite ?? false, { timeout: 60_000 }).toBe(true);
    await page.goto(`http://localhost:${port}/#2026-01-02-hello`);
    await expect(page.locator('[id="r-2026-01-02-hello/1/proposed/1"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[id="r-2026-01-02-hello/1/current/1"]')).toBeVisible();
  } finally {
    child.kill?.("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
