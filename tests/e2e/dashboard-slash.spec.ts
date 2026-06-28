import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt } from "./helpers/index.js";

// Browser E2E — `/dashboard:*` executable-mode slash commands.
//
// Proves the full slash-exec pipeline inside the disposable container:
//   composer → send_prompt → bridge parseSendPrompt → sessionPrompt →
//   tryExecSlashTemplate → loadPromptTemplate (resolves the bundled
//   pi-dashboard skill's commands/*.md via pi.getCommands(), since the session
//   cwd is /fixtures/sample-git which has NO skill on disk) → handleBashCommand
//   → bash_output { source: "slash-exec" } → ChatView → BashOutputCard footer.
//
// `/dashboard:server-health` curls the in-container dashboard via the injected
// PI_DASHBOARD_BASE env, with NO LLM credential. The "ran locally" footer is
// the proxy for "LLM not invoked"; the health output proves the curl+jq body ran.
//
// Regression: a `!` bang command renders a bash card WITHOUT the footer.
// See change: add-dashboard-slash-commands.

const FOOTER = /ran locally/i;

test.describe("dashboard slash commands (executable: bash)", () => {
  test("/dashboard:server-health runs locally, renders output + footer, no LLM", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "/dashboard:server-health");

    // Footer proves the slash-exec source flag round-tripped to the client.
    await expect(page.getByText(FOOTER).first()).toBeVisible({ timeout: 30_000 });
    // Health body proves the curl + jq executed against the in-container server.
    await expect(page.getByText(/ok=true/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("! bang command renders a bash card without the slash-exec footer", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "!echo hi-from-bang");

    await expect(page.getByText(/hi-from-bang/).first()).toBeVisible({ timeout: 30_000 });
    // The "ran locally" footer is exclusive to slash-exec; bang commands omit it.
    await expect(page.getByText(FOOTER)).toHaveCount(0);
  });
});
