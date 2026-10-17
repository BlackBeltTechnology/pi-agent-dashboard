/**
 * Helpers for the session actions menu (the flyout that replaced the desktop
 * card's inline action chips). See change: add-session-actions-flyout.
 */
import { expect, type Locator, type Page } from "../fixtures.js";

/** The card's `⋯` trigger (`session-actions-trigger-<id>`). */
export function sessionMenuTrigger(scope: Page | Locator): Locator {
  return scope.locator("[data-testid^='session-actions-trigger-']").first();
}

/** The open menu panel (`session-actions-menu-<id>`). */
export function sessionMenuPanel(page: Page): Locator {
  return page.locator("[data-testid^='session-actions-menu-']").first();
}

/** A host menu item by id (`session-menu-item-<id>`, or a legacy test id). */
export function sessionMenuItem(page: Page, id: string): Locator {
  return page.getByTestId(`session-menu-item-${id}`).first();
}

/** Open a card's menu via its trigger and wait for the panel. */
export async function openSessionMenu(page: Page, card?: Locator): Promise<Locator> {
  const panel = sessionMenuPanel(page);
  if (await panel.isVisible().catch(() => false)) return panel;
  await sessionMenuTrigger(card ?? page).click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

export async function closeSessionMenu(page: Page): Promise<void> {
  if (!(await sessionMenuPanel(page).isVisible().catch(() => false))) return;
  await page.keyboard.press("Escape");
  await expect(sessionMenuPanel(page)).toHaveCount(0, { timeout: 10_000 });
}

/** Expand a group's folded `More…` items when present. */
export async function expandMore(page: Page, group: string): Promise<void> {
  const more = page.getByTestId(`session-menu-more-${group}`);
  if ((await more.count()) > 0 && (await more.getAttribute("aria-expanded")) === "false") await more.click();
}

/** Open the menu and activate an item (expanding `More…` first when `group` is given). */
export async function chooseMenuItem(page: Page, id: string, opts: { card?: Locator; group?: string } = {}): Promise<void> {
  await openSessionMenu(page, opts.card);
  if (opts.group) await expandMore(page, opts.group);
  await sessionMenuItem(page, id).click();
}

/** A flows action (rendered by the flows plugin through the `ui:action-list` menu context). */
export function flowMenuItem(page: Page, name: RegExp): Locator {
  return sessionMenuPanel(page).getByRole("menuitem", { name });
}
