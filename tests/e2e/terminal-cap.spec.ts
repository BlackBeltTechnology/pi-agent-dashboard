import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E - terminal cap refusal (change: harden-server-capability-bounds, test-plan #F8).
//
// With the harness booted with a tiny global PTY cap, the third "+ Terminal" is
// refused: the server starts nothing and the requesting socket gets
// `terminal_limit_reached`, which the editor pane renders as a dismissible
// `role="status"` notice. Closing a terminal frees a slot; the next "+" succeeds
// and the notice clears. Only a live browser + server + PTY proves the whole loop
// (the cap itself, the targeted message, the notice slot, the clear-on-spawn rule).
//
// Variant harness: the cap is global, so it needs a DEDICATED boot with no other
// terminals alive, and it cannot be a shared default (other specs open many
// terminals). Locally opt in with:
//   PI_E2E_SEED=1 PI_E2E_TERMINALS_MAX_CONCURRENT=2 docker/test-up.sh -d --build
const CAP_VARIANT = process.env.PI_E2E_TERMINALS_MAX_CONCURRENT === "2";

test.describe("terminal cap", () => {
  test.skip(
    !CAP_VARIANT,
    "variant harness: runs on the `e2e-bounds-variants` CI leg (PI_E2E_TERMINALS_MAX_CONCURRENT=2); see .github/workflows/ci-e2e-browser.yml",
  );

  test("a refused + Terminal shows a notice; closing one frees a slot and clears it", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    const editorPane = page.getByTestId("split-editor-pane");
    await expect(editorPane).toBeVisible();

    const notice = editorPane.getByTestId("terminal-limit-notice");
    const tabs = editorPane.getByRole("tab");

    // Two terminals fit under the cap of 2.
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(1, { timeout: 30_000 });
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(2, { timeout: 30_000 });
    await expect(notice).toHaveCount(0);

    // The third is refused: a polite status notice naming the limit; still 2 tabs.
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(notice.getByRole("status")).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("2 terminals are open");
    await expect(tabs).toHaveCount(2);

    // Closing one frees a slot; the next "+" succeeds and the stale notice clears.
    const first = tabs.first();
    await first.hover();
    await first.getByRole("button").first().click();
    await expect(tabs).toHaveCount(1, { timeout: 20_000 });
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(2, { timeout: 30_000 });
    await expect(notice).toHaveCount(0);
  });
});

// Browser E2E - terminal cwd refusal (change: harden-git-terminal-plugin-boundaries, test-plan #SF2).
//
// A standalone `create_terminal` whose cwd is neither a session cwd nor a pinned directory is
// refused: no PTY, no tab, and the requesting page gets `terminal_error{cwd_not_admitted}` which
// the editor pane renders as a dismissible `role="status"` notice. A later create in a KNOWN
// folder spawns and clears the notice. Default harness (no cap variant): the cap variant's
// leftover terminals would make the follow-up create hit the limit instead.
test.describe("terminal cwd refusal", () => {
  test.skip(CAP_VARIANT, "default harness only: the cap-2 variant would turn the follow-up create into a limit refusal");

  test("an unknown-folder create shows a dismissible notice and no tab; a known-folder create spawns and clears it", async ({ page }) => {
    // Capture the page's OWN /ws socket so the test can send an arbitrary browser frame as the
    // requesting socket (the refusal is delivered to the requester only). Install BEFORE the page connects.
    const serverSockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      serverSockets.push(server);
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
    await robustClick(page, "layout-mode-split");
    const editorPane = page.getByTestId("split-editor-pane");
    await expect(editorPane).toBeVisible();

    const notice = editorPane.getByTestId("terminal-error-notice");
    const tabs = editorPane.getByRole("tab");
    await expect(tabs).toHaveCount(0);

    // Neither a session cwd nor pinned: refused.
    expect(serverSockets.length).toBeGreaterThan(0);
    serverSockets[serverSockets.length - 1].send(JSON.stringify({ type: "create_terminal", cwd: "/tmp/pi-e2e-not-a-known-folder" }));
    await expect(notice.getByRole("status")).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(/not (one the dashboard knows|a known)|could not be verified/i);
    await expect(tabs).toHaveCount(0);

    // Dismiss removes it.
    await notice.getByRole("button", { name: /dismiss/i }).click();
    await expect(notice).toHaveCount(0);

    // A refusal again, then a create in the known (session) folder spawns and clears the notice.
    serverSockets[serverSockets.length - 1].send(JSON.stringify({ type: "create_terminal", cwd: "/tmp/pi-e2e-not-a-known-folder" }));
    await expect(notice.getByRole("status")).toBeVisible({ timeout: 20_000 });
    await launchFromNewTabMenu(page, "new-terminal-launch");
    await expect(tabs).toHaveCount(1, { timeout: 30_000 });
    await expect(notice).toHaveCount(0);
  });
});
