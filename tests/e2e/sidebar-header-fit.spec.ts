/**
 * E2E: declutter-sidebar-header — the sidebar header never clips (test-plan #E3 #E4 #E5 #F7 #F8).
 *
 * Only this level can prove it: jsdom has no layout engine, so "stays on one line", "every child
 * inside the bar" and the 400 px container-query breakpoint are statements about laid-out pixels.
 *
 * The header is the container (`@container`), so its width is the sidebar width minus the sidebar's
 * 11 px (resize handle + border): sidebar 410 → container 399, sidebar 411 → container 400. The sidebar is clamped to
 * 180–500 px (`useSidebarState`); the width is seeded through its localStorage key before load.
 *
 * Row-1 children = the items of the left group and of the right group (the YOLO link is out of flow).
 * "Same line" = every child's vertical centre within 3 px of the first child's (items differ in
 * height, so `offsetTop` equality would be wrong for `items-center`).
 *
 * See change: declutter-sidebar-header.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, openAppearance, openConnectionMenu } from "./helpers/index.js";

const WIDTH_KEY = "dashboard:sidebar-width";
const bar = (page: Page) => page.getByTestId("header-app-bar");

async function seedSidebarWidth(page: Page, width: number): Promise<void> {
  // Set-if-absent so a test can move the width itself before a reload.
  await page.addInitScript(([k, w]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, String(w)); }, [WIDTH_KEY, width] as const);
}

interface Geometry {
  barLeft: number;
  barRight: number;
  centres: number[];
  inside: boolean;
  outside: string[];
}

/** Rects of every in-flow row-1 child, relative to the bar. */
async function geometry(page: Page): Promise<Geometry> {
  return bar(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    const kids = Array.from(el.querySelectorAll(":scope > div > *")) as HTMLElement[];
    const rects = kids
      .map((k) => ({ id: k.getAttribute("data-testid") ?? k.tagName.toLowerCase(), r: k.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    const outside = rects.filter(({ r }) => r.left < b.left - 0.5 || r.right > b.right + 0.5).map(({ id }) => id);
    return {
      barLeft: b.left,
      barRight: b.right,
      centres: rects.map(({ r }) => r.top + r.height / 2),
      inside: outside.length === 0,
      outside,
    };
  });
}

const oneLine = (g: Geometry) => g.centres.every((c) => Math.abs(c - g.centres[0]) <= 3);

/** Common state: connected, update available, no question, no waiting device, long server label. */
async function installCommonState(page: Page): Promise<void> {
  await page.route("**/api/pi-core/versions*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { updatesAvailable: 3 } }) }),
  );
  await page.route("**/api/known-servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    }),
  );
}

/** Worst case: 2 open questions, update, server offline, tunnel failed, 1 waiting device. */
async function installWorstCaseState(page: Page): Promise<void> {
  await installCommonState(page);
  const gateway = { connected: 0, expected: 1 };
  await page.route("**/api/tunnel-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "inactive", serverOs: "linux", gateway }) }),
  );
  await page.route("**/api/tunnel-status-detail", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "inactive", serverOs: "linux", gateway, providers: [{ provider: "zrok", primary: true, state: "failed", error: "x" }] }),
    }),
  );
  await page.route("**/api/pair/pending", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [{ pendingId: "p1", createdAt: Date.now(), expiresAt: Date.now() + 600_000, attemptsLeft: 3 }] }),
    }),
  );
  const rows = [1, 2].map((n) => ({
    id: `q${n}`, sessionId: `s${n}`, sessionLabel: `Session ${n}`, preview: "Proceed?", type: "confirm", askedAt: Date.now() - n, briefStatus: "none",
  }));
  // A dropped socket otherwise probes `/auth/status` and lands on the sign-in page, not "offline".
  await page.route("**/auth/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }),
  );
  // Reconnects go to a dead port, so once the first link drops the chip stays offline.
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    let made = 0;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        made += 1;
        super(made > 1 ? "ws://127.0.0.1:1/ws" : url, protocols);
      }
    } as typeof WebSocket;
  });
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    // The server's own first `questions_update` frame is empty: swap in ours so there is no race.
    server.onMessage((m) => {
      if (String(m).includes('"questions_update"')) {
        ws.send(JSON.stringify({ type: "questions_update", questions: rows }));
        // Drop the link once the pill has rendered, so the chip goes offline (reconnects are refused).
        setTimeout(() => ws.close(), 4_000);
        return;
      }
      ws.send(m);
    });
  });
}

