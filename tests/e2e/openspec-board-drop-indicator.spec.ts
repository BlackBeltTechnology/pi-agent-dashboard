import { expect, test } from "./fixtures.js";
import {
  beginCardDrag,
  boxOf,
  card,
  cardEl,
  columnBody,
  filterBoard,
  headerGrabPoint,
  midpointOf,
  openBoard,
  rail,
  setBoardLayout,
} from "./helpers/openspec-board.js";

/**
 * Browser E2E — the board's drag-time drop indication, its reachability, and
 * its cost.
 *
 * The guarantee under test is that no pointer position over a column leaves the
 * resolved slot unindicated. That is a rendered-geometry property: the marker
 * paints into a flex gap, the rail is `position: sticky` inside a scrolled
 * body, and both are driven by rects only a real browser measures.
 *
 * Covers test-plan #E15, #F4, #F7, #F8, #F9, #F16, #F19, #F20, #P1.
 * See change: fix-openspec-board-drop-targeting.
 */

const DESKTOP = { width: 1500, height: 900 };
const A = card(1);
const B = card(2);
const C = card(3);
const X = card(5);
/**
 * Every fixture change not under test, parked in a trailing group.
 *
 * Ungrouped always renders FIRST, so leaving 60 cards there would push the
 * columns under test far off a stacked narrow viewport. Parking them in a
 * trailing group instead keeps the stack order [Ungrouped(empty), …under test,
 * REST].
 */
const REST = Array.from({ length: 64 }, (_, i) => card(i + 1)).filter(
  (n) => ![A, B, X].includes(n),
);

