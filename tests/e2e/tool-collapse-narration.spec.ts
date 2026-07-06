import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — composition flip + narration fold-in.
//
// change: collapse-tool-calls-across-narration
//
// Two browser-level assertions of the flipped semantic-INNER-first composition:
//
//  1. A NARRATED poll loop (`echo checking` × 4, each preceded by a line of
//     narration prose) folds into ONE ×4 CollapsedToolGroup. The absorbed
//     narration is hidden while collapsed and revealed — interleaved with the
//     tool calls — when the pill is expanded. The trailing "poll complete"
//     reply stays visible at the top level.
//
//  2. A heterogeneous investigation split by a mid-turn reply renders as two
//     separate burst groups with the reply visible at the top level between
//     them (non-empty assistant prose is a HARD boundary for burst formation).
//
// Scenarios: qa/fixtures/faux-scenarios.ts → "poll-narrated", "burst-split-by-reply".
test.describe("faux round-trip — collapse across narration", () => {
  // Guard the post-boot server-stabilization race: the managed harness starts
  // specs the instant /api/health first returns 200, before the server finishes
  // hydrating (model registry / plugins / a boot event-loop spike). During that
  // window the WS can briefly drop and the client shows "Server offline", which
  // makes a fresh spawnFreshGitSession mis-detect an empty container. Wait for a
  // STABLE healthy server (3 consecutive OKs) before each test.
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

  test("narrated poll loop folds into one ×N pill; expand reveals narration", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:poll-narrated]] go");

    // Turn terminates with the trailing reply, which is NOT absorbed and
    // renders at the top level.
    await expect(page.getByText("poll complete").first()).toBeVisible({ timeout: 30_000 });

    // The four identical calls collapsed into a single ×4 pill.
    const group = page.getByTestId("collapsed-group");
    await expect(group).toBeVisible();
    await expect(group).toContainText("×4");

    // Collapsed: the absorbed narration is hidden.
    await expect(page.getByTestId("collapsed-group-narration")).toHaveCount(0);

    // Expand → the absorbed narration is revealed interleaved with the calls.
    await group.click();
    await expect(page.getByTestId("collapsed-group-narration").first()).toContainText(
      "still starting",
    );
  });

  test("heterogeneous run split by a mid-turn reply forms two bursts", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:burst-split-by-reply]] go");

    await expect(page.getByText("split complete").first()).toBeVisible({ timeout: 30_000 });

    // Two separate burst groups formed, split at the reply.
    await expect(page.getByTestId("tool-burst-group")).toHaveCount(2);

    // The mid-turn reply renders at the top level (not buried in a burst body).
    await expect(page.getByText("found the cause").first()).toBeVisible();
  });
});
