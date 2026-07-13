import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — oversized-event server liveness.
//
// change: bound-subagent-event-serialization
//
// Regression guard for the P0 fix that bounds a single event's total serialized
// size before it reaches the persist (`insertEvent`) and broadcast
// (`broadcastEvent` → `JSON.stringify`) paths. A subagent's full timeline —
// forwarded as one oversized, deeply-nested event — previously OOM-crashed the
// WHOLE dashboard server inside a single `JSON.stringify`, dropping every
// session. The per-event size ceiling collapses an over-cap event's data to a
// bounded placeholder so the ingest/broadcast path can never allocate an
// unbounded string.
//
// This automates the change's open MANUAL task (5.3): "run a subagent-heavy /
// oversized turn against a live server; confirm /api/health stays up." It drives
// the `oversized-turn` faux scenario (a bash call emitting ~90 KB of output)
// through the real pipeline → bridge → server → /ws in the Docker harness, then
// proves the server survived and stayed responsive:
//   1. /api/health returns 200 after the heavy turn (no OOM crash).
//   2. A follow-up normal turn round-trips in the SAME session — a crashed or
//      restarted server would drop the session and the second turn would never
//      land.
//
// The exact truncation mechanics (size walk, depth-limit collapse, placeholder
// shape) are covered by unit tests in packages/server; this spec owns the
// end-to-end liveness proof no unit test can give.

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

test.describe("faux round-trip — oversized-event server liveness", () => {
  // Guard the post-boot server-stabilization race: the managed harness starts
  // specs the instant /api/health first returns 200, before the server finishes
  // hydrating. Wait for a STABLE healthy server (3 consecutive OKs) first.
  test.beforeEach(async ({ page }) => {
    await expect
      .poll(
        async () => {
          let oks = 0;
          for (let n = 0; n < 3; n++) {
            try {
              const r = await page.request.get("/api/health");
              if (!r.ok()) return 0;
              oks++;
            } catch {
              return 0;
            }
            await new Promise((res) => setTimeout(res, 300));
          }
          return oks;
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe(3);
  });

  test("survives an oversized-payload turn and stays responsive", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    // 1. Drive the oversized turn (~90 KB bash output) and wait for it to settle.
    await sendPrompt(page, "[[faux:oversized-turn]] go");
    await expect(page.getByText("oversized-turn complete").first()).toBeVisible({
      timeout: 60_000,
    });

    // 2. The server did NOT OOM-crash on the broadcast path — health is 200.
    const health = await page.request.get("/api/health");
    expect(health.ok()).toBe(true);

    // 3. The server is still alive AND responsive: a follow-up normal turn
    //    round-trips in the same session. A crashed/restarted server would have
    //    dropped this session and this text would never render.
    await sendPrompt(page, "[[faux:plain-text]] follow-up");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({
      timeout: 30_000,
    });

    // Health remains green after the second turn too.
    const healthAfter = await page.request.get("/api/health");
    expect(healthAfter.ok()).toBe(true);
  });
});