test.describe("board drop indication", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openBoard(page, 10);
  });

  // #F7 — the marker must follow the resolution across a midpoint crossing.
  // `onDragOver`'s effect deps are `[overId]`, so it does NOT fire when the
  // pointer crosses a midpoint WITHIN one droppable — this is what pins the
  // resolution to `onDragMove`.
  test("F7: the marker tracks the slot across a card's midpoint", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Marker", changes: [A, B, C] },
      { name: "E2E Source", changes: [X] },
    ]);
    const col = ids.get("E2E Marker")!;

    const move = await beginCardDrag(page, X);
    const mid = await midpointOf(cardEl(page, B));
    await move({ x: mid.x, y: mid.y - 6 });
    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "1");
    const hostBefore = await page.locator(".board-drop-marker").getAttribute("data-testid");
    expect(hostBefore).toBe(`board-card-${B}`);

    // Cross the midpoint without leaving the droppable.
    await move({ x: mid.x, y: mid.y + 6 });
    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "2");
    expect(await page.locator(".board-drop-marker").getAttribute("data-testid")).toBe(`board-card-${C}`);
    await page.mouse.up();
  });

  // #F8 — the last slot has no following card, so the rail (not a marker) is
  // what indicates it, driven by the resolved slot rather than by the pointer.
  test("F8: the final slot is indicated without hovering the rail", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Final", changes: [A, B, C] },
      { name: "E2E Source", changes: [X] },
    ]);
    const col = ids.get("E2E Final")!;

    const move = await beginCardDrag(page, X);
    const mid = await midpointOf(cardEl(page, C));
    const railBox = await boxOf(rail(page, col));
    const y = mid.y + 8;
    expect(y, "the probe point must not be over the rail").toBeLessThan(railBox.y);
    await move({ x: mid.x, y });

    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "3");
    await expect(rail(page, col)).toHaveAttribute("data-rail-active", "true");
    // The in-gap marker is suppressed: there is nothing after the last card.
    expect(await page.locator(".board-drop-marker").count()).toBe(0);
    await page.mouse.up();
  });

  // #F9 — the continuous-indication invariant, swept across the whole column.
  test("F9: every pointer position over a column resolves a slot", async ({ page }) => {
    const ids = await setBoardLayout(page, [
      { name: "E2E Sweep", changes: [A, B, C] },
      { name: "E2E Source", changes: [X] },
    ]);
    const col = ids.get("E2E Sweep")!;
    const body = await boxOf(columnBody(page, col));

    const move = await beginCardDrag(page, X);
    await move(await headerGrabPoint(page, col));
    const samples: Array<string | null> = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const y = body.y + 2 + ((body.height - 4) * i) / steps;
      await move({ x: body.x + body.width / 2, y }, 2);
      samples.push(await columnBody(page, col).getAttribute("data-drop-slot"));
    }
    await page.mouse.up();

    const unindicated = samples.filter((s) => s === null || s === "");
    expect(unindicated, `${unindicated.length}/${samples.length} samples unindicated`).toEqual([]);
    // The sweep really did cross slots, else the invariant is vacuous.
    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  // #F4 — an IN-FLOW rail "after the last card" sits below the scroll fold in 8
  // of 9 measured columns: unreachable in exactly the case it exists for.
  test("F4: the rail is reachable without scrolling, at any scroll position", async ({ page }) => {
    const deep = Array.from({ length: 16 }, (_, i) => card(i + 20));
    const ids = await setBoardLayout(page, [
      { name: "E2E Deep", changes: deep },
      { name: "E2E Source", changes: [A] },
    ]);
    const col = ids.get("E2E Deep")!;
    const body = columnBody(page, col);
    expect(await body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(50);
    await body.evaluate((el) => { el.scrollTop = 0; });

    const move = await beginCardDrag(page, A);
    await move(await headerGrabPoint(page, col));
    const visible = await boxOf(body);

    const atTop = await boxOf(rail(page, col));
    expect(atTop.y).toBeGreaterThanOrEqual(visible.y - 1);
    expect(atTop.y + atTop.height, "rail is below the scroll fold").toBeLessThanOrEqual(
      visible.y + visible.height + 1,
    );

    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await move(await headerGrabPoint(page, col));
    const atBottom = await boxOf(rail(page, col));
    expect(atBottom.y + atBottom.height).toBeLessThanOrEqual(visible.y + visible.height + 1);
    await page.mouse.up();
  });

  // #F16 — auto-scroll is dnd-kit's, but it walks the OVER NODE's ancestors, so
  // it only works because the droppable stayed on the scrolling body.
  // Per test-plan C2 the edge-zone SIZE is deliberately untested.
  test("F16: holding the pointer near the bottom edge auto-scrolls the body", async ({ page }) => {
    const deep = Array.from({ length: 20 }, (_, i) => card(i + 30));
    const ids = await setBoardLayout(page, [
      { name: "E2E Scroll", changes: deep },
      { name: "E2E Source", changes: [A] },
    ]);
    const col = ids.get("E2E Scroll")!;
    const body = columnBody(page, col);
    const max = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(max).toBeGreaterThan(100);
    await body.evaluate((el) => { el.scrollTop = 0; });

    const box = await boxOf(body);
    const move = await beginCardDrag(page, A);
    // Park just inside the body's bottom edge and hold: dnd-kit's auto-scroll
    // runs off its own loop, so the pointer only has to stay in the edge zone.
    // It is nudged by a pixel while waiting so the drag keeps producing sensor
    // events on a loaded host, where a perfectly idle pointer can let the loop
    // starve. Sampling in a loop (not `expect.poll`) keeps the nudge and the
    // read on the same clock.
    const edgeY = box.y + box.height - 6;
    const centreX = box.x + box.width / 2;
    await move({ x: centreX, y: edgeY });

    const scrollTop = () => body.evaluate((el) => el.scrollTop);
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(centreX + (i % 2), edgeY);
      const top = await scrollTop();
      samples.push(top);
      if (top >= max - 2) break;
      await page.waitForTimeout(200);
    }
    await page.mouse.up();

    // The assertion is the spec's wording — the body SCROLLS TOWARD the edge
    // and keeps going while held. Deliberately NOT a fraction of scrollHeight:
    // dnd-kit's edge-scroll rate is fixed, so any such threshold really tests
    // "is this column shallow enough to traverse in the time budget", which is
    // a property of the fixture, not of auto-scroll. Edge-zone SIZE is
    // untested per test-plan C2.
    const first = samples[0];
    const last = samples[samples.length - 1];
    const trace = `samples ${samples.slice(0, 6).join(",")}…${last}, max ${max}`;

    // What this scenario actually guards is the D5 decision: the droppable had
    // to STAY on the scrolling body, because dnd-kit walks the OVER NODE's
    // ancestors. Move it to the column root and the body scrolls by exactly
    // zero, so "did it scroll at all, and far" is the discriminating signal.
    //
    // Deliberately NOT asserting it is still advancing at the end of the
    // budget: dnd-kit derives a scroll intent from pointer movement, and a
    // synthetic held pointer on a loaded host can let that intent lapse
    // mid-scroll. Observed reaching max (0 -> 1972 of 1947) when the host is
    // idle; the lapse is an artefact of emulating "hold still", not of the
    // board.
    expect(last, `body never scrolled (${trace})`).toBeGreaterThan(100);
    expect(last, `scroll did not advance (${trace})`).toBeGreaterThan(first);
    expect(last, `scrolled only marginally (${trace})`).toBeGreaterThanOrEqual(Math.min(300, max));
    // Monotonic: auto-scroll only ever moves toward the held edge.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i], `scrollTop went backwards at sample ${i} (${trace})`).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  // #P1 — the resolution runs on EVERY pointer move, so its cost is a frame
  // budget, not a one-off. The early bail-out when the slot is unchanged is the
  // primary mitigation (unit-tested as test-plan #P2).
  //
  // Scope: this gate sees DROPPED FRAMES under a real drag. It cannot see a
  // resolver that got algorithmically worse but still fits inside one refresh
  // interval — that complexity bound is pinned without timing by the
  // "one rect read per card" unit test in `openspec-board-drop.test.ts`.
  test("P1: a drag sweep over a 64-card column holds the frame budget", async ({ page }) => {
    const all = Array.from({ length: 63 }, (_, i) => card(i + 2));
    const ids = await setBoardLayout(page, [{ name: "E2E Perf", changes: all }], [A]);
    const col = ids.get("E2E Perf")!;
    await expect
      .poll(async () => columnBody(page, col).locator('[data-testid^="board-card-board-card-"]').count(), { timeout: 30_000 })
      .toBe(all.length);
    const box = await boxOf(columnBody(page, col));

    const move = await beginCardDrag(page, A);
    await move(await headerGrabPoint(page, col));
    await page.evaluate(() => {
      const probe = window as unknown as { __frames: number[]; __probing: boolean };
      probe.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        probe.__frames.push(now - last);
        last = now;
        if (probe.__probing) requestAnimationFrame(tick);
      };
      probe.__probing = true;
      requestAnimationFrame(tick);
    });

    // Sweep top→bottom repeatedly for ≥3s of sustained resolution.
    const deadline = Date.now() + 3200;
    while (Date.now() < deadline) {
      for (let i = 0; i <= 10; i++) {
        const y = box.y + 4 + ((box.height - 8) * i) / 10;
        await move({ x: box.x + box.width / 2, y }, 1);
      }
    }
    const frames: number[] = await page.evaluate(() => {
      const probe = window as unknown as { __frames: number[]; __probing: boolean };
      probe.__probing = false;
      return probe.__frames;
    });
    await page.mouse.up();

    // Drop the first frame (it spans the probe's own installation).
    const measured = frames.slice(1);
    expect(measured.length, "no frames captured").toBeGreaterThan(60);
    const worst = Math.max(...measured);
    const sorted = [...measured].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // The gate is sustained 60fps (test-plan C3), expressed as a STEADY-STATE
    // rate rather than a per-frame absolute, for two reasons:
    //   1. A rAF delta on a 60Hz display quantises to the refresh interval and
    //      lands at 16.6–16.9ms even when nothing is dropped, so a literal
    //      `> 16.7` predicate fires on rounding rather than on jank.
    //   2. This runs against a shared docker harness on a developer host, where
    //      an isolated 100ms+ stall is the OS scheduler, not the resolver.
    // A real regression degrades EVERY move, so it moves the whole
    // distribution. Median + p95 capture that while staying immune to a couple
    // of host stalls; a max-frame gate would only measure the host's worst
    // moment.
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(median, `median frame ${median.toFixed(1)}ms`).toBeLessThanOrEqual(17.5);
    expect(
      p95,
      `p95 frame ${p95.toFixed(1)}ms over ${measured.length} frames (median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms)`,
    ).toBeLessThanOrEqual(25);
  });
});

