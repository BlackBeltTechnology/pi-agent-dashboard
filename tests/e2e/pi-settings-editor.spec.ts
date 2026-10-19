import { execSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 browser behaviour for the pi settings editor + default-model mirror
 * (change: edit-pi-agent-settings). Covers test-plan rows F13 and F14, and
 * (change: pi-settings-full-coverage) rows F12 and F13: the editor lives on its
 * own `pi → pi settings` rail page, and plain-text API keys can be moved into
 * auth.json from it.
 *
 * F13 drives the Form mode in the real UI and reads the result back through
 * `GET /api/pi-settings`. F14 selects a Default model and asserts pi's own
 * `~/.pi/agent/settings.json` (read via the same API) now carries the split
 * provider/id. NOTE: the harness seeds pi's `defaultProvider: "faux"`
 * (spec `faux-model-integration-tests`); F14 deliberately rewrites it.
 *
 * `GET /api/models` is stubbed so the catalogue does not depend on harness
 * credentials. The dashboard port comes from .pi-test-harness.json via the
 * Playwright baseURL — never hardcode :18000.
 */

const CATALOGUE = {
  object: "list",
  data: [
    { id: "openai/gpt-5-e2e", provider: "openai", input: ["text"], contextWindow: 400000 },
    { id: "anthropic/claude-e2e", provider: "anthropic", input: ["text", "image"] },
  ],
};

/** Settings → pi → pi settings (the editor's own page). */
async function openPiSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "pi settings", exact: true }).click();
  await expect(page.getByTestId("pi-settings-page")).toBeVisible({ timeout: 20_000 });
}

async function openSessionsSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("settings-nav-rail").getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByTestId("retry-settings-section")).toBeVisible({ timeout: 20_000 });
}

async function piSettings(page: Page) {
  const res = await page.request.get("/api/pi-settings");
  expect(res.status()).toBe(200);
  return (await res.json()) as { settings: Record<string, unknown>; raw: string; etag: string };
}

test.describe("pi settings editor", () => {
  // test-plan #F13
  test("a Form edit saves through the unified Save and shows in JSON mode", async ({ page }) => {
    // Pick the value the file does NOT hold, so the edit is always a change.
    const next = (await piSettings(page)).settings.steeringMode === "all" ? "one-at-a-time" : "all";
    await openPiSettings(page);

    await page.getByTestId(`pi-settings-field-steeringMode-${next}`).click();
    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    expect((await piSettings(page)).settings.steeringMode).toBe(next);

    // Not dirty any more, so switching mode does not prompt; the JSON editor
    // (Monaco renders only the visible lines, so assert the file's first keys)
    // shows the re-read file.
    await page.getByTestId("pi-settings-mode-json").click();
    await expect(page.getByTestId("pi-settings-switch-prompt")).toBeHidden();
    await expect(page.getByTestId("pi-settings-page").locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pi-settings-page")).toContainText('"defaultProvider"', { timeout: 20_000 });
  });

  // test-plan #F12 (pi-settings-full-coverage)
  test("the pi settings page saves a typed edit and keeps the other keys", async ({ page }) => {
    const before = await piSettings(page);
    const next = before.settings.steeringMode === "all" ? "one-at-a-time" : "all";
    await openPiSettings(page);

    await page.getByTestId(`pi-settings-field-steeringMode-${next}`).click();
    await expect(page.getByTestId("pi-settings-changed-steeringMode")).toBeVisible();
    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    const after = (await piSettings(page)).settings;
    expect(after.steeringMode).toBe(next);
    // Every other key survived the typed patch.
    for (const [k, v] of Object.entries(before.settings)) {
      if (k !== "steeringMode") expect(after[k], k).toEqual(v);
    }
  });

  // test-plan #F13 (pi-settings-full-coverage)
  test("Move to Providers writes auth.json and drops the key from settings.json", async ({ page }) => {
    const KEY = `sk-proj-e2e-${"a".repeat(40)}`;
    const AUTH = "/home/pi/.pi/agent/auth.json";
    const container = execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" }).trim().split("\n")[0];
    const inContainer = (script: string) => execSync(`docker exec -i ${container} node`, { input: script, encoding: "utf8" });
    const editAuth = (body: string) =>
      inContainer(`
        const fs = require("node:fs");
        const p = ${JSON.stringify(AUTH)};
        let a = {};
        try { a = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
        ${body}
        fs.mkdirSync(require("node:path").dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(a, null, 2), { mode: 0o600 });
      `);

    // Seed: no `openai` credential, and the plain-text key in settings.json.
    editAuth("delete a.openai;");
    const seeded = await piSettings(page);
    const file = { ...JSON.parse(seeded.raw === "" ? "{}" : seeded.raw), openaiApiKey: KEY };
    const put = await page.request.put("/api/pi-settings/raw", { data: { raw: `${JSON.stringify(file, null, 2)}\n`, baseEtag: seeded.etag } });
    expect(put.status()).toBe(200);

    try {
      await openPiSettings(page);
      await expect(page.getByTestId("pi-settings-legacy")).toBeVisible();
      await page.getByTestId("pi-settings-legacy-move-openaiApiKey").click();
      await page.getByTestId("save-btn").first().click();
      await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

      await expect(page.getByTestId("pi-settings-legacy")).toBeHidden();
      const auth = JSON.parse(inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(AUTH)}, "utf8"))`));
      expect(auth.openai).toEqual({ type: "api_key", key: KEY });
      expect((await piSettings(page)).raw).not.toContain("openaiApiKey");
      // The full key never reaches the page DOM.
      expect(await page.locator("body").innerText()).not.toContain(KEY);
      expect(await page.content()).not.toContain(KEY);
    } finally {
      editAuth("delete a.openai;");
    }
  });

  // test-plan #F14
  test("saving a Default model mirrors it into pi's settings.json", async ({ page }) => {
    await page.route("**/api/models", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CATALOGUE) }),
    );
    // Pick the model pi does NOT hold yet, so the save is always a change.
    const [provider, id] = (await piSettings(page)).settings.defaultModel === "gpt-5-e2e"
      ? ["anthropic", "claude-e2e"]
      : ["openai", "gpt-5-e2e"];
    await openSessionsSettings(page);

    const selector = page.getByTestId("model-selector").first();
    await selector.getByTestId("model-selector-button").click();
    // The open dropdown is portaled to the layer root, so resolve from `page`.
    await page.getByTestId("model-row").filter({ hasText: id }).first().click();
    await page.getByTestId("save-btn").first().click();
    await expect(page.getByTestId("settings-save-bar")).toBeHidden({ timeout: 20_000 });

    await expect
      .poll(async () => (await piSettings(page)).settings, { timeout: 20_000 })
      .toMatchObject({ defaultProvider: provider, defaultModel: id });
    // pi now matches the dashboard default, so the pi settings page offers no drift action.
    await page.getByTestId("settings-nav-rail").getByRole("button", { name: "pi settings", exact: true }).click();
    await expect(page.getByTestId("pi-settings-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("pi-settings-sync-defaults")).toBeHidden();
  });
});
