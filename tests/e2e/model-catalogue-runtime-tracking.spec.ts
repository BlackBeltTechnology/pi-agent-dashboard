import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * L3 browser behaviour for the runtime-tracking model catalogue
 * (change: adopt-piai-factory-api-registry, test-plan #F1 + #F2).
 *
 * Two halves, deliberately different in kind:
 *
 * 1. **Runtime half (real, unstubbed).** `GET /api/models?annotated=1` must
 *    contain the ids only a pi-ai >= 0.85 catalogue serves. `annotated=1` lists
 *    every model with an `excludedReason` instead of dropping the unreachable
 *    ones, so this assertion is CREDENTIAL-INDEPENDENT — it passes in a harness
 *    container holding no provider keys.
 *
 * 2. **UI half (catalogue stubbed to the new shape).** The picker must render
 *    those ids and the ★Favs filter must converge on a favorite naming one of
 *    them. This is the original symptom: a favorite starred from a session
 *    running the newer pi had no catalogue row to match, so ★Favs rendered
 *    "No models match" and the saved default model could not be seen at all.
 *
 * Harness glue from `settings-default-model-catalogue.spec.ts` (Settings →
 * Sessions nav) + `model-favorites-cross-surface.spec.ts` (★Favs + star
 * toggles). The dashboard port comes from `.pi-test-harness.json` via the
 * Playwright baseURL — never hardcode :18000.
 */

/** Ids present in pi-ai >= 0.85 and absent from the 0.75.5 table. */
const NEW_RUNTIME_IDS = [
  "anthropic/claude-opus-5",
  "zai/glm-5.3",
  "deepseek/deepseek-flash",
];

async function openSessionsSettings(page: Page) {
  await gotoDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });
  await page
    .getByTestId("settings-nav-rail")
    .getByRole("button", { name: "Sessions", exact: true })
    .click();
}

/** Serve the picker the catalogue the installed runtime actually produces. */
async function stubNewRuntimeCatalogue(page: Page) {
  await page.route("**/api/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        object: "list",
        data: NEW_RUNTIME_IDS.map((id) => ({
          id,
          provider: id.split("/")[0],
          input: ["text"],
        })),
      }),
    }),
  );
}

test.describe("model catalogue tracks the installed pi-ai (L3)", () => {
  test.setTimeout(120_000);

  // test-plan #X12 at the harness level — the real server, real runtime, no
  // credentials, no stubbing. This is what proves the pin bump actually moved
  // the catalogue rather than merely changing a version string.
  test("the live /api/models catalogue serves models only pi-ai >= 0.85 has", async ({ page }) => {
    await gotoDashboard(page);

    const res = await page.request.get("/api/models?annotated=1");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);

    const ids = new Set<string>(body.data.map((r: { id: string }) => r.id));
    for (const want of NEW_RUNTIME_IDS) {
      expect(ids.has(want), `catalogue is missing ${want} — got ${ids.size} models`).toBe(true);
    }
    // A non-trivial catalogue: the projection bug produced a 200 with zero
    // models and no error, so a count assertion is the real guard.
    expect(ids.size).toBeGreaterThan(100);
  });

  // test-plan #F2 — the picker offers what the catalogue serves.
  test("the Default Model picker lists the new-runtime catalogue", async ({ page }) => {
    await stubNewRuntimeCatalogue(page);
    await openSessionsSettings(page);

    await expect(page.getByTestId("default-model-catalogue-loading")).toBeHidden({ timeout: 20_000 });
    await page.getByTestId("settings-content").getByTestId("model-selector-button").first().click();

    for (const id of NEW_RUNTIME_IDS) {
      await expect(page.getByTestId("model-row").filter({ hasText: id }).first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  // test-plan #F1 — the ORIGINAL SYMPTOM. A server-persisted favorite naming a
  // model the old catalogue lacked must resolve, not render "No models match".
  test("★Favs converges on a favorite naming a new-runtime model", async ({ page }) => {
    await stubNewRuntimeCatalogue(page);
    await openSessionsSettings(page);

    await expect(page.getByTestId("default-model-catalogue-loading")).toBeHidden({ timeout: 20_000 });
    await page.getByTestId("settings-content").getByTestId("model-selector-button").first().click();

    const target = NEW_RUNTIME_IDS[0];
    const row = page.getByTestId("model-row").filter({ hasText: target }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Normalize to favorited, then filter to favorites ONLY. The filter is the
    // assertion: with the favorite naming a model absent from the catalogue, the
    // list empties and the "No models match" callout renders instead.
    const star = row.getByTestId("model-fav-toggle");
    await expect(star).toBeVisible();
    if ((await star.getAttribute("aria-pressed")) !== "true") await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");

    const favsOnly = page.getByTestId("favs-only-toggle");
    await expect(favsOnly).toBeVisible();
    if ((await favsOnly.getAttribute("aria-pressed")) !== "true") await favsOnly.click();

    await expect(page.getByTestId("model-row").filter({ hasText: target }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("No models match")).toBeHidden();
  });
});
