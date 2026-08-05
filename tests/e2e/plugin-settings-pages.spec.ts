import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the per-plugin settings pages (change:
 * plugin-settings-pages). Covers test-plan rows F1-F14 and X1-X5, X7.
 *
 * Fixture states the harness seeds for us (docker/test-entrypoint.sh, gated on
 * PI_E2E_SEED):
 *   e2e-broken     server entry throws  -> status.error       (row X1)
 *   e2e-needs-req  absent pi extension  -> missingRequirements (row X2)
 * Enable/disable states are driven through the real `POST /api/plugins/:id/
 * toggle` route rather than a stubbed store, so the specs exercise the same
 * path the UI does.
 *
 * `hermes-memory` is the dirty-state vehicle: it is the plugin whose settings
 * body this change re-homed onto the global Save Bar (its own `position: fixed`
 * footer was deleted), so its edits are the honest test of host-owned save.
 */

const DIRTY_PLUGIN = "hermes-memory";
const DIRTY_FIELD = "hermes-input-memoryCharLimit";

async function setPluginEnabled(request: APIRequestContext, id: string, enabled: boolean) {
  const res = await request.post(`/api/plugins/${id}/toggle`, { data: { enabled } });
  expect(res.ok(), `toggle ${id} -> ${enabled}`).toBe(true);
}

/** Hard-navigate (full document load) and wait for the rail. */
async function gotoSettings(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
}

/**
 * Move between settings pages the way a user does — through the rail, in the
 * SAME document. Multi-page dirty scenarios MUST use this: `page.goto` reloads
 * and would discard the very draft state under test.
 */
async function railGoto(page: Page, label: string | RegExp) {
  const rail = page.getByTestId("settings-nav-rail");
  await rail.getByRole("button", { name: label, exact: typeof label === "string" }).click();
}

/**
 * Dirty a BUILT-IN page. Uses the Developer page's `Dev Build on Reload`
 * toggle: flipping it is always an edit regardless of the persisted value (so
 * a spec that Saves cannot make a later spec's edit a silent no-op), and
 * committing it has no effect on the running harness — unlike the Server page's
 * HTTP port, which a Save would rebind on the next restart.
 */
async function dirtyBuiltInPage(page: Page) {
  await gotoSettings(page, "/settings/developer");
  const toggle = page
    .getByTestId("settings-content")
    .getByText("Dev Build on Reload", { exact: true })
    .locator("xpath=following-sibling::button[1]");
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect(page.getByTestId("settings-save-bar")).toBeVisible();
}

/** Put the hermes-memory page into a dirty state and return to a stable point. */
async function dirtyPluginPage(page: Page, { navigate = true } = {}): Promise<string> {
  if (navigate) await gotoSettings(page, `/settings/plugins/${DIRTY_PLUGIN}`);
  // Wait for the plugin BODY to mount before touching its DOM: the settings
  // form is fetched, so the <details> groups do not exist on first paint.
  await expect(page.getByTestId("hermes-file-path")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
  });
  const input = page.getByTestId(DIRTY_FIELD);
  await expect(input).toBeVisible({ timeout: 20_000 });
  // Derive the edit from the CURRENT value: a fixed literal stops being an
  // edit once an earlier spec's Save has persisted it, and the page would
  // silently never go dirty.
  const current = Number((await input.inputValue()) || "0");
  const next = String(current + 1);
  await input.fill(next);
  await input.blur();
  await expect(page.getByTestId("settings-save-bar")).toBeVisible();
  return next;
}

