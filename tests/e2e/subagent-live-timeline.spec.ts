/**
 * L3: live subagent timeline from the producer's entry/delta streams
 * (pi-dashboard-subagents ≥ 0.4.0, declared by the subagents-plugin bridge).
 * Folded from test-plan.md F1–F4, P2. Exemplar: subagent-inspector.spec.ts.
 *
 * `[[faux:subagent-reasoning]]` runs ~10 s: three 500-char thinking blocks,
 * each followed by a `sleep 3` tool call, so the inspector is observable WHILE
 * the subagent runs. Port comes from `baseURL` (never a hardcoded :18000).
 * See change: add-plugin-bridge-contributions.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const RUNNING_CARD = '[data-testid="agent-activity-row"]';

/** Start the faux reasoning subagent and open its inline inspector while it runs. */
async function startAndOpenInspector(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.keyboard.press("Escape").catch(() => {});
  await sendPrompt(page, "[[faux:subagent-reasoning]] go");
  await expect(page.locator(RUNNING_CARD).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Details$/ }).last().click();
}

test.describe("subagent live timeline (entry/delta streams)", () => {
  // F1: steps reach the open inspector during the run, not only at the end.
  test("tool steps are visible in the inspector while the subagent runs", async ({ page }) => {
    await startAndOpenInspector(page);
    // First sleeping tool call finished → its step must render while running.
    await expect(page.getByText(/sleep 3 && echo r-one/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(RUNNING_CARD).first()).toBeVisible();
    await expect(page.getByText(/reasoning subagent complete/i).first()).toBeVisible({ timeout: 60_000 });
  });

  // F2: the in-progress block grows from its start instead of rolling a
  // 280-char window. Sampled every 250 ms while the live entry is shown.
  test("the in-progress reasoning block grows beyond the tail length", async ({ page }) => {
    await startAndOpenInspector(page);
    const live = page.getByTestId("minimal-live-entry").first();
    await expect(live).toBeVisible({ timeout: 20_000 });
    const samples: string[] = [];
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const text = (await live.textContent().catch(() => null)) ?? "";
      if (text) samples.push(text);
      await page.waitForTimeout(250);
    }
    const longest = samples.reduce((a, b) => (b.length > a.length ? b : a), "");
    expect(longest.length).toBeGreaterThan(280);
    // Starts at the block start, not mid-word inside a rolling window.
    expect(longest).toMatch(/weighing the (first|second|third) probe/);
    expect(longest.indexOf("weighing")).toBeLessThan(40);
  });

  // F3: a reload mid-run rebuilds the steps from the stored step events.
  test("a page reload mid-run restores the streamed steps", async ({ page }) => {
    await startAndOpenInspector(page);
    await expect(page.getByText(/sleep 3 && echo r-one/).first()).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("button", { name: /^Details$/ }).last()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Details$/ }).last().click();
    await expect(page.getByText(/sleep 3 && echo r-one/).first()).toBeVisible({ timeout: 20_000 });
  });

  // F4 + P2: no "steps hidden" sentinel anywhere, and the store dropped every
  // finished block's delta pieces (collapse counter moved).
  test("no steps-hidden sentinel and finished deltas are collapsed", async ({ page, baseURL }) => {
    const before = (await (await page.request.get(`${baseURL}/api/health`)).json()) as {
      storeTrim: { collapsedDeltas: number };
      pluginEventForward: { declared: number };
    };
    await startAndOpenInspector(page);
    await expect(page.getByText(/reasoning subagent complete/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/steps hidden/)).toHaveCount(0);
    const after = (await (await page.request.get(`${baseURL}/api/health`)).json()) as typeof before;
    expect(after.pluginEventForward.declared).toBeGreaterThanOrEqual(2);
    expect(after.storeTrim.collapsedDeltas).toBeGreaterThan(before.storeTrim.collapsedDeltas);
  });
});
