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

    // Capture the siblings so the write can be proven NON-destructive: a
    // careless `c.memoryLimits = { ...one field }` would silently reset them.
    const readNumber = async (label: string) =>
      Number(await page.getByLabel(label, { exact: true }).inputValue());
    const before = {
      maxEventsPerSession: await readNumber("Max Events Per Session"),
      maxStringFieldSize: await readNumber("Max string truncation"),
      maxWsBufferBytes: await readNumber("Max WebSocket buffer"),
    };

    const write = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().includes("/api/config"),
    );
    await field.fill("1000");
    await page.getByRole("button", { name: /save/i }).first().click();

    const body = (await (await write).postDataJSON()) as {
      memoryLimits?: Record<string, number>;
    };
    expect(body.memoryLimits?.maxReplayEvents).toBe(1000);
    expect(body.memoryLimits?.maxEventsPerSession).toBe(before.maxEventsPerSession);
    expect(body.memoryLimits?.maxStringFieldSize).toBe(before.maxStringFieldSize);
    expect(body.memoryLimits?.maxWsBufferBytes).toBe(before.maxWsBufferBytes);
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
