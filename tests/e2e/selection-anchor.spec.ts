import { expect, type Page, test } from "@playwright/test";
import { ANCHOR_PROSE, ANCHOR_ROW_GROWTH_TAIL } from "../../qa/fixtures/faux-scenarios.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Real-layout acceptance for selection anchoring
 * (change: anchor-chat-selection-against-row-growth).
 *
 * jsdom has no layout engine, so the unit layer can only assert the arithmetic
 * (`selection-anchor.test.ts`) and the compensator's write discipline against a
 * driven geometry (`ChatView.selection-anchor.test.tsx`). THIS layer is where
 * the bug actually lives: a real browser hit-tests the focus endpoint against a
 * screen point, so when content slides under a stationary pointer the selection
 * silently retargets. Only a real browser reproduces that.
 *
 * Mechanism: the faux `anchor-row-growth` scenario runs `seq 1 600` (a ~600-line
 * result) ABOVE the prose under test. A WebSocket proxy HOLDS that tool's
 * `tool_execution_end` frame so the card is still "running" when the drag
 * starts, then RELEASES it mid-drag — the card completes, renders its body, and
 * every row below it shifts down by thousands of px. That is the reported
 * trigger, reproduced deterministically.
 */


/**
 * Install a server→client WS proxy that withholds `tool_execution_end` frames
 * until `release()` is called. MUST run before the page opens its socket.
 */
async function holdToolEndFrames(page: Page): Promise<{ release: () => Promise<void>; heldCount: () => number }> {
  // The route handler runs in NODE (the test process), so the queue and the
  // flush hook are plain closures here — no page-side bridge needed.
  const queue: Array<{ send: (m: string) => void; frame: string }> = [];
  let open = false;

  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m)); // client→server: verbatim
    server.onMessage((m) => {
      if (!open && typeof m === "string") {
        try {
          const parsed = JSON.parse(m) as { type?: string; event?: { eventType?: string } };
          if (parsed.type === "event" && parsed.event?.eventType === "tool_execution_end") {
            queue.push({ send: (f) => ws.send(f), frame: m });
            return; // park it — the card stays "running"
          }
        } catch {
          // fall through and forward
        }
      }
      ws.send(m);
    });
  });

  return {
    heldCount: () => queue.length,
    release: async () => {
      open = true; // stop parking; later frames pass straight through
      while (queue.length) {
        const item = queue.shift();
        item?.send(item.frame);
      }
    },
  };
}

const selectionText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

const scroller = (page: Page) => page.locator("[data-testid='chat-scroll-container']");

async function scrollMetrics(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-testid='chat-scroll-container']") as HTMLElement;
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
}

