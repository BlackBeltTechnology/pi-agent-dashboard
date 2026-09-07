/**
 * L3 browser behaviour — F9: non-users see no new session-card chrome
 * (change: add-blackhole-session-pipeline, task 7.0).
 *
 * `pi-blackhole` is deliberately NOT installed in the harness (same posture as
 * blackhole-settings.spec.ts — no third-party registry dependency in CI). The
 * dashboard must therefore show ZERO MEMORY subcards: the plugin's client boot
 * gate resolves `/api/plugins/blackhole/status` (registry negative, D1), the
 * claim's `shouldRender` fails closed, and `useSlotHasClaimsForSession` counts
 * the claim absent — on every card, including idle/ended sessions.
 *
 * The status-route probe first makes the negative MEANINGFUL: it proves the
 * gate's data source answered (a resolved `installed: false`), so the
 * zero-subcard assertion below reflects the gate failing closed — not an
 * unresolved gate that merely hasn't flipped yet.
 *
 * Port/baseURL come from the harness config (playwright.config.ts reads
 * `.pi-test-harness.json`); this spec never hardcodes a port.
 */
import { expect, test } from "./fixtures.js";
import { ensureGitSession, gotoDashboard } from "./helpers/index.js";

test.describe("blackhole session pipeline — absent extension (F9)", () => {
  test("no MEMORY subcard on any session card when pi-blackhole is not installed", async ({
    page,
    request,
  }) => {
    // The gate's truth source answers a resolved negative in this harness.
    const status = await request.get("/api/plugins/blackhole/status");
    expect(status.ok()).toBeTruthy();
    expect(await status.json()).toEqual({ installed: false });

    await gotoDashboard(page);

    // A fresh page load briefly renders the onboarding (empty) view before the
    // WS snapshot lands and flips the sidebar to dashboard mode — settle the
    // flip first (same pattern as openspec-init-affordances pinAndExpand),
    // then get a real session card (the harness's seeded-session idiom) so
    // the negative below is not vacuous.
    const affordance = page
      .getByTestId("dashboard-add-folder-btn")
      .first()
      .or(page.getByTestId("onboarding-step-2-cta"));
    await expect(affordance.first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    const card = await ensureGitSession(page);
    await expect(card).toBeVisible();

    // The plugin claim's own DOM: absent everywhere.
    await expect(page.locator('[data-testid="bh-memory-subcard"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bh-memory-workers"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bh-memory-no-activity"]')).toHaveCount(0);

    // The host MEMORY subcard wrapper (title span, i18n fallback "MEMORY"):
    // never painted on the card.
    await expect(card.getByText("MEMORY", { exact: true })).toHaveCount(0);
  });
});
