import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the heap settings surfaces and the heap telemetry
 * on `/api/health` (change: bound-session-heap-and-gc-telemetry).
 *
 * Covers test-plan rows F1 (effect-boundary copy), F2 (save round-trip),
 * E24 (subagent coupling warning) and F3 (telemetry readable).
 *
 * These are worth L3 specifically because the jsdom tests render the panel
 * against a MOCKED `/api/config`; here the save goes through the real
 * persistence path and the reload re-reads what the server actually wrote — the
 * half where a missing `computeConfigPartial` branch or a missing server-side
 * deep-merge would silently drop the value.
 *
 * Harness glue copied from settings-default-model-catalogue.spec.ts. The
 * dashboard port comes from .pi-test-harness.json via the Playwright baseURL —
 * never hardcode :18000.
 */

async function openSettingsPage(page: Page, name: "Sessions" | "Server") {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name, exact: true }).click();
}

test.describe("heap settings", () => {
  // test-plan #F1 — the effect boundary is the whole point of these fields:
  // neither applies to anything already running, and the server one is not
  // satisfied by the in-place Restart the panel itself offers.
  test("the session fields state they apply to newly started sessions", async ({ page }) => {
    await openSettingsPage(page, "Sessions");
    await expect(page.getByTestId("session-heap-effect-boundary")).toContainText(
      /newly started sessions/i,
      { timeout: 20_000 },
    );
  });

  test("the server field states a cold start is required", async ({ page }) => {
    await openSettingsPage(page, "Server");
    const copy = page.getByTestId("server-heap-effect-boundary");
    await expect(copy).toContainText(/cold start/i, { timeout: 20_000 });
    await expect(copy).toContainText(/will NOT apply/i);
  });

  // test-plan #F2 — round-trip through the REAL config write. A dropped
  // `computeConfigPartial` branch or a missing server-side deep-merge shows up
  // here as a revert to the default after reload, and nowhere else.
  test("a changed session ceiling survives save and reload", async ({ page }) => {
    await openSettingsPage(page, "Sessions");
    const field = page.getByTestId("session-heap-max-old-space");
    await expect(field).toBeVisible({ timeout: 20_000 });
    // The ORIGINAL value, not an assumed default: this config is shared with
    // every other spec in the run, so restoring a guess would silently change
    // the harness for them.
    const original = await field.inputValue();

    try {
      await field.fill("1024");
      await field.blur();

      await page.getByTestId("save-btn").first().click();
      await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

      await openSettingsPage(page, "Sessions");
      await expect(page.getByTestId("session-heap-max-old-space")).toHaveValue("1024", {
        timeout: 20_000,
      });
    } finally {
      // `finally`, so a failed assertion above cannot leak the changed ceiling
      // into every later spec in the run.
      await openSettingsPage(page, "Sessions");
      const restore = page.getByTestId("session-heap-max-old-space");
      await restore.fill(original);
      await restore.blur();
      const save = page.getByTestId("save-btn").first();
      if (await save.isVisible().catch(() => false)) {
        await save.click();
        await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });
      }
    }
  });

  // test-plan #E24 — `maxConcurrentSubagents` becomes a memory-safety knob once
  // a ceiling is enforced, because Agent children share the parent's heap. The
  // warning is non-blocking: it discloses a risk, it does not reject a value.
  test("a thin subagent pairing is warned about but stays saveable", async ({ page }) => {
    await openSettingsPage(page, "Sessions");
    await expect(page.getByTestId("session-heap-subagent-warning")).toBeHidden();

    const subagents = page.getByRole("spinbutton", { name: /Max concurrent subagents/i });
    await subagents.fill("8");
    await subagents.blur();

    const warning = page.getByTestId("session-heap-subagent-warning");
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await expect(warning).toContainText(/56 MB/);
    await expect(page.getByTestId("save-btn").first()).toBeEnabled();
  });
});

test.describe("heap telemetry", () => {
  // test-plan #F3 — `heapUsed` is unreadable without the ceiling it runs
  // against, and a climbing major-GC count is the only advance warning of the
  // OOM the lowered server default trades against.
  test("the health endpoint carries the server heap ceiling and GC counters", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(typeof body.server.heapSizeLimit).toBe("number");
    expect(body.server.heapSizeLimit).toBeGreaterThan(0);
    expect(typeof body.server.gcMajorCount).toBe("number");
    expect(typeof body.server.gcMajorPauseMsTotal).toBe("number");
    // `null` is legitimate — a process at the bare V8 default has no ceiling,
    // and saying so beats reporting a fiction.
    expect(
      body.server.effectiveMaxOldSpaceMb === null ||
        typeof body.server.effectiveMaxOldSpaceMb === "number",
    ).toBe(true);

    // The fallback field must exist and must NOT be flagged on a normal
    // harness, where every spawn resolves through the argv route.
    expect(body.sessionHeapFallback.used).toBe(false);
  });

  // Any session the harness has attached must carry the new metric fields once
  // it has beaten. Skipped rather than failed when the harness runs with no
  // session: the assertion is about the SHAPE a reporting bridge sends, and
  // there is nothing to assert without one.
  test("an attached session reports heap and GC metrics", async ({ request }) => {
    const body = await (await request.get("/api/health")).json();
    const agents: Array<Record<string, unknown>> = body.agents ?? [];
    test.skip(agents.length === 0, "no session attached to this harness");

    const reporting = agents.filter((a) => typeof a.heapSizeLimit === "number");
    expect(reporting.length).toBeGreaterThan(0);
    for (const a of reporting) {
      expect(typeof a.external).toBe("number");
      expect(typeof a.arrayBuffers).toBe("number");
      expect(typeof a.gcCount).toBe("number");
      expect(typeof a.gcMajorCount).toBe("number");
    }
  });
});
