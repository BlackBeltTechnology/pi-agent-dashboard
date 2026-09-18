/**
 * Browser E2E for tasks 4.4–4.7 (design D4) — the mobile viewport bound.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * D4 is a statement about LAID-OUT pixels: exactly one element owns a viewport
 * unit and it also owns `overflow-hidden`, so in-flow banners above the shell
 * take height FROM the bound instead of adding height ON TOP of it. jsdom has
 * no layout engine — `scrollHeight` there is fiction — so the defect this pins
 * (baseline 887 px of document against an 844 px viewport at 390×844 with a
 * 43 px banner) is unreachable below L3.
 *
 * The bound is established by TWO elements together: `App.tsx`'s mobile branch
 * root gains `flex flex-col h-[100dvh] overflow-hidden`, and `MobileShell`'s
 * root drops `w-screen h-[100dvh]` for `w-full flex-1 min-h-0`. Either half
 * reverted reintroduces the overflow, so every assertion here fails if the
 * shell claims a viewport unit again.
 *
 * F12–F14 drive the in-flow banner (the plugin-staleness banner is a
 * deterministic 43 px of in-flow height); F15 mounts each viewport-anchored
 * overlay surface and proves it contributes no height to the bound.
 *
 * See change: fix-long-session-ux-degradation.
 */
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { byTestId, ensureGitSession, gotoDashboard } from "./helpers/index.js";

/** The repro device from the design: 390×844 with a ~43 px banner. */
const MOBILE = { width: 390, height: 844 } as const;
/** Desktop viewport for the spawn helper's onboarding affordances. */
const DESKTOP = { width: 1280, height: 800 } as const;

interface ViewportMetrics {
  docScrollHeight: number;
  bodyScrollHeight: number;
  innerHeight: number;
  scrollY: number;
  docScrollTop: number;
}

function readMetrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => ({
    docScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
    docScrollTop: document.documentElement.scrollTop,
  }));
}

/** The D4 invariant: the document's scrollable height never exceeds the viewport. */
async function expectViewportBound(page: Page): Promise<void> {
  const m = await readMetrics(page);
  expect(m.docScrollHeight, "document scrollHeight <= viewport height").toBeLessThanOrEqual(
    m.innerHeight,
  );
  expect(m.scrollY, "window must not scroll").toBe(0);
}

/** Walk to the nearest `position: fixed` ancestor — how a no-height overlay is anchored. */
function fixedAncestorPosition(locator: Locator): Promise<string> {
  return locator.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    while (node) {
      if (getComputedStyle(node).position === "fixed") return "fixed";
      node = node.parentElement;
    }
    return "none";
  });
}

/**
 * Force the plugin-staleness banner: it renders only when `/api/health`'s
 * `bundleHash` differs from the client's compiled `PLUGIN_REGISTRY_HASH`. The
 * route is a PASSTHROUGH (other consumers still read the real body), with the
 * hash rewritten to a value the build cannot have produced.
 */
async function forceStaleBanner(page: Page): Promise<void> {
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, bundleHash: "e2e-forced-stale-bundle-hash" } });
  });
}

/** Two concurrent runs in the boot rehydration endpoint → the concurrent stack renders. */
async function forceConcurrentInitStack(page: Page): Promise<void> {
  const now = Date.now();
  await page.route("**/api/git/worktree/active-inits", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          runs: [
            { cwd: "/fixtures/sample-git", phase: "running", startedAt: now, lastLine: "installing" },
            { cwd: "/fixtures/sample-hook-ok", phase: "running", startedAt: now, lastLine: "linking" },
          ],
        },
      }),
    }),
  );
}

interface FrameInjector {
  /** Deliver a synthetic server→client frame to the page's shell WebSocket. */
  send(frame: unknown): void;
}

/**
 * Capture the page's shell WebSocket so the test can deliver a server→client
 * frame. `routeWebSocket` must be installed BEFORE navigation; the first socket
 * the app opens is the shell socket (plugin relay sockets open later, only when
 * a live view is requested).
 */
async function installFrameInjector(page: Page): Promise<FrameInjector> {
  let live: { send(data: string): void } | undefined;
  await page.routeWebSocket(/.*/, (ws) => {
    live ??= ws;
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
  });
  return {
    send(frame) {
      if (!live) throw new Error("the page has not opened its shell WebSocket yet");
      live.send(JSON.stringify(frame));
    },
  };
}

/** Open the add-folders dialog through whichever affordance the container exposes. */
async function openAddFoldersDialog(page: Page): Promise<Locator> {
  const dialog = page.getByTestId("add-folders-dialog");
  if (await dialog.isVisible().catch(() => false)) return dialog;

  const onboardingCta = page.getByTestId("onboarding-step-2-cta");
  if (await onboardingCta.isVisible().catch(() => false)) {
    await onboardingCta.click({ timeout: 5_000 }).catch(async () => {
      await page.getByTestId("dashboard-add-folder-btn").first().click();
    });
  } else {
    await page.getByTestId("dashboard-add-folder-btn").first().click();
  }
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

// F12 — the primary repro: a visible 43 px banner must not make the document scroll.
test("F12: a visible in-flow banner bounds the document to the viewport", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await forceStaleBanner(page);
  await gotoDashboard(page);

  const banner = page.getByTestId("plugin-staleness-banner");
  await expect(banner, "the staleness banner must be visible for this repro").toBeVisible({
    timeout: 15_000,
  });

  const m = await readMetrics(page);
  // test-plan #F12: exact equality (baseline defect 887 vs 844).
  expect(m.docScrollHeight, "document scrollHeight === viewport height").toBe(m.innerHeight);
  expect(m.scrollY, "window must not scroll").toBe(0);
});

