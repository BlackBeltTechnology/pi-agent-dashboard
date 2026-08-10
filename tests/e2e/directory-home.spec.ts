import { expect, test } from "@playwright/test";
import { ensureGitSession, FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

// Mirror of packages/client/src/lib/folder-encoding.ts::encodeFolderPath — the
// web package does not export internals, and duplicating this 6-line pure fn is
// cheaper than widening its export surface for a test.
function encodeFolderPath(cwd: string): string {
  const bytes = new TextEncoder().encode(cwd);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Browser E2E — directory home page (change: add-directory-home-page).
//
// Drives the real sidebar "open" affordance → bare `/folder/:encodedCwd` home
// → centered prompt → spawn → auto-navigate round-trip against the Docker
// harness. The pinned folder is the baked git fixture (FIXTURE_GIT), pinned by
// `ensureGitSession`. The dedicated `folder-open-home-<cwd>` icon is DELETED by
// change add-folder-actions-menu (D3): the header ROW (`folder-home-row-<cwd>`)
// is the only open affordance, so these cases drive it directly (it is not in
// the shared TESTIDS map — the map is for static ids).

test.describe("directory home page", () => {
  // F1 — click-open → type → send → lands in a new session.
  test("open affordance → type → send → converges on a new /session/:id", async ({ page }) => {
    await ensureGitSession(page); // guarantees FIXTURE_GIT is pinned

    const openBtn = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();

    // Bare directory home route.
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`), {
      timeout: 15_000,
    });

    // Centered prompt: type + send spawns a session with initialPrompt.
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    await composer.fill("hello");
    await page.getByTestId("send-button").click();

    // D6 — Tier-1 spawn correlation auto-navigates to the new session.
    await expect(page).toHaveURL(/\/session\/[^/]+$/, { timeout: 60_000 });

    // The first user prompt "hello" surfaces in the new session's transcript.
    await expect(page.getByText("hello", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

// F5 — mobile back from the home page pops to the predecessor (cards), proving
// the bare route is a depth-1 detail surface (D1a), not a dead depth-0 no-op.
// Setup (pin + spawn) runs at the default desktop viewport because
// `ensureGitSession` resolves the desktop session card; only then do we resize
// to a mobile viewport and exercise the mobile shell.
test.describe("directory home page (mobile)", () => {
  test("mobile back from the home page returns to the card list", async ({ page }) => {
    await ensureGitSession(page); // desktop viewport — guarantees FIXTURE_GIT is pinned

    // Switch to a mobile viewport: the MobileShell now drives depth.
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoDashboard(page);

    // Depth-0 list panel shows the pinned folder row + its open affordance.
    const openBtn = page.getByTestId(`folder-home-row-${FIXTURE_GIT}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();

    // Depth-1 detail: the directory home renders.
    await expect(page).toHaveURL(new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`), {
      timeout: 15_000,
    });
    await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 15_000 });

    // Trigger back → pops one depth to the card list at "/", not stuck on the
    // home page and not a depth-0 no-op.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByTestId(`folder-home-row-${FIXTURE_GIT}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// add-folder-actions-menu — the folder header's trailing cluster is ONE control.
// Real geometry is the point here: opening must not bubble into the navigating
// header row, and the sheet-vs-popover choice is a live media-query decision
// jsdom cannot make. Covers test-plan F1, F2, F3, F4, F5, F6, F7.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("folder actions menu", () => {
  const HOME_URL = new RegExp(`/folder/${encodeFolderPath(FIXTURE_GIT)}$`);

  /** The folder body only renders while expanded — a reliable expansion probe. */
  function folderBody(page: import("@playwright/test").Page) {
    return page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  }

  async function seed(page: import("@playwright/test").Page) {
    await ensureGitSession(page);
    await expect(page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`)).toBeVisible({
      timeout: 15_000,
    });
  }

  // F1 — opening the menu neither navigates nor collapses.
  test("F1: opening the menu keeps the route and the expanded state", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    const trigger = page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`);
    await expect(folderBody(page)).toBeVisible({ timeout: 15_000 });
    const before = page.url();

    await trigger.click();
    await expect(page.getByTestId(`folder-actions-menu-panel-${FIXTURE_GIT}`)).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(folderBody(page)).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  // F2 — the header row is the open affordance.
  test("F2: clicking the header row outside the trigger opens the home page", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await page.getByTestId(`folder-header-leaf-${FIXTURE_GIT}`).click();
    await expect(page).toHaveURL(HOME_URL, { timeout: 15_000 });
  });

  // F3 — that navigation does not collapse the folder.
  test("F3: header-row navigation leaves the folder expanded", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await expect(folderBody(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).click();
    await expect(page).toHaveURL(HOME_URL, { timeout: 15_000 });
    await expect(folderBody(page)).toBeVisible();
  });

  // F4 — the dedicated icon control is gone everywhere.
  test("F4: no folder-open-home node renders on a pinned folder", async ({ page }) => {
    await seed(page);
    await gotoDashboard(page);
    await expect(page.locator('[data-testid^="folder-open-home-"]')).toHaveCount(0);
  });

  // F5 / F6 / F7 — the sheet gates on the app's compound mobile predicate
  // (<768w OR <600h), reused verbatim, so a short-but-wide window is mobile too.
  for (const [label, width, height, form] of [
    ["F5: 375x900 narrow", 375, 900, "sheet"],
    ["F6: 1200x560 short-but-wide", 1200, 560, "sheet"],
    ["F7: 1200x900 desktop", 1200, 900, "popover"],
  ] as const) {
    test(`${label} presents a ${form}`, async ({ page }) => {
      await ensureGitSession(page); // desktop viewport for the setup
      await page.setViewportSize({ width, height });
      await gotoDashboard(page);

      const trigger = page.getByTestId(`folder-actions-menu-${FIXTURE_GIT}`);
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      await trigger.click();

      const panel = page.getByTestId(`folder-actions-menu-panel-${FIXTURE_GIT}`);
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel).toHaveAttribute("data-menu-form", form);

      const box = await panel.boundingBox();
      if (!box) throw new Error("menu panel has no bounding box");
      if (form === "sheet") {
        // Full-width, flush to the viewport, and no horizontal overflow.
        expect(box.width).toBeGreaterThanOrEqual(width - 2);
        expect(box.x).toBeLessThanOrEqual(1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      } else {
        // A floating popover is narrower than the viewport, not a full-width sheet.
        expect(box.width).toBeLessThan(width / 2);
      }
    });
  }
});
