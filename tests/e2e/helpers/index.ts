import type { Page, Locator } from "@playwright/test";

// Central testid → locator map. Specs select on existing app data-testids
// (693 already shipped) — NOT CSS classes, text copy, or DOM structure.
// A renamed testid breaks here, in one place. Do NOT add app testids for E2E.
// See openspec change add-playwright-e2e/design.md.
export const TESTIDS = {
  // Stable shell — header bar renders on the main dashboard view.
  headerAppBar: "header-app-bar",
  settingsBtn: "settings-btn",
  // Sessions (scenario backlog).
  sessionCardDesktop: "session-card-desktop",
  sessionSearchInput: "session-search-input",
  // VCS panels (scenario backlog).
  composerGitGroup: "composer-git-group",
  composerJjGroup: "composer-jj-group",
  gitInitBtn: "git-init-btn",
  // Terminal (scenario backlog).
  terminalCard: "terminal-card",
  openInlineTerminalButton: "open-inline-terminal-button",
} as const;

export function byTestId(page: Page, key: keyof typeof TESTIDS): Locator {
  return page.getByTestId(TESTIDS[key]);
}

/** Navigate to the dashboard root and wait for the shell to mount. */
export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
}
