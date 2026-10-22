/**
 * L3 — composer dock collapse, hover peek and per-file Open / Diff
 * (change: composer-dock-collapse-and-file-open; test-plan #E5 #E17 #F17–#F22).
 *
 * Same synthetic-bridge setup as `composer-dock.spec.ts`: a session under the pre-trusted
 * `FIXTURE_GIT` reports background processes; `/api/session-diff` and `/api/quota` are stubbed per
 * page. The dashboard port is the fixtures' baseURL — never hardcoded. The collapsed bit lives in
 * `localStorage` (`pi-dashboard:composer-dock-collapsed:<sessionId>`).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import {
  type ComposerBridge,
  connectComposerBridge,
  ensureFixturePinned,
  fakeProcesses,
  openComposerSession,
  stubQuota,
} from "./helpers/composer-bridge.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

const KEY = (sessionId: string) => `pi-dashboard:composer-dock-collapsed:${sessionId}`;

const dock = (page: Page) => page.getByTestId("composer-dock");
const bar = (page: Page) => page.getByTestId("composer-dock-bar");
const hide = (page: Page) => page.getByTestId("composer-dock-hide");
const region = (page: Page) => page.getByTestId("composer-dock-scroll");
const composerRoot = (page: Page) => page.getByTestId("composer-root");
const transcript = (page: Page) => page.getByTestId("chat-scroll-container");

/** Stub `/api/session-diff` with the given in-cwd files (all previewable, origin edit). */
async function stubDiff(page: Page, paths: string[]): Promise<void> {
  await page.route("**/api/session-diff*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          files: paths.map((p) => ({ path: p, changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 3, deletions: 1 })),
          isGitRepo: true,
          totalAdditions: 3 * paths.length,
          totalDeletions: paths.length,
        },
      }),
    }),
  );
}

async function open(page: Page, tag: string, processes = 2): Promise<ComposerBridge> {
  await gotoDashboard(page);
  await ensureFixturePinned(page);
  const bridge = await connectComposerBridge(page, tag);
  await openComposerSession(page, bridge.sessionId);
  bridge.setProcesses(fakeProcesses(processes));
  await expect(dock(page)).toBeVisible({ timeout: 20_000 });
  return bridge;
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  return b as { x: number; y: number; width: number; height: number };
};
const bottomGap = async (page: Page) => {
  const card = await box(composerRoot(page));
  const viewport = page.viewportSize();
  return (viewport?.height ?? 0) - (card.y + card.height);
};

