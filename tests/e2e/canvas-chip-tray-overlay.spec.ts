import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// Canvas chip tray lives in a content-height SLOT in the chat column
// (change: fix-chat-transcript-layout D5/D6, #1084; was fix-canvas-chip-tray-overlay,
// #681). Test-plan #F8–#F17, #X2, #X3.
//
// The tray (server chip + mobile file chip) is portaled INTO
// `composer-stack-anchor`, a `shrink-0 mx-5` row directly above the composer
// dock. In flow: it stays inside the chat column (never over the editor pane or
// the transcript scrollbar), the transcript gives up its height (never covered)
// and a pinned transcript re-pins (D6). With no live composer, or with the chat
// pane hidden (`full` editor mode), it falls back to a fixed bottom-right
// overlay that ignores pointer input. Manual-only: #F19 (soft keyboard).
//
// Exemplar: canvas-declare-tool.spec.ts (faux canvas scenarios + helpers).
// Scenarios: canvas-declare-server · canvas-declare-server-long ·
// canvas-declare-server-longpath · canvas-declare-server-slow · canvas-write-md ·
// canvas-write-md-and-server · plain-text (qa/fixtures/faux-scenarios.ts).
// ─────────────────────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Chrome that must not move when a chip appears: header, pane, composer card (incl. its toolbar). */
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
 * the composer dock when it is laid out, else the composer card's wrapper.
 */
async function composerStackTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ids = ["composer-dock", "composer-root"];
    const tops = ids
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      // A `hidden` dock (every lane renders nothing) is laid out nowhere: its rect top is 0, not an edge.
      .filter((el): el is Element => el != null && el.getClientRects().length > 0)
      .map((el) => el.getBoundingClientRect().top);
    return Math.min(...tops);
  });
}

const chip = (page: Page) => page.getByTestId("canvas-server-chip");
const tray = (page: Page) => page.getByTestId("canvas-chip-tray");
const slot = (page: Page) => page.getByTestId("composer-stack-anchor");
const chatScroll = (page: Page) => page.getByTestId("chat-scroll-container");

async function chipBottom(page: Page): Promise<number> {
  const box = await chip(page).boundingBox();
  expect(box, "chip has a box").not.toBeNull();
  return (box?.y ?? 0) + (box?.height ?? 0);
}

async function trayInSlot(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = document.querySelector('[data-testid="canvas-chip-tray"]');
    const s = document.querySelector('[data-testid="composer-stack-anchor"]');
    return !!t && !!s && s.contains(t);
  });
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Scroll metrics of the transcript + the newest row's bottom edge. */
async function scrollState(page: Page) {
  return chatScroll(page).evaluate((el) => {
    const rows = [...el.querySelectorAll("[data-index]")] as HTMLElement[];
    const bottoms = rows.map((r) => r.getBoundingClientRect().bottom);
    // Live-tail rows render after the virtual spacer; include the scroller's last element child too.
    const tail = el.lastElementChild?.lastElementChild as HTMLElement | null | undefined;
    if (tail) bottoms.push(tail.getBoundingClientRect().bottom);
    return {
      scrollTop: el.scrollTop,
      distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
      scrollerBottom: el.getBoundingClientRect().bottom,
      lastRowBottom: Math.max(...bottoms),
    };
  });
}

async function openSession(page: Page, viewport = { width: 1200, height: 800 }) {
  await page.setViewportSize(viewport);
  const card = await spawnFreshGitSession(page);
  await card.click();
  await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });
}

async function openSessionWithServerChip(page: Page, scenario = "canvas-declare-server") {
  await openSession(page);
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  await expect(chip(page)).toBeVisible({ timeout: 30_000 });
}

/** Wait for the turn to settle (no working-status word in the toolbar). */
async function settled(page: Page) {
  await expect(page.getByTestId("working-status")).toHaveCount(0, { timeout: 60_000 });
}

