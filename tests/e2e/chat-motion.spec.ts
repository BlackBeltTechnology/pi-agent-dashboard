import {
  CHAT_MOTION_GLIDE_TAIL,
  CHAT_MOTION_STREAM_TAIL,
} from "../../qa/fixtures/faux-scenarios.js";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, dismissToasts, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * L3 (docker harness) rows for change: add-fluid-chat-motion.
 *
 * jsdom has no CSS engine, no layout and no real frame clock, so everything that
 * makes the motion REAL lives here: the `@starting-style` entry/cue transitions
 * as computed opacity on the first rAF, the paced reveal against the real WS
 * cadence, the glide against real scroll attribution, selection freeze, the
 * idle-exemption bound and the reduced-motion / pref-off equivalence.
 *
 * Rows: F1 live entry · F2 paced reveal · F3 glide follow · F4/F5/F6 mid-glide
 * escapes (keyboard / wheel / foreign scroll) · F7 relocation mid-glide · F8
 * selection freeze · F9 trailing edge · F10 completion cue · F11 idle exemption
 * · F12 reduced motion · F13 pref off.
 *
 * Fixtures (qa/fixtures/faux-scenarios.ts): `chat-motion-stream` (≥ 4000 chars,
 * ~20 s), `chat-motion-glide` (overflowing prelude → ~3 s bash → closing text),
 * `tool-read`. Needs PI_E2E_SEED=1 (managed sets it).
 */

const STREAM = "[[faux:chat-motion-stream]] go";
const GLIDE = "[[faux:chat-motion-glide]] go";
const TOOL_READ = "[[faux:tool-read]] go";

const scroller = (page: Page) => byTestId(page, "chatScrollContainer");

async function openSession(page: Page, prompt: string): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await dismissToasts(page);
  await scroller(page).waitFor({ state: "visible", timeout: 30_000 });
  await sendPrompt(page, prompt);
}

/** Install in-page probes BEFORE the stream starts. Everything is timed on one clock. */
async function installProbes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const sc = () => document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]')!;
    const tail = () => document.querySelector(".chat-stream-live")?.firstElementChild?.textContent?.length ?? 0;
    const frames: { t: number; len: number; top: number; height: number; bottom: number }[] = [];
    const mounts: { sel: string; firstFrameOpacity: number; samples: { dt: number; o: number }[] }[] = [];
    w.__frames = frames;
    w.__mounts = mounts;
    w.__midGlide = false;
    // Per-frame sampler (tail length, scroll geometry).
    const tick = () => {
      const el = sc();
      if (el) {
        frames.push({
          t: performance.now(),
          len: tail(),
          top: el.scrollTop,
          height: el.scrollHeight,
          bottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // First-frame opacity of every newly mounted entry/cue element.
    const watch = '[data-testid="tool-burst-group"], [data-testid="tool-completion-cue"]';
    const record = (el: Element) => {
      const sel = el.getAttribute("data-testid") ?? "";
      const entry = { sel, firstFrameOpacity: -1, samples: [] as { dt: number; o: number }[] };
      mounts.push(entry);
      const t0 = performance.now();
      const loop = () => {
        const o = Number(getComputedStyle(el).opacity);
        if (entry.firstFrameOpacity < 0) entry.firstFrameOpacity = o;
        entry.samples.push({ dt: performance.now() - t0, o });
        if (performance.now() - t0 < 700 && el.isConnected) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches(watch)) record(n);
          for (const d of n.querySelectorAll(watch)) record(d);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    // Flag "a glide is in progress": a tool row appeared and scrollTop has started moving.
    new MutationObserver((records, obs) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches('[data-testid="tool-burst-group"]') || n.querySelector('[data-testid="tool-burst-group"]')) {
            const start = sc().scrollTop;
            const poll = () => {
              if (Math.abs(sc().scrollTop - start) > 3 && sc().scrollHeight - sc().scrollTop - sc().clientHeight > 4) {
                w.__midGlide = true;
              } else if (performance.now() - (w.__glideT0 as number) < 600) requestAnimationFrame(poll);
            };
            w.__glideT0 = performance.now();
            requestAnimationFrame(poll);
            obs.disconnect();
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    // WS text-update timestamps on the same clock.
    const stamps: number[] = [];
    w.__wsStamps = stamps;
    // Existing sockets are already open: hook their message events.
    for (const s of (w.__sockets as WebSocket[] | undefined) ?? []) {
      s.addEventListener("message", (e) => {
        if (typeof e.data === "string" && e.data.includes("message_update")) stamps.push(performance.now());
      });
    }
  });
}

/** Hook the app's already-open socket(s): wrap the constructor BEFORE app load. */
async function armSocketProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as { __sockets: WebSocket[]; WebSocket: typeof WebSocket };
    w.__sockets = [];
    const Wrapped = function (url: string, protocols?: string | string[]) {
      const socket = protocols === undefined ? new Real(url) : new Real(url, protocols);
      w.__sockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Real.prototype;
    Object.assign(Wrapped, Real);
    w.WebSocket = Wrapped;
  });
}

interface Frame {
  t: number;
  len: number;
  top: number;
  height: number;
  bottom: number;
}
const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.slice());
const mounts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mounts: { sel: string; firstFrameOpacity: number; samples: { dt: number; o: number }[] }[] }).__mounts.slice());
const stamps = (page: Page) => page.evaluate(() => (window as unknown as { __wsStamps: number[] }).__wsStamps.slice());

