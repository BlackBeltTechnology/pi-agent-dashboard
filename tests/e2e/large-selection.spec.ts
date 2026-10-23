import type { BrowserContext, CDPSession } from "@playwright/test";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Real-browser gate for change `keep-oversized-chat-selection`: a selection
 * larger than the retained-row ceiling is never cleared or re-anchored, copying
 * it is complete and ordered up to the copy ceiling, and a held selection beats
 * the mobile edge-swipe-back. jsdom cannot host these: they need real layout,
 * real Range semantics under unmount, and the real clipboard round-trip.
 *
 * ENGINES: F1/F2/F3/F5 run in chromium, firefox AND webkit (playwright.config.ts
 * scopes the firefox/webkit projects to THIS file). A WebKit drag silently
 * re-anchors where Blink/Gecko wipe, so one engine proves nothing about another.
 *
 * FIXTURE: `[[faux:long-transcript]]` streams ~120 turns; each turn is a text row
 * "Investigating item N of the long transcript." plus a bash row, i.e. ~240 rows
 * once settled, which exceeds the coarse copy ceiling and every retained ceiling
 * while staying under the fine copy ceiling.
 *
 * CEILINGS are read off the scroll container (`data-selection-retain-cap`,
 * `data-selection-copy-cap`) rather than mirrored here, so calibration of the
 * constants cannot silently decouple this spec.
 *
 * COPY TIMING: `window.__piCopyTiming` is a test-only sink in ChatView, enabled by
 * `window.__piCopyTimingEnabled = true` (set via addInitScript below).
 */

const LONG = "[[faux:long-transcript]] go";
const LONG_TRANSCRIPT_TAIL = "long-transcript complete"; // mirror qa/fixtures
const ITEM_RE = /Investigating item (\d+) of the long transcript\./g;
const COPY_P90_BUDGET_MS = 1500;

const chatScroll = (page: Page) => byTestId(page, "chatScrollContainer");

/** Turn on the test-only copy-timing sink for every page load of `page`. */
async function enableCopyTiming(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __piCopyTimingEnabled?: boolean }).__piCopyTimingEnabled = true;
  });
}

/**
 * Open a fresh session, stream the whole long transcript and settle. Returns the
 * session id, so a narrow/touch page can deep-link to the SAME session (the
 * session list does not render its desktop cards below 600px height or on a
 * 390px mobile shell, so `spawnFreshGitSession` only works at a desktop size).
 */
async function openLongSession(page: Page): Promise<string> {
  await enableCopyTiming(page);
  const card = await spawnFreshGitSession(page);
  const id = (await card.getAttribute("data-session-id")) as string;
  await card.click();
  await sendPrompt(page, LONG);
  await expect(page.getByText(LONG_TRANSCRIPT_TAIL).last()).toBeVisible({ timeout: 240_000 });
  await chatScroll(page).waitFor({ state: "visible" });
  return id;
}

interface SelInfo {
  collapsed: boolean;
  anchorKey: string | null;
  anchorIdx: number;
  focusIdx: number;
  mounted: number;
}

async function selectionInfo(page: Page): Promise<SelInfo> {
  return page.evaluate(() => {
    const sel = window.getSelection() as Selection;
    const rowOf = (n: Node | null): HTMLElement | null =>
      ((n?.nodeType === 1 ? (n as Element) : (n?.parentElement ?? null))?.closest("[data-row-key]") as HTMLElement | null) ?? null;
    const a = rowOf(sel.anchorNode);
    const f = rowOf(sel.focusNode);
    return {
      collapsed: sel.isCollapsed,
      anchorKey: a?.getAttribute("data-row-key") ?? null,
      anchorIdx: a ? Number(a.dataset.index) : -1,
      focusIdx: f ? Number(f.dataset.index) : -1,
      mounted: document.querySelectorAll("[data-testid='chat-scroll-container'] [data-index]").length,
    };
  });
}

const capOf = (page: Page, attr: "retain" | "copy") =>
  chatScroll(page).evaluate((el, a) => Number(el.getAttribute(`data-selection-${a}-cap`)), attr);

/**
 * Drag-select from the start of row 0 downward while the transcript scrolls under
 * a stationary pointer, until the selection spans `rows` rows. The pointer only
 * ever moves a pixel at a time so the browser re-resolves the focus endpoint
 * against whatever row is under it, exactly like a user holding a drag. Leaves
 * the mouse button UP and returns the row-0 key.
 */
