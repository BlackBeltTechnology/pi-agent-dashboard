import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, sendPrompt } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 — a dashboard restart while a tool call is RUNNING must not fabricate a
 * "parent session ended" error for it.
 *
 * After `POST /api/restart` the event store is empty, so the live bridge
 * reconnects and replays its own transcript. The in-flight call has no
 * `toolResult` yet. Before this change the replay's orphan-close emitted
 * `tool_execution_end{isError, "parent session ended", healedBy:"session_ended"}`
 * for it, and the card read as failed while the process kept running it. The
 * bridge now leaves the live tail open, so the card stays running and finalizes
 * on the REAL end when the process finishes the call.
 *
 * Substrate: `faux:session-death-open-tool` (one `sleep 120` bash call), the
 * same long-running call `session-ended-orphan-heal.spec.ts` kills. Here the
 * process is left alive, and only the dashboard restarts.
 *
 * Exemplar: `tests/e2e/session-ended-orphan-heal.spec.ts` (spawn, open the long
 * tool call, restart). Port from `.pi-test-harness.json` via `lifecycle.ts`.
 *
 * See change: fix-replay-fabricates-orphan-end-for-live-calls (test-plan #F8).
 */

const HEAL_TEXT = "parent session ended";

async function sessionIds(page: import("@playwright/test").Page): Promise<string[]> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as Array<{ id: string }>).map((s) => s.id);
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/** Every `session_ended` heal frame the browser receives for `sessionId`. */
function collectHeals(page: import("@playwright/test").Page, sessionId: () => string): string[] {
  const out: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("session_ended")) return;
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.sessionId !== sessionId()) return;
        const events: any[] = parsed?.event
          ? [parsed.event]
          : Array.isArray(parsed?.events)
            ? parsed.events.map((e: any) => e?.event).filter(Boolean)
            : [];
        for (const ev of events) if (ev?.data?.healedBy === "session_ended") out.push(String(ev.eventType));
      } catch {
        // not JSON
      }
    });
  });
  return out;
}

test.describe("live replay leaves a running tool call open (L3)", () => {
  test("#F8 a dashboard restart mid-call keeps the card running, then completes it", async ({ page }) => {
    test.setTimeout(360_000);

    let sessionId = "";
    const heals = collectHeals(page, () => sessionId);

    await gotoDashboard(page);
    const before = new Set(await sessionIds(page));
    const spawned = await page.request.post("/api/session/spawn", { data: { cwd: FIXTURE_GIT } });
    expect(spawned.ok(), "spawn into the git fixture").toBe(true);
    await expect
      .poll(
        async () => {
          sessionId = (await sessionIds(page)).find((id) => !before.has(id)) ?? "";
          return sessionId !== "";
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await page.goto(`/session/${sessionId}`);
    await page.keyboard.press("Escape").catch(() => {});

    await sendPrompt(page, "[[faux:session-death-open-tool]] go");
    await expect(page.getByTestId("tool-burst-group").first()).toHaveAttribute("data-running", "true", {
      timeout: 60_000,
    });

    // Restart the dashboard while `sleep 120` is still running in the live pi.
    await restartDashboard();
    await page.goto(`/session/${sessionId}`);
    await page.keyboard.press("Escape").catch(() => {});

    // The replayed card is RUNNING, not a fabricated failure.
    const burst = page.getByTestId("tool-burst-group").first();
    await expect(burst).toBeVisible({ timeout: 60_000 });
    await expect(burst).toHaveAttribute("data-running", "true", { timeout: 30_000 });
    await expect(page.getByText(/1 failed/i)).toHaveCount(0);
    await expect(page.getByText(new RegExp(HEAL_TEXT, "i"))).toHaveCount(0);
    expect(heals, "no session_ended heal may reach the browser for a live call").toEqual([]);

    // The process finishes the call: the REAL end finalizes the card.
    await expect(page.getByText("open tool scenario complete").first()).toBeVisible({ timeout: 180_000 });
    await expect(burst).toHaveAttribute("data-running", "false", { timeout: 30_000 });
    await expect(page.getByText(/1 failed/i)).toHaveCount(0);
    expect(heals).toEqual([]);
  });
});
