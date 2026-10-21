import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// Canvas chip tray floats above the composer, out of layout flow
// (change: fix-canvas-chip-tray-overlay, #681; test-plan #E1 #E2 #E7 #F1–#F6).
//
// The tray (server chip + mobile file chip) is portaled to <body>, `fixed
// z-overlay pointer-events-none`, anchored above the live composer stack via a
// zero-height `composer-stack-anchor` sentinel. Manual-only: #F7 (soft
// keyboard), #F8 (first-appearance flash) — see tasks 3.14 / 3.15.
//
// Exemplar: canvas-declare-tool.spec.ts (faux canvas scenarios + helpers).
// Scenarios: canvas-declare-server · canvas-declare-server-long ·
// canvas-declare-server-slow · canvas-write-md (qa/fixtures/faux-scenarios.ts).
// ─────────────────────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Elements whose box must not move when a chip appears (layout, not overlay). */
const LAYOUT_PROBES = ["header-app-bar", "split-chat-pane", "composer-root"] as const;

async function layoutBoxes(page: Page): Promise<Record<string, Box | null>> {
  const out: Record<string, Box | null> = {};
  for (const id of LAYOUT_PROBES) out[id] = await page.getByTestId(id).first().boundingBox();
  return out;
}

function expectSameBoxes(after: Record<string, Box | null>, before: Record<string, Box | null>) {
  for (const id of LAYOUT_PROBES) {
    const a = after[id];
    const b = before[id];
    expect(a, `${id} present after`).not.toBeNull();
    expect(b, `${id} present before`).not.toBeNull();
    if (!a || !b) continue;
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(a[k] - b[k]), `${id}.${k} moved`).toBeLessThanOrEqual(0.5);
    }
  }
}

/**
 * Top edge (viewport px) of the topmost composer-stack row currently rendered:
 * the composer dock when it renders, else the composer card's wrapper.
 * See change: add-composer-dock (the strip, StatusBar and QueuePanel rows are gone).
 */
async function composerStackTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ids = ["composer-dock", "composer-root"];
    const tops = ids
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .filter((el): el is Element => el != null)
      .map((el) => el.getBoundingClientRect().top);
    return Math.min(...tops);
  });
}

const chip = (page: Page) => page.getByTestId("canvas-server-chip");
const tray = (page: Page) => page.getByTestId("canvas-chip-tray");

async function chipBottom(page: Page): Promise<number> {
  const box = await chip(page).boundingBox();
  expect(box, "chip has a box").not.toBeNull();
  return (box?.y ?? 0) + (box?.height ?? 0);
}

async function openSessionWithServerChip(page: Page, scenario = "canvas-declare-server") {
  await page.setViewportSize({ width: 1200, height: 800 });
  const card = await spawnFreshGitSession(page);
  await card.click();
  await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  await expect(chip(page)).toBeVisible({ timeout: 30_000 });
}

test.describe("canvas chip tray — floats out of layout flow", () => {
  test("#E1: the tray takes no layout space (boxes identical with it hidden) and is portaled to body", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });

    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    // The turn has ended (no working-status word in the toolbar).
    await expect(page.getByTestId("working-status")).toHaveCount(0, { timeout: 60_000 });

    // Same state, tray rendered vs hidden: no layout probe may move. (A
    // before/after-prompt baseline would also capture the usage row a turn adds
    // above the chat pane, which is unrelated to the chip.)
    const withTray = await layoutBoxes(page);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = "none"));
    const withoutTray = await layoutBoxes(page);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = ""));
    expectSameBoxes(withTray, withoutTray);
    const parentIsBody = await tray(page).evaluate((el) => el.parentElement === document.body);
    expect(parentIsBody, "tray portaled to document.body").toBe(true);
  });

  test("#E2: at 360px a long title stays inside the viewport and truncates", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 360, height: 740 });
    await sendPrompt(page, "[[faux:canvas-declare-server-long]] go");
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });

    const box = await tray(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360 - 16);

    const truncated = await chip(page)
      .locator("span.truncate")
      .first()
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(truncated, "label is truncated").toBe(true);
  });

  test("#E7: a plain live session has one anchor; with the Settings overlay open it has none", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("composer-stack-anchor")).toHaveCount(1);

    await byTestId(page, "settingsBtn").click();
    await expect(byTestId(page, "settingsContent")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("composer-stack-anchor")).toHaveCount(0);
  });
});