test.describe("canvas chip slot — in the chat column", () => {
  test("#F8: a chip in the slot moves no chrome and sits above the composer stack", async ({ page }) => {
    await openSessionWithServerChip(page);
    await settled(page);
    expect(await trayInSlot(page), "tray portaled into composer-stack-anchor").toBe(true);

    // Same state, tray rendered vs removed: header, pane and composer card stay put
    // (only the transcript gives up the slot's height).
    const withTray = await layoutBoxes(page);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = "none"));
    const withoutTray = await layoutBoxes(page);
    await expect.poll(async () => (await slot(page).boundingBox())?.height ?? -1).toBeLessThanOrEqual(0.5);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = ""));
    expectSameBoxes(withTray, withoutTray);
    expect(await chipBottom(page)).toBeLessThanOrEqual((await composerStackTop(page)) + 0.5);
  });

  test("#E7: a live session has one slot, not aria-hidden; with the Settings overlay open it has none", async ({
    page,
  }) => {
    await openSession(page);
    await expect(slot(page)).toHaveCount(1);
    expect(await slot(page).getAttribute("aria-hidden")).toBe(null);

    await byTestId(page, "settingsBtn").click();
    await expect(byTestId(page, "settingsContent")).toBeVisible({ timeout: 20_000 });
    await expect(slot(page)).toHaveCount(0);
  });

  test("#F11: with a growing draft the tray never touches the transcript, its scrollbar, the Hide handle or the dock", async ({
    page,
  }) => {
    await openSessionWithServerChip(page);
    await settled(page);
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.click();
    for (const n of [1, 3, 6]) {
      await composer.fill(Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n"));
      await page.waitForTimeout(150);
      const g = await page.evaluate(() => {
        const r = (id: string) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el || el.getClientRects().length === 0) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
        const chipBox = document.querySelector('[data-testid="canvas-server-chip"]')?.getBoundingClientRect();
        return {
          tray: r("canvas-chip-tray"),
          chip: chipBox ? { x: chipBox.x, y: chipBox.y, width: chipBox.width, height: chipBox.height } : null,
          scroller: r("chat-scroll-container"),
          hide: r("composer-dock-hide"),
          root: r("composer-root"),
        };
      });
      expect(g.tray === null, "tray laid out").toBe(false);
      if (!g.tray || !g.scroller || !g.root) continue;
      // The transcript scroller (rows + scrollbar) ends where the slot begins.
      expect(intersects(g.tray, g.scroller), `draft ${n}: tray ∩ transcript`).toBe(false);
      // The tray's `pb-3` gap is reserved FOR the handle; the chip itself must clear it.
      if (g.hide && g.chip) expect(intersects(g.chip, g.hide), `draft ${n}: chip ∩ Hide handle`).toBe(false);
      expect(g.tray.x).toBeGreaterThanOrEqual(g.root.x - 0.5);
      expect(g.tray.x + g.tray.width).toBeLessThanOrEqual(g.root.x + g.root.width + 0.5);
      expect(g.tray.y + g.tray.height, `draft ${n}: tray above the stack`).toBeLessThanOrEqual(
        (await composerStackTop(page)) + 0.5,
      );
    }
  });

  test("#F2: the toolbar's working state coming and going keeps the chip above the stack", async ({ page }) => {
    await openSessionWithServerChip(page, "canvas-declare-server-slow");

    await expect(page.getByTestId("working-status")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);

    await settled(page);
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);
  });

  test("#F17: on first appearance the tray never overlaps the composer stack in any frame", async ({ page }) => {
    await openSession(page);
    await page.evaluate(() => {
      const w = window as unknown as { __trayFrames: { overlap: boolean }[]; __trayDone: boolean };
      w.__trayFrames = [];
      w.__trayDone = false;
      const box = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
      };
      const start = performance.now();
      const tick = () => {
        const t = box("canvas-chip-tray");
        if (t) {
          const stack = [box("composer-dock"), box("composer-root")].filter((b): b is DOMRect => b != null);
          const overlap = stack.some(
            (s) => t.left < s.right && s.left < t.right && t.top < s.bottom && s.top < t.bottom,
          );
          w.__trayFrames.push({ overlap });
          if (w.__trayFrames.length >= 60) {
            w.__trayDone = true;
            return;
          }
        }
        if (performance.now() - start > 60_000) {
          w.__trayDone = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __trayDone: boolean }).__trayDone), { timeout: 60_000 })
      .toBe(true);
    const frames = await page.evaluate(() => (window as unknown as { __trayFrames: { overlap: boolean }[] }).__trayFrames);
    expect(frames.length, "sampled frames with the tray").toBeGreaterThan(10);
    expect(frames.filter((f) => f.overlap)).toHaveLength(0);
  });
});