test.describe("plugin settings pages (L3)", () => {
  test.beforeEach(async ({ page }) => {
    // Mount the shell once so the first-launch preset modal is auto-dismissed
    // by the shared handler before any settings interaction.
    await gotoDashboard(page);
  });

  test.afterEach(async ({ page }) => {
    // Leave every plugin enabled for the next spec regardless of failure point.
    for (const id of ["subagents", "flows", DIRTY_PLUGIN]) {
      await page.request.post(`/api/plugins/${id}/toggle`, { data: { enabled: true } });
    }
  });

  // ── Routing + rail ────────────────────────────────────────────────────────

  // (test-plan #F5) — design D8a: exactly one active entry.
  test("a plugin page marks its nav child active, not the parent", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins/roles");
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail.getByTestId("nav-plugin-roles")).toHaveAttribute("aria-current", "page");
    await expect(rail.locator("[aria-current='page']")).toHaveCount(1);
  });

  // (test-plan #F6)
  test("the activation index marks the Plugins parent active and no child", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins");
    const rail = page.getByTestId("settings-nav-rail");
    const active = rail.locator("[aria-current='page']");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveText(/Plugins/);
    await expect(rail.locator("[data-testid^='nav-plugin-'][aria-current='page']")).toHaveCount(0);
  });

  // (test-plan #F11) — a bookmarked plugin page used to bounce to General.
  test("a deep link survives a hard reload", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins/roles");
    await page.reload();
    await expect(page.getByTestId("plugin-settings-page-roles")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe("/settings/plugins/roles");
  });

  // (test-plan #F7)
  test("the rail drops a plugin child the moment it is disabled, with no reload", async ({
    page,
  }) => {
    await gotoSettings(page, "/settings/plugins");
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail.getByTestId("nav-plugin-flows")).toBeVisible();

    await page.getByTestId("plugin-toggle-flows").click();

    await expect(rail.getByTestId("nav-plugin-flows")).toHaveCount(0, { timeout: 20_000 });
    // Same document — no navigation happened.
    expect(new URL(page.url()).pathname).toBe("/settings/plugins");
  });

  // (test-plan #X7)
  test("the rail survives a failing GET /api/plugins", async ({ page }) => {
    await page.route("**/api/plugins", (route) => route.fulfill({ status: 500, body: "{}" }));
    await gotoSettings(page, "/settings/general");
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail.getByRole("button", { name: "Plugins" })).toBeVisible();
    await expect(rail.locator("[data-testid^='nav-plugin-']")).toHaveCount(0);
    // The rest of Settings still works. `exact` because "Remote Servers" also
    // contains "Server" and getByRole name matching is substring by default.
    await rail.getByRole("button", { name: "Server", exact: true }).click();
    await expect(page.getByTestId("settings-content")).toContainText("HTTP Port");
  });

  // ── Page states ───────────────────────────────────────────────────────────

  // (test-plan #F1) — design D6: chrome only, plugin component never mounted.
  test("a disabled plugin's page is chrome-only with a re-enable affordance", async ({ page }) => {
    await setPluginEnabled(page.request, "subagents", false);
    await gotoSettings(page, "/settings/plugins/subagents");

    await expect(page.getByTestId("plugin-page-chrome")).toBeVisible();
    await expect(page.getByTestId("plugin-page-title")).toHaveText("Subagent Inspector");
    await expect(page.getByTestId("plugin-page-chrome")).toContainText("disabled");
    await expect(page.getByTestId("plugin-page-disabled-notice")).toBeVisible();
    await expect(page.getByTestId("plugin-page-reenable-btn")).toBeVisible();
    // Absent from the rail, but the deep link still resolves (design D4).
    await expect(
      page.getByTestId("settings-nav-rail").getByTestId("nav-plugin-subagents"),
    ).toHaveCount(0);
  });

  // (test-plan #F2)
  test("disabling from the page collapses the body and keeps the chrome", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins/flows");
    await expect(page.getByTestId("plugin-settings-page-flows")).toBeVisible();
    await expect(page.getByTestId("plugin-page-disabled-notice")).toHaveCount(0);

    // `.click()`, not `.uncheck()`: the checkbox is controlled by the row's
    // enabled state, which only flips after the toggle round-trip — uncheck's
    // synchronous state assertion would fail on a correct implementation.
    await page.getByTestId("plugin-page-toggle-flows").click();

    await expect(page.getByTestId("plugin-page-disabled-notice")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("plugin-page-chrome")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/settings/plugins/flows");
  });

  // (test-plan #X1) — full error text, copy-on-click, chrome intact.
  test("a load error renders on the plugin's own page", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins/e2e-broken");
    await expect(page.getByTestId("plugin-page-chrome")).toContainText("error");
    const block = page.getByTestId("plugin-status-error-e2e-broken");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Bridge path conflict");
    await expect(page.getByTestId("plugin-status-error-e2e-broken-copy")).toBeVisible();
    // Membership keys on `enabled`, not `loaded` — the page is reachable from
    // the rail precisely because it failed (design D4).
    await expect(
      page.getByTestId("settings-nav-rail").getByTestId("nav-plugin-e2e-broken"),
    ).toBeVisible();
  });

  // (test-plan #X2)
  test("an unmet requirement renders a banner on the plugin's page", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins/e2e-needs-req");
    await expect(page.getByTestId("plugin-page-chrome")).toBeVisible();
    await expect(
      page.getByTestId("missing-piExtension-pi-e2e-absent-extension"),
    ).toBeVisible();
    await expect(page.getByTestId("plugin-page-chrome")).toContainText(
      "requires pi extension",
    );
  });

  // (test-plan #F12) — the activation index is a list, never a settings host.
  test("the activation index never renders settings inline", async ({ page }) => {
    await gotoSettings(page, "/settings/plugins");
    const index = page.getByTestId("plugins-section");
    await expect(index).toBeVisible();
    await expect(index.getByTestId("plugin-page-chrome")).toHaveCount(0);

    await page.getByTestId("plugin-expand-roles").click();

    await expect(page.getByTestId("plugin-settings-page-roles")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe("/settings/plugins/roles");
  });

  // (test-plan #F13) — every monorepo claimant declares `tab: "general"`, so
  // General is the highest-signal check that `tab` really is inert.
  test("General renders no plugin-contributed sections", async ({ page }) => {
    await gotoSettings(page, "/settings/general");
    const content = page.getByTestId("settings-content");
    await expect(content).toBeVisible();
    // Signature nodes of the plugins that used to land here via `tab: general`.
    await expect(content.getByTestId("hermes-file-path")).toHaveCount(0);
    await expect(content.getByTestId("roles-settings")).toHaveCount(0);
    await expect(content.getByTestId("plugin-page-chrome")).toHaveCount(0);
  });

  // (test-plan #F14) — HermesMemorySettings' `position: fixed` footer used to
  // overlay every settings page.
  test("no plugin renders a fixed bottom bar over the viewport", async ({ page }) => {
    for (const path of ["/settings/general", `/settings/plugins/${DIRTY_PLUGIN}`]) {
      await gotoSettings(page, path);
      const fixedBars = await page.evaluate(() => {
        const vh = window.innerHeight;
        return Array.from(document.querySelectorAll("div")).filter((el) => {
          const s = getComputedStyle(el);
          if (s.position !== "fixed") return false;
          const r = el.getBoundingClientRect();
          // A bottom-anchored bar: touches the viewport floor, spans it wide,
          // and is short. Modal backdrops (full-height) are excluded by height.
          return r.height > 0 && r.height < 200 && r.bottom >= vh - 2 && r.width > vh / 2;
        }).length;
      });
      expect(fixedBars, `fixed bottom bars on ${path}`).toBe(0);
    }
  });

  // ── Save Bar attribution + guards ─────────────────────────────────────────

  // (test-plan #F8)
  test("a dirty plugin page shows its dirty dot on the child, not the parent", async ({ page }) => {
    await dirtyPluginPage(page);
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail.getByTestId(`nav-dirty-plugins/${DIRTY_PLUGIN}`)).toBeVisible();
    // The parent `Plugins` entry must not inherit a child's dirt.
    await expect(rail.getByTestId("nav-dirty-plugins")).toHaveCount(0);
  });

  // (test-plan #F9) — no cap on the page list; the plugin entry navigates.
  test("the Save Bar names every dirty page, plugin pages included", async ({ page }) => {
    // Dirty a built-in page first: its draft state lives in SettingsPanel and
    // survives the switch to the plugin page.
    await dirtyBuiltInPage(page);

    // In-document navigation — a reload would discard the built-in draft.
    await railGoto(page, "Hermes Memory");
    await dirtyPluginPage(page, { navigate: false });

    const bar = page.getByTestId("settings-save-bar");
    await expect(bar.getByTestId("save-bar-page-developer")).toBeVisible();
    const pluginEntry = bar.getByTestId(`save-bar-page-plugins/${DIRTY_PLUGIN}`);
    await expect(pluginEntry).toHaveText(/Plugins\s*›\s*Hermes Memory/);
    await expect(page.getByTestId("settings-dirty-page-count")).toHaveText("2");

    // The entry navigates. Leaving a DIRTY plugin page routes through the same
    // guard rail navigation uses (design D5a) — that is the correct path, not a
    // bypass, so resolve it and assert we land on the named page.
    await bar.getByTestId("save-bar-page-developer").click();
    await page.getByRole("button", { name: /discard/i }).last().click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
      .toBe("/settings/developer");
  });

  // (test-plan #F10) — one Save, one fan-out; the contract is unchanged.
  test("a single Save commits both a built-in and a plugin page", async ({ page }) => {
    await dirtyBuiltInPage(page);
    await railGoto(page, "Hermes Memory");
    await dirtyPluginPage(page, { navigate: false });
    await expect(page.getByTestId("settings-dirty-page-count")).toHaveText("2");

    await page.getByTestId("save-btn").click();

    await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("settings-dirty-page-count")).toHaveCount(0);
  });

  // (test-plan #X3) — design D5a: plugin draft state dies on unmount, so
  // leaving a dirty plugin page MUST prompt.
  test("rail navigation prompts when leaving a dirty plugin page", async ({ page }) => {
    const edited = await dirtyPluginPage(page);

    await railGoto(page, "General");

    const dialog = page.getByRole("button", { name: /cancel/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.click();
    // Cancel keeps the edits and the page.
    expect(new URL(page.url()).pathname).toBe(`/settings/plugins/${DIRTY_PLUGIN}`);
    await expect(page.getByTestId(DIRTY_FIELD)).toHaveValue(edited);
  });

  // (test-plan #X4) — the guard must NOT key off aggregate dirtiness, or
  // unsaved Server edits would block opening any other page.
  test("rail navigation does NOT prompt when only a built-in page is dirty", async ({ page }) => {
    await dirtyBuiltInPage(page);

    await railGoto(page, "General");

    await expect(page.getByRole("button", { name: /cancel/i })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/settings/general");
    // The edit and its indicator survive the switch.
    await expect(page.getByTestId("settings-save-bar")).toBeVisible();
    await expect(
      page.getByTestId("settings-nav-rail").getByTestId("nav-dirty-developer"),
    ).toBeVisible();
  });

  // (test-plan #X5) — design Open Question 3: the confirm must resolve BEFORE
  // the rail drops the child, or a dirty source is filed under a page with no
  // nav entry.
  test("disabling a plugin from its dirty page confirms before the rail updates", async ({
    page,
  }) => {
    const edited = await dirtyPluginPage(page);
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail.getByTestId(`nav-plugin-${DIRTY_PLUGIN}`)).toBeVisible();

    await page.getByTestId(`plugin-page-toggle-${DIRTY_PLUGIN}`).click();

    // The confirm is up and the child is STILL in the rail.
    const cancel = page.getByRole("button", { name: /cancel/i });
    await expect(cancel).toBeVisible({ timeout: 10_000 });
    await expect(rail.getByTestId(`nav-plugin-${DIRTY_PLUGIN}`)).toBeVisible();

    await cancel.click();
    // Cancelling leaves the plugin enabled and the edits intact.
    await expect(rail.getByTestId(`nav-plugin-${DIRTY_PLUGIN}`)).toBeVisible();
    await expect(page.getByTestId(DIRTY_FIELD)).toHaveValue(edited);
  });
});
