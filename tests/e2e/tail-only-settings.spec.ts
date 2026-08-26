import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import {
  buildWindowedSession,
  teardownWindowedSession,
  type WindowedSession,
} from "./helpers/windowed-session.js";

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

/**
 * #X8 — retention undercutting the window.
 *
 * ── The scenario as written is NOT reachable by configuration ───────────────
 * The row assumed that setting `maxEventsPerSession` BELOW `maxReplayEvents`
 * announces a gap the store cannot serve. It does not, and the measurement is
 * unambiguous: with `maxEventsPerSession: 50` against `maxReplayEvents: 100`
 * the RETAINED stream (≤50) is smaller than the window (100), so
 * `computeReplayWindow` takes its fits-entirely short-circuit and announces NO
 * gap whatsoever. `scrollDividerIntoDom` then times out because there is no
 * divider to find — which is what this spec originally failed on.
 *
 * Raise retention ABOVE the window and the opposite holds: `gapCount` is read
 * from the store, so everything announced is by construction servable.
 *
 * The `unservable` state is therefore a RACE, not a configuration: retention
 * must evict events, or compaction must drop a whole superseded
 * `message_update` band, in the interval BETWEEN the window being announced
 * and the backfill arriving. That is not arrangeable from the settings panel,
 * which is all this row specified.
 *
 * So this asserts the property that IS reachable and is worth pinning: the
 * combination degrades to no gap at all, rather than to a divider that offers
 * to load events nothing can serve. The A5 copy itself stays covered at L1
 * (`HistoryGapDivider.test.tsx`), where the state can be constructed directly.
 *
 * Retained below for the wording contract it still guards:
 *
 * The divider must state the OUTCOME and nothing else. Two causes produce an
 * identical empty slice — retention having trimmed the events, and replay
 * compaction having dropped a whole superseded `message_update` band — and the
 * client cannot tell them apart. Naming either one would sometimes be false, so
 * the copy names neither. It must also not be styled or announced as an ERROR:
 * nothing failed, and offering a retry would invite the user to re-attempt
 * something that cannot succeed.
 *
 * See change: fix-lazy-history-backfill-ux (D8); add-tail-only-replay-window.
 */
test.describe("X8: retention below the replay window", () => {
  test.setTimeout(600_000);

  let built: WindowedSession | undefined;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(1_500_000);
    built = await buildWindowedSession(browser, { mode: "tail-only", transcripts: 1 });
  });

  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    if (built) await teardownWindowedSession(browser, built);
  });

  test("X8: retention below the window announces no gap at all, rather than an unloadable one", async ({
    browser,
    page,
  }) => {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    let limits: Limits = {};
    try {
      const cfg = (await (await p2.request.get("/api/config")).json()) as {
        data?: { memoryLimits?: Limits };
      };
      limits = cfg.data?.memoryLimits ?? {};
      // Squeeze the store BELOW the window.
      await p2.request.put("/api/config", {
        data: { memoryLimits: { ...limits, maxEventsPerSession: 50, maxReplayEvents: 100 } },
      });
      await p2.request.post("/api/restart").catch(() => undefined);
    } finally {
      await ctx.close();
    }
    await expect
      .poll(async () => (await page.request.get("/api/health")).status(), { timeout: 180_000 })
      .toBe(200);

    try {
      await gotoDashboard(page);
      const card = page.locator(`[data-session-id="${built!.sessionId}"]`).first();
      await card.waitFor({ state: "visible", timeout: 60_000 });
      await card.click();
      // Let a full replay land.
      await page.waitForTimeout(5_000);

      /**
       * NO divider: the retained stream fits the window, so no gap is
       * announced. The transcript is short and complete rather than windowed.
       *
       * This is the graceful degradation the pairing must produce. The failure
       * it rules out is a divider offering "Load earlier" over events the store
       * no longer holds — an affordance that could never succeed.
       */
      await expect(page.getByTestId("history-gap-divider")).toHaveCount(0);
      await expect(page.getByTestId("history-gap-load")).toHaveCount(0);
      await expect(page.getByTestId("history-gap-unavailable")).toHaveCount(0);
      // And nothing is presented as a fault, because nothing failed.
      await expect(page.getByTestId("history-gap-error")).toHaveCount(0);
    } finally {
      const ctx2 = await browser.newContext();
      const p3 = await ctx2.newPage();
      try {
        await p3.request.put("/api/config", { data: { memoryLimits: limits } });
      } finally {
        await ctx2.close();
      }
    }
  });
});
