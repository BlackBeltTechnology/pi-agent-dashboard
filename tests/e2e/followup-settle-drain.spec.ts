import { expect, test } from "./fixtures.js";
import { byTestId, expandQueueLane, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E for change: update-pi-core-1-3-adopt-apis (design D4).
 *
 * The bridge-owned follow-up buffer now drains on `agent_settled` instead of
 * `agent_end` + an idle-retry loop. Drives the real `POST /api/session/:id/prompt
 * → bridge buffer → queue_update → settle → drain → fresh turn → transcript`
 * chain against the docker harness. Only the LLM is faux.
 *
 * Covers test-plan rows F1 (delivered after settle) and F2 (drained ordering).
 * Exemplar: followup-image-queue.spec.ts (same harness, same helpers).
 */

const SLOW_STREAM = "[[faux:slow-stream]] go";
const FOLLOW_UP = "follow-1";

async function selectedSessionId(page: import("@playwright/test").Page): Promise<string> {
  const id = await page.evaluate(() => /\/session\/([^/?#]+)/.exec(window.location.pathname)?.[1]);
  expect(id, "a session must be selected before posting to it").toBeTruthy();
  return id as string;
}

/** POST a prompt, then open the dock's Queue lane (the chips live in its body). */
async function postFollowUp(page: import("@playwright/test").Page, sessionId: string, text: string): Promise<number> {
  const status = await page.evaluate(
    async ([id, body]) => {
      const r = await fetch(`/api/session/${id}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.status;
    },
    [sessionId, { text }] as const,
  );
  await expandQueueLane(page);
  return status;
}

/** Spawn a session, select it and drive it into a streaming turn. */
async function streamingSession(page: import("@playwright/test").Page): Promise<string> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, SLOW_STREAM);
  await expect(page.getByText("slow-chunk-0").first()).toBeVisible({ timeout: 30_000 });
  return selectedSessionId(page);
}

test.describe("follow-up drain on agent_settled", () => {
  test("F1: a follow-up queued mid-stream shows as a chip, clears, and is delivered once after the settle", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const sessionId = await streamingSession(page);

    expect(await postFollowUp(page, sessionId, FOLLOW_UP)).toBeLessThan(400);

    const chip = byTestId(page, "queueChipFollowup").first();
    await expect(chip).toContainText(FOLLOW_UP, { timeout: 15_000 });

    // The run settles, the buffer drains as a fresh turn, and the chip clears.
    await expect(byTestId(page, "queuePanel")).toHaveCount(0, { timeout: 120_000 });

    // Exactly one `follow-1` user bubble in the transcript (the queue panel is gone).
    await expect(page.getByText(FOLLOW_UP, { exact: true })).toHaveCount(1, { timeout: 60_000 });
  });

  test("F2: the drained follow-up bubble renders BELOW the assistant's final message", async ({ page }) => {
    test.setTimeout(240_000);
    const sessionId = await streamingSession(page);

    expect(await postFollowUp(page, sessionId, FOLLOW_UP)).toBeLessThan(400);
    await expect(byTestId(page, "queuePanel")).toHaveCount(0, { timeout: 120_000 });
    const bubble = page.getByText(FOLLOW_UP, { exact: true }).first();
    await expect(bubble).toBeVisible({ timeout: 60_000 });

    // DOM order, not pixels: the assistant's streamed text precedes the bubble.
    const assistantFirst = await page.evaluate(
      ([assistantText, followText]) => {
        const walk = (needle: string): Element | null => {
          const all = Array.from(document.querySelectorAll("*")).filter(
            (el) => el.children.length === 0 && el.textContent?.includes(needle),
          );
          return all[0] ?? null;
        };
        const a = walk(assistantText);
        const u = Array.from(document.querySelectorAll("*")).find(
          (el) => el.children.length === 0 && el.textContent?.trim() === followText,
        );
        if (!a || !u) return null;
        return Boolean(a.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING);
      },
      ["slow-chunk-0", FOLLOW_UP] as const,
    );
    expect(assistantFirst, "assistant text and follow-up bubble must both be in the DOM").not.toBeNull();
    expect(assistantFirst).toBe(true);
  });
});
