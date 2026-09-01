import { CUSTOM_ENTRIES_TAIL, CUSTOM_MESSAGE_HIDDEN, CUSTOM_MESSAGE_VISIBLE } from "../../qa/fixtures/faux-scenarios.js";
import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Custom-entry replay parity (browser E2E, test-plan #F2).
 *
 * The custom rows built from the LIVE event path (bridge `message_end`
 * role=custom + bridge `custom_entry`) and the rows rebuilt by COLD REPLAY
 * (state-replay.ts synthesizing the SAME two events from the session JSONL)
 * must be identical: same rows, same relative order, same truncation form.
 *
 * Triple: seeded session (the `custom-entries` scenario writes real
 * CustomMessageEntry + CustomEntry JSONL entries) · cold reload · row order +
 * truncation match live.
 */
test.setTimeout(150_000);

test.describe("custom entries — replay parity", () => {
  test("#F2 cold reload rebuilds the same custom rows in the same order and form", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();
    await card.click();

    await sendPrompt(page, "[[faux:custom-entries]] go");
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_MESSAGE_VISIBLE }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(CUSTOM_ENTRIES_TAIL).first()).toBeVisible({ timeout: 30_000 });

    /** Snapshot every custom card: label (order proxy) + truncation form. */
    async function snapshot(): Promise<Array<{ label: string; truncated: boolean }>> {
      const cards = page.locator('[data-testid="custom-entry-card"]');
      const count = await cards.count();
      const rows: Array<{ label: string; truncated: boolean }> = [];
      for (let i = 0; i < count; i++) {
        const cardEl = cards.nth(i);
        const label = (await cardEl.locator("span").first().textContent()) ?? "";
        const pre = cardEl.locator("pre");
        const text = (await pre.textContent()) ?? "";
        rows.push({ label: label.trim(), truncated: text.startsWith("«") && text.includes("earlier lines hidden") });
      }
      return rows;
    }

    const live = await snapshot();
    // The scenario produced THREE visible custom rows (hidden message never
    // renders live) and the 300-line entry arrives pre-truncated.
    expect(live.map((r) => r.label)).toEqual(["e2e:state", "e2e:big", "e2e:note"]);
    expect(live.find((r) => r.label === "e2e:big")?.truncated).toBe(true);
    expect(live.find((r) => r.label === "e2e:note")?.truncated).toBe(false);

    // Cold reload — the replay path rebuilds the chat from the JSONL.
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await page
      .locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`)
      .click();
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_MESSAGE_VISIBLE }).first(),
    ).toBeVisible({ timeout: 30_000 });

    const replayed = await snapshot();
    // Same rows, same relative order, same truncation form — byte-for-byte
    // equal snapshots.
    expect(replayed).toEqual(live);
    // And the exclusion contract held on replay too.
    await expect(page.getByText(CUSTOM_MESSAGE_HIDDEN, { exact: false })).toHaveCount(0);
  });
});
