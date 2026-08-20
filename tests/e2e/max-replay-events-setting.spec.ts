import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the `maxReplayEvents` control — test-plan rows F12
 * and F13 (change: lazy-load-session-history).
 *
 * These two rows are the part of the change that is honestly testable in a real
 * browser against the shared harness: the control is a plain `NumberField` in
 * an existing section, so it needs no windowed session and no server restart.
 *
 * The remaining L3 rows (F4-F11) all require the SERVER to be running with a
 * non-zero `memoryLimits.maxReplayEvents` — a restart-only field on a container
 * every other spec shares — and their protocol messages arrive over the
 * WebSocket, which `page.route()` cannot intercept. They are covered at jsdom
 * level in `useMessageHandler.history-gap.test.tsx` and
 * `HistoryGapDivider.test.tsx` instead.
 *
 * The dashboard port comes from the Playwright baseURL, which docker/test-up.sh
 * derived into `.pi-test-harness.json`. Never hardcode `:18000`.
 */

const LABEL = "Max Replay Events";

async function openServerSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Server", exact: true }).click();
  await expect(page.getByTestId("settings-content")).toBeVisible();
}

test.describe("maxReplayEvents settings control", () => {
  // test-plan #F12
  test("renders in Memory Limits and writes only its own field", async ({ page }) => {
    await openServerSettings(page);

    const field = page.getByLabel(LABEL, { exact: true });
    await expect(field).toBeVisible();

    // Capture the siblings so the write can be proven NON-DESTRUCTIVE: a
    // careless `c.memoryLimits = { ...one field }` would silently reset them.
    //
    // Read from the SERVER, not from sibling labels: the assertion is about the
    // persisted values the write must preserve, and sourcing them from the API
    // keeps this test from failing over an unrelated field's label copy.
    const before = (await (
      await page.request.get("/api/config")
    ).json()) as { data?: { memoryLimits?: Record<string, number> } };
    const siblings = before.data?.memoryLimits ?? {};
    expect(Object.keys(siblings)).toEqual(
      expect.arrayContaining(["maxEventsPerSession", "maxStringFieldSize", "maxWsBufferBytes"]),
    );

    await field.fill("1000");
    // The Save Bar is dirty-gated: it exists only once a field has changed, so
    // waiting for it also proves the control is wired into the dirty tracking.
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    const write = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().includes("/api/config"),
    );
    await page.getByTestId("save-btn").click();

    const body = (await (await write).postDataJSON()) as {
      memoryLimits?: Record<string, number>;
    };
    expect(body.memoryLimits?.maxReplayEvents).toBe(1000);
    expect(body.memoryLimits?.maxEventsPerSession).toBe(siblings.maxEventsPerSession);
    expect(body.memoryLimits?.maxStringFieldSize).toBe(siblings.maxStringFieldSize);
    expect(body.memoryLimits?.maxWsBufferBytes).toBe(siblings.maxWsBufferBytes);
  });

  // test-plan #F13
  test("inherits the section's restart-required affordance, as its siblings do", async ({ page }) => {
    await openServerSettings(page);

    // The control is deliberately NOT given a bespoke warning: it is a fourth
    // NumberField inside the existing "Memory Limits" section, so the section's
    // shared restart line already covers it. Asserting on the shared line is
    // what proves the control was placed inside that section rather than
    // sprouting a variant of its own.
    const field = page.getByLabel(LABEL, { exact: true });
    await expect(field).toBeVisible();

    const section = page
      .getByTestId("settings-content")
      .locator("section, div")
      .filter({ hasText: /Memory Limits/ })
      .filter({ has: page.getByLabel(LABEL, { exact: true }) })
      .last();
    await expect(section).toContainText(/requires server restart/i);
  });
});
