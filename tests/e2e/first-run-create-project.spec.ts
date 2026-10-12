import { connectBus, expect, test } from "./fixtures.js";
import { pinViaBus, unpinViaBus } from "./helpers/folder-collapse.js";
import { byTestId, gotoDashboard } from "./helpers/index.js";

// Browser E2E — Landing Step ② "Create your first project" against the real
// server (change: streamline-first-run, test-plan F16, F17).
//
// The harness is shared across specs and persists pins, so each case first
// UNPINS everything (the Landing Step ② form only renders at zero pins) and
// afterwards restores exactly what it removed. Credentials are seeded by the
// harness, so Step ② is never locked here.

const NAME = "e2e-first";

async function readPinned(request: import("@playwright/test").APIRequestContext): Promise<string[]> {
  const res = await request.get("/api/access/grants");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data?: { pinnedDirectories?: string[] } };
  return body.data?.pinnedDirectories ?? [];
}

test.describe("first-run: create project on Landing", () => {
  let savedPins: string[] = [];

  test.beforeEach(async ({ request, page }) => {
    savedPins = await readPinned(request);
    for (const dir of savedPins) await unpinViaBus(dir);
    await expect.poll(() => readPinned(request), { timeout: 15_000 }).toEqual([]);
    await gotoDashboard(page);
  });

  test.afterEach(async ({ request }) => {
    for (const dir of await readPinned(request)) await unpinViaBus(dir);
    for (const dir of savedPins) await pinViaBus(dir);
  });

  // F16 — create → pin → start, against the real server.
  test("create → pin → start a session in ~/Projects/<name>", async ({ page }) => {
    const create = byTestId(page, "onboardingStep2Create");
    await expect(create).toBeVisible({ timeout: 20_000 });

    await byTestId(page, "onboardingStep2Name").fill(NAME);
    await create.click();

    // Step ② is done and the sidebar shows the folder.
    await expect(byTestId(page, "onboardingStep2Done")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-testid^="folder-body-"][data-testid$="/Projects/${NAME}"]`).first()).toBeVisible({
      timeout: 20_000,
    });

    // Start a session through the Step ③ CTA, or the sidebar affordance once Landing has moved on.
    const stepCta = byTestId(page, "onboardingStep3Cta");
    if (await stepCta.isVisible().catch(() => false)) {
      await stepCta.click();
    } else {
      await page
        .locator(`[data-testid^="folder-body-"][data-testid$="/Projects/${NAME}"]`)
        .first()
        .getByTestId("folder-spawn-session-btn")
        .click();
    }

    const bus = await connectBus();
    try {
      await expect
        .poll(() => bus.read.sessions().some((s) => s.cwd.endsWith(`/Projects/${NAME}`)), { timeout: 60_000 })
        .toBe(true);
    } finally {
      bus.close();
    }
  });

  // F17 — the server's rejection is rendered; nothing is pinned; the escape hatch still works.
  test("an invalid name is explained inline and the folder browser stays available", async ({ page, request }) => {
    const create = byTestId(page, "onboardingStep2Create");
    await expect(create).toBeVisible({ timeout: 20_000 });

    await byTestId(page, "onboardingStep2Name").fill("a/b");
    await create.click();

    await expect(byTestId(page, "onboardingStep2Error")).toContainText(/single folder name/i, { timeout: 15_000 });
    expect(await readPinned(request)).toEqual([]);

    await byTestId(page, "onboardingStep2Cta").click();
    await expect(byTestId(page, "addFoldersDialog")).toBeVisible();
  });
});
