import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Sidebar-header helpers (change: declutter-sidebar-header, design D7).
 *
 * Remote access / Install moved into the connection chip's menu, the mode toggle into the
 * Appearance dropdown, and the two search inputs into one scoped box. These helpers open the
 * surface so specs only assert on the controls inside it.
 */

/** The visible connection chip (desktop sidebar; `.first()` tolerates the mobile overlay copy). */
export const connectionChip = (page: Page): Locator => page.locator('[data-testid="connection-chip"]:visible').first();

/** Open the connection menu (server list + Access group); returns the menu locator. */
export async function openConnectionMenu(page: Page): Promise<Locator> {
  const menu = page.getByRole("menu", { name: "Switch server" });
  if (!(await menu.isVisible().catch(() => false))) {
    await expect(connectionChip(page)).toBeVisible({ timeout: 15_000 });
    await connectionChip(page).click();
  }
  await expect(menu).toBeVisible({ timeout: 15_000 });
  return menu;
}

/** Open the Appearance dropdown (mode toggle + palette list); returns it. */
export async function openAppearance(page: Page): Promise<Locator> {
  const dropdown = page.getByTestId("theme-picker-dropdown");
  if (!(await dropdown.isVisible().catch(() => false))) await page.getByTestId("theme-picker-trigger").click();
  await expect(dropdown).toBeVisible({ timeout: 10_000 });
  return dropdown;
}

/** Type into the scoped sidebar search box, switching its scope first when needed. */
export async function setSearch(page: Page, scope: "sessions" | "folders", text: string): Promise<void> {
  const inputId = scope === "sessions" ? "session-search-input" : "workspace-filter-input";
  const input = page.getByTestId(inputId).first();
  if (!(await input.isVisible().catch(() => false))) await page.getByTestId(`search-scope-${scope}`).first().click();
  await input.fill(text);
}
