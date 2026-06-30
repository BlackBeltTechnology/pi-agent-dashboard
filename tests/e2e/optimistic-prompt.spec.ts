import { test, expect } from "@playwright/test";
import { spawnFreshGitSession, sendPrompt, byTestId } from "./helpers/index.js";

/**
 * Browser E2E for change: optimistic-prompt-progress.
 *
 * Drives the real `prompt → bridge → server → events → DOM` round-trip via the
 * faux model (no LLM key). Only the LLM is faux; the bridge `prompt_received`
 * ack, protocol, reducer, and rendering are all real — exactly the chain this
 * change touches.
 *
 * Two user-observable invariants are asserted (the sub-second
 * sending→sent→confirmed micro-transitions are covered deterministically by the
 * unit/render tests — `event-reducer.test.ts`, `ChatView.test.tsx`):
 *
 *   1. IDLE send  → optimistic bubble appears instantly, then confirms with no
 *                   leftover card (the gap this change removes).
 *   2. MID-TURN   → no optimistic bubble; the authoritative follow-up queue chip
 *                   renders instead (idle-scoping; governed by
 *                   `mid-turn-prompt-queue`).
 *
 * Faux marker source of truth: qa/fixtures/faux-scenarios.ts.
 * Requires PI_E2E_SEED=1 (managed mode sets it automatically).
 */

// Assistant reply streamed by the `plain-text` scenario (asserted to prove the
// real round-trip confirmed the optimistic bubble). Distinct from the prompt
// text so the two never collide.
const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

/**
 * Delay every server→client WebSocket frame so the sub-second optimistic window
 * (sending → sent → confirmed) is comfortably observable. The optimistic bubble
 * is written client-side instantly on send; it clears when the server's user
 * `message_start` echo arrives — holding that echo back widens the window. This
 * mirrors the exact condition the feature targets: a slow link where the echo
 * lags. (CDP `emulateNetworkConditions` does NOT throttle an already-open WS,
 * so we intercept the socket itself via Playwright's WebSocket routing.)
 *
 * Must be installed BEFORE the page opens its socket — call it before any
 * navigation. HTTP `/api/health` is unaffected (separate from the WS).
 */
async function delayServerToClientWs(page: import("@playwright/test").Page, ms: number): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: immediate
    server.onMessage(async (m) => {
      await new Promise((r) => setTimeout(r, ms)); // server→client: delayed
      ws.send(m);
    });
  });
}

test.describe("optimistic prompt — idle send", () => {
  test("idle send shows an optimistic bubble, then confirms with no leftover card", async ({ page }) => {
    // Widen the optimistic window before the dashboard opens its socket.
    await delayServerToClientWs(page, 700);

    const card = await spawnFreshGitSession(page);
    await card.click();

    // Unique prompt text so the optimistic bubble is unambiguous (the assistant
    // reply is PLAIN_TEXT_MARKER, never this).
    await sendPrompt(page, "[[faux:plain-text]] optimistic-idle-probe");

    const optimistic = byTestId(page, "pendingPromptCard");
    // Appears immediately on an idle send — before any server echo. This is the
    // feedback the change restores (previously a multi-second blank gap).
    await expect(optimistic).toBeVisible();
    await expect(optimistic).toContainText("optimistic-idle-probe");
    // The card carries a valid progress status keyed off pendingPrompt.status.
    await expect(optimistic).toHaveAttribute("data-status", /^(sending|sent)$/);

    // Confirmed: the real assistant reply renders and the optimistic card is
    // replaced by the server-sourced user card (zero leftover).
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
    await expect(optimistic).toHaveCount(0);
  });
});

test.describe("optimistic prompt — mid-turn suppression", () => {
  test("a send during a streaming turn shows a queue chip, not an optimistic bubble", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // Kick off a long-running turn. `slow-stream` streams 40 scripted chunks, so
    // the session stays in `streaming` for a multi-second window — long enough to
    // land a second send mid-turn.
    await sendPrompt(page, "[[faux:slow-stream]] go");
    // Streaming has begun once the first scripted chunk renders.
    await expect(page.getByText("slow-chunk-0").first()).toBeVisible({ timeout: 30_000 });

    // Send a second prompt WHILE the agent is still streaming. The composer
    // stays enabled mid-turn (input is only disabled for an idle pendingPrompt).
    // Use Alt+Enter to force `followUp` delivery (plain Enter / the send button
    // default to `steer`, which drains fast and renders a steer ghost bubble);
    // followUp is buffered until agent_end, so its queue chip is stable to assert.
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.fill("queued-followup-probe");
    await composer.press("Alt+Enter");

    // Mid-turn sends never write pendingPrompt (idle-scoped) → no optimistic card.
    await expect(byTestId(page, "pendingPromptCard")).toHaveCount(0);
    // The authoritative follow-up queue chip renders instead.
    await expect(byTestId(page, "queueChipFollowup").first()).toBeVisible({ timeout: 15_000 });
  });
});