test.describe("canvas chip tray — tracks the composer stack", () => {
  test("#F1: a growing multi-line draft keeps the chip above the stack", async ({ page }) => {
    await openSessionWithServerChip(page);
    await expect.poll(async () => (await chipBottom(page)) <= (await composerStackTop(page))).toBe(true);
    const bottomBefore = await tray(page).evaluate((el) => Number.parseFloat(el.style.bottom));

    const composer = page.getByPlaceholder(/message/i).first();
    await composer.click();
    await composer.fill("l1\nl2\nl3\nl4\nl5\nl6");

    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);
    const bottomAfter = await tray(page).evaluate((el) => Number.parseFloat(el.style.bottom));
    expect(bottomAfter).toBeGreaterThan(bottomBefore);
  });

  test("#F2: the toolbar's working state coming and going keeps the chip above the stack", async ({ page }) => {
    await openSessionWithServerChip(page, "canvas-declare-server-slow");

    // While streaming the toolbar shows the working-status word (the StatusBar row it replaced is gone).
    await expect(page.getByTestId("working-status")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);

    // After the turn ends the word unmounts; the invariant still holds.
    await expect(page.getByTestId("working-status")).toHaveCount(0, { timeout: 60_000 });
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);
  });
});

test.describe("canvas chip tray — layering and pointer input", () => {
  test("#F3: a composer popover paints above the chip where they overlap", async ({ page }) => {
    await openSessionWithServerChip(page);
    await page.getByTestId("model-selector-button").click();
    await expect(page.getByTestId("model-dropdown")).toBeVisible({ timeout: 10_000 });

    const hit = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="canvas-server-chip"]')?.getBoundingClientRect();
      const d = document.querySelector('[data-testid="model-dropdown"]')?.getBoundingClientRect();
      if (!c || !d) return { skipped: true as const };
      const x = c.x + c.width / 2;
      const y = c.y + c.height / 2;
      const covered = x >= d.left && x <= d.right && y >= d.top && y <= d.bottom;
      const el = document.elementFromPoint(x, y);
      return {
        skipped: false as const,
        covered,
        inPopover: !!el?.closest('[data-testid="model-dropdown"]'),
        inChip: !!el?.closest('[data-testid="canvas-server-chip"]'),
      };
    });
    expect(hit.skipped).toBe(false);
    if (hit.skipped) return;
    // Whichever way they overlap: popover wins when it covers the point,
    // otherwise the chip stays clickable.
    expect(hit.covered ? hit.inPopover : hit.inChip).toBe(true);
  });

  test("#F4: the tray ignores pointer input; only the chip takes it", async ({ page }) => {
    await openSessionWithServerChip(page);
    const style = await page.evaluate(() => ({
      tray: getComputedStyle(document.querySelector('[data-testid="canvas-chip-tray"]') as Element).pointerEvents,
      chip: getComputedStyle(document.querySelector('[data-testid="canvas-server-chip"]') as Element).pointerEvents,
    }));
    expect(style).toEqual({ tray: "none", chip: "auto" });

    // 4px left of the chip: whatever is there is page content, never the tray.
    const hitsTray = await chip(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left - 4, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="canvas-chip-tray"]');
    });
    expect(hitsTray).toBe(false);
  });

  test("#F5: a dialog paints above the tray; closing it restores the invariant", async ({ page }) => {
    // NOT Settings: that route deselects the session, so the canvas state (and
    // the chip) is empty there — the premise of test-plan #F5 was wrong. The
    // commit dialog opens over a still-selected session, which is what the
    // layering requirement is about.
    await openSessionWithServerChip(page);
    await byTestId(page, "gitDirtyPill").first().click();
    await expect(byTestId(page, "commitDialog")).toBeVisible({ timeout: 10_000 });

    const hitsTray = await chip(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="canvas-chip-tray"]');
    });
    expect(hitsTray, "dialog/backdrop, not the chip, receives the point").toBe(false);

    await page.keyboard.press("Escape");
    await expect(byTestId(page, "commitDialog")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("composer-stack-anchor")).toHaveCount(1);
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);
  });
});

