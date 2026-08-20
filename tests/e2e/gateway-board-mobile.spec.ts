import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E for tasks 6.8/6.9 (D11) — the readiness board at 375×667.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * D11 is entirely a statement about LAID-OUT PIXELS: a row is one 52px line,
 * the board fits without the dialog outgrowing the viewport, nothing overflows
 * horizontally, and touch targets stay ≥44px. jsdom has no layout engine, so
 * every number here is unreachable below this level — `getBoundingClientRect()`
 * in jsdom returns zeroes and would make each assertion vacuous.
 *
 * The board is stubbed via `page.route` (the container enrols no providers),
 * following `gateway-readiness-board.spec.ts`.
 */

const BOARD = [
  { provider: "zrok", state: "connected", endpoints: [{ kind: "public", url: "https://x.shares.zrok.io", tls: true }] },
  { provider: "ngrok", state: "not-installed", endpoints: [] },
  // tailscale is CONNECTED here so the second row also owns an action group —
  // an empty slot would make the "only the selected row shows actions"
  // assertion pass without the collapse rule existing at all.
  { provider: "tailscale", state: "connected", endpoints: [{ kind: "public", url: "https://ts.example.com", tls: true }] },
  { provider: "zerotier", state: "disconnected", endpoints: [] },
];

/** Every provider row, plus the controls that must stay tappable. */
const ROWS = BOARD.map((p) => p.provider);

async function openBoardAt375(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.route("**/api/tunnel-readiness", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { providers: BOARD, checkedAt: new Date().toISOString() } }),
    }),
  );
  await gotoDashboard(page);
  const btn = page.getByTestId("tunnel-btn");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await page.getByTestId("gateway-tab-setup").click();
  await expect(page.getByTestId("gateway-readiness-zrok")).toBeVisible({ timeout: 15_000 });
}

test.describe("gateway readiness board at 375", () => {
  // The first-launch display modal opens whenever the container has NO stored
  // display prefs, renders asynchronously, and its backdrop then intercepts
  // every click — including the auto-dismiss handler's own Skip once our
  // dialog is open, which deadlocks the two modals. Seeding real prefs once
  // removes the modal at its source instead of racing it.
  test.beforeAll(async ({ request }) => {
    await request.patch("/api/preferences/display", { data: { debugTools: false } });
  });

  // 6.8 — one 52px line per row, and the page does not scroll sideways.
  test("6.8: every row is a single 52px line and nothing overflows horizontally", async ({ page }) => {
    await openBoardAt375(page);

    for (const id of ROWS) {
      const box = await page.getByTestId(`gateway-readiness-${id}`).boundingBox();
      expect(box, `${id} row must be laid out`).not.toBeNull();
      // A row that wrapped to two lines would measure ~104px — the exact
      // failure D11 exists to prevent.
      expect(box?.height, `${id} row height`).toBeLessThanOrEqual(56);
      expect(box?.width, `${id} row width`).toBeLessThanOrEqual(375);
    }

    // The whole board, header included, on one screen.
    const board = await page.getByTestId("gateway-readiness-board").boundingBox();
    expect(board?.height, "board height incl. header").toBeLessThanOrEqual(420);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.scrollWidth, "no horizontal overflow at 375").toBeLessThanOrEqual(overflow.inner);
  });

  // 6.8 (second arm) — the action group is collapsed to the SELECTED row, so
  // adding actions cannot silently reintroduce the multi-line row.
  test("6.8: only the selected provider shows its action group at 375", async ({ page }) => {
    await openBoardAt375(page);

    // zrok is the default provider, hence the selected one.
    await expect(page.getByTestId("gateway-readiness-actions-slot-zrok")).toBeVisible();
    await expect(page.getByTestId("gateway-readiness-actions-slot-ngrok")).toBeHidden();

    await page.getByTestId("gateway-readiness-tailscale").click();
    await expect(page.getByTestId("gateway-readiness-actions-slot-tailscale")).toBeVisible();
    await expect(page.getByTestId("gateway-readiness-actions-slot-zrok")).toBeHidden();
  });

  // 6.9 — touch targets and contrast, in BOTH themes. The saving in D11 comes
  // from removing lines, never from shrinking targets; this is the assertion
  // that keeps that promise honest.
  test("6.9: touch targets stay ≥44px and labels clear the contrast floor in both themes", async ({ page }) => {
    for (const mode of ["dark", "light"] as const) {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/");
      await page.evaluate((m) => localStorage.setItem("dashboard:theme", m), mode);
      await openBoardAt375(page);

      for (const id of ROWS) {
        const box = await page.getByTestId(`gateway-readiness-${id}`).boundingBox();
        expect(box?.height, `${id} touch target in ${mode}`).toBeGreaterThanOrEqual(44);
      }

      // The state LABEL is the information (WCAG 1.4.1), so it is the text that
      // has to be legible — the dot beside it is decoration.
      const ratio = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="gateway-readiness-zrok-label"]') as HTMLElement;
        // `color-mix()` resolves to `color(srgb r g b)` with 0..1 channels in
        // Chromium, NOT `rgb()`. Parsing it as 0..255 silently yields a
        // near-black triple and a ~1.1 ratio for every colour — a measurement
        // that fails for a reason unrelated to the design.
        const parse = (c: string) => {
          const n = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          return c.startsWith("color(") ? n.map((v) => v * 255) : n;
        };
        const lum = (rgb: number[]) => {
          const [r, g, b] = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        let bgEl: HTMLElement | null = el;
        let bg = getComputedStyle(el).backgroundColor;
        while (bgEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
          bgEl = bgEl.parentElement;
          bg = bgEl ? getComputedStyle(bgEl).backgroundColor : "rgb(255,255,255)";
        }
        const a = lum(parse(getComputedStyle(el).color));
        const b = lum(parse(bg));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      // 4.5:1 is the AA floor for this text size (11.5px, not large text).
      expect(ratio, `zrok state label contrast in ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