test.describe("board drop indication — responsive", () => {
  // #F19 — at ≤900px `index.css` sets `overflow-y: visible`, so column bodies
  // do not scroll internally and the columns wrap to rows.
  test("F19: tablet wrap still resolves a drop, with no console error", async ({ page }) => {
    // The harness serves no service worker, so its registration logs a MIME-type
    // error on every load. Pre-existing and unrelated to the board — ignored by
    // exact text so any OTHER console error still fails the spec.
    const IGNORED = /unsupported MIME type/;
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.setViewportSize({ width: 900, height: 1000 });
    await openBoard(page, 10);
    const ids = await setBoardLayout(page, [
      { name: "E2E Tablet", changes: [A, B] },
      { name: "E2E TabletSrc", changes: [X] },
      { name: "E2E TabletRest", changes: REST },
    ]);
    await filterBoard(page, "board-card-0");
    const col = ids.get("E2E Tablet")!;
    expect(await columnBody(page, col).evaluate((el) => getComputedStyle(el).overflowY)).toBe("visible");

    const move = await beginCardDrag(page, X);
    const mid = await midpointOf(cardEl(page, A));
    await move({ x: mid.x, y: mid.y + 6 });
    await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "1");
    await page.mouse.up();
    await expect
      .poll(async () => columnBody(page, col).locator('[data-testid^="board-card-board-card-"]').count(), { timeout: 15_000 })
      .toBe(3);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  // #F20 / #E15 — the rail's 44px floor is WCAG 2.5.8, and phone stacking is
  // where vertical space is scarcest.
  for (const width of [540, 375]) {
    test(`F20+E15: the rail is at least 44px tall at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openBoard(page, 10);
      const ids = await setBoardLayout(page, [
        { name: "E2E Phone", changes: [A, B] },
        { name: "E2E PhoneSrc", changes: [X] },
        { name: "E2E PhoneRest", changes: REST },
      ]);
      await filterBoard(page, "board-card-0");
      const col = ids.get("E2E Phone")!;

      const move = await beginCardDrag(page, X);
      await move(await headerGrabPoint(page, col));
      const box = await boxOf(rail(page, col));
      expect(box.height, `rail is ${box.height}px tall`).toBeGreaterThanOrEqual(44);

      // The drop still resolves at this width.
      const mid = await midpointOf(cardEl(page, A));
      await move({ x: mid.x, y: mid.y + 6 });
      await expect(columnBody(page, col)).toHaveAttribute("data-drop-slot", "1");
      await page.mouse.up();
      await expect
        .poll(async () => columnBody(page, col).locator('[data-testid^="board-card-board-card-"]').count(), { timeout: 15_000 })
        .toBe(3);
    });
  }
});