test.describe("composer dock collapse / peek / file open (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await stubQuota(page);
    await stubDiff(page, ["notes.md"]);
  });

  test("#E5: the collapsed bar is one 44 px line at 375 px and never overflows", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const bridge = await open(page, "bar-phone", 3);
    try {
      await hide(page).click();
      await expect(bar(page)).toBeVisible();
      const b = await box(bar(page));
      expect(Math.round(b.height)).toBe(44);
      const fits = await bar(page).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      expect(fits.sh).toBeLessThanOrEqual(fits.ch);
      const overflow = await dock(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      bridge.close();
    }
  });

  test("#E17: Open and Diff fit a long path at 375 px with 44 px targets and a truncated folder", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await stubDiff(page, ["packages/client/src/components/chat/very/long/dir/ChangesLane.tsx"]);
    const bridge = await open(page, "row-phone");
    try {
      await page.locator("[data-dock-toggle='changes']").click();
      const openBtn = page.getByTestId("composer-dock-file-open");
      const diffBtn = page.getByTestId("composer-dock-file-diff");
      await expect(openBtn).toBeVisible();
      await expect(diffBtn).toBeVisible();
      for (const b of [await box(openBtn), await box(diffBtn)]) {
        expect(b.width).toBeGreaterThanOrEqual(43.5);
        expect(b.height).toBeGreaterThanOrEqual(43.5);
      }
      const detail = page.getByTestId("composer-dock-row-detail").first();
      const truncated = await detail.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis");
      expect(truncated).toBe(true);
      expect(await dock(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    } finally {
      bridge.close();
    }
  });

  test("#F17/#F18: collapse and peek keep the composer card and the YOLO footer in place and the join intact", async ({ page }) => {
    await page.request.delete("/api/access/yolo").catch(() => undefined);
    const res = await page.request.post("/api/access/yolo", { data: { durationMinutes: 15, base: FIXTURE_GIT, root: FIXTURE_GIT } });
    expect(res.ok()).toBe(true);
    const bridge = await open(page, "yolo-collapse");
    try {
      await page.locator("[data-dock-toggle='changes']").click();
      const gapExpanded = await bottomGap(page);
      const transcriptExpanded = await box(transcript(page));
      await expect(composerRoot(page)).toHaveCSS("border-top-width", "0px");

      await hide(page).click();
      await expect(bar(page)).toBeVisible();
      const footer = page.getByTestId("yolo-composer-strip");
      await expect(footer).toBeVisible();
      const barBox = await box(bar(page));
      const footerBox = await box(footer);
      expect(barBox.y + barBox.height).toBeLessThanOrEqual(footerBox.y + 1);
      expect(Math.abs((await bottomGap(page)) - gapExpanded)).toBeLessThanOrEqual(1);
      await expect(composerRoot(page)).toHaveCSS("border-top-width", "0px");
      const transcriptCollapsed = await box(transcript(page));
      expect(transcriptCollapsed.height).toBeGreaterThan(transcriptExpanded.height);
      const scrollTop = await transcript(page).evaluate((el) => el.scrollTop);

      // Peek: hover the bar and rest.
      const b = await box(bar(page));
      await page.mouse.move(b.x + 40, b.y + b.height / 2);
      await page.mouse.move(b.x + 41, b.y + b.height / 2);
      await expect(dock(page)).toHaveAttribute("data-peek", "true", { timeout: 3_000 });
      expect(Math.abs((await bottomGap(page)) - gapExpanded)).toBeLessThanOrEqual(1);
      expect((await box(transcript(page))).height).toBe(transcriptCollapsed.height);
      expect(await transcript(page).evaluate((el) => el.scrollTop)).toBe(scrollTop);
      await expect(composerRoot(page)).toHaveCSS("border-top-width", "0px");
      await expect(footer).toBeVisible();
    } finally {
      await page.request.delete("/api/access/yolo").catch(() => undefined);
      bridge.close();
    }
  });

  test("#F19: a fast pass over the bar never peeks; resting does", async ({ page }) => {
    const bridge = await open(page, "peek-speed");
    try {
      await hide(page).click();
      await expect(bar(page)).toBeVisible();
      const b = await box(bar(page));
      const input = await box(composerRoot(page));
      // Transcript → composer across the bar in 5 steps: well above 1.5 px/ms.
      await page.mouse.move(b.x + 100, b.y - 200);
      await page.mouse.move(b.x + 100, input.y + 30, { steps: 5 });
      await expect(dock(page)).not.toHaveAttribute("data-peek", "true");
      await page.waitForTimeout(500);
      await expect(dock(page)).not.toHaveAttribute("data-peek", "true");

      const started = Date.now();
      await page.mouse.move(b.x + 40, b.y + b.height / 2);
      await page.mouse.move(b.x + 41, b.y + b.height / 2);
      await expect(dock(page)).toHaveAttribute("data-peek", "true", { timeout: 3_000 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    } finally {
      bridge.close();
    }
  });

  test("#F20: the collapsed state persists per session across a reload", async ({ page }) => {
    const first = await open(page, "persist-a");
    const second = await connectComposerBridge(page, "persist-b");
    try {
      second.setProcesses(fakeProcesses(1));
      await hide(page).click();
      await expect(bar(page)).toBeVisible();
      expect(await page.evaluate((k) => localStorage.getItem(k), KEY(first.sessionId))).toBe("collapsed");

      await page.reload();
      await openComposerSession(page, first.sessionId);
      await expect(bar(page)).toBeVisible({ timeout: 20_000 });

      await openComposerSession(page, second.sessionId);
      await expect(hide(page)).toBeVisible({ timeout: 20_000 });
      await expect(bar(page)).toHaveCount(0);

      await openComposerSession(page, first.sessionId);
      await expect(bar(page)).toBeVisible();
    } finally {
      first.close();
      second.close();
    }
  });

  test("#F21: Open and Diff land in the editor pane and never navigate to the session diff page", async ({ page }) => {
    const bridge = await open(page, "open-diff");
    try {
      await page.locator("[data-dock-toggle='changes']").click();
      await page.getByTestId("composer-dock-file-open").click();
      const active = page.locator("[data-testid='editor-tab'][aria-selected='true']");
      await expect(active).toHaveAttribute("data-tab-path", "notes.md", { timeout: 20_000 });

      await page.getByTestId("composer-dock-file-diff").click();
      await expect(active).toHaveAttribute("data-tab-path", "diff:notes.md", { timeout: 20_000 });
      expect(new URL(page.url()).pathname).not.toMatch(/\/diff$/);
    } finally {
      bridge.close();
    }
  });

  test("#F22: a menu portaled out of a peeked overlay is fully visible and keeps the peek open", async ({ page }) => {
    const bridge = await open(page, "peek-menu");
    try {
      await page.locator("[data-dock-toggle='changes']").click();
      await hide(page).click();
      const b = await box(bar(page));
      await page.mouse.move(b.x + 40, b.y + b.height / 2);
      await page.mouse.move(b.x + 41, b.y + b.height / 2);
      await expect(dock(page)).toHaveAttribute("data-peek", "true", { timeout: 3_000 });
      const trigger = region(page).locator("[aria-haspopup][aria-expanded]").first();
      test.skip((await trigger.count()) === 0, "this session's lanes expose no popover trigger (no OpenSpec attachment)");
      await trigger.click();
      const menu = page.getByRole("menu").or(page.locator("[data-testid$='-overflow-menu']")).first();
      await expect(menu).toBeVisible();
      const mb = await box(menu);
      const viewport = page.viewportSize();
      expect(mb.x).toBeGreaterThanOrEqual(0);
      expect(mb.y).toBeGreaterThanOrEqual(0);
      expect(mb.x + mb.width).toBeLessThanOrEqual(viewport?.width ?? 0);
      const mid = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 };
      await page.mouse.move(mid.x, mid.y);
      await page.waitForTimeout(700);
      await expect(dock(page)).toHaveAttribute("data-peek", "true");
    } finally {
      bridge.close();
    }
  });
});
