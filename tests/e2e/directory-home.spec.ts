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
// `ensureGitSession`. The dynamic `folder-open-home-<cwd>` testid is selected
// directly (it is not in the shared TESTIDS map — the map is for static ids).

test.describe("directory home page", () => {
  // F1 — click-open → type → send → lands in a new session.
  test("open affordance → type → send → converges on a new /session/:id", async ({ page }) => {
    await ensureGitSession(page); // guarantees FIXTURE_GIT is pinned

    const openBtn = page.getByTestId(`folder-open-home-${FIXTURE_GIT}`);
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
    const openBtn = page.getByTestId(`folder-open-home-${FIXTURE_GIT}`);
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
    await expect(page.getByTestId(`folder-open-home-${FIXTURE_GIT}`)).toBeVisible({
      timeout: 15_000,
    });
  });
});