async function dragSelect(page: Page, rows: number): Promise<string> {
  const scroller = chatScroll(page);
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  const row0 = page.locator("[data-testid='chat-scroll-container'] [data-index='0']");
  await expect(row0).toBeVisible();
  const key0 = (await row0.getAttribute("data-row-key")) as string;
  const textBox = await row0.locator("p, span").first().boundingBox();
  const box = await scroller.boundingBox();
  if (!textBox || !box) throw new Error("no layout for row 0 / scroller");
  const x = textBox.x + 2;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(x, textBox.y + textBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(x + 40, cy, { steps: 8 });
  for (let i = 0; i < 400; i++) {
    const info = await selectionInfo(page);
    const span = info.focusIdx - info.anchorIdx + 1;
    if (info.anchorIdx >= 0 && span >= rows) break;
    const atBottom = await scroller.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
    if (atBottom) break;
    const step = rows - span > 20 ? 400 : 60;
    await scroller.evaluate((el, s) => {
      el.scrollTop += s;
    }, step);
    await page.mouse.move(x + 40 + (i % 2), cy);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  return key0;
}

async function primeClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ta = document.createElement("textarea");
    ta.id = "__clip";
    ta.value = t;
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
  }, text);
  await page.keyboard.press("ControlOrMeta+C");
  await page.evaluate(() => document.getElementById("__clip")?.remove());
}

async function pasteText(page: Page): Promise<string> {
  await page.evaluate(() => {
    const ta = document.createElement("textarea");
    ta.id = "__paste";
    document.body.appendChild(ta);
    ta.focus();
  });
  await page.keyboard.press("ControlOrMeta+V");
  const value = await page.locator("#__paste").inputValue();
  await page.evaluate(() => document.getElementById("__paste")?.remove());
  return value;
}

/** Every "item N" marker in `text`, in order of appearance. */
const itemNumbers = (text: string): number[] => Array.from(text.matchAll(ITEM_RE), (m) => Number(m[1]));

/** p90 of a numeric sample (nearest-rank). */
const p90 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.9) - 1)];

const copyTimings = (page: Page) =>
  page.evaluate(() => (window as unknown as { __piCopyTiming?: number[] }).__piCopyTiming ?? []);

async function selectAllPage(page: Page): Promise<void> {
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.body));
}

