import { expect, test } from "@playwright/test";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Faux round-trip — universal tool-call grouping + turn-scoped reasoning fold.
//
// change: enhance-tool-call-grouping
//
// Three browser-level assertions of the enhanced grouping:
//
//  1. UNIVERSAL grouping (threshold → 1): a SINGLE tool call forms a framed
//     group that renders its own one-line summary in the collapsed header —
//     NOT the literal "1 tool calls", and NOT a bare top-level tool row.
//  2. A multi-member run renders the "N tool calls" header with a per-kind
//     breakdown.
//  3. TURN-SCOPED reasoning fold: a TRAILING `thinking` after the last tool is
//     absorbed INTO the group and renders as a real ThinkingBlock (labeled
//     "Reasoning") inside the body — NOT the demoted narration <div>. (Leading
//     absorption is covered by the group-tool-bursts unit + component tests;
//     the faux replay is unreliable for a thinking+tool-call in one message.)
//
// Scenarios: qa/fixtures/faux-scenarios.ts → "grp-single", "burst-heterogeneous",
// "grp-reasoning".
test.describe("faux round-trip — enhanced tool-call grouping", () => {
  // Guard the post-boot server-stabilization race (see tool-collapse-narration
  // spec): wait for a STABLE healthy server (3 consecutive OKs) before each test.
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

  test("a single tool call forms a framed group with its own summary", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:grp-single]] go");

    // Turn terminates with the trailing reply.
    await expect(page.getByText("single done").first()).toBeVisible({ timeout: 30_000 });

    // The lone tool call is wrapped in the unified group frame (not a bare row).
    const group = page.getByTestId("tool-burst-group");
    await expect(group).toHaveCount(1);

    // Collapsed header shows the tool's OWN summary, never the literal count text.
    const summary = page.getByTestId("tool-burst-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("echo single-call");
    await expect(page.getByTestId("tool-burst-header")).not.toContainText("1 tool calls");
  });

  test("a multi-member run shows the 'N tool calls' header + breakdown", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:burst-heterogeneous]] go");

    await expect(page.getByText("burst complete").first()).toBeVisible({ timeout: 30_000 });

    const header = page.getByTestId("tool-burst-header").first();
    await expect(header).toContainText("3 tool calls");
    await expect(page.getByTestId("tool-burst-breakdown").first()).toBeVisible();
  });

  test("trailing reasoning folds inside the group as a ThinkingBlock", async ({ page }) => {
    // Enable reasoning globally so absorbed `thinking` renders (default off).
    // Send a COMPLETE prefs object (not a sparse `{reasoning:true}`): when the
    // container has never seeded displayPrefs, the server's setDisplayPrefs base
    // default is all-false — a sparse patch would silently hide every tool call
    // (toolCalls.* → false) and no group would render. Keep tools visible.
    const res = await page.request.patch("/api/preferences/display", {
      data: {
        reasoning: true,
        toolResults: true,
        toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true },
      },
    });
    expect(res.ok()).toBeTruthy();

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:grp-reasoning]] go");

    await expect(page.getByText("reasoning burst complete").first()).toBeVisible({ timeout: 30_000 });

    const group = page.getByTestId("tool-burst-group").first();
    await expect(group).toBeVisible();
    await expect(group).toContainText("3 tool calls");

    // Expand the group body, then assert the absorbed TRAILING reasoning renders
    // through the real ThinkingBlock (data-testid="reasoning-block", labeled
    // "Reasoning") INSIDE the group body — not as demoted narration text.
    await page.getByTestId("tool-burst-header").first().click();
    const body = page.getByTestId("tool-burst-body").first();
    const reasoning = body.getByTestId("reasoning-block").first();
    await expect(reasoning).toBeVisible({ timeout: 10_000 });
    // Rendered through the real ThinkingBlock (labeled "Reasoning", collapsible)
    // — NOT the demoted narration <div>. The block's open/closed state is
    // live/timer-dependent, so we assert the affordance, not the inner text.
    await expect(reasoning).toContainText(/Reasoning/i);
    await expect(reasoning.getByRole("button").first()).toBeVisible();
    // The flat narration path is NOT used for absorbed reasoning.
    await expect(body.getByTestId("tool-burst-narration")).toHaveCount(0);
  });
});
