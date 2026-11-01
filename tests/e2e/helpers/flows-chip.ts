/**
 * Helpers for the flows plugin's FLOWS chip (composer dock Context lane) and
 * the flow panel's collapse. Flow actions moved here from the session actions
 * menu. See change: flows-dock-chip-and-panel-actions.
 */
import { expect, type Locator, type Page } from "../fixtures.js";

/** The FLOWS chip group (`ComposerContextGroup` testId). */
export function flowsChip(page: Page): Locator {
  return page.getByTestId("flows-context-group");
}

/** Wait for the chip (the catalog is published at session start). */
export async function waitForFlowsChip(page: Page, timeout = 60_000): Promise<Locator> {
  const chip = flowsChip(page);
  await expect(chip).toBeVisible({ timeout });
  return chip;
}

export const chipRun = (page: Page) => page.getByTestId("flows-chip-run");
export const chipOpen = (page: Page) => page.getByTestId("flows-chip-open");
export const chipEdit = (page: Page) => page.getByTestId("flows-chip-edit-button");

/** Open the chip's pencil popover and return it. */
export async function openChipPopover(page: Page): Promise<Locator> {
  const pop = page.getByTestId("flows-chip-edit-popover");
  // The popover body is a lazy chunk: key on the pencil's state, not on the
  // popover being visible yet, or a second click would close it again.
  if ((await chipEdit(page).getAttribute("aria-expanded")) !== "true") await chipEdit(page).click();
  await expect(pop).toBeVisible({ timeout: 10_000 });
  return pop;
}

/** A pencil-popover item by accessible name (opens the popover first). */
export async function chipPopoverItem(page: Page, name: RegExp): Promise<Locator> {
  const pop = await openChipPopover(page);
  return pop.getByRole("menuitem", { name });
}

export async function closeChipPopover(page: Page): Promise<void> {
  const pop = page.getByTestId("flows-chip-edit-popover");
  if (!(await pop.isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0, { timeout: 10_000 });
}

/** Pick a flow in the open Run / Open picker by a search term. */
export async function pickFlow(page: Page, term: string): Promise<void> {
  const search = page.getByPlaceholder("Search flows...");
  await search.waitFor({ state: "visible", timeout: 15_000 });
  await search.fill(term);
  await page.getByText(term, { exact: false }).first().click();
}

/** Expand the completed-flow summary panel (it starts collapsed). */
export async function expandSummary(page: Page): Promise<void> {
  const toggle = page.getByTestId("flow-summary-panel-toggle");
  await expect(toggle).toBeVisible({ timeout: 120_000 });
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
