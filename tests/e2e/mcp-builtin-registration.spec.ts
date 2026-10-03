import {
  MCP_DASHBOARD_CALL_PREFIX,
  MCP_ENV_PROBE_PREFIX,
} from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// L3 — the dashboard MCP server reaches a REAL harness pi session through pi's
// built-in MCP (change: migrate-mcp-to-pi-builtin, test-plan X1/X2).
//
// The bridge registers `pi-dashboard` with `pi.registerMcpServer()` using the
// token + `/mcp` URL the mcp-server plugin delivers (`exposure: "deferred"`).
// Both scenarios drive the real pi agent loop with the faux provider:
//
//   X1  `[[faux:mcp-env-probe]]`      bash `env` → the dump carries neither a
//       `PI_DASHBOARD_MCP_TOKEN` variable nor any `mcp_…` credential.
//   X2  `[[faux:mcp-dashboard-call]]` `tool_search` loads the deferred
//       `mcp__pi_dashboard__list_sessions`, which is then called — a round
//       trip through pi's MCP client to /mcp with the session's bearer.
//       After a dashboard restart the bridge re-mints, re-registers, and the
//       same call succeeds again.
//
// The harness port comes from `.pi-test-harness.json` via the fixtures — never
// hardcoded.

async function serverIdentity(
  page: import("@playwright/test").Page,
): Promise<{ pid: number; startedAt: string } | null> {
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    if (!res.ok()) return null;
    const body = (await res.json()) as { pid: number; startedAt: string };
    return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt };
  } catch {
    return null; // mid-restart
  }
}

test.describe("built-in MCP registration (L3)", () => {
  test("X1: a subprocess of the session cannot read the dashboard MCP credential", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:mcp-env-probe]] dump the environment");
    await expect(
      page.getByText(`${MCP_ENV_PROBE_PREFIX} ran=true tokenVar=false mcpToken=false`).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("X2: the session reaches /mcp through pi's MCP, before and after a dashboard restart", async ({ page }) => {
    test.setTimeout(300_000);
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:mcp-dashboard-call]] list sessions via the dashboard MCP");
    await expect(page.getByText(new RegExp(`${MCP_DASHBOARD_CALL_PREFIX} ok=true`)).first()).toBeVisible({
      timeout: 90_000,
    });

    const before = await serverIdentity(page);
    expect(before, "server identity must be readable before restart").not.toBeNull();
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response — expected.
    });
    await expect
      .poll(async () => {
        const now = await serverIdentity(page);
        return now !== null && (now.pid !== before!.pid || now.startedAt !== before!.startedAt);
      }, { timeout: 120_000, intervals: [500] })
      .toBe(true);

    await page.reload();
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.click();
    // The old bearer died with the old server; only the re-minted, re-registered
    // one can make this call succeed.
    await sendPrompt(page, "[[faux:mcp-dashboard-call]] list sessions again after restart");
    await expect(page.getByText(new RegExp(`${MCP_DASHBOARD_CALL_PREFIX} ok=true`))).toHaveCount(2, {
      timeout: 120_000,
    });
  });
});