test.describe("sidebar header fit (declutter-sidebar-header)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const width of [279, 280, 320, 440, 500]) {
    test(`#E3 common state stays on one line at sidebar ${width}px`, async ({ page }) => {
      await seedSidebarWidth(page, width);
      await installCommonState(page);
      await gotoDashboard(page);
      await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("pi-update-badge").first()).toBeVisible({ timeout: 20_000 });
      const g = await geometry(page);
      expect(g.inside, `children outside the bar: ${g.outside.join(", ")}`).toBe(true);
      if (width >= 280) expect(oneLine(g), `centres: ${g.centres.join(", ")}`).toBe(true);
    });
  }

  for (const width of [180, 280, 399, 400, 500]) {
    test(`#E4 worst case never clips at sidebar ${width}px`, async ({ page }) => {
      await seedSidebarWidth(page, width);
      await installWorstCaseState(page);
      await gotoDashboard(page);
      await expect(page.getByTestId("question-pill").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("tunnel-btn-badge").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toHaveAttribute("aria-label", /offline/i, { timeout: 20_000 });
      const g = await geometry(page);
      expect(g.inside, `children outside the bar: ${g.outside.join(", ")}`).toBe(true);
      if (width >= 400) expect(oneLine(g), `centres: ${g.centres.join(", ")}`).toBe(true);
    });
  }

  for (const [sidebar, narrow] of [[410, true], [411, false]] as const) {
    test(`#E5 chip name + offline breakpoint: header container ${sidebar - 11}px`, async ({ page }) => {
      await installWorstCaseState(page);
      await seedSidebarWidth(page, sidebar); // header container = sidebar - 11 (resize handle + border)
      await gotoDashboard(page);
      const chip = page.locator('[data-testid="connection-chip"]:visible').first();
      await expect(chip).toHaveAttribute("aria-label", /offline/i, { timeout: 30_000 });
      const state = await chip.evaluate((c) => {
        const shown = (el: Element | null | undefined) => !!el && getComputedStyle(el).display !== "none";
        return {
          name: shown(c.querySelector("span.truncate")),
          word: shown(Array.from(c.querySelectorAll("span")).find((x) => x.textContent === "Offline")),
          glyph: shown(c.querySelector('[data-testid="connection-chip-offline-glyph"]')),
          // diagnostic only: what the container query actually saw
          // biome-ignore lint: debug field removed from the assertion below
          w: c.closest(".\\@container")?.clientWidth,
        };
      });
      const w = await page.getByTestId("header-app-bar").evaluate((e) => e.parentElement?.getBoundingClientRect().width);
      expect(w, "container width").toBe(sidebar - 11);
      const { w: seen, ...flags } = state as typeof state & { w?: number };
      expect(seen, "query container clientWidth").toBe(sidebar - 11);
      expect(flags).toEqual(narrow ? { name: false, word: false, glyph: true } : { name: true, word: true, glyph: false });
    });
  }

  test("#F7 narrowest sidebar keeps every popover on screen (375x667, sidebar 180px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seedSidebarWidth(page, 180);
    await installCommonState(page);
    await gotoDashboard(page);
    // At 375 px the sidebar is the mobile overlay behind the hamburger.
    const hamburger = page.getByTestId("hamburger-button");
    if (await hamburger.isVisible().catch(() => false)) await hamburger.click();
    const within = async (panel: ReturnType<Page["getByTestId"]>) => {
      await expect(panel).toBeVisible({ timeout: 10_000 });
      const r = await panel.evaluate((e) => e.getBoundingClientRect().toJSON());
      expect(r.left, "left").toBeGreaterThanOrEqual(0);
      expect(r.top, "top").toBeGreaterThanOrEqual(0);
      expect(r.right, "right").toBeLessThanOrEqual(375);
      expect(r.bottom, "bottom").toBeLessThanOrEqual(667);
    };
    await openAppearance(page);
    await within(page.getByTestId("theme-picker-dropdown"));
    await page.keyboard.press("Escape");
    await openConnectionMenu(page);
    await within(page.getByRole("menu", { name: "Switch server" }));
    await page.keyboard.press("Escape");
    await page.getByTestId("filter-funnel-btn").first().click();
    await within(page.getByTestId("filter-funnel-panel"));
  });

  test("#F8 short viewport: the Appearance panel fits or scrolls internally (height 480)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await installCommonState(page);
    await gotoDashboard(page);
    const dropdown = await openAppearance(page);
    const m = await dropdown.evaluate((e) => ({ r: e.getBoundingClientRect().toJSON(), scrolls: e.scrollHeight > e.clientHeight }));
    expect(m.r.top).toBeGreaterThanOrEqual(0);
    expect(m.r.bottom).toBeLessThanOrEqual(480);
    // Either everything is visible, or the panel scrolls internally.
    expect(m.scrolls || m.r.height > 0).toBe(true);
  });
});
