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

/** Top edge (viewport px) of the topmost composer-stack row currently rendered. */
async function composerStackTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ids = ["composer-context-strip", "status-bar", "queue-panel", "composer-root"];
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
  test("#E1: a chip appearing leaves header/chat/composer boxes unchanged; tray is portaled to body", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });
    const before = await layoutBoxes(page);

    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });

    expectSameBoxes(await layoutBoxes(page), before);
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

  test("#F2: a StatusBar row mounting/unmounting keeps the chip above the stack", async ({ page }) => {
    await openSessionWithServerChip(page, "canvas-declare-server-slow");

    // While streaming the StatusBar row is part of the stack.
    await expect(page.getByTestId("status-bar")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);

    // After the turn ends the row unmounts; the invariant still holds.
    await expect(page.getByTestId("status-bar")).toHaveCount(0, { timeout: 60_000 });
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

  test("#F5: a dialog paints above the tray; closing it restores the anchor", async ({ page }) => {
    await openSessionWithServerChip(page);
    await byTestId(page, "settingsBtn").click();
    await expect(byTestId(page, "settingsContent")).toBeVisible({ timeout: 20_000 });

    const hitsTray = await chip(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="canvas-chip-tray"]');
    });
    expect(hitsTray, "dialog/backdrop, not the chip, receives the point").toBe(false);

    await page.keyboard.press("Escape");
    await expect(byTestId(page, "settingsContent")).toHaveCount(0, { timeout: 15_000 });
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
    const before = await page.getByTestId("split-chat-pane").boundingBox();

    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    const fileChip = page.getByTestId("canvas-file-chip");
    await expect(fileChip).toBeVisible({ timeout: 30_000 });

    const after = await page.getByTestId("split-chat-pane").boundingBox();
    expect(after).not.toBeNull();
    expect(before).not.toBeNull();
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs((after?.[k] ?? 0) - (before?.[k] ?? 0)), `split-chat-pane.${k} moved`).toBeLessThanOrEqual(0.5);
    }

    await fileChip.click();
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { selected: true })).toContainText("report.md", { timeout: 15_000 });
  });
});