test.describe("canvas chip tray — mobile file chip", () => {
  test("#F6: the file chip floats without shifting chat, and tapping opens it in the foreground", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });

    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    const fileChip = page.getByTestId("canvas-file-chip");
    await expect(fileChip).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("working-status")).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId("split-chat-pane")).toBeVisible();

    // Same state, tray present vs removed from rendering: the chat pane must not
    // move. (Comparing against a pre-prompt baseline would also capture the
    // unrelated mobile header rows that a first turn adds.)
    const withTray = await page.getByTestId("split-chat-pane").boundingBox();
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = "none"));
    const withoutTray = await page.getByTestId("split-chat-pane").boundingBox();
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = ""));
    expect(withTray).not.toBeNull();
    expect(withoutTray).not.toBeNull();
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs((withTray?.[k] ?? 0) - (withoutTray?.[k] ?? 0)), `split-chat-pane.${k} depends on tray`).toBeLessThanOrEqual(0.5);
    }

    await fileChip.click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { selected: true })).toContainText("report.md", { timeout: 15_000 });
  });
});

// ── #F12 (add-composer-dock): the tray tracks the DOCK's top edge, or the card's ──
// The dock is an extra row between the anchor and the composer card. With a Context
// lane (a stubbed `/api/quota` gives every session one) the tray must clear the dock's
// top; on a quiet session (no dock) it clears the card's wrapper, as before.

const QUOTA_BODY = {
  providers: [
    {
      provider: "anthropic",
      windows: [{ label: "5h", usedPercent: 14, resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), windowSeconds: 5 * 3600 }],
    },
  ],
  unavailable: [],
};

async function topOf(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? null, testId);
}

test.describe("canvas chip tray — tracks the composer dock", () => {
  test("#F12a: with a dock the tray's bottom clears the dock's top edge", async ({ page }) => {
    await page.route("**/api/quota", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUOTA_BODY) }),
    );
    await openSessionWithServerChip(page);
    await expect(page.getByTestId("composer-dock")).toBeVisible({ timeout: 20_000 });
    const dockTop = await topOf(page, "composer-dock");
    const rootTop = await topOf(page, "composer-root");
    expect(dockTop, "dock renders").not.toBeNull();
    expect(dockTop as number, "the dock sits above the card").toBeLessThan(rootTop as number);
    await expect.poll(async () => (await chipBottom(page)) <= (await topOf(page, "composer-dock"))! + 0.5).toBe(true);
    // The anchor sits directly above the dock, not above the card: the tray must not hug the card.
    expect(await chipBottom(page), "chip is above the dock, not merely above the card").toBeLessThanOrEqual((dockTop as number) + 0.5);
  });

  test("#F12b: a quiet session (no dock) keeps the tray above the card's top edge", async ({ page }) => {
    await page.route("**/api/quota", (route) => route.abort());
    await openSessionWithServerChip(page);
    await expect(page.getByTestId("composer-dock")).toHaveCount(0);
    await expect
      .poll(async () => (await chipBottom(page)) <= (await topOf(page, "composer-root"))! + 0.5, { timeout: 10_000 })
      .toBe(true);
  });
});
