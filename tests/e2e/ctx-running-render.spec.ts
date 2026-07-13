import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change: fix-ctx-running-render.
 *
 * The `CtxToolRenderer` used to describe a `ctx_*` call only from its result
 * text. While a call was still RUNNING there was no result, so the header chip
 * fell back to the bare tool name (duplicating the subtitle) and the body
 * showed a bare `Running…`. The fix derives the chip + a preview body from
 * `args` while running.
 *
 * This spec proves the running render through the real WS pipeline:
 *   1. The faux `ctx-batch-running` scenario streams a single
 *      `ctx_batch_execute` call carrying `args.commands` (two labelled cmds).
 *   2. `routeWebSocket` DROPS the tool's `tool_execution_end` frame on the
 *      server→browser hop, so the single-member burst stays RUNNING (auto-
 *      expanded) and the child `CtxToolRenderer` renders its running state.
 *   3. Expand the member step (its collapsed title is the `getSummary`
 *      one-liner) to reveal the child `CtxToolRenderer`, then assert the
 *      args-derived chip `▦ 2 cmds` (NOT the bare tool name) and the per-command
 *      RunningPreview list render in its running body.
 *
 * The sub-second render logic is covered deterministically by the jsdom unit
 * suite (CtxToolRenderer.test.tsx running-state cases); this spec proves the
 * real browser round-trip.
 */

/**
 * Drop every server→client `tool_execution_end` WS frame (there is exactly one
 * in this scenario). Must be installed BEFORE the page opens its socket — call
 * before any navigation. HTTP is unaffected. Mirrors superseded-heal.spec.ts.
 */
async function dropToolEndFrames(page: import("@playwright/test").Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: verbatim
    server.onMessage((m) => {
      if (typeof m === "string") {
        try {
          const parsed = JSON.parse(m) as { type?: string; event?: { eventType?: string } };
          if (parsed.type === "event" && parsed.event?.eventType === "tool_execution_end") {
            return; // DROP — freeze the card in its running state
          }
        } catch {
          // fall through to forward
        }
      }
      ws.send(m);
    });
  });
}

test.describe("ctx running-state render", () => {
  test("a running ctx_batch_execute shows an args-derived chip + command preview", async ({ page }) => {
    test.setTimeout(90_000);

    // Install BEFORE the dashboard opens its socket.
    await dropToolEndFrames(page);
    // 404 the HTTP reconcile route so the frozen running card cannot self-heal
    // mid-test — keeps the running-state assertions deterministic.
    await page.route("**/api/sessions/*/tool-result/*", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "evicted" }) }),
    );

    // Keep generic tool calls visible (a fresh container may seed all-false).
    const res = await page.request.patch("/api/preferences/display", {
      data: { toolResults: true, toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true } },
    });
    expect(res.ok()).toBeTruthy();

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:ctx-batch-running]] go");

    // The single ctx call renders inside a single-member burst; its terminal
    // frame is dropped, so it stays RUNNING (auto-expanded body).
    const burst = page.getByTestId("tool-burst-group");
    await expect(burst).toBeVisible({ timeout: 30_000 });
    await expect(burst).toHaveAttribute("data-running", "true", { timeout: 10_000 });

    const body = page.getByTestId("tool-burst-body");
    await expect(body).toBeVisible();

    // The member renders as a COLLAPSED step whose title is the getSummary
    // one-liner (`ctx_batch_execute 2 cmds`). Expand it to mount the child
    // CtxToolRenderer with its running body.
    await body.getByText("ctx_batch_execute 2 cmds").click();

    // Args-derived header chip — `▦ 2 cmds`, NOT the bare tool name. Before the
    // fix the running chip duplicated the `ctx_batch_execute` subtitle.
    await expect(body.getByText("▦ 2 cmds")).toBeVisible({ timeout: 10_000 });

    // RunningPreview lists each command's label — not a bare `Running…`.
    await expect(body.getByText("list files")).toBeVisible();
    await expect(body.getByText("count lines")).toBeVisible();
  });
});
