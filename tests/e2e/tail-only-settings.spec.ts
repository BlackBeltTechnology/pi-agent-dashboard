import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 gate for the `replayWindowMode` settings control — test-plan rows F14 and
 * F15 (change: add-tail-only-replay-window, D10).
 *
 * Deliberately a SIBLING of `max-replay-events-setting.spec.ts` rather than an
 * addition to it: that file owns the `maxReplayEvents` field's own rows, and
 * these two are about a different control with a different failure mode (an
 * inert-state disclosure, and a partial write).
 *
 * Both rows run against the shared harness config, so both restore what they
 * read in a `finally`. A leftover `tail-only` would reshape every later spec's
 * replay — the same cross-spec flake hazard the sibling file documents.
 *
 * See change: add-tail-only-replay-window (D10).
 */

const MODE_LABEL = "Replay window shape";
const EVENTS_LABEL = "Max Replay Events";

async function openServerSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: "Server", exact: true })
    .click();
  await expect(page.getByTestId("settings-content")).toBeVisible();
}

type Limits = Record<string, number | string>;

async function readLimits(page: Page): Promise<Limits> {
  const cfg = (await (await page.request.get("/api/config")).json()) as {
    data?: { memoryLimits?: Limits };
  };
  return cfg.data?.memoryLimits ?? {};
}

test.describe("replayWindowMode settings control", () => {
  /**
   * #F14 — the INERT disclosure.
   *
   * At `maxReplayEvents: 0` no window forms, so the mode has nothing to shape.
   * D10 chose to DISABLE the control with an explanation rather than hide it,
   * because hiding it would make the dependency invisible — the user would be
   * left to infer that a setting they cannot find is the reason their choice
   * does nothing.
   *
   * Both halves are asserted: disabled, AND the reason stated. A disabled
   * control with no explanation is the failure this row is really about.
   */
  test("F14: at maxReplayEvents 0 the mode control is disabled and says why", async ({ page }) => {
    await openServerSettings(page);
    const original = await readLimits(page);

    try {
      // Drive the precondition through the UI, so the disabled state is
      // reached the way a user reaches it rather than by seeding config.
      await page.getByLabel(EVENTS_LABEL, { exact: true }).fill("0");

      const mode = page.getByLabel(MODE_LABEL, { exact: true });
      await expect(mode).toBeVisible();
      await expect(mode).toBeDisabled();

      // The explanation must name the DEPENDENCY, not merely say "disabled".
      await expect(
        page.getByText(/no effect until Max Replay Events is set to a positive value/i),
      ).toBeVisible();

      // And it must come back the moment the dependency is satisfied — a
      // control stuck disabled would pass the assertions above.
      await page.getByLabel(EVENTS_LABEL, { exact: true }).fill("100");
      await expect(mode).toBeEnabled();
    } finally {
      await page.request.put("/api/config", { data: { memoryLimits: original } });
    }
  });

  /**
   * #F15 — the PARTIAL write.
   *
   * `GET /api/config` returns the PARSED config, so every memory limit is
   * materialized client-side. Writing the whole object back would serialize an
   * explicit value for every sibling the user never chose, converting defaulted
   * fields into pinned ones behind their back and freezing them across
   * upgrades. `fix-lazy-history-backfill-ux` (D7) made the write field-level;
   * this row proves the new field did not regress that.
   *
   * Asserted on BOTH the request body (only the edited key travels) and the
   * persisted server state (siblings unchanged end-to-end) — the second is
   * strictly stronger, the first localises a regression when it happens.
   */
  test("F15: changing only the mode writes only the mode", async ({ page }) => {
    await openServerSettings(page);
    const original = await readLimits(page);
    // Non-vacuity: the siblings this row protects must actually be present.
    expect(Object.keys(original)).toEqual(
      expect.arrayContaining(["maxEventsPerSession", "maxStringFieldSize", "maxWsBufferBytes"]),
    );

    try {
      // Ensure the control is live, then change ONLY it.
      const events = page.getByLabel(EVENTS_LABEL, { exact: true });
      if ((await events.inputValue()) === "0") await events.fill("100");
      const baseline = await readLimits(page);

      const mode = page.getByLabel(MODE_LABEL, { exact: true });
      await expect(mode).toBeEnabled();
      await mode.selectOption("tail-only");

      await expect(page.getByTestId("settings-save-bar")).toBeVisible();
      const write = page.waitForRequest(
        (r) => r.method() === "PUT" && r.url().includes("/api/config"),
      );
      await page.getByTestId("save-btn").click();

      const body = (await (await write).postDataJSON()) as { memoryLimits?: Limits };
      expect(body.memoryLimits?.replayWindowMode).toBe("tail-only");
      expect(body.memoryLimits).not.toHaveProperty("maxEventsPerSession");
      expect(body.memoryLimits).not.toHaveProperty("maxStringFieldSize");
      expect(body.memoryLimits).not.toHaveProperty("maxWsBufferBytes");

      const persisted = await readLimits(page);
      expect(persisted.replayWindowMode).toBe("tail-only");
      expect(persisted.maxEventsPerSession).toBe(baseline.maxEventsPerSession);
      expect(persisted.maxStringFieldSize).toBe(baseline.maxStringFieldSize);
      expect(persisted.maxWsBufferBytes).toBe(baseline.maxWsBufferBytes);
    } finally {
      await page.request.put("/api/config", { data: { memoryLimits: original } });
    }
  });
});
