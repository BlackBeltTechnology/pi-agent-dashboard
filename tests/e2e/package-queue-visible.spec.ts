import { expect, test } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Visible-queue behaviour of Settings → Pi Ecosystem, in a real browser
// against the disposable harness bundle.
//
// Why routes are stubbed: the harness container is already at the latest
// published core versions (`updateAvailable: false`) and carries a single
// local-path extension, so no Update affordance renders at all and there is
// nothing to click. The stubs supply *server responses only* — the browser,
// the shipped bundle, the React tree, the real `packageQueue` singleton and
// the real clicks are all genuine. That is precisely the boundary this change
// sits behind: the queue is transport + state and holds no server knowledge.
//
// Proves (change: unify-pi-core-into-package-queue, D9 rewritten):
//   1. A click mid-flight on another core row AND on an extension row
//      enqueues and renders `queued` — no 409 ever reaches the user.
//   2. Navigating away and back mid-flight preserves the in-flight state.
//   3. The queue drains FIFO once the running op completes.

const PI = "@earendil-works/pi-coding-agent";
const DASH = "@blackbelt-technology/pi-agent-dashboard";
const EXT = "npm:pi-web-access";

test.describe("Settings → Pi Ecosystem — visible queue", () => {
  test("mid-flight clicks queue instead of failing, survive navigation, then drain FIFO", async ({
    page,
  }) => {
    // ── Stub server responses ────────────────────────────────────────────
    await page.route("**/api/pi-core/versions**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            packages: [
              {
                name: PI,
                displayName: "pi (core agent)",
                currentVersion: "0.82.0",
                latestVersion: "0.83.0",
                updateAvailable: true,
                installSource: "global",
              },
              {
                name: DASH,
                displayName: "pi-dashboard",
                currentVersion: "0.6.0",
                latestVersion: "0.7.0",
                updateAvailable: true,
                installSource: "global",
              },
            ],
            updatesAvailable: 2,
            lastChecked: new Date().toISOString(),
          },
        }),
      });
    });

    await page.route("**/api/packages/installed**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: [
            {
              source: EXT,
              scope: "user",
              filtered: false,
              version: "0.1.0",
              displayName: "pi-web-access",
              isRecommended: true,
              isBundled: false,
            },
          ],
        }),
      });
    });

    // Flags the extension row as updatable so its Update button renders.
    await page.route("**/api/packages/check-updates**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [{ source: EXT }] }),
      });
    });

    // Hold the core POST open so we can click other rows mid-flight. Each
    // core POST gets its own gate, released in order by the test.
    const coreRequested: string[] = [];
    const coreGates: Array<() => void> = [];
    await page.route("**/api/pi-core/update", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      const name = body.packages?.[0];
      coreRequested.push(name);
      await new Promise<void>((resolve) => coreGates.push(resolve));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { results: [{ name, success: true }], sessionsReloaded: 0 },
        }),
      });
    });

    const extPosted: string[] = [];
    await page.route("**/api/packages/update", async (route) => {
      extPosted.push(JSON.parse(route.request().postData() ?? "{}").source);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { operationId: "op-ext-1" } }),
      });
    });

    // ── Open Settings → Packages ─────────────────────────────────────────
    await gotoDashboard(page);
    await page.goto("/settings/packages");
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    const packagesNav = page.getByRole("button", { name: "Packages", exact: true });
    if (await packagesNav.isVisible().catch(() => false)) await packagesNav.click();

    const piUpdate = page.getByTestId(`pi-core-row-${PI}-update`);
    const dashUpdate = page.getByTestId(`pi-core-row-${DASH}-update`);
    const extRowId = `pkg-row-${EXT.replace(/[^a-z0-9]/gi, "-")}`;
    const extUpdate = page.getByTestId(`${extRowId}-update`);

    await expect(piUpdate).toBeVisible({ timeout: 30_000 });
    await expect(dashUpdate).toBeVisible({ timeout: 30_000 });
    await expect(extUpdate).toBeVisible({ timeout: 30_000 });

    // ── 1. Start a core update; its POST stays pending ───────────────────
    await piUpdate.click();
    await expect.poll(() => coreRequested.length, { timeout: 15_000 }).toBe(1);
    expect(coreRequested[0]).toBe(PI);
    await expect(piUpdate).toBeDisabled();

    // The OTHER rows are still clickable — this is the whole point of D9.
    await expect(dashUpdate).toBeEnabled();
    await expect(extUpdate).toBeEnabled();

    // ── 2. Click both mid-flight → both visibly queued, no 409 ───────────
    await dashUpdate.click();
    await extUpdate.click();

    await expect(page.getByTestId(`pi-core-row-${DASH}-queued`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`${extRowId}-queued`)).toBeVisible({ timeout: 10_000 });
    await expect(dashUpdate).toContainText("Queued");
    await expect(extUpdate).toContainText("Queued");

    // Evidence artifact: one core row running, one core row + one extension
    // row queued, zero error text.
    await page.screenshot({ path: "test-results/visible-queue-mid-flight.png", fullPage: false });

    // No busy-lock error text anywhere on the page.
    await expect(page.getByText(/already in progress/i)).toHaveCount(0);
    await expect(page.getByText(/operation is already/i)).toHaveCount(0);
    // Nothing was POSTed for the queued entries yet.
    expect(coreRequested).toEqual([PI]);
    expect(extPosted).toEqual([]);

    // Move + Reset-to-npm are the ONLY controls disabled while busy.
    await page.getByTestId(`${extRowId}-menu`).click();
    await expect(page.getByTestId(`${extRowId}-move`)).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);

    // ── 3. Navigate away and back mid-flight → state survives ───────────
    // CLIENT-SIDE navigation only (the in-app Back button, then the settings
    // button). This is the reported reproduction: sidebar navigation unmounts
    // `UnifiedPackagesSection`. A `page.goto()` would be a hard reload, which
    // tears down the JS module singleton and is an explicit Non-goal — the
    // queue survives unmount, not reload.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await byTestId(page, "settingsContent").waitFor({ state: "detached", timeout: 15_000 });
    await byTestId(page, "headerAppBar").waitFor({ state: "visible", timeout: 15_000 });

    await byTestId(page, "settingsBtn").click();
    await byTestId(page, "settingsContent").waitFor({ state: "visible", timeout: 15_000 });
    if (await packagesNav.isVisible().catch(() => false)) await packagesNav.click();

    // Running op still running; queued entries still queued. No new POSTs.
    await expect(page.getByTestId(`pi-core-row-${PI}-update`)).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByTestId(`pi-core-row-${DASH}-queued`)).toBeVisible();
    await expect(page.getByTestId(`${extRowId}-queued`)).toBeVisible();
    expect(coreRequested).toEqual([PI]);

    // ── 4. Release the running op → FIFO drain ──────────────────────────
    coreGates[0]();
    // DASH was enqueued before the extension, so it POSTs next.
    await expect.poll(() => coreRequested, { timeout: 20_000 }).toEqual([PI, DASH]);
    await expect(page.getByTestId(`${extRowId}-queued`)).toBeVisible();
    expect(extPosted).toEqual([]);

    // Release DASH → the extension finally POSTs.
    await expect.poll(() => coreGates.length, { timeout: 15_000 }).toBe(2);
    coreGates[1]();
    await expect.poll(() => extPosted, { timeout: 20_000 }).toEqual([EXT]);

    // Still no 409 surfaced to the user at any point.
    await expect(page.getByText(/already in progress/i)).toHaveCount(0);
  });
});
