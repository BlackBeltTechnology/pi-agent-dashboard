import { expect, narrowTrust, test } from "./fixtures.js";
import { dragChatPaneTo, openIdleGrid } from "./helpers/flow-card-grid.js";
import { chooseLayoutMode, FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — define-chat-pane-below-floor-allocation
 *
 * Verifies height allocation and ordering below the floor sum for `split-chat-pane`:
 * - At/above floor sum: full rows, clipped = 0 (#E3, #E4)
 * - Below floor sum: shrinkable rows absorb deficit, fixed rows hold content height (#E5, #E6, #E7, #E8)
 * - Precedence: min-height (72px) beats max-h-[40%] below floor sum (#E9)
 * - Long draft does not evict bottom rows (#F4)
 *
 * Test-Plan rows covered: E3, E4, E5, E6, E7, E8, E9, F4.
 */

/**
 * Resize and wait until the chat pane's box stops changing. A viewport change crosses the mobile /
 * desktop header tiers and remounts the split layout, so a measurement taken in the same tick reads
 * the previous layout (a stale 469 px pane bottom under a 900 px viewport).
 */
async function resizeAndSettle(page: import("@playwright/test").Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  const pane = page.getByTestId("split-chat-pane");
  let last = "";
  let stable = 0;
  await expect
    .poll(
      async () => {
        const b = await pane.boundingBox();
        const now = b ? `${b.x},${b.y},${b.width},${b.height}` : "none";
        stable = now === last && b ? stable + 1 : 0;
        last = now;
        return stable;
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
}

async function openSplitSession(page: import("@playwright/test").Page) {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});

    // Set short viewport 375x360 after session is active
    await page.setViewportSize({ width: 375, height: 360 });

    const sendBtn = page.getByTestId("send-button");
    await expect(sendBtn).toBeVisible({ timeout: 30_000 });

    // Open split mode
    await chooseLayoutMode(page, "split");
    const chatPane = page.getByTestId("split-chat-pane");
    await expect(chatPane).toBeVisible({ timeout: 15_000 });
    return chatPane;
}

test.describe("chat-pane below-floor allocation", () => {
  test("3.1 & 3.2 At and just above the floor sum, rows are full and nothing clips (#E3, #E4)", async ({ page }) => {
    // Comfortably tall viewport so pane is well above the floor sum
    const chatPane = await openSplitSession(page);
    await resizeAndSettle(page, { width: 1280, height: 900 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(paneBox!.height).toBeGreaterThan(0);

    const chatView = chatPane.locator('[data-testid="chat-scroll-container"]');
    await expect(chatView).toBeVisible();

    const composer = page.getByTestId("composer-root");
    await expect(composer).toBeVisible();

    // Check that composer and chat view both have height >= their declared bounds
    const compBox = await composer.boundingBox();
    expect(compBox!.height).toBeGreaterThanOrEqual(72);

    const chatViewBox = await chatView.boundingBox();
    expect(chatViewBox!.height).toBeGreaterThanOrEqual(64);

    // Verify no bottom clip on pane: child bottom does not exceed pane bottom
    expect(compBox!.y + compBox!.height).toBeLessThanOrEqual(paneBox!.y + paneBox!.height + 1);
  });

  test("3.3 & 3.4 Below the floor sum, deficit is shared and not dumped on one row (#E5, #E6)", async ({ page }) => {
    // Short viewport puts pane below floor sum
    const chatPane = await openSplitSession(page);
    await resizeAndSettle(page, { width: 375, height: 280 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();

    const compBox = await page.getByTestId("composer-root").boundingBox();
    expect(compBox).not.toBeNull();
    // Composer participates in shrinking down to its 72px bound
    expect(compBox!.height).toBeGreaterThanOrEqual(72);

    const chatView = chatPane.locator('[data-testid="chat-scroll-container"]');
    const chatViewBox = await chatView.boundingBox();
    expect(chatViewBox).not.toBeNull();
    // Transcript absorbed deficit below its 64px declared floor
    expect(chatViewBox!.height).toBeLessThan(64);
    // While holding at or above its 16px bound
    expect(chatViewBox!.height).toBeGreaterThanOrEqual(16);

    // The composer-stack anchor is the only fixed row above the card now that the
    // context strip, StatusBar and QueuePanel are gone: it stays 0 px and never
    // absorbs (or adds to) the deficit. See change: add-composer-dock.
    const anchorBox = await page.getByTestId("composer-stack-anchor").boundingBox();
    expect(anchorBox).not.toBeNull();
    expect(anchorBox!.height).toBeLessThanOrEqual(1);
  });

  test("3.7 min-height beats max-h-[40%] below floor sum (#E9)", async ({ page }) => {
    // Short viewport where 0.4 * pane < 72px
    const chatPane = await openSplitSession(page);
    await resizeAndSettle(page, { width: 375, height: 260 });

    const paneBox = await chatPane.boundingBox();
    expect(paneBox).not.toBeNull();
    // Precondition: 40% cap would be less than 72px
    expect(paneBox!.height * 0.4).toBeLessThan(72);

    const composer = page.getByTestId("composer-root");
    await expect(composer).toBeVisible();

    // Min-height (72px) must prevail over max-h-[40%]
    const compBox = await composer.boundingBox();
    expect(compBox!.height).toBeGreaterThanOrEqual(72);
  });

  test("3.11 Long draft does not evict the bottom rows (#F4)", async ({ page }) => {
    const chatPane = await openSplitSession(page);

    const textarea = page.locator('textarea[placeholder*="Message"]');
    await expect(textarea).toBeVisible();

    // Fill 40-line draft into textarea
    const longDraft = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
    await textarea.fill(longDraft);

    const paneBox = await chatPane.boundingBox();
    const compBox = await page.getByTestId("composer-root").boundingBox();
    expect(compBox).not.toBeNull();
    expect(paneBox).not.toBeNull();

    // Verify textarea or card scrolls its content
    const textareaScrollable = await textarea.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(textareaScrollable).toBe(true);

    // Bottom of composer does not overflow pane
    expect(compBox!.y + compBox!.height).toBeLessThanOrEqual(paneBox!.y + paneBox!.height + 2);
  });
});

// ── Sticky header row reclassification (consolidate-flow-agent-cards) ────────
// `content-header-sticky` moved from FIXED to SHRINKABLE: it owns a scrollport,
// takes a share of a pane deficit, and its bound is 0 so an empty slot takes no
// pane height (test-plan #E15, #F7, #F8, #F9).

test.describe("chat-pane below-floor allocation — sticky header row", () => {
  /** The sticky header wrapper is the pane's first element child. */
  const headerOf = (pane: import("@playwright/test").Locator) => pane.locator(":scope > div").first();

  test("#F9: an empty sticky slot takes exactly 0px and does not shift the pane", async ({ page }) => {
    // Flow-less session (this spec's existing scenario): the slot renders null.
    const chatPane = await openSplitSession(page);
    const header = headerOf(chatPane);
    const box = await header.boundingBox();
    expect(box?.height ?? 0).toBeLessThanOrEqual(1);

    const chat = chatPane.locator('[data-testid="chat-scroll-container"]');
    const beforeChat = await chat.boundingBox();
    const beforeComposer = await page.getByTestId("composer-root").boundingBox();
    expect(beforeChat!.height).toBeGreaterThanOrEqual(16);
    expect(beforeComposer!.height).toBeGreaterThanOrEqual(72);

    // Removing the wrapper changes neither measured height (no dead band).
    await header.evaluate((el) => el.remove());
    const afterChat = await chat.boundingBox();
    const afterComposer = await page.getByTestId("composer-root").boundingBox();
    expect(Math.abs(afterChat!.height - beforeChat!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterComposer!.height - beforeComposer!.height)).toBeLessThanOrEqual(1);
  });

  test("#F7: the header shrinks into a short pane's deficit and scrolls internally", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { panel } = await openIdleGrid(page);
    const chatPane = await dragChatPaneTo(page, 243);
    const header = headerOf(chatPane);

    const paneBox = await chatPane.boundingBox();
    const headerBox = await header.boundingBox();
    const contentHeight = await header.evaluate((el) => el.getBoundingClientRect().height);
    expect(headerBox!.height).toBeLessThanOrEqual(paneBox!.height + 1);
    expect(headerBox!.height).toBeGreaterThanOrEqual(0);
    expect(contentHeight).toBeGreaterThan(0);

    // It owns a scrollport: its content overflows behind its own scrollbar.
    expect(await header.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
    await expect(panel).toBeVisible();

    // The other rows keep their declared bounds.
    const chat = await chatPane.locator('[data-testid="chat-scroll-container"]').boundingBox();
    const composer = await page.getByTestId("composer-root").boundingBox();
    expect(chat!.height).toBeGreaterThanOrEqual(16);
    expect(composer!.height).toBeGreaterThanOrEqual(72);

    // Nothing is painted outside its own row's box.
    const inside = await chatPane.evaluate((pane) => {
      const pr = pane.getBoundingClientRect();
      // A `hidden` row (an empty dock) paints nothing: it has no rect to be outside of.
      return [...pane.children].filter((c) => c.getClientRects().length > 0).every((c) => {
        const r = c.getBoundingClientRect();
        return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1;
      });
    });
    expect(inside, "every pane child stays inside the pane").toBe(true);
  });

  test("#F8: a tall pane renders the header at its content height with no scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    const { panel } = await openIdleGrid(page);
    const chatPane = await dragChatPaneTo(page, 700);
    const header = headerOf(chatPane);
    await expect(panel).toBeVisible();

    const metrics = await header.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(Math.abs(metrics.scrollHeight - metrics.clientHeight)).toBeLessThanOrEqual(1);
  });

  test("#E15: far below the floor sum the header sits at its bound; other rows hold theirs", async ({ page }) => {
    // Spawn from the desktop shell (the session list is desktop-only), then
    // drop to the 375x360 viewport the row bounds are measured at.
    await page.setViewportSize({ width: 1440, height: 900 });
    const { panel } = await openIdleGrid(page);
    await page.setViewportSize({ width: 375, height: 360 });
    await chooseLayoutMode(page, "split");
    const chatPane = page.getByTestId("split-chat-pane");
    await expect(chatPane).toBeVisible({ timeout: 15_000 });
    // Below the md breakpoint the shell collapses the flow slot to its mobile
    // bar, so the slot holds a bar rather than the panel; tap it open (the
    // user's own gesture) so the row under measurement carries the real panel.
    await page.getByText("tap to expand").click();
    await expect(panel).toBeVisible();

    const headerBox = await headerOf(chatPane).boundingBox();
    expect(headerBox!.height).toBeGreaterThanOrEqual(0);
    // Shrunk below its content: the deficit was taken from the header's row,
    // not clipped off a lower row.
    expect(
      await headerOf(chatPane).evaluate((el) => el.getBoundingClientRect().height < el.scrollHeight + 1),
    ).toBe(true);

    const chat = await chatPane.locator('[data-testid="chat-scroll-container"]').boundingBox();
    const composer = await page.getByTestId("composer-root").boundingBox();
    expect(chat!.height).toBeGreaterThanOrEqual(16);
    expect(composer!.height).toBeGreaterThanOrEqual(72);
  });
});

// ── Composer dock allocation (add-composer-dock, test-plan #F13) ─────────────
// The dock is a SHRINKABLE row (`composer-dock`: bound = YOLO footer, floor = bound + 41,
// weight 1). Below the floor sum its lane region scrolls; the footer (one fixed 32 px line)
// and the composer card are never clipped, and the transcript keeps its declared bound.

test.describe("chat-pane below-floor allocation — composer dock", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    // YOLO activation refuses in report mode; same narrowing as yolo-indicator-layout.spec.ts.
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete("/api/access/yolo").catch(() => undefined);
  });

  test("#F13: pane = floor sum − 50 px with YOLO on and lanes present: lanes scroll, footer and card stay fully visible", async ({ page }) => {
    // A stubbed quota gives the session a Context lane (a dock WITH lanes) with no extra setup.
    await page.route("**/api/quota", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: [
            {
              provider: "anthropic",
              windows: [{ label: "5h", usedPercent: 14, resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(), windowSeconds: 5 * 3600 }],
            },
          ],
          unavailable: [],
        }),
      }),
    );
    await page.request.delete("/api/access/yolo").catch(() => undefined);
    const started = await page.request.post("/api/access/yolo", {
      data: { durationMinutes: 15, base: FIXTURE_GIT, root: FIXTURE_GIT },
    });
    expect(started.ok(), `YOLO activation: ${started.status()}`).toBe(true);
    await page.reload();

    const chatPane = await openSplitSession(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const dock = page.getByTestId("composer-dock");
    await expect(dock).toBeVisible({ timeout: 20_000 });
    const footer = page.getByTestId("yolo-composer-strip");
    await expect(footer).toBeVisible({ timeout: 20_000 });

    // Floor sum (chat-pane-row-class.ts): transcript 64 + composer bound 72 + dock (32 + 41).
    // Pin the pane 50 px below it.
    const FLOOR_SUM = 64 + 72 + (32 + 41);
    await chatPane.evaluate((el, h) => {
      const e = el as HTMLElement;
      e.style.flex = "none";
      e.style.height = `${h}px`;
      e.style.maxHeight = `${h}px`;
    }, FLOOR_SUM - 50);

    const paneBox = (await chatPane.boundingBox())!;
    const inPane = (b: { y: number; height: number }) => b.y >= paneBox.y - 1 && b.y + b.height <= paneBox.y + paneBox.height + 1;

    const footerBox = (await footer.boundingBox())!;
    expect(footerBox.height, "footer keeps its one-line 32 px height").toBeCloseTo(32, 0);
    expect(inPane(footerBox), "footer fully inside the pane").toBe(true);

    const card = (await page.getByTestId("composer-card").boundingBox())!;
    expect(inPane(card), "composer card fully inside the pane").toBe(true);
    expect((await page.getByTestId("composer-root").boundingBox())!.height).toBeGreaterThanOrEqual(72);

    // The lane region is the dock's scrollport: it gave height, the footer did not.
    const scroll = page.getByTestId("composer-dock-scroll");
    const scrollBox = (await scroll.boundingBox())!;
    expect(scrollBox.height, "lane region may shrink, never below 0").toBeGreaterThanOrEqual(0);
    expect(await scroll.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    expect(inPane(scrollBox), "lane region stays inside the pane").toBe(true);

    // The transcript keeps at least its declared lower bound (16 px) — the deficit is shared, not dumped on it.
    const chat = (await chatPane.locator('[data-testid="chat-scroll-container"]').boundingBox())!;
    expect(chat.height).toBeGreaterThanOrEqual(16);
  });
});
