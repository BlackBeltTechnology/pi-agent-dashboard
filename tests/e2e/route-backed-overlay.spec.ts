import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E — route-backed overlays (change: add-route-backed-overlay-dialogs).
 *
 * These assert the ONE-URL-ONE-SURFACE rule that design D5 rests on, and they
 * need a real browser: nothing unit-tests `App`, so the container wiring in
 * App.tsx has no jsdom coverage at all. The pure resolution underneath (which
 * route dismisses to where) is unit-tested in overlay-background.test.ts.
 *
 *   S-12 — at `/tunnel-setup` exactly one overlay is mounted; settings is NOT
 *          mounted simultaneously. This is the whole of "replaces, not stacks":
 *          `/tunnel-setup` is its own URL, so `settingsMatch` is false there.
 *   S-13 — dismissing leaves the surface and changes the URL.
 *
 * S-13 is covered here in its COLD-LOAD form only. The plan states it as
 * "opened /tunnel-setup from /settings/gateway", but no in-app affordance
 * navigates to /tunnel-setup anywhere in the repo today — it is reachable by URL
 * alone. Driving it via a synthetic history push would assert the test's own
 * setup rather than a user path. The launcher-based return to /settings/gateway
 * is pinned instead at the unit level (resolveDismissTarget, D1d).
 */

