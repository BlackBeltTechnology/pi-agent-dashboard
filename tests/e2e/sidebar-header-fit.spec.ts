/**
 * E2E: declutter-sidebar-header — the sidebar header never clips (test-plan #E3 #E4 #E5 #F7 #F8);
 * polish-sidebar-header-controls adds the icon-button recipe, the chip glyph/word breakpoints and the
 * Appearance panel fit (#E2 #E3 #E4 #E5 #E6 #E7 #E17 #F1 #F2 #F3 #F5 #F7 #F8).
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
 * See change: declutter-sidebar-header, polish-sidebar-header-controls.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { contrastFailures, contrastRatio, elementColors, measureText, nonTextFailures, ownBackground, resolveColor, setThemeMode, sizeFailures } from "./helpers/computed-contrast.js";
import { HEADER_ICON_BUTTON_IDS } from "./helpers/header.js";
import { gotoDashboard, openAppearance, openConnectionMenu } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

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

const connectionChipName = (page: Page) => page.locator('[data-testid="connection-chip"]:visible').first().locator("span.truncate").first();

const oneLine = (g: Geometry) => g.centres.every((c) => Math.abs(c - g.centres[0]) <= 3);

/** The long server label of the #E3 fixture (34 characters). */
const LONG_LABEL = "pi-dashboard-31f4d8185a43-studio";
/**
 * Non-loopback alias of the harness listener: the current entry is then the labelled known server, not the
 * seeded "Local". `127.0.0.2` is refused (the harness publishes on 127.0.0.1 only), so Chromium maps a
 * `.local` hostname (admitted by the host gate) to 127.0.0.1 instead (`--host-resolver-rules`); the page still talks to the same listener.
 */
const LONG_NAME_HOST = "pi-dash-long.local";
const LONG_NAME_ORIGIN = `http://${LONG_NAME_HOST}:${DASHBOARD_PORT}/`;

/** Common state: connected, update available, no question, no waiting device, "Local" server (or a long label with `longName`). */
async function installCommonState(page: Page, opts: { updates?: number; longName?: boolean } = {}): Promise<void> {
  await page.route("**/api/pi-core/versions*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { updatesAvailable: opts.updates ?? 3 } }) }),
  );
  await page.route("**/api/known-servers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: opts.longName ? [{ host: LONG_NAME_HOST, port: DASHBOARD_PORT, label: LONG_LABEL, addedAt: "2024-01-01T00:00:00Z" }] : [],
      }),
    }),
  );
}

/** Remote access "internet" tone (tunnel on): gateway fully connected. */
async function installTunnelOn(page: Page): Promise<void> {
  const gateway = { connected: 1, expected: 1 };
  await page.route("**/api/tunnel-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "active", serverOs: "linux", gateway }) }),
  );
  await page.route("**/api/tunnel-status-detail", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "active", serverOs: "linux", gateway, providers: [{ provider: "zrok", primary: true, state: "connected" }] }),
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

// Top-level: `launchOptions` forces a new worker, which Playwright refuses inside a describe group.
test.use({ launchOptions: { args: [`--host-resolver-rules=MAP ${LONG_NAME_HOST} 127.0.0.1`] } });

