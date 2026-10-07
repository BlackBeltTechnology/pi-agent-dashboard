import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 — role-aware model refs (change: add-role-aware-model-refs).
 * Covers test-plan rows F1–F4 and X14.
 *
 * Harness glue copied from `model-roles-promotion.spec.ts` (custom role editing
 * needs a live session: the roles list + model catalogue reach the browser
 * through it) and `blackhole-settings.spec.ts`. Uses a CUSTOM role per test so
 * the shared container's built-in assignments are never touched; every test
 * removes its role and the blackhole slot it bound. Dashboard port comes from
 * `.pi-test-harness.json` via the Playwright baseURL — never hardcode :18000.
 *
 * X14 ("roles plugin absent") routes `GET /api/roles` to 404 — the exact signal
 * the client gate keys on (the plugin owns that route).
 */

const ROLE = "e2e-follow";
const BLACKHOLE_CONFIG = "/api/plugins/blackhole/config";

async function gotoRoles(page: Page) {
  await page.goto("/settings/plugins/roles");
  await expect(page.getByTestId("roles-group-custom")).toBeVisible({ timeout: 30_000 });
}

/** Stage + save `@ROLE` with the first/last row of the model catalogue; returns the saved ref. */
async function assignRole(page: Page, which: "first" | "last"): Promise<string> {
  await gotoRoles(page);
  if (!(await page.getByTestId(`roles-row-${ROLE}`).isVisible())) {
    await page.getByTestId("roles-add-custom").click();
    await page.getByTestId("roles-add-custom-input").fill(ROLE);
    await page.getByTestId("roles-add-custom-confirm").click();
  } else {
    await page.getByTestId(`roles-row-${ROLE}`).click();
  }
  const picker = page.getByTestId("roles-model-picker");
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await picker.getByTestId("model-selector-button").first().click();
  const rows = page.getByTestId("model-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await (which === "first" ? rows.first() : rows.last()).click();
  const ref = ((await page.getByTestId("roles-ref-echo").textContent()) ?? "").trim();
  await page.getByTestId("save-btn").click();
  await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });
  return ref;
}

async function cleanup(page: Page) {
  await page.request.put(BLACKHOLE_CONFIG, { data: { observerModel: null } });
  await gotoRoles(page).catch(() => {});
  const remove = page.getByTestId(`roles-row-${ROLE}-remove`);
  if (await remove.isVisible().catch(() => false)) await remove.click();
}

const modelIdOf = (ref: string) => ref.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, "");

test.describe("role-aware model refs (L3)", () => {
  test("F1 + F4: a bound blackhole slot follows a role change; Model roles lists the usage", async ({ page }) => {
    test.setTimeout(240_000);
    page.on("dialog", (d) => d.accept());
    await spawnFreshGitSession(page);
    try {
      const first = modelIdOf(await assignRole(page, "first"));

      // Bind blackhole's observer slot to the role (server resolves + writes concrete).
      const put = await page.request.put(BLACKHOLE_CONFIG, { data: { observerModel: `@${ROLE}` } });
      expect(put.ok()).toBeTruthy();
      const read = async () => {
        const body = (await (await page.request.get(BLACKHOLE_CONFIG)).json()) as {
          fields?: { observerModel?: { value?: { provider?: string; id?: string } } };
        };
        const v = body.fields?.observerModel?.value;
        return v?.provider && v.id ? `${v.provider}/${v.id}` : "";
      };
      expect(await read()).toBe(first);

      // F4: the Model roles page lists the binding under the role.
      await gotoRoles(page);
      await expect(page.getByTestId(`roles-used-by-${ROLE}-blackhole`)).toBeVisible({ timeout: 15_000 });

      // F1: reassign the role → the target converges within the 5 s deadline.
      const second = modelIdOf(await assignRole(page, "last"));
      test.skip(second === first, "harness catalogue has a single model — cannot observe a change");
      await expect.poll(read, { timeout: 8_000, intervals: [250, 500, 1000] }).toBe(second);
    } finally {
      await cleanup(page);
    }
  });

  test("F3: the Role tab is keyboard-operable; focus returns to the trigger", async ({ page }) => {
    test.setTimeout(240_000);
    page.on("dialog", (d) => d.accept());
    await spawnFreshGitSession(page);
    try {
      await assignRole(page, "first");
      await page.goto("/");
      await spawnFreshGitSession(page);
      const trigger = page.getByTestId("model-selector-button").first();
      await trigger.click();
      const tablist = page.getByRole("tablist");
      await expect(tablist).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("model-tab-model")).toHaveAttribute("aria-selected", "true");
      await page.getByTestId("model-tab-model").focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByTestId("model-tab-role")).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("model-dropdown")).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await cleanup(page);
    }
  });

  test("F2: a session role pick is one-shot — a later role change does not move it", async ({ page }) => {
    test.setTimeout(300_000);
    page.on("dialog", (d) => d.accept());
    await spawnFreshGitSession(page);
    try {
      await assignRole(page, "first");
      await page.goto("/");
      await spawnFreshGitSession(page);
      const trigger = page.getByTestId("model-selector-button").first();
      await trigger.click();
      await page.getByTestId("model-tab-role").click();
      await page.locator(`[data-testid='role-row'][data-role='${ROLE}']`).click();
      await expect(page.getByTestId("model-via-role")).toContainText(`@${ROLE}`, { timeout: 15_000 });
      const before = (await trigger.textContent()) ?? "";

      await assignRole(page, "last"); // the role now resolves elsewhere
      await page.goBack().catch(() => {});
      await page.waitForTimeout(6_000);
      const after = (await page.getByTestId("model-selector-button").first().textContent()) ?? "";
      expect(after.split("via")[0]).toBe(before.split("via")[0]);
    } finally {
      await cleanup(page);
    }
  });

  test("X14: without the roles plugin there is no Role tab anywhere; direct models stay editable", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/roles", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }),
    );
    await gotoDashboard(page);
    await spawnFreshGitSession(page);
    const trigger = page.getByTestId("model-selector-button").first();
    await trigger.click();
    await expect(page.getByTestId("model-dropdown")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByTestId("model-tab-role")).toHaveCount(0);
    await expect(page.getByTestId("model-row").first()).toBeVisible();
  });
});