test.describe("canvas chip slot — transcript stays readable", () => {
  /** A transcript taller than the viewport, pinned to the bottom. */
  async function longPinnedTranscript(page: Page) {
    // Shortest non-mobile height (the mobile tier starts below 600 px).
    await openSession(page, { width: 1200, height: 640 });
    for (let i = 0; i < 3; i++) {
      await sendPrompt(page, "[[faux:coalesce-multiparagraph]] go");
      await settled(page);
    }
    await expect
      .poll(async () => {
        const m = await chatScroll(page).evaluate((el) => el.scrollHeight - el.clientHeight);
        return m;
      })
      .toBeGreaterThan(200);
  }

  test("#F9: a pinned transcript stays pinned when the chip appears and disappears; a scrolled-up one is not moved", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await longPinnedTranscript(page);

    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await expect.poll(async () => (await scrollState(page)).distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    let s = await scrollState(page);
    expect(s.lastRowBottom).toBeLessThanOrEqual(s.scrollerBottom + 0.5);

    // Unpinned: scroll up; the slot collapsing / re-growing (tray hidden, shown)
    // must leave scrollTop alone — the ResizeObserver re-pins in follow mode only.
    await chatScroll(page).evaluate((el) => el.scrollBy(0, -150));
    await page.waitForTimeout(300);
    const parked = (await scrollState(page)).scrollTop;
    expect((await scrollState(page)).distanceFromBottom).toBeGreaterThan(50);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = "none"));
    await page.waitForTimeout(300);
    expect(Math.abs((await scrollState(page)).scrollTop - parked), "slot collapses").toBeLessThanOrEqual(1);
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = ""));
    await page.waitForTimeout(300);
    expect(Math.abs((await scrollState(page)).scrollTop - parked), "slot re-grows").toBeLessThanOrEqual(1);

    // Back to the bottom (follow re-arms), then the chip really disappears
    // (expires at the next turn's agent_start) → still pinned.
    await chatScroll(page).evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(chip(page)).toHaveCount(0, { timeout: 30_000 });
    await settled(page);
    await expect.poll(async () => (await scrollState(page)).distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    s = await scrollState(page);
    expect(s.lastRowBottom).toBeLessThanOrEqual(s.scrollerBottom + 0.5);
  });

  test("#X3: removing the chip mid-session returns the slot to 0 px, moves no chrome and keeps the pin", async ({
    page,
  }) => {
    await openSessionWithServerChip(page);
    await settled(page);
    const header = await page.getByTestId("header-app-bar").boundingBox();

    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(chip(page)).toHaveCount(0, { timeout: 30_000 });
    await settled(page);
    await expect.poll(async () => (await slot(page).boundingBox())?.height ?? -1).toBeLessThanOrEqual(0.5);
    const headerAfter = await page.getByTestId("header-app-bar").boundingBox();
    for (const k of ["x", "y", "width", "height"] as const) {
      expect(Math.abs((headerAfter?.[k] ?? 0) - (header?.[k] ?? 0)), `header.${k}`).toBeLessThanOrEqual(0.5);
    }
    await expect.poll(async () => (await scrollState(page)).distanceFromBottom).toBeLessThanOrEqual(1);
  });
});

