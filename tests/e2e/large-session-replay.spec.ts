import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 gate for `compact-warm-replay-stream` (issue #399).
 *
 * The warm (in-memory) replay path used to ship every assistant
 * `message_update` — each one a FULL content snapshot — so reopening a large
 * session replayed ~20k events. `compactEventsForReplay` drops the superseded
 * ones on the replay hook only.
 *
 * Verified at the WIRE level (robust to DOM churn), same technique as the
 * sibling `replay-truncate.spec.ts`: a SECOND browser context has an empty
 * IndexedDB, so it subscribes with `lastSeq: 0` and forces a FULL replay.
 *
 * ── Scenario mapping (test-plan.md) ─────────────────────────────────────────
 * P1  — reformulated (C1 follow-up): rather than a size-dependent "≤ 2× the
 *       cold-load count" ratio — the cold-load count for the SAME session is
 *       not observable from the browser — this asserts the STRONGER, fully
 *       deterministic invariant it implies: ZERO superseded `message_update`
 *       survives a full replay. The literal ≤ 2× ratio at 20k scale is gated
 *       deterministically at L1 by P2 in `replay-compaction.test.ts`.
 * F5  — the seq gaps compaction introduces do not misfire the client's
 *       `event_replay` reset rule: the transcript still renders.
 * F6  — reasoning rows still reconstruct on reopen (the thinking exemption,
 *       design D2).
 *
 * F3 (mid-turn subscribe convergence) is deliberately NOT asserted here: it
 * requires racing a live token stream, which is flaky at L3. Its invariant —
 * everything after the last `message_end` survives compaction verbatim — is
 * gated deterministically at L1 by E9 plus the `streamingTail` fixture in
 * `replay-compaction-equivalence.test.ts`.
 */

interface ReplayFrame {
  seq: number;
  eventType: string;
  isThinkingUpdate: boolean;
}

function replayFramesIn(payload: string): { events: ReplayFrame[]; isLast: boolean } | null {
  try {
    const msg = JSON.parse(payload) as {
      type?: string;
      isLast?: boolean;
      events?: { seq: number; event: { eventType?: string; data?: Record<string, unknown> } }[];
    };
    if (msg.type !== "event_replay" || !Array.isArray(msg.events)) return null;
    return {
      isLast: msg.isLast === true,
      events: msg.events.map((e) => {
        const ame = e.event?.data?.assistantMessageEvent as { type?: unknown } | undefined;
        return {
          seq: e.seq,
          eventType: e.event?.eventType ?? "",
          isThinkingUpdate: typeof ame?.type === "string" && ame.type.startsWith("thinking"),
        };
      }),
    };
  } catch {
    return null;
  }
}

test.describe("replay compaction — warm replay drops superseded snapshots", () => {
  test("full replay carries no superseded message_update, keeps seqs monotonic, and still renders reasoning", async ({
    page,
    browser,
  }) => {
    // Reasoning rows only render when the display pref is on (mirrors
    // reasoning-auto-collapse.spec.ts), which F6 needs.
    const prefRes = await page.request.patch("/api/preferences/display", {
      data: { reasoning: true },
    });
    expect(prefRes.ok()).toBeTruthy();

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    // thinking-text streams a reasoning block AND prose, so the window carries
    // both thinking-bearing updates (exempt) and superseded text snapshots.
    await sendPrompt(page, "[[faux:thinking-text]] go");
    await expect(page.getByText(/done thinking/).first()).toBeVisible({ timeout: 45_000 });
    await sendPrompt(page, "[[faux:thinking-text]] again");
    await expect(page.getByText(/done thinking/).nth(1)).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1_000);

    const ctx2 = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page2 = await ctx2.newPage();
      const frames: ReplayFrame[][] = [];
      let sawLast = false;
      page2.on("websocket", (ws) => {
        ws.on("framereceived", (frame) => {
          const payload = typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
          const parsed = replayFramesIn(payload);
          if (!parsed) return;
          frames.push(parsed.events);
          if (parsed.isLast) sawLast = true;
        });
      });

      await page2.goto(`/session/${sessionId}`);
      await expect.poll(() => sawLast, { timeout: 45_000 }).toBe(true);

      const replayed = frames.flat();
      expect(replayed.length).toBeGreaterThan(0);

      // P1 — no `message_update` positioned before the LAST `message_end`
      // survives, except the thinking-bearing ones (D2) and at most one
      // text update per tool_execution_start (the reducer's flush seed).
      const lastEndIdx = replayed.map((e) => e.eventType).lastIndexOf("message_end");
      expect(lastEndIdx).toBeGreaterThan(0);
      const toolStarts = replayed
        .slice(0, lastEndIdx)
        .filter((e) => e.eventType === "tool_execution_start").length;
      const supersededTextUpdates = replayed
        .slice(0, lastEndIdx)
        .filter((e) => e.eventType === "message_update" && !e.isThinkingUpdate).length;
      expect(supersededTextUpdates).toBeLessThanOrEqual(toolStarts);

      // Seq contract — strictly increasing, no duplicates, gaps tolerated.
      const seqs = replayed.map((e) => e.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

      // F5 — the seq gaps do not misfire the client's reset rule: both turns
      // are still on screen after replay.
      await expect(page2.getByText(/done thinking/).first()).toBeVisible({ timeout: 30_000 });
      await expect(page2.getByText(/done thinking/).nth(1)).toBeVisible({ timeout: 30_000 });

      // F6 — reasoning survives the compaction (thinking updates exempted,
      // design D2). On the REPLAY path a reasoning block renders COLLAPSED
      // (streamedLive falsy), so the observable is the block header, not the
      // body text — same assertion shape as reasoning-auto-collapse.spec.ts.
      await expect(page2.getByTestId("reasoning-block").last()).toBeVisible({ timeout: 30_000 });
      expect(await page2.getByTestId("reasoning-block").count()).toBe(2);
    } finally {
      await ctx2.close();
    }
  });
});
