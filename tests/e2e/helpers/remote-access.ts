import { expect, type Page } from "@playwright/test";

/**
 * Remote access dialog helpers (change: add-remote-access-wizard).
 *
 * `openRemoteAccess` opens the status landing; `openAddressStep` walks the
 * Share-over-the-internet task to its Public address step, expanding the fold of
 * already-satisfied steps and re-opening the step when it is collapsed. Both
 * tolerate whichever step the stubbed state makes current.
 */
export async function openRemoteAccess(page: Page): Promise<void> {
  const btn = page.getByTestId("tunnel-btn");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId("remote-access-landing")).toBeVisible({ timeout: 15_000 });
}

export async function openAddressStep(page: Page): Promise<void> {
  await openRemoteAccess(page);
  await page.getByTestId("remote-access-task-share").click();
  await expect(page.getByTestId("remote-access-wizard")).toBeVisible({ timeout: 15_000 });
  const body = page.getByTestId("remote-access-step-body-address");
  const fold = page.getByTestId("remote-access-fold");
  if (!(await body.isVisible().catch(() => false)) && (await fold.isVisible().catch(() => false))) {
    await fold.getByRole("button").click();
  }
  const reopen = page.getByTestId("remote-access-step-open-address");
  if (!(await body.isVisible().catch(() => false)) && (await reopen.isVisible().catch(() => false))) {
    await reopen.click();
  }
  await expect(body).toBeVisible({ timeout: 15_000 });
}

/** Settings ▸ Network ▸ Gateway — the expert view that hosts the readiness board and Make-primary. */
export async function openGatewayPage(page: Page): Promise<void> {
  await page.goto("/settings/gateway");
  await expect(page.getByTestId("gateway-page")).toBeVisible({ timeout: 15_000 });
}