// F13 — the banner appearing and dismissing only resizes the shell.
test("F13: banner on→off keeps the document non-scrollable in both states", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await forceStaleBanner(page);
  await gotoDashboard(page);

  const banner = page.getByTestId("plugin-staleness-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  // ON — takes its 43 px from the flex bound.
  await expectViewportBound(page);

  await page.getByTestId("plugin-staleness-dismiss").click();
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
  // OFF — the shell grows into the reclaimed height; the document stays bound.
  await expectViewportBound(page);
});

// F14 — navigating into a session and focusing the composer must not scroll the shell.
test("F14: entering a session and focusing the composer does not scroll the shell", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await forceStaleBanner(page);

  // Spawn at DESKTOP: `ensureGitSession` drives the desktop onboarding / folder
  // spawn affordances, which the mobile list panel does not expose. Then enter
  // the mobile layout with the session already selected.
  await page.setViewportSize(DESKTOP);
  const card = await ensureGitSession(page);
  await card.click();
  await page.setViewportSize(MOBILE);

  const composer = page.getByTestId("composer-root").first();
  await expect(composer).toBeVisible({ timeout: 30_000 });

  await composer.locator("textarea").focus();
  await page.keyboard.type("mobile viewport probe");

  const m = await readMetrics(page);
  expect(m.docScrollTop, "document must not scroll when the composer takes focus").toBe(0);
  expect(m.scrollY, "window must not scroll when the composer takes focus").toBe(0);
  await expectViewportBound(page);

  // The shell header stays fully visible after focus. Pre-fix the document
  // scrolled, pushing the header above the viewport — the defect this pins.
  const headerAfter = await byTestId(page, "headerAppBar").first().boundingBox();
  expect(headerAfter, "header must remain laid out").not.toBeNull();
  expect(headerAfter!.y, "header must not be scrolled off the top").toBeGreaterThanOrEqual(0);
  expect(headerAfter!.y + headerAfter!.height, "header fully within the viewport").toBeLessThanOrEqual(
    m.innerHeight,
  );
});

// F15 — each overlay surface is viewport-anchored and adds no flow height.
test.describe("F15: overlays add no flow height", () => {
  test("first-launch modal", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await forceStaleBanner(page);
    // Force the seedless state so the one-shot modal opens deterministically,
    // and navigate directly (no auto-dismiss locator handler).
    await page.route("**/api/preferences/display", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });
    await page.goto("/");

    const backdrop = page.getByTestId("first-launch-display-backdrop");
    await expect(backdrop).toBeVisible({ timeout: 20_000 });
    expect(await fixedAncestorPosition(backdrop)).toBe("fixed");
    await expectViewportBound(page);
  });

  test("add-folders dialog", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await forceStaleBanner(page);
    await gotoDashboard(page);

    const dialog = await openAddFoldersDialog(page);
    expect(await fixedAncestorPosition(dialog)).toBe("fixed");
    await expectViewportBound(page);
  });

  test("app-level toast, spawn-error and recovery hosts", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await forceStaleBanner(page);
    const inject = await installFrameInjector(page);
    await gotoDashboard(page);

    // Generic app toast — `auto_name_error` routes through `showToast`.
    inject.send({ type: "auto_name_error", sessionId: "e2e-mobile-toast", reason: "e2e" });
    const toast = page.getByText(/auto-name session/i).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    expect(await fixedAncestorPosition(toast)).toBe("fixed");
    await expectViewportBound(page);

    // Off-screen spawn failure → the global fallback toast host.
    inject.send({
      type: "spawn_error",
      cwd: "/e2e/mobile-viewport-offscreen",
      strategy: "tmux",
      message: "e2e spawn failure",
      code: "PREFLIGHT_FAILED",
    });
    const spawnHost = page.getByTestId("spawn-error-toast-host");
    await expect(spawnHost).toBeVisible({ timeout: 10_000 });
    expect(await fixedAncestorPosition(spawnHost)).toBe("fixed");
    await expectViewportBound(page);

    // Cold-start recovery offer — sticky, no auto-timeout.
    inject.send({
      type: "recovery_offer",
      candidates: [{ sessionId: "e2e-mobile-recovery", cwd: "/e2e/mobile-viewport-offscreen" }],
    });
    const recoveryHost = page.getByTestId("recovery-offer-host");
    await expect(recoveryHost).toBeVisible({ timeout: 10_000 });
    expect(await fixedAncestorPosition(recoveryHost)).toBe("fixed");
    await expectViewportBound(page);
  });

  test("worktree-init stack", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await forceStaleBanner(page);
    await forceConcurrentInitStack(page);
    await gotoDashboard(page);

    const stack = page.getByTestId("worktree-init-stack");
    await expect(stack).toBeVisible({ timeout: 20_000 });
    expect(await fixedAncestorPosition(stack)).toBe("fixed");
    await expectViewportBound(page);
  });
});