test.describe("oversized chat selection (desktop, all engines)", () => {
  test.setTimeout(420_000);

  test("F1/F3/F4/F5: a drag past the ceiling keeps its anchor, and copy is complete + ordered", async ({
    page,
    browserName,
  }) => {
    await openLongSession(page);
    const retainCap = await capOf(page, "retain");
    await primeClipboard(page, "PRIOR");
    await chatScroll(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    const baselineMounted = (await selectionInfo(page)).mounted;

    // ── F1: the selection survives, anchored in row 0, with a bounded mounted set
    const key0 = await dragSelect(page, retainCap + 10);
    const info = await selectionInfo(page);
    expect(info.collapsed).toBe(false);
    expect(info.anchorKey).toBe(key0);
    expect(info.focusIdx - info.anchorIdx + 1).toBeGreaterThan(retainCap);
    // Window rows + the (at most 4) retained endpoint rows; slack for row-height variance.
    expect(info.mounted).toBeLessThanOrEqual(baselineMounted + 4 + 12);

    // Scroll back to the middle of the span: every mounted interior row re-highlights.
    await chatScroll(page).evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop / 2);
    });
    await page.waitForTimeout(300);
    const interior = await page.evaluate(
      ([lo, hi]) => {
        const sel = window.getSelection() as Selection;
        const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='chat-scroll-container'] [data-index]"));
        const inside = rows.filter((r) => Number(r.dataset.index) > lo && Number(r.dataset.index) < hi);
        return { n: inside.length, ok: inside.every((r) => sel.containsNode(r, true)) };
      },
      [info.anchorIdx, info.focusIdx],
    );
    expect(interior.n).toBeGreaterThan(0);
    expect(interior.ok).toBe(true);

    // ── F4 (chromium): copy must not move the view
    const before = await chatScroll(page).evaluate((el) => ({ t: el.scrollTop, h: el.scrollHeight }));
    // ── F3: copy the whole oversized selection, paste it back
    await page.keyboard.press("ControlOrMeta+C");
    if (browserName === "chromium") {
      const after = await chatScroll(page).evaluate((el) => ({ t: el.scrollTop, h: el.scrollHeight }));
      expect(Math.abs(after.t - before.t)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.h - before.h)).toBeLessThanOrEqual(1);
    }
    const pasted = await pasteText(page);
    expect(pasted).not.toBe("PRIOR");
    const items = itemNumbers(pasted);
    expect(items.length).toBeGreaterThan(retainCap / 2 - 1);
    for (let i = 1; i < items.length; i++) expect(items[i], `item order at ${i}`).toBe(items[i - 1] + 1); // in order, once each, no gaps

    // ── F5: a page-wide select-all (≤ copy ceiling rows) copies page text + every turn
    await selectAllPage(page);
    await page.keyboard.press("ControlOrMeta+C");
    const all = await pasteText(page);
    const allItems = itemNumbers(all);
    expect(allItems.length).toBeGreaterThanOrEqual(100); // every turn of the fixture, contiguous from item 0
    allItems.forEach((n, i) => expect(n).toBe(i));
    const firstAt = all.indexOf("Investigating item 0 of the long transcript.");
    const tailAt = all.lastIndexOf(LONG_TRANSCRIPT_TAIL);
    expect(firstAt).toBeGreaterThan(0); // page text BEFORE the transcript
    expect(tailAt).toBeGreaterThan(firstAt);
    expect(all.slice(tailAt + LONG_TRANSCRIPT_TAIL.length).trim().length).toBeGreaterThan(0); // and AFTER it
  });

  test("F2: with selectionchange swallowed, the anchor still stays in row 0", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
        if (type === "selectionchange") return;
        return (orig as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof orig;
    });
    await openLongSession(page);
    const retainCap = await capOf(page, "retain");
    const key0 = await dragSelect(page, retainCap + 10);
    const info = await selectionInfo(page);
    expect(info.collapsed).toBe(false);
    expect(info.anchorKey).toBe(key0); // not the container, not another row
  });
});

test.describe("oversized chat selection (chromium desktop)", () => {
  test.setTimeout(420_000);
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "chromium-only: layout/CDP assertions");
  });

  test("F7: a held >100-row selection suspends the bottom-pin while a reply streams", async ({ page }) => {
    await openLongSession(page);
    const retainCap = await capOf(page, "retain");
    // Type the prompt FIRST (fill focuses the composer), then drag, then submit
    // with a programmatic click so the held selection is never touched.
    await page.getByPlaceholder(/message/i).first().fill("[[faux:slow-stream]] go");
    await dragSelect(page, retainCap + 10);
    const scrollTop0 = await chatScroll(page).evaluate((el) => el.scrollTop);
    await byTestId(page, "sendButton").dispatchEvent("click");
    await page.waitForTimeout(3_000);
    const scrollTop1 = await chatScroll(page).evaluate((el) => el.scrollTop);
    expect(Math.abs(scrollTop1 - scrollTop0)).toBeLessThanOrEqual(1);
    expect((await selectionInfo(page)).collapsed).toBe(false);

    // Collapse, jump to the bottom: the content that arrived during the selection is there.
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await byTestId(page, "scrollToBottom").click();
    await expect(page.getByText(/slow-chunk-39/).last()).toBeVisible({ timeout: 60_000 });
  });

  test("F8: a short desktop window still uses the fine ceiling (60 rows stay mounted)", async ({ page }) => {
    await openLongSession(page);
    // 560px tall makes `useMobile()` true (max-height: 599px) while the pointer stays fine.
    await page.setViewportSize({ width: 1280, height: 560 });
    await chatScroll(page).waitFor({ state: "visible" });
    expect(await capOf(page, "retain")).toBeGreaterThanOrEqual(100);
    await dragSelect(page, 60);
    const info = await selectionInfo(page);
    expect(info.focusIdx - info.anchorIdx + 1).toBeGreaterThanOrEqual(60);
    // Scroll so the middle rows leave the window, then count the intersected rows still mounted.
    await chatScroll(page).evaluate((el) => {
      el.scrollTop = el.scrollTop + 5_000;
    });
    await page.waitForTimeout(300);
    const kept = await page.evaluate(
      ([lo, hi]) => {
        const idx = new Set(
          Array.from(document.querySelectorAll<HTMLElement>("[data-testid='chat-scroll-container'] [data-index]")).map((r) =>
            Number(r.dataset.index),
          ),
        );
        let n = 0;
        for (let i = lo; i <= hi; i++) if (idx.has(i)) n++;
        return n;
      },
      [info.anchorIdx, Math.min(info.focusIdx, info.anchorIdx + 59)],
    );
    expect(kept).toBe(Math.min(info.focusIdx, info.anchorIdx + 59) - info.anchorIdx + 1);
  });

  test("P2: copying a fine-pointer selection stays within the copy budget (p90)", async ({ page }) => {
    await openLongSession(page);
    await selectAllPage(page);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("ControlOrMeta+C");
      await page.waitForTimeout(150);
    }
    const timings = await copyTimings(page);
    expect(timings.length).toBeGreaterThanOrEqual(10);
    expect(p90(timings)).toBeLessThanOrEqual(COPY_P90_BUDGET_MS);
  });
});

