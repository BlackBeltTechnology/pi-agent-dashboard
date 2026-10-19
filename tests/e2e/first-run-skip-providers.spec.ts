import { expect, test } from "./fixtures.js";
import { pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { byTestId, gotoDashboard, routeProviderData } from "./helpers/index.js";

// Browser E2E — Landing Step ① "Skip for now" (change: fix-provider-catalogue-first-run,
// test-plan F13). With no usable provider Step ② is locked; skipping unlocks it and
// the choice survives a reload.
//
// Mirrors first-run-create-project.spec.ts for pins (Step ② only renders at zero
// pins; restore exactly what was removed) and redesign-providers-list.spec.ts for the
// `page.route` provider-data mocks (the harness seeds a credential, so providersReady
// would otherwise be true).

const SKIP_KEY = "pi-dashboard.onboarding.providersSkipped";

async function readPinned(request: import("@playwright/test").APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/access/grants");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data?: { pinnedDirectories?: string[] } };
  return body.data?.pinnedDirectories ?? [];
}

test.describe("first-run: skip provider setup on Landing", () => {
  let savedPins: string[] = [];

  test.beforeEach(async ({ request, page }) => {
    savedPins = await readPinned(request);
    for (const dir of savedPins) await unpinViaBus(dir);
    await expect.poll(() => readPinned(request), { timeout: 15_000 }).toEqual([]);
    // No provider is usable: status rows all unauthenticated, no custom endpoints.
    routeProviderData(page, { statuses: [], providers: {} });
    await gotoDashboard(page);
    await page.evaluate((key) => localStorage.removeItem(key), SKIP_KEY);
    await page.reload();
  });

  test.afterEach(async ({ request, page }) => {
    await page.evaluate((key) => localStorage.removeItem(key), SKIP_KEY).catch(() => {});
    for (const dir of await readPinned(request)) await unpinViaBus(dir);
    for (const dir of savedPins) await pinViaBus(dir);
  });

  // F13 — skip unlocks Step ②, and the choice survives a reload.
  test("skipping unlocks Step 2 and survives a reload", async ({ page }) => {
    await expect(byTestId(page, "onboardingStep2Create")).toHaveCount(0);

    await byTestId(page, "onboardingStep1Skip").click({ timeout: 20_000 });
    await expect(byTestId(page, "onboardingStep1Skipped")).toBeVisible();
    await expect(byTestId(page, "onboardingStep2Create")).toBeVisible();

    await page.reload();
    await expect(byTestId(page, "onboardingStep1Skipped")).toBeVisible({ timeout: 20_000 });
    await expect(byTestId(page, "onboardingStep2Create")).toBeVisible();
  });
});