test.describe("canvas chip slot — editor pane and fallback", () => {
  /** Desktop session with report.md open in the editor AND a server chip. */
  async function editorAndChip(page: Page) {
    await openSession(page, { width: 1400, height: 850 });
    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 30_000 });
    await settled(page);
    await sendPrompt(page, "[[faux:canvas-declare-server]] go");
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    await settled(page);
  }

  test("#F10: with the editor open the tray stays inside the chat pane, never over the editor", async ({ page }) => {
    await editorAndChip(page);
    for (const mode of ["split", "closed"] as const) {
      await page.getByTestId(`layout-mode-${mode}`).first().click();
      await page.waitForTimeout(300);
      expect(await trayInSlot(page), `${mode}: in the slot`).toBe(true);
      const t = await tray(page).boundingBox();
      const pane = await page.getByTestId("split-chat-pane").boundingBox();
      expect(Boolean(t && pane)).toBe(true);
      if (!t || !pane) continue;
      expect(t.x).toBeGreaterThanOrEqual(pane.x - 0.5);
      expect(t.x + t.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
      const editor = page.getByTestId("split-editor-pane");
      if (await editor.isVisible()) {
        const e = await editor.boundingBox();
        if (e) expect(intersects(t, e), `${mode}: tray ∩ editor`).toBe(false);
      }
    }
  });

  test("#F14: full-editor mode shows the chip as a fixed overlay that ignores pointer input; split puts it back", async ({
    page,
  }) => {
    await editorAndChip(page);
    await page.getByTestId("layout-mode-full").first().click();
    await expect(chip(page)).toBeVisible({ timeout: 10_000 });
    expect(await trayInSlot(page)).toBe(false);
    const style = await page.evaluate(() => ({
      position: getComputedStyle(document.querySelector('[data-testid="canvas-chip-tray"]') as Element).position,
      tray: getComputedStyle(document.querySelector('[data-testid="canvas-chip-tray"]') as Element).pointerEvents,
      chip: getComputedStyle(document.querySelector('[data-testid="canvas-server-chip"]') as Element).pointerEvents,
    }));
    expect(style).toEqual({ position: "fixed", tray: "none", chip: "auto" });
    // 4px left of the chip: whatever is there is page content, never the tray.
    const hitsTray = await chip(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left - 4, r.top + r.height / 2);
      return !!hit?.closest('[data-testid="canvas-chip-tray"]');
    });
    expect(hitsTray).toBe(false);

    await page.getByTestId("layout-mode-split").first().click();
    await expect.poll(() => trayInSlot(page)).toBe(true);
  });
});

test.describe("canvas chip slot — layering", () => {
  test("#F16: a composer popover paints above the chip where they overlap", async ({ page }) => {
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
    expect(hit.covered ? hit.inPopover : hit.inChip).toBe(true);
  });

  test("#F5: a dialog paints above the tray; closing it restores the slot", async ({ page }) => {
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
    await expect(slot(page)).toHaveCount(1);
    await expect
      .poll(async () => (await chipBottom(page)) <= (await composerStackTop(page)) + 0.5, { timeout: 10_000 })
      .toBe(true);
  });
});