test.describe("oversized chat selection (chromium mobile, coarse pointer)", () => {
  test.setTimeout(420_000);
  // Contexts opened by hand are not closed with the test's own context.
  const extraContexts: BrowserContext[] = [];
  test.afterEach(async () => {
    for (const ctx of extraContexts.splice(0)) await ctx.close();
  });
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "chromium-only: mobile emulation + CDP");
  });

  test("F6/F9/P1: coarse copy declines past the ceiling, swipe-back yields to a selection, copy p90 holds under 6x CPU", async ({
    page,
    browser,
  }) => {
    // Stream the transcript on a desktop-size context, then deep-link the touch page to it.
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    extraContexts.push(desktop);
    const sessionId = await openLongSession(await desktop.newPage());
    await enableCopyTiming(page);
    await page.goto(`/session/${sessionId}`);
    await chatScroll(page).waitFor({ state: "visible" });
    // The deep-linked page replays history: wait until the whole transcript is
    // loaded (last row index) before any copy, else the row count is a race.
    await expect
      .poll(
        async () => {
          await chatScroll(page).evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          return page.evaluate(() =>
            Math.max(-1, ...Array.from(document.querySelectorAll<HTMLElement>("[data-index]")).map((r) => Number(r.dataset.index))),
          );
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(200);
    await primeClipboard(page, "PRIOR");
    const copyCap = await capOf(page, "copy");
    expect(copyCap).toBeLessThan(240); // the fixture must exceed the coarse ceiling

    // ── F6: select-all over > ceiling rows → declined, clipboard untouched, toast visible
    await selectAllPage(page);
    await page.keyboard.press("ControlOrMeta+C");
    const toast = page.getByText(/too large to copy at once/i);
    await expect(toast).toBeVisible();
    const tb = await toast.boundingBox();
    const vp = page.viewportSize() as { width: number; height: number };
    expect(tb && tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= vp.width && tb.y + tb.height <= vp.height).toBe(true);
    expect((await selectionInfo(page)).collapsed).toBe(false);
    expect(await pasteText(page)).toBe("PRIOR");

    // ── F9: with transcript text selected, an edge swipe must not navigate back
    const url0 = page.url();
    await chatScroll(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.evaluate(() => {
      const row = document.querySelector("[data-testid='chat-scroll-container'] [data-index] p");
      if (row) window.getSelection()?.selectAllChildren(row);
    });
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 10, y: 400 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 10 + i * 24, y: 400 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url0);
    await expect(page.getByTestId("mobile-shell")).toHaveAttribute("data-depth", "1");
    const left = await chatScroll(page).evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(left)).toBeLessThanOrEqual(1); // detail panel back at rest

    // ── P1: a selection of ~the coarse ceiling copies within budget at 6x CPU slowdown
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await dragSelect(page, copyCap - 3);
    await page.evaluate(() => {
      (window as unknown as { __piCopyTiming?: number[] }).__piCopyTiming = [];
    });
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("ControlOrMeta+C");
      await page.waitForTimeout(300);
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const timings = await copyTimings(page);
    expect(timings.length).toBeGreaterThanOrEqual(10);
    expect(p90(timings)).toBeLessThanOrEqual(COPY_P90_BUDGET_MS);
  });
});
