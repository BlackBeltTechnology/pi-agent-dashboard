import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the blackhole settings page (change:
 * add-blackhole-plugin). Covers test-plan rows X3 and F1-F9.
 *
 * `pi-blackhole` is a third-party extension and is deliberately NOT installed in
 * the harness: pulling it at test time would make CI depend on a third-party
 * registry, and the change's whole point is that the dashboard takes no
 * dependency on that package. So:
 *
 *   F6 (extension absent)      runs against the REAL, unrouted harness state —
 *                              the plugin is loaded, its requirement probe
 *                              reports `pi-blackhole` missing, and the page
 *                              renders the plugin's OWN not-installed state.
 *   every other row            routes `/api/plugins` (to report the requirement
 *                              satisfied) and `/api/plugins/blackhole/config`
 *                              (to serve a fixture), then asserts the RENDERED
 *                              DOM and accessibility tree.
 *
 * The routed rows still exercise the real component, the real slot mount and
 * the real settings shell — only the two data sources are fixtures. The
 * server-side halves of the same scenarios (bytes unchanged, atomic write,
 * validation) are L1 and assert the filesystem directly.
 */

const PLUGIN_PATH = "/settings/plugins/blackhole";

const MODEL = (id: string, provider = "openrouter") => ({ provider, id });

/** A config fixture: every managed key at its default, with overrides applied. */
function configFixture(over: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    compaction: "auto",
    compactionEngine: "blackhole",
    tailBehavior: "minimal",
    midRunCompaction: "off",
    memory: true,
    sessionFallback: true,
    debug: false,
    debugLog: false,
    observeAfterTokens: 15000,
    reflectAfterTokens: 25000,
    compactAfterTokens: 81000,
    observationsPoolMaxTokens: 20000,
    observationsPoolTargetTokens: 10000,
    observerChunkMaxTokens: 40000,
    observerPreambleMaxTokens: 0,
    reflectorInputMaxTokens: 80000,
    dropperInputMaxTokens: 80000,
    dropperPressureThreshold: 0.7,
    agentMaxTurns: 16,
    providerIdleTimeoutMs: undefined,
    model: MODEL("base-model"),
    observerModel: MODEL("model-alpha"),
    reflectorModel: MODEL("model-ref"),
    dropperModel: MODEL("model-drop"),
    observerFallbackModels: [MODEL("model-beta", "ollama"), MODEL("model-gamma", "cerebras")],
    reflectorFallbackModels: undefined,
    dropperFallbackModels: undefined,
  };
  const fields: Record<string, { value: unknown; default: unknown; isDefault: boolean }> = {};
  for (const [key, def] of Object.entries(defaults)) {
    const has = Object.hasOwn(over, key);
    fields[key] = { value: has ? over[key] : def, default: def, isDefault: !has };
  }
  return {
    status: "ok",
    filePath: "/home/pi/.pi/agent/pi-blackhole/pi-blackhole-config.json",
    exists: true,
    unmanagedKeys: ["_comment"],
    fields,
  };
}

/**
 * Report the `pi-blackhole` requirement as SATISFIED. The route rewrites the
 * real `/api/plugins` payload rather than replacing it, so every other plugin
 * row (and therefore the whole settings rail) stays authentic.
 */
async function routeInstalled(page: Page) {
  await page.route("**/api/plugins", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { plugins?: { id: string; status?: unknown }[] };
    for (const row of body.plugins ?? []) {
      if (row.id === "blackhole") row.status = { ...(row.status as object), missingRequirements: [] };
    }
    await route.fulfill({ response: res, json: body });
  });
}