test.describe("canvas chip slot — narrow viewports", () => {
  test("#F12: on mobile the newest message ends above the file chip; tapping opens it in the foreground", async ({
    page,
  }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(byTestId(page, "sendButton")).toBeVisible({ timeout: 30_000 });

    await sendPrompt(page, "[[faux:canvas-write-md]] go");
    const fileChip = page.getByTestId("canvas-file-chip");
    await expect(fileChip).toBeVisible({ timeout: 30_000 });
    await settled(page);
    expect(await trayInSlot(page)).toBe(true);

    await expect.poll(async () => (await scrollState(page)).distanceFromBottom, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    const s = await scrollState(page);
    const t = await tray(page).boundingBox();
    expect(t === null, "tray laid out").toBe(false);
    expect(Math.min(s.lastRowBottom, s.scrollerBottom)).toBeLessThanOrEqual((t?.y ?? 0) + 0.5);

    const header = await page.getByTestId("header-app-bar").first().boundingBox();
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = "none"));
    const headerHidden = await page.getByTestId("header-app-bar").first().boundingBox();
    await tray(page).evaluate((el) => ((el as HTMLElement).style.display = ""));
    expect(Math.abs((header?.y ?? 0) - (headerHidden?.y ?? 0)), "header unmoved").toBeLessThanOrEqual(0.5);

    await fileChip.click();
    await expect(page.getByRole("tab", { selected: true })).toContainText("report.md", { timeout: 15_000 });
  });

  for (const [scenario, kind] of [
    ["canvas-declare-server-long", "80-char title"],
    ["canvas-declare-server-longpath", "120-char path"],
  ] as const) {
    test(`#F13: a ${kind} truncates and the chip never exceeds the slot width`, async ({ page }) => {
      const card = await spawnFreshGitSession(page);
      await card.click();
      await page.setViewportSize({ width: 360, height: 740 });
      await sendPrompt(page, `[[faux:${scenario}]] go`);
      await expect(chip(page)).toBeVisible({ timeout: 30_000 });

      const c = await chip(page).boundingBox();
      const s = await slot(page).boundingBox();
      expect(Boolean(c && s)).toBe(true);
      expect((c?.width ?? 0)).toBeLessThanOrEqual((s?.width ?? 0) + 0.5);
      const truncated = await chip(page)
        .locator("span.truncate")
        .evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth));
      expect(truncated, "a chip span is truncated").toBe(true);
    });
  }

  test("#X2: on a 375×320 pane with two chips the composer stays fully inside the chat pane", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.setViewportSize({ width: 375, height: 320 });
    await sendPrompt(page, "[[faux:canvas-write-md-and-server]] go");
    await expect(page.getByTestId("canvas-file-chip")).toBeVisible({ timeout: 30_000 });
    await expect(chip(page)).toBeVisible({ timeout: 30_000 });
    await settled(page);
    const root = await page.getByTestId("composer-root").first().boundingBox();
    const pane = await page.getByTestId("split-chat-pane").first().boundingBox();
    expect(Boolean(root && pane)).toBe(true);
    if (!root || !pane) return;
    expect(root.y).toBeGreaterThanOrEqual(pane.y - 0.5);
    expect(root.y + root.height).toBeLessThanOrEqual(pane.y + pane.height + 0.5);
    expect(root.x).toBeGreaterThanOrEqual(pane.x - 0.5);
    expect(root.x + root.width).toBeLessThanOrEqual(pane.x + pane.width + 0.5);
  });
});

// ── Dock present / absent (add-composer-dock #F12): the slot sits directly above
// the dock, so the tray clears the dock's top; with no dock it clears the card's,
// within the card's horizontal extent (8 px inset, D5). ──

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

test.describe("canvas chip slot — composer dock", () => {
  test("#F12a: with a dock the tray's bottom clears the dock's top edge and matches its insets", async ({ page }) => {
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
    const t = await tray(page).boundingBox();
    const dock = await page.getByTestId("composer-dock").boundingBox();
    expect((t?.x ?? 0) + (t?.width ?? 0)).toBeLessThanOrEqual((dock?.x ?? 0) + (dock?.width ?? 0) + 0.5);
  });

  test("#F15: a quiet session (no dock) keeps the tray above the card and within its horizontal extent", async ({
    page,
  }) => {
    await page.route("**/api/quota", (route) => route.abort());
    await openSessionWithServerChip(page);
    // The harness always mounts plugin lanes (e.g. FLOWS actions), so a fixture
    // session is never `allEmpty`; apply the dock's own `hidden` (the allEmpty
    // render) to get the no-dock layout.
    await page.getByTestId("composer-dock").evaluate((el) => {
      (el as HTMLElement).hidden = true;
    });
    await expect(page.getByTestId("composer-dock")).toBeHidden();
    await expect
      .poll(async () => (await chipBottom(page)) <= (await topOf(page, "composer-root"))! + 0.5, { timeout: 10_000 })
      .toBe(true);
    const t = await tray(page).boundingBox();
    const root = await page.getByTestId("composer-root").first().boundingBox();
    expect(Boolean(t && root)).toBe(true);
    expect(t?.x ?? 0).toBeGreaterThanOrEqual((root?.x ?? 0) - 0.5);
    expect((t?.x ?? 0) + (t?.width ?? 0)).toBeLessThanOrEqual((root?.x ?? 0) + (root?.width ?? 0) + 0.5);
  });
});