/**
 * Per WS-update interval: how many times the painted tail length CHANGED between
 * consecutive frames. Counting distinct lengths would be confounded by the frame
 * that still shows the previous update (render lags receipt by up to a frame), so
 * an UNPACED stream already reads "2 distinct lengths" per interval. Changes are
 * exact: unpaced ≈ 1 per update; paced ≈ one per frame (~3–6 per interval).
 */
function changesPerInterval(fr: Frame[], ws: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < ws.length; i += 1) {
    const [a, b] = [ws[i], ws[i + 1]];
    if (b - a > 200) continue; // a stall, not a burst interval
    let changes = 0;
    let seen = false;
    for (let k = 1; k < fr.length; k += 1) {
      if (fr[k].t < a || fr[k].t >= b) continue;
      seen = true;
      if (fr[k].len > 0 && fr[k].len !== fr[k - 1].len) changes += 1;
    }
    if (seen) out.push(changes);
  }
  return out;
}

// Sockets must be armed before the app loads, so every test arms first.
test.beforeEach(async ({ page }) => {
  await armSocketProbe(page);
});

test.describe("chat motion (real browser)", () => {
  test("F1: a live tool row enters via @starting-style; remounts never animate", async ({ page }) => {
    test.setTimeout(120_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await dismissToasts(page);
    await scroller(page).waitFor({ state: "visible", timeout: 30_000 });
    await installProbes(page);
    await sendPrompt(page, TOOL_READ);
    await expect.poll(async () => (await mounts(page)).filter((m) => m.sel === "tool-burst-group").length, { timeout: 60_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(900);
    const group = (await mounts(page)).find((m) => m.sel === "tool-burst-group")!;
    expect(group.firstFrameOpacity, "first rAF opacity").toBeLessThan(1);
    const settled = group.samples.find((s) => s.o === 1);
    expect(settled, "reached opacity 1").toBeTruthy();
    expect(settled!.dt, "within 300 ms").toBeLessThanOrEqual(300 + 40);
    // A remount (scroll away and back) reads opacity 1 on its first frame.
    const before = (await mounts(page)).length;
    await scroller(page).evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(150);
    await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(400);
    for (const m of (await mounts(page)).slice(before)) expect(m.firstFrameOpacity).toBe(1);
  });

  test("F2: the answer is revealed progressively between WS updates", async ({ page }) => {
    test.setTimeout(120_000);
    await openSession(page, STREAM);
    await installProbes(page);
    await expect.poll(async () => (await frames(page)).some((f) => f.len > 0), { timeout: 60_000 }).toBe(true);
    await page.waitForTimeout(2500);
    const per = changesPerInterval(await frames(page), await stamps(page));
    expect(per.length, "enough burst intervals observed").toBeGreaterThan(10);
    const progressive = per.filter((n) => n >= 2).length / per.length;
    expect(progressive, `≥2 length changes between WS updates in ≥80% of intervals (got ${(progressive * 100).toFixed(0)}%)`).toBeGreaterThanOrEqual(0.8);
    await expect(page.getByText(CHAT_MOTION_STREAM_TAIL).last()).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(".chat-stream-live")).toHaveCount(0);
  });

  test("F9: the trailing edge sits at the reveal point, then clears after the last arrival", async ({ page }) => {
    test.setTimeout(120_000);
    await openSession(page, STREAM);
    await installProbes(page);
    const edge = page.getByTestId("trailing-edge");
    await expect.poll(async () => (await frames(page)).some((f) => f.len > 150), { timeout: 60_000 }).toBe(true);
    await expect(edge).toHaveAttribute("data-edge", "visible", { timeout: 10_000 });
    expect(Number(await edge.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0);
    const inside = await edge.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const b = el.parentElement!.getBoundingClientRect();
      return r.right <= b.right + 1 && r.left >= b.left - 50 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    });
    expect(inside, "overlay is within the bubble at the reveal point").toBe(true);
    await expect(page.getByText(CHAT_MOTION_STREAM_TAIL).last()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(700);
    const gone = await page.getByTestId("trailing-edge").count();
    if (gone > 0) expect(Number(await edge.evaluate((el) => getComputedStyle(el).opacity))).toBe(0);
  });

  test("F8: a held selection freezes the tail; releasing catches it up", async ({ page }) => {
    test.setTimeout(120_000);
    await openSession(page, STREAM);
    await installProbes(page);
    await expect.poll(async () => (await frames(page)).some((f) => f.len > 400), { timeout: 60_000 }).toBe(true);
    // Drag-select 20 chars at the start of the tail's first paragraph.
    const box = await page.evaluate(() => {
      const p = document.querySelector(".chat-stream-live p")!;
      const t = p.firstChild as Text;
      const r = document.createRange();
      const mk = (o: number) => {
        r.setStart(t, o);
        r.setEnd(t, o + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top + b.height / 2 };
      };
      return { from: mk(0), to: mk(20) };
    });
    await page.mouse.move(box.from.x + 1, box.from.y);
    await page.mouse.down();
    await page.mouse.move(box.to.x, box.to.y, { steps: 6 });
    const held = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(held.length).toBeGreaterThanOrEqual(15);
    const lenAtHold = (await frames(page)).at(-1)!.len;
    await page.waitForTimeout(2000);
    const still = await page.evaluate(() => ({ text: window.getSelection()?.toString() ?? "", collapsed: window.getSelection()?.isCollapsed }));
    expect(still.collapsed).toBe(false);
    expect(still.text).toBe(held);
    const lenDuring = (await frames(page)).at(-1)!.len;
    expect(lenDuring, "tail frozen while selected").toBe(lenAtHold);
    await page.mouse.up();
    // Release: collapse the selection (a click elsewhere in the transcript).
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.evaluate(() => document.dispatchEvent(new Event("selectionchange")));
    await expect.poll(async () => (await frames(page)).at(-1)!.len, { timeout: 2000 }).toBeGreaterThan(lenAtHold + 150);
    await expect(page.getByText(CHAT_MOTION_STREAM_TAIL).last()).toBeVisible({ timeout: 90_000 });
  });

  test("F3: a tool row below the fold is followed by a glide, not a snap", async ({ page }) => {
    test.setTimeout(150_000);
    await openSession(page, GLIDE);
    await installProbes(page);
    await expect.poll(async () => (await mounts(page)).some((m) => m.sel === "tool-burst-group"), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(800);
    const fr = await frames(page);
    const mount = (await mounts(page)).find((m) => m.sel === "tool-burst-group")!;
    void mount;
    // Frames from the first growth after the tool row mounted.
    const t0 = fr.findIndex((f, i) => i > 0 && f.height > fr[i - 1].height && f.bottom > 4);
    const window_ = fr.slice(Math.max(t0, 0), Math.max(t0, 0) + 40);
    const tops = [...new Set(window_.map((f) => Math.round(f.top)))];
    const settledAt = window_.find((f) => f.bottom <= 1);
    expect(tops.length, "intermediate scrollTop values").toBeGreaterThanOrEqual(3);
    expect(settledAt, "reached the bottom").toBeTruthy();
    expect(settledAt!.t - window_[0].t, "within 500 ms").toBeLessThanOrEqual(500);
    await expect(byTestId(page, "scrollToBottom")).toHaveCount(0);
    // Follow is still on: the closing message is followed to the bottom.
    await expect(page.getByText(CHAT_MOTION_GLIDE_TAIL).last()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await frames(page)).at(-1)!.bottom, { timeout: 3000 }).toBeLessThanOrEqual(2);
  });

  for (const [id, label, act] of [
    ["F4", "Page Up with focus in the transcript", async (page: Page) => page.keyboard.press("PageUp")],
    ["F5", "a wheel-up", async (page: Page) => page.mouse.wheel(0, -400)],
    [
      "F6",
      "a foreign scroll write (scrollbar-drag / find-in-page analogue)",
      async (page: Page) => scroller(page).evaluate((el) => { el.scrollTop -= 300; }),
    ],
  ] as const) {
    test(`${id}: ${label} mid-glide releases follow with no pull-back`, async ({ page }) => {
      test.setTimeout(150_000);
      await openSession(page, GLIDE);
      await installProbes(page);
      // Focus lives in the transcript (so Page Up scrolls it) before the glide starts.
      await scroller(page).click({ position: { x: 4, y: 4 } });
      await page.waitForFunction(() => (window as unknown as { __midGlide: boolean }).__midGlide, undefined, { timeout: 90_000, polling: 8 });
      await act(page);
      await expect(byTestId(page, "scrollToBottom")).toBeVisible({ timeout: 3000 });
      const topAfter = (await frames(page)).at(-1)!.top;
      // 2 s of further streaming (the tool ends, the closing message arrives): no pull-back.
      await page.waitForTimeout(2000);
      const all = await frames(page);
      const later = all.filter((f) => f.t > all.at(-1)!.t - 2000);
      for (const f of later) expect(f.top, "never increases toward the bottom").toBeLessThanOrEqual(topAfter + 1.5);
      await expect(byTestId(page, "scrollToBottom")).toBeVisible();
    });
  }

  test("F7: a relocation mid-glide lands instantly and nothing keeps moving it", async ({ page }) => {
    test.setTimeout(150_000);
    await openSession(page, GLIDE);
    await installProbes(page);
    await page.waitForFunction(() => (window as unknown as { __midGlide: boolean }).__midGlide, undefined, { timeout: 90_000, polling: 8 });
    await byTestId(page, "scrollToTop").click(); // a relocation writer (jump to the top)
    await page.waitForTimeout(250);
    const base = await scroller(page).evaluate((el) => el.scrollTop);
    expect(base).toBeLessThan(40);
    const after = await frames(page);
    const tail = after.slice(-10);
    for (const f of tail) expect(f.top, "no scrollTop change on the next 10 frames").toBeLessThanOrEqual(base + 2);
  });

  test("F10: the completion cue pops in on a live flip, and never on a remount", async ({ page }) => {
    test.setTimeout(150_000);
    await openSession(page, GLIDE);
    await installProbes(page);
    await expect.poll(async () => (await mounts(page)).some((m) => m.sel === "tool-completion-cue"), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(700);
    const cue = (await mounts(page)).find((m) => m.sel === "tool-completion-cue")!;
    expect(cue.firstFrameOpacity, "first-frame opacity").toBeLessThan(1);
    const settled = cue.samples.find((s) => s.o === 1);
    expect(settled && settled.dt <= 300 + 40).toBe(true);
    // Scroll away and back: the icon reads opacity 1 on its first frame (no cue).
    const before = (await mounts(page)).length;
    await scroller(page).evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(150);
    await scroller(page).evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(400);
    expect((await mounts(page)).slice(before).filter((m) => m.sel === "tool-completion-cue")).toHaveLength(0);
    await expect(page.getByText(CHAT_MOTION_GLIDE_TAIL).last()).toBeVisible({ timeout: 60_000 });
  });

  test("F11: arrival motion runs while the UI is idle and schedules nothing after the last arrival", async ({ page }) => {
    test.setTimeout(150_000);
    await openSession(page, GLIDE);
    await installProbes(page);
    // No input from here on: the 5 s idle mark applies mid-stream.
    await expect(page.locator("html")).toHaveClass(/fx-idle/, { timeout: 30_000 });
    await expect.poll(async () => (await mounts(page)).some((m) => m.sel === "tool-burst-group"), { timeout: 90_000 }).toBe(true);
    await page.waitForTimeout(800);
    const row = (await mounts(page)).find((m) => m.sel === "tool-burst-group")!;
    expect(row.samples.at(-1)!.o, "arrived row is fully visible while idle").toBe(1);
    await expect(page.getByText(CHAT_MOTION_GLIDE_TAIL).last()).toBeVisible({ timeout: 60_000 });
    const busy = () => scroller(page).evaluate((el) => el.hasAttribute("data-chat-motion-busy"));
    await expect.poll(busy, { timeout: 1500 }).toBe(false);
    for (let i = 0; i < 10; i += 1) {
      await page.waitForTimeout(500);
      expect(await busy(), "stays absent for the next 5 s").toBe(false);
    }
  });
});

/** The observables shared by F12 (reduced motion) and F13 (pref off): motion behaves exactly as before. */
async function assertMotionAbsent(page: Page): Promise<void> {
  await installProbes(page);
  await sendPrompt(page, GLIDE);
  await expect.poll(async () => (await mounts(page)).some((m) => m.sel === "tool-burst-group"), { timeout: 90_000 }).toBe(true);
  await expect(page.getByText(CHAT_MOTION_GLIDE_TAIL).last()).toBeVisible({ timeout: 90_000 });
  const fr = await frames(page);
  const ws = await stamps(page);
  const row = (await mounts(page)).find((m) => m.sel === "tool-burst-group")!;
  expect(row.firstFrameOpacity, "row opacity 1 on its first frame").toBe(1);
  // Unpaced: the painted tail length changes at most once per WS update interval.
  const per = changesPerInterval(fr, ws);
  const stepped = per.filter((n) => n <= 1).length / Math.max(per.length, 1);
  expect(stepped, "no intermediate reveal between WS updates").toBeGreaterThanOrEqual(0.85);
  // No glide: when the page grows while following, it is at the bottom in the SAME frame.
  for (let i = 1; i < fr.length; i += 1) {
    if (fr[i].height > fr[i - 1].height && fr[i - 1].bottom <= 2) expect(fr[i].bottom, `frame ${i}`).toBeLessThanOrEqual(2);
  }
  expect(await scroller(page).evaluate((el) => el.hasAttribute("data-chat-motion-busy"))).toBe(false);
}

test.describe("chat motion disabled equals today", () => {
  test("F12: OS reduced motion", async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const card = await spawnFreshGitSession(page);
    await card.click();
    await dismissToasts(page);
    await scroller(page).waitFor({ state: "visible", timeout: 30_000 });
    await assertMotionAbsent(page);
  });

  test("F13: chatMotion off via the View popover", async ({ page }) => {
    test.setTimeout(150_000);
    const card = await spawnFreshGitSession(page);
    await card.click();
    await dismissToasts(page);
    await scroller(page).waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTitle("View options").click();
    // The override round-trips through the server before the checkbox reflects it.
    await page.getByLabel("Fluid chat motion").click();
    await expect(page.getByLabel("Fluid chat motion")).not.toBeChecked({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await assertMotionAbsent(page);
  });
});