/** Serve a config fixture (or a parse-error result) for the plugin's own route. */
async function routeConfig(page: Page, body: unknown, status = 200) {
  await page.route("**/api/plugins/blackhole/config", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

async function gotoBlackhole(page: Page) {
  await page.goto(PLUGIN_PATH);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

/**
 * Expand every accordion. The scalar groups render COLLAPSED, so their inputs
 * exist in the DOM but are not visible and cannot be filled — same pattern as
 * the hermes-memory spec. Must run AFTER the plugin body mounts: the form is
 * fetched, so the `<details>` elements do not exist on first paint.
 */
async function expandGroups(page: Page) {
  await expect(page.getByTestId("blackhole-settings")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
  });
}

test.describe("blackhole settings page (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  // ── Not installed (test-plan #F6) — REAL harness state, no routing ────────
  test("renders the plugin's own not-installed state naming the install command", async ({
    page,
  }) => {
    await gotoBlackhole(page);
    const missing = page.getByTestId("blackhole-not-installed");
    await expect(missing).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("blackhole-install-command")).toHaveText(
      "pi install npm:pi-blackhole",
    );
    // Zero configuration controls anywhere in the settings body.
    const content = page.getByTestId("settings-content");
    await expect(content.locator("[data-testid^='blackhole-input-']")).toHaveCount(0);
  });

  // ── Parse error (test-plan #X3) ───────────────────────────────────────────
  test("renders no form and a disabled save control on a parse error", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(
      page,
      {
        status: "parse-error",
        filePath: "/home/pi/.pi/agent/pi-blackhole/pi-blackhole-config.json",
        message: "Unexpected token } in JSON at position 34",
      },
      409,
    );
    await gotoBlackhole(page);

    const panel = page.getByTestId("blackhole-parse-error");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("blackhole-parse-message")).toContainText("Unexpected token");

    // No input, select, textarea or toggle for a config key.
    await expect(panel.locator("input, select, textarea")).toHaveCount(0);
    await expect(page.getByTestId("settings-content").locator("[data-testid^='blackhole-input-']")).toHaveCount(0);

    // The save control is present and disabled — and the host save bar, which
    // only appears while dirty, never appears.
    await expect(page.getByTestId("blackhole-save-blocked")).toBeDisabled();
    await expect(page.getByTestId("save-btn")).toHaveCount(0);
  });

  // ── Chain editing (test-plan #F1, #F2, #F3) ───────────────────────────────
  test("reorder controls are keyboard-operable and converge to the expected order", async ({
    page,
  }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    await expect(page.getByTestId("blackhole-chain-observer")).toBeVisible({ timeout: 30_000 });

    const order = () =>
      page
        .getByTestId("blackhole-chain-observer")
        .locator("[data-testid^='blackhole-chain-observer-entry-']")
        .evaluateAll((els) =>
          els.map((el) => el.querySelector("summary span.font-mono")?.textContent ?? ""),
        );

    await expect.poll(order).toEqual(["model-alpha", "model-beta", "model-gamma"]);

    // Keyboard ONLY: focus the move-up control of entry 1 and activate it.
    const up1 = page.getByTestId("blackhole-chain-observer-up-1");
    await up1.focus();
    await expect(up1).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(order).toEqual(["model-beta", "model-alpha", "model-gamma"]);

    // Move it back down with the keyboard.
    const down0 = page.getByTestId("blackhole-chain-observer-down-0");
    await down0.focus();
    await page.keyboard.press("Space");
    await expect.poll(order).toEqual(["model-alpha", "model-beta", "model-gamma"]);

    // Remove is reachable and activatable by keyboard alone.
    const remove2 = page.getByTestId("blackhole-chain-observer-remove-2");
    await remove2.focus();
    await page.keyboard.press("Enter");
    await expect.poll(order).toEqual(["model-alpha", "model-beta"]);
  });

  test("boundary controls are present in the accessibility tree and disabled", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    await expect(page.getByTestId("blackhole-chain-observer")).toBeVisible({ timeout: 30_000 });

    // Present, not absent — and disabled.
    await expect(page.getByTestId("blackhole-chain-observer-up-0")).toBeDisabled();
    await expect(page.getByTestId("blackhole-chain-observer-down-2")).toBeDisabled();
    // Interior controls remain enabled.
    await expect(page.getByTestId("blackhole-chain-observer-down-0")).toBeEnabled();
  });

  test("every reorder control exposes an accessible name identifying its model", async ({
    page,
  }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    await expect(page.getByTestId("blackhole-chain-observer")).toBeVisible({ timeout: 30_000 });

    for (const [index, id] of ["model-alpha", "model-beta", "model-gamma"].entries()) {
      for (const kind of ["up", "down", "remove"]) {
        await expect(
          page.getByTestId(`blackhole-chain-observer-${kind}-${index}`),
        ).toHaveAccessibleName(new RegExp(id));
      }
    }
  });

  // ── The implicit tail (test-plan #F4, #F5) ────────────────────────────────
  test("the session-model tail reflects sessionFallback without a reload", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    await expandGroups(page);

    const tail = page.getByTestId("blackhole-chain-observer-tail-session");
    await expect(tail).toHaveAttribute("data-excluded", "false");

    await page.getByTestId("blackhole-input-sessionFallback").uncheck();
    await expect(tail).toHaveAttribute("data-excluded", "true");
    await expect(tail).toContainText("excluded");
  });

  test("the tail is shown but is not an entry of the chain", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    const chain = page.getByTestId("blackhole-chain-observer");
    await expect(chain).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("blackhole-chain-observer-tail")).toContainText("base-model");
    // Three real entries; the tail adds no fourth.
    await expect(chain.locator("[data-testid^='blackhole-chain-observer-entry-']")).toHaveCount(3);
    await expect(page.getByTestId("blackhole-chain-observer-entry-3")).toHaveCount(0);
  });

  // ── Copy rules (test-plan #F7) ────────────────────────────────────────────
  test("the form never demands a restart and attributes immediate apply", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    const body = page.getByTestId("blackhole-settings");
    await expect(body).toBeVisible({ timeout: 30_000 });

    await expect(body).not.toContainText(/restart/i);
    await expect(page.getByTestId("blackhole-apply-note")).toContainText(
      /pi-blackhole re-reads this file/i,
    );
  });

  // ── Dirty / save / revert (test-plan #F8) ─────────────────────────────────
  test("save is absent when clean, present when dirty, and gone again after discard", async ({
    page,
  }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    await expandGroups(page);

    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);

    const input = page.getByTestId("blackhole-input-compactAfterTokens");
    await input.fill("90000");
    await input.blur();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await expect(page.getByTestId("save-btn")).toBeEnabled();

    await page.getByTestId("discard-btn").click();
    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
  });

  // ── R1: overlay dismissal must not discard unsaved edits ─────────────────
  // Converting Settings into a route-backed overlay added three dismissal
  // gestures the full page never had. Each one reaches `Dialog`'s onClose, so
  // without the opt-in guard it navigates away and eats the edit. This is the
  // highest-severity risk in add-route-backed-overlay-dialogs.
  for (const [name, dismiss] of [
    ["Escape", async (page) => await page.keyboard.press("Escape")],
    ["the ✕ affordance", async (page) => await page.getByTestId("settings-overlay-close").click()],
    ["a backdrop click", async (page) => await page.getByTestId("settings-overlay-overlay").click({ position: { x: 5, y: 5 } })],
  ] as [string, (page: import("@playwright/test").Page) => Promise<void>][]) {
    test(`dismissing a dirty settings overlay via ${name} prompts instead of discarding`, async ({
      page,
    }) => {
      await routeInstalled(page);
      await routeConfig(page, configFixture());
      await gotoBlackhole(page);
      await expandGroups(page);

      const input = page.getByTestId("blackhole-input-compactAfterTokens");
      await input.fill("90000");
      await input.blur();
      await expect(page.getByTestId("settings-save-bar")).toBeVisible();

      await dismiss(page);

      // The prompt is raised AND the surface is still mounted with the edit
      // intact — the URL must not have moved.
      await expect(page.getByTestId("unsaved-changes-dialog")).toBeVisible();
      await expect(page).toHaveURL(/\/settings\/plugins\/blackhole/);
      await expect(page.getByTestId("settings-overlay")).toBeVisible();

      // Cancelling returns to the edit, still unsaved.
      await page.getByTestId("unsaved-cancel").click();
      await expect(page.getByTestId("unsaved-changes-dialog")).toHaveCount(0);
      await expect(page.getByTestId("blackhole-input-compactAfterTokens")).toHaveValue("90000");
    });
  }

  // S-17 / D1b — the discard confirm must return to the LAUNCHING route. The
  // popstate guard used to hardcode setPendingNav("/"), evicting the user to
  // the card list: the exact defect this change exists to fix.
  //
  // MUST navigate in-app. page.goto() is a hard load, which leaves no captured
  // launcher, and the cold-load path then correctly synthesizes "/" from the
  // depth table (D4) — a test built on goto() asserts the wrong contract.
  test("confirming the discard returns to the launching route, not the card list", async ({
    page,
  }) => {
    const cwd = Buffer.from(FIXTURE_GIT).toString("base64url");
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoDashboard(page);
    await page.goto(`/folder/${cwd}`);
    await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 20_000 });

    // Client-side navigation, so the launching route is actually captured.
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, PLUGIN_PATH);
    await expandGroups(page);

    const input = page.getByTestId("blackhole-input-compactAfterTokens");
    await input.fill("90000");
    await input.blur();
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("unsaved-changes-dialog")).toBeVisible();

    // Stop stubbing before the navigation: an in-flight routed request would
    // otherwise be torn down mid-fetch ("Response has been disposed").
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.getByTestId("unsaved-discard").click();

    // Back to the FOLDER the user launched from — not the card list.
    await expect(page).toHaveURL(new RegExp(`/folder/${cwd}$`));
  });

  // ── No per-session state on the global surface (test-plan #F9) ────────────
  test("renders no per-session pipeline content", async ({ page }) => {
    await routeInstalled(page);
    await routeConfig(page, configFixture());
    await gotoBlackhole(page);
    const body = page.getByTestId("blackhole-settings");
    await expect(body).toBeVisible({ timeout: 30_000 });

    // The per-session surface moved to `add-blackhole-session-pipeline`; none of
    // its vocabulary may appear here.
    await expect(body).not.toContainText(/pending|observation pool fullness|session card/i);
    await expect(body.locator("[data-testid^='blackhole-session-']")).toHaveCount(0);
  });
});