/** Enable tool bodies so completing the card actually renders ~600 lines. */
async function enableToolBodies(page: Page) {
  const res = await page.request.patch("/api/preferences/display", {
    data: { toolResults: true, toolResultBodies: true, toolCalls: { bash: true, generic: true } },
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * Start a drag inside the prose row and sweep RIGHT by `SELECT_CHARS`-ish worth
 * of pixels. Leaves the mouse button DOWN — the caller triggers the layout shift
 * and then asserts, exactly as a user holding a drag would experience it.
 */
async function beginDragInProse(page: Page) {
  const prose = page.getByText(/ANCHORSTART/).first();
  await expect(prose).toBeVisible({ timeout: 60_000 });
  const box = await prose.boundingBox();
  if (!box) throw new Error("prose row has no bounding box");
  const y = box.y + Math.min(12, box.height / 2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(box.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + 220, y, { steps: 12 });
  return { box, y };
}

/** Nudge 1px so the browser re-resolves the focus endpoint after a shift. */
async function nudge(page: Page, at: { box: { x: number }; y: number }) {
  await page.mouse.move(at.box.x + 4 + 221, at.y);
  await page.waitForTimeout(150);
}

async function runScenario(page: Page) {
  const hold = await holdToolEndFrames(page);
  await enableToolBodies(page);
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:anchor-row-growth]] go");
  // Wait for the prose row (emitted after the withheld tool result) to render.
  // Matched on the fixture's own marker so a fixture edit cannot silently
  // decouple the spec from the scenario it asserts.
  expect(ANCHOR_PROSE).toContain("ANCHORSTART");
  await expect(page.getByText(/ANCHORSTART/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(ANCHOR_ROW_GROWTH_TAIL).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(400); // let measurement settle
  return hold;
}

test.describe("selection anchoring against row growth", () => {
  // Task 6.1 — the acceptance scenario for the original report.
  test("a tool card completing mid-drag does not retarget the selection", async ({ page }) => {
    test.setTimeout(150_000);
    const hold = await runScenario(page);

    const at = await beginDragInProse(page);
    const before = await selectionText(page);
    expect(before.length).toBeGreaterThan(5);
    expect(before).toContain("ANCHORSTART");

    const beforeHeight = (await scrollMetrics(page)).scrollHeight;
    expect(hold.heldCount()).toBeGreaterThan(0); // the fixture really withheld a frame
    await hold.release(); // the card completes mid-drag and renders ~600 lines
    await page.waitForTimeout(600);
    const afterHeight = (await scrollMetrics(page)).scrollHeight;
    // Guard the fixture itself: if nothing grew, the test proves nothing.
    expect(afterHeight).toBeGreaterThan(beforeHeight);

    await nudge(page, at);
    const after = await selectionText(page);
    await page.mouse.up();

    // The pointer only ever moved forward, so the selection may only have grown
    // forward — it must NOT have crept above the drag origin.
    expect(after).toContain("ANCHORSTART");
    expect(after.startsWith(before.slice(0, 10))).toBeTruthy();
    // And it must not have swallowed the tool output that appeared above it.
    expect(after).not.toContain("599");
  });

  // Task 6.2 — shrink counterpart: collapsing the completed card above.
  test("a row above the anchor shrinking mid-drag does not retarget the selection", async ({ page }) => {
    test.setTimeout(150_000);
    const hold = await runScenario(page);
    await hold.release(); // let the card complete and expand FIRST
    await page.waitForTimeout(600);

    const at = await beginDragInProse(page);
    const before = await selectionText(page);
    expect(before).toContain("ANCHORSTART");

    // Collapse the big bash card above → the rows below shrink upward.
    // Asserted, NOT branched on: if the header were missing the shrink would
    // never happen and the assertions below would still pass, reporting success
    // without ever exercising the path under test.
    const header = page.getByText(/seq 1 600/).first();
    await expect(header).toBeVisible({ timeout: 30_000 });
    const heightBefore = (await scrollMetrics(page)).scrollHeight;
    await header.click({ force: true });
    await expect
      .poll(async () => (await scrollMetrics(page)).scrollHeight, { timeout: 10_000 })
      .toBeLessThan(heightBefore);

    await nudge(page, at);
    const after = await selectionText(page);
    await page.mouse.up();

    expect(after).toContain("ANCHORSTART");
    expect(after.startsWith(before.slice(0, 10))).toBeTruthy();
  });

  // Task 6.3 — above-viewport resize: the virtualizer corrects it itself, so the
  // compensator must NOT apply a second correction.
  test("an above-viewport resize is corrected exactly once", async ({ page }) => {
    test.setTimeout(150_000);
    const hold = await runScenario(page);

    // Scroll the growing card entirely above the viewport, keeping the prose in
    // view, then hold a selection in the prose.
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='chat-scroll-container']") as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    await beginDragInProse(page);
    const proseTopBefore = await page.evaluate(() => {
      const n = [...document.querySelectorAll("[data-index]")].find((e) => e.textContent?.includes("ANCHORSTART"));
      return n ? n.getBoundingClientRect().top : null;
    });
    expect(proseTopBefore).not.toBeNull();

    await hold.release();
    await page.waitForTimeout(800);

    const proseTopAfter = await page.evaluate(() => {
      const n = [...document.querySelectorAll("[data-index]")].find((e) => e.textContent?.includes("ANCHORSTART"));
      return n ? n.getBoundingClientRect().top : null;
    });
    await page.mouse.up();

    // Pinned: the anchor row holds its viewport position. A double-move would
    // show up as a large displacement in either direction.
    expect(Math.abs((proseTopAfter as number) - (proseTopBefore as number))).toBeLessThan(60);
  });

  // Task 6.4 — control: identical growth with NO selection must behave as today,
  // including sticky-bottom follow.
  test("with no selection, growth still follows the bottom as before", async ({ page }) => {
    test.setTimeout(150_000);
    const hold = await runScenario(page);

    // Park at the bottom so sticky-bottom follow is armed, and select nothing.
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='chat-scroll-container']") as HTMLElement;
      el.scrollTop = el.scrollHeight;
      window.getSelection()?.removeAllRanges();
    });
    await page.waitForTimeout(400);

    await hold.release();
    await page.waitForTimeout(900);

    const m = await scrollMetrics(page);
    // Still pinned to the bottom after a multi-thousand-px growth.
    expect(m.scrollHeight - m.scrollTop - m.clientHeight).toBeLessThan(80);
  });

  // Task 6.6 — a user scroll during an active selection must not be fought (D2).
  test("a wheel scroll during an active selection is not fought", async ({ page }) => {
    test.setTimeout(150_000);
    await runScenario(page);

    await beginDragInProse(page);
    const before = (await scrollMetrics(page)).scrollTop;
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(500);
    const after = (await scrollMetrics(page)).scrollTop;
    await page.mouse.up();

    // The wheel moved the view and stayed moved — the compensator did not claw
    // it back to the anchor.
    expect(after).toBeGreaterThan(before + 100);
  });
});