test.describe("sidebar header fit (declutter-sidebar-header)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // #E3: the long-name fixture reaches the harness through 127.0.0.2 (see LONG_NAME_ORIGIN).
  for (const width of [279, 280, 320, 411, 440, 491, 500]) {
    test(`#E3 common state stays on one line at sidebar ${width}px (34-char server label)`, async ({ page }) => {
      await seedSidebarWidth(page, width);
      await installCommonState(page, { longName: true });
      await gotoDashboard(page, LONG_NAME_ORIGIN);
      await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("pi-update-badge").first()).toBeVisible({ timeout: 20_000 });
      const g = await geometry(page);
      expect(g.inside, `children outside the bar: ${g.outside.join(", ")}`).toBe(true);
      if (width >= 280) expect(oneLine(g), `centres: ${g.centres.join(", ")}`).toBe(true);
      if (width >= 411) {
        const name = connectionChipName(page);
        await expect(name).toHaveText(LONG_LABEL);
        const w = (await name.boundingBox())?.width ?? 0;
        expect(w, `name width at ${width}`).toBeLessThanOrEqual(width >= 491 ? 160.5 : 96.5);
      }
    });
  }

  for (const width of [180, 280, 400, 411, 491, 500]) {
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

  test("#E6 a tunnel at the narrowest width wraps instead of clipping (sidebar 280px)", async ({ page }) => {
    await seedSidebarWidth(page, 280);
    await installCommonState(page);
    await installTunnelOn(page);
    await gotoDashboard(page);
    await expect(page.getByTestId("pi-update-badge").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="connection-chip-tone"]:visible').first()).toBeVisible({ timeout: 20_000 });
    const g = await geometry(page);
    expect(g.inside, `children outside the bar: ${g.outside.join(", ")}`).toBe(true);
  });

  test("#E7 a two-digit update count never clips (sidebar 280px)", async ({ page }) => {
    await seedSidebarWidth(page, 280);
    await installCommonState(page, { updates: 12 });
    await gotoDashboard(page);
    await expect(page.getByTestId("pi-update-badge").first()).toContainText("12", { timeout: 20_000 });
    const g = await geometry(page);
    expect(g.inside, `children outside the bar: ${g.outside.join(", ")}`).toBe(true);
  });

  test("#F8 the icon-button recipe keeps row 1 at 44 px (sidebar 440px)", async ({ page }) => {
    await seedSidebarWidth(page, 440);
    await installCommonState(page);
    await gotoDashboard(page);
    await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible({ timeout: 20_000 });
    const h = (await bar(page).boundingBox())?.height ?? 0;
    expect(Math.round(h)).toBe(44);
  });

  // #E5: header container = sidebar - 11. Name + chevron from 400, "Offline" word from 480, glyph always.
  for (const [sidebar, flags] of [
    [410, { name: false, chevron: false, word: false }],
    [411, { name: true, chevron: true, word: false }],
    [490, { name: true, chevron: true, word: false }],
    [491, { name: true, chevron: true, word: true }],
  ] as const) {
    test(`#E5 chip name / word / glyph breakpoints: header container ${sidebar - 11}px`, async ({ page }) => {
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
          chevron: shown(c.querySelector(":scope > svg")),
          // diagnostic only: what the container query actually saw
          w: c.closest(".\\@container")?.clientWidth,
        };
      });
      const w = await page.getByTestId("header-app-bar").evaluate((e) => e.parentElement?.getBoundingClientRect().width);
      expect(w, "container width").toBe(sidebar - 11);
      const { w: seen, ...seenFlags } = state as typeof state & { w?: number };
      expect(seen, "query container clientWidth").toBe(sidebar - 11);
      expect(seenFlags).toEqual({ ...flags, glyph: true });
      if (sidebar === 410) {
        const box = await chip.boundingBox();
        expect(box?.width ?? 0, "collapsed chip width").toBeGreaterThanOrEqual(31.5);
        expect(box?.height ?? 0, "collapsed chip height").toBeGreaterThanOrEqual(31.5);
      }
    });
  }

  // ── icon-button recipe: contrast + fill (#E2 #F7) ──────────────────────────
  test("#E2 header icon buttons: 28 px box and glyph contrast >= 3 in base dark / base light / nord dark", async ({ page }) => {
    await installCommonState(page);
    await gotoDashboard(page);
    const failures: string[] = [];
    for (const [theme, mode] of [["base", "dark"], ["base", "light"], ["nord", "dark"]] as const) {
      await setThemeMode(page, mode, theme);
      await expect(page.locator('[data-testid="connection-chip"]:visible').first()).toBeVisible({ timeout: 20_000 });
      for (const id of HEADER_ICON_BUTTON_IDS) {
        const btn = page.locator(`[data-testid="${id}"]:visible`).first();
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        if (!box || Math.abs(box.width - 28) > 0.5 || Math.abs(box.height - 28) > 0.5) failures.push(`${theme}/${mode} ${id}: box ${box?.width}x${box?.height}`);
        const { fg, bg } = await elementColors(btn);
        const ratio = contrastRatio(fg, bg);
        if (ratio < 3) failures.push(`${theme}/${mode} ${id}: glyph ${ratio.toFixed(2)}:1`);
      }
    }
    await setThemeMode(page, "dark", "base");
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("#F7 hover and open states fill with --bg-hover", async ({ page }) => {
    await installCommonState(page);
    await gotoDashboard(page);
    const settings = page.locator('[data-testid="settings-btn"]:visible').first();
    const trigger = page.locator('[data-testid="theme-picker-trigger"]:visible').first();
    const hover = await resolveColor(page, "var(--bg-hover)");
    await settings.hover();
    await expect.poll(async () => (await ownBackground(settings)).join(",")).toBe(hover.join(","));
    await trigger.click();
    await page.mouse.move(700, 600);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await ownBackground(trigger)).join(",")).toBe(hover.join(","));
  });

  test("#F2 narrowest sidebar keeps every popover on screen (375x667, sidebar 180px; Appearance <= 300px)", async ({ page }) => {
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
    expect((await page.getByTestId("theme-picker-dropdown").boundingBox())?.width ?? 999, "Appearance width").toBeLessThanOrEqual(300.5);
    await page.keyboard.press("Escape");
    await openConnectionMenu(page);
    await within(page.getByRole("menu", { name: "Switch server" }));
    await page.keyboard.press("Escape");
    await page.getByTestId("filter-funnel-btn").first().click();
    await within(page.getByTestId("filter-funnel-panel"));
  });

  test("#F1 short viewport: the Mode control stays visible, only the palette grid scrolls (height 480 and 300)", async ({ page }) => {
    await installCommonState(page);
    for (const height of [480, 300]) {
      await page.setViewportSize({ width: 1280, height });
      await gotoDashboard(page);
      const dropdown = await openAppearance(page);
      const r = await dropdown.evaluate((e) => e.getBoundingClientRect().toJSON());
      expect(r.top, `top @${height}`).toBeGreaterThanOrEqual(0);
      expect(r.bottom, `bottom @${height}`).toBeLessThanOrEqual(height);
      const toggle = (await page.getByTestId("theme-toggle").boundingBox())!;
      expect(toggle.y, `toggle top @${height}`).toBeGreaterThanOrEqual(r.top - 0.5);
      expect(toggle.y + toggle.height, `toggle bottom @${height}`).toBeLessThanOrEqual(r.bottom + 0.5);
      const grid = page.getByTestId("theme-palette-grid");
      const scrolls = await grid.evaluate((g) => g.scrollHeight > g.clientHeight);
      // 9 palettes in two columns are ~190 px: they fit at 480 and must scroll at 300.
      if (height === 300) expect(scrolls, "palette grid scrolls at 300").toBe(true);
      if (scrolls) {
        await grid.evaluate((g) => { g.scrollTop = g.scrollHeight; });
        const after = (await page.getByTestId("theme-toggle").boundingBox())!;
        expect(after.y, "Mode control did not move while the grid scrolled").toBeCloseTo(toggle.y, 0);
      }
      await page.keyboard.press("Escape");
    }
  });

  // ── Appearance panel on a phone / tiny viewport (#E17 #F3 #F5) ────────────
  for (const lang of ["en", "zh-CN", "hu"]) {
    test(`#E17 Appearance on a 375px phone: 2 columns, palette + mode labels fit (${lang})`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.addInitScript(([l]) => {
        localStorage.setItem("pi-dashboard-language", l);
        localStorage.setItem("dashboard:theme-name", "tokyo-night");
      }, [lang]);
      await installCommonState(page);
      await gotoDashboard(page);
      const hamburger = page.getByTestId("hamburger-button");
      if (await hamburger.isVisible().catch(() => false)) await hamburger.click();
      const dropdown = await openAppearance(page);
      const cols = await page.getByTestId("theme-palette-grid").evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
      expect(cols, "grid columns").toBe(2);
      const overflowing = await dropdown.evaluate((d) =>
        Array.from(d.querySelectorAll<HTMLElement>('[data-testid="theme-name-label"], [data-testid="theme-toggle"] span.truncate'))
          .filter((e) => e.scrollWidth > e.clientWidth)
          .map((e) => e.textContent),
      );
      expect(overflowing, "truncated labels").toEqual([]);
    });
  }

  test("#F3 one-column fallback at 320px: panel < 254px, one grid track, on screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await installCommonState(page);
    await gotoDashboard(page);
    const hamburger = page.getByTestId("hamburger-button");
    if (await hamburger.isVisible().catch(() => false)) await hamburger.click();
    const dropdown = await openAppearance(page);
    const r = await dropdown.evaluate((e) => e.getBoundingClientRect().toJSON());
    expect(r.width, "dropdown width").toBeLessThan(254);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(320);
    const cols = await page.getByTestId("theme-palette-grid").evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
    expect(cols, "grid columns").toBe(1);
  });

  test("#F5 Appearance dropdown passes the contrast + size probes in base dark / base light / nord dark", async ({ page }) => {
    await installCommonState(page);
    await gotoDashboard(page);
    const failures: string[] = [];
    for (const [theme, mode] of [["base", "dark"], ["base", "light"], ["nord", "dark"]] as const) {
      await setThemeMode(page, mode, theme);
      const dropdown = await openAppearance(page);
      const ms = await measureText(dropdown);
      failures.push(...contrastFailures(ms).map((f) => `${theme}/${mode} ${f}`));
      failures.push(...sizeFailures(ms).map((f) => `${theme}/${mode} ${f}`));
      failures.push(...(await nonTextFailures(dropdown)).map((f) => `${theme}/${mode} ${f}`));
      await page.keyboard.press("Escape");
    }
    await setThemeMode(page, "dark", "base");
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