test.describe("route-backed overlays", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("S-12: /tunnel-setup mounts exactly one overlay and settings is not mounted", async ({
    page,
  }) => {
    await page.goto("/tunnel-setup");

    const tunnel = page.getByTestId("tunnel-setup-overlay");
    await expect(tunnel).toBeVisible({ timeout: 15_000 });

    // The stacking claim, stated as a count rather than a look: settings is a
    // sibling branch on the same tree, so if the two could ever coexist this is
    // where it would show.
    await expect(page.getByTestId("settings-overlay")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("S-13 (cold load): dismissing /tunnel-setup leaves the surface", async ({ page }) => {
    await page.goto("/tunnel-setup");
    await expect(page.getByTestId("tunnel-setup-overlay")).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Escape");

    // Assert the URL FIRST. `toHaveCount(0)` is not a sound primary signal here:
    // the overlay is also gated on `firstLaunchModal`, so it can reach count 0
    // WITHOUT any dismissal having happened, and this test duly flaked green-to-
    // red on exactly that. A changed URL is the one observable only a real
    // dismissal produces.
    //
    // Dismissal must not be a no-op — the cold-load target is resolved from the
    // RouteDescriptor table, which is why group 2's depth work is load-bearing
    // on this path too.
    await expect(page).not.toHaveURL(/\/tunnel-setup$/);
    await expect(page.getByTestId("tunnel-setup-overlay")).toHaveCount(0);
  });

  test("5.5a/S-10: an in-overlay navigation switches in place and keeps the frozen background", async ({
    page,
  }) => {
    await page.goto("/settings/general");
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible({ timeout: 20_000 });

    // Stamp the live DOM nodes with an expando React does not manage. It rides
    // along through any number of re-renders and vanishes on REMOUNT, which is
    // the only thing that distinguishes "switched in place" from "tore down and
    // rebuilt" once the URL has changed either way. Asserting on visibility
    // instead would pass in both cases and prove nothing.
    const stamp = (testId: string) =>
      page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (!el) throw new Error(`stamp target ${id} not found`);
        (el as HTMLElement).dataset.remountProbe = "original";
      }, testId);
    const probe = (testId: string) =>
      page.evaluate(
        (id) =>
          (document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null)?.dataset
            .remountProbe ?? null,
        testId,
      );

    await stamp("settings-overlay");
    await stamp("settings-overlay-underlay");

    // A real in-panel navigation to a sibling settings page: same overlay, and
    // the container's own route pattern still matches, so D1c says switch in
    // place rather than dismiss.
    await page
      .getByTestId("settings-nav-rail")
      .getByRole("button", { name: "Security", exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\/security/);

    expect(await probe("settings-overlay"), "container was NOT remounted").toBe("original");
    // The frozen background must survive too: re-freezing it against a path that
    // is itself inside the overlay is the specific corruption D1c prevents, and
    // it would take the underlay's scroll position with it.
    expect(await probe("settings-overlay-underlay"), "underlay was NOT remounted").toBe("original");

    // Still exactly one surface -- an in-place switch must not leave a second
    // container behind.
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("the underlay is inert, so nothing behind the overlay can be clicked", async ({ page }) => {
    // This is WHY 'navigate to a non-owned route' has no in-app path from inside
    // an overlay: the whole shell behind it is removed from pointer and focus
    // order. The non-owned branch is therefore exercised by dismissal (S-13) and
    // by route matching (S-12b), not by a click.
    await page.goto("/settings/general");
    const underlay = page.getByTestId("settings-overlay-underlay");
    await expect(underlay).toHaveAttribute("aria-hidden", "true");
    await expect(underlay).toHaveAttribute("inert", /.*/);
  });

  test("S-12b: /settings mounts exactly one overlay and tunnel setup is not mounted", async ({
    page,
  }) => {
    // The mirror of S-12. Without it, S-12 would still pass if the tunnel branch
    // simply never rendered settings under any circumstances.
    await page.goto("/settings/gateway");

    await expect(page.getByTestId("settings-overlay")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tunnel-setup-overlay")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  // 6.5 — the dirty guard is OPT-IN, so a clean surface must not gain a prompt.
  // Deliberately lives here rather than in a plugin-settings spec: those install
  // `page.route` stubs, and a test that asserts navigation AWAY tears the
  // in-flight handler down mid-fetch ("Response has been disposed").
  test("6.5: dismissing a CLEAN settings overlay leaves immediately, with no prompt", async ({
    page,
  }) => {
    await page.goto("/settings/general");
    await expect(page.getByTestId("settings-overlay")).toBeVisible();

    await page.keyboard.press("Escape");

    // URL first: the overlay is also gated on the first-launch modal, so a
    // count of 0 is reachable without any dismissal having happened.
    await expect(page).not.toHaveURL(/\/settings/);
    await expect(page.getByTestId("unsaved-changes-dialog")).toHaveCount(0);
  });

  // The CORE promise of option C (design D1): the launching surface stays
  // visible beneath the scrim. Nothing tested it, and an audit found it broken
  // — the folder-home renderer was gated on a LIVE-URL-derived cwd, which is
  // null once the overlay owns the URL, so the underlay fell through to the
  // onboarding LandingPage.
  //
  // Must be driven by a REAL in-app affordance: page.goto() is a hard load that
  // wipes the module-level capture and exercises the cold-load synthesis path
  // instead (D4), where a LandingPage underlay is correct.
  test("D1: the underlay shows the LAUNCHING surface, not the landing page", async ({ page }) => {
    const cwd = Buffer.from(FIXTURE_GIT).toString("base64url");
    await gotoDashboard(page);
    await page.goto(`/folder/${cwd}`);
    await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("directory-home-open-settings").click();

    const underlay = page.getByTestId("folder-settings-overlay-underlay");
    await expect(underlay).toBeVisible();
    // The folder the user launched from is still behind the scrim...
    await expect(underlay.getByTestId("directory-home")).toBeVisible();
    // ...and NOT the onboarding fallback.
    await expect(underlay).not.toContainText("Welcome to pi-dashboard");
  });

  // S-32 — a deep link to a file that does not exist must render the surface's
  // own error state. A dialog makes this sharper than a page did: an empty
  // dialog is a dead-end modal with no content to explain itself.
  test("S-32: a missing preview target renders an error state, not a blank dialog", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const cwd = Buffer.from(FIXTURE_GIT).toString("base64url");
    await gotoDashboard(page);
    await page.goto(`/folder/${cwd}/view?path=definitely/not/here.md`);

    const overlay = page.getByTestId("preview-route-overlay");
    await expect(overlay).toBeVisible({ timeout: 20_000 });

    // The dialog has CONTENT: it names the target and states that it cannot be
    // resolved, rather than rendering an empty shell. Deliberately a vocabulary
    // match, not the exact copy — this pins "explains itself", not wording.
    await expect(overlay).not.toHaveText(/^\s*$/);
    await expect(overlay).toContainText("definitely/not/here.md");
    await expect(overlay).toContainText(/unknown|not found|no such file|failed|error|unable/i);

    // And the failure did not escape as an unhandled rejection.
    expect(errors).toEqual([]);
  });

  // Task 4.7 / design D2 — the plugin canary. Six bundled `shell-overlay-route`
  // claims (automation x2, goals x2, kb, subagent popout) all default to
  // `presentation: "dialog"`, and D2's whole claim is that ONE change at the
  // slot converts every one of them.
  //
  // This exists because the seam shipped in group 4 was never injected: its
  // unit tests passed a container explicitly, so they were green while
  // production still rendered every plugin claim as a full page. Only an e2e
  // that looks at the real container catches that class of gap.
  test("4.7/D2: a plugin claim route renders in the overlay, not as a full page", async ({
    page,
  }) => {
    const cwd = Buffer.from(FIXTURE_GIT).toString("base64url");
    await gotoDashboard(page);
    await page.goto(`/folder/${cwd}/kb`);

    const overlay = page.getByTestId("plugin-overlay");
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    // The claim's own content is inside the overlay...
    await expect(overlay).toContainText(/knowledge base/i);
    // ...over a pinned, inert underlay...
    await expect(page.getByTestId("plugin-overlay-underlay")).toHaveAttribute("inert", "");
    // ...and the URL is untouched (D1: containers change, URLs do not).
    await expect(page).toHaveURL(new RegExp(`/folder/${cwd}/kb$`));
  });
});