// Task 6.5 — D6 first-frame: a chunk arriving before React commits the drag's
// render must already find the bottom-pin suspended.
test.describe("selection suspends the bottom-pin on the first frame", () => {
  test("a chunk delivered on the first frame of a drag does not scroll to bottom", async ({ page }) => {
    test.setTimeout(150_000);
    await enableToolBodies(page);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:slow-stream]] go");

    const el = scroller(page);
    await expect(el).toBeVisible({ timeout: 60_000 });
    // Wait for enough streamed text to select inside.
    await page.waitForTimeout(2_500);

    // Park at the bottom (follow armed), then start a drag in the tail and let
    // the very next chunk land.
    await page.evaluate(() => {
      const c = document.querySelector("[data-testid='chat-scroll-container']") as HTMLElement;
      c.scrollTop = c.scrollHeight;
    });
    await page.waitForTimeout(200);

    const started = await page.evaluate(() => {
      const c = document.querySelector("[data-testid='chat-scroll-container']") as HTMLElement;
      const rows = [...c.querySelectorAll("p, div")].filter((n) => (n.textContent ?? "").length > 60);
      const target = rows[Math.max(0, rows.length - 2)];
      if (!target) return null;
      const tn = [...target.childNodes].find((n) => n.nodeType === 3);
      if (!tn) return null;
      const r = document.createRange();
      r.setStart(tn, 0);
      r.setEnd(tn, Math.min(30, (tn.textContent ?? "").length));
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
      document.dispatchEvent(new Event("selectionchange"));
      return { scrollTop: c.scrollTop, scrollHeight: c.scrollHeight };
    });
    expect(started).not.toBeNull();

    // Let several chunks arrive while the selection is held.
    await page.waitForTimeout(2_000);
    const after = await scrollMetrics(page);
    // The view must NOT have been yanked down to the new bottom.
    expect(after.scrollTop).toBeLessThan(after.scrollHeight - after.clientHeight - 40);
  });
});
