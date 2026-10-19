/**
 * L3 — the session actions menu against the real harness (change:
 * add-session-actions-flyout; test-plan F1, F13, F14, F21, P2).
 *
 * Why L3: stacking order against a neighbouring card's `isolate` context, the
 * sidebar's scroll tracking, real `contextmenu` / Shift+F10 delivery, whether an
 * open menu steals selection, a claim-owned flows dialog surviving the menu
 * closing, and a latency percentile are properties of the REAL DOM that jsdom
 * cannot express. The deriver, focus model, folding, hover intent and plugin
 * hosting are L1 (`session-menu-items.test.ts`, `SessionActionsMenu.test.tsx`,
 * `session-hover-intent.test.ts`, `SessionCard.actions-menu.test.tsx`).
 *
 * Seeding: the many-card rows (F13, F14, P2) plant ENDED transcripts out-of-band
 * with `docker exec` (the `ended-session-endedat.spec.ts` technique — a REAL
 * `<stamp>_<uuid>.jsonl` the boot scanner turns into an ended card), restart the
 * daemon once, and remove them again in `afterAll`. A live pi per card would
 * not fit the harness's memory cap.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { buttonBoxes, resolveColor } from "./helpers/computed-contrast.js";
import { byTestId, ensureGitSession, expandFolder, FIXTURE_GIT, gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";
import {
  chooseMenuItem,
  closeSessionMenu,
  expandMore,
  flowMenuItem,
  openSessionMenu,
  sessionMenuItem,
  sessionMenuPanel,
  sessionMenuTrigger,
} from "./helpers/session-actions-menu.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";


// ── Edge trigger (change: move-session-actions-trigger-to-card-edge) ─────────────────────────
// The trigger is a centred pill on the card's right edge (R = the card's border-box right
// edge): the button spans [R−7, R+6] × 26 px and its `::before` hit box [R−18, R+6]. jsdom has no
// layout, so the geometry (centring, clearance, overlap, clipping, stacking) is asserted here.

interface EdgeGeometry {
  R: number;
  cy: number;
  card: { x: number; y: number; w: number; h: number };
  pill: { x: number; y: number; w: number; h: number };
}

async function edgeGeometry(card: Locator): Promise<EdgeGeometry> {
  const c = (await card.boundingBox())!;
  const t = (await sessionMenuTrigger(card).boundingBox())!;
  return {
    R: c.x + c.width,
    cy: c.y + c.height / 2,
    card: { x: c.x, y: c.y, w: c.width, h: c.height },
    pill: { x: t.x, y: t.y, w: t.width, h: t.height },
  };
}

/** The card's right border-box edge and the trigger's rects, read in ONE coordinate space (zoom-safe). */
async function edgeRects(card: Locator) {
  return card.evaluate((li) => {
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const trigger = li.querySelector("[data-testid^='session-actions-trigger-']") as HTMLElement;
    // Nearest ancestor drawing a right border = the folder enclosure.
    let border: { left: number } | null = null;
    for (let el = li.parentElement; el && !border; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (Number.parseFloat(cs.borderRightWidth) > 0 && cs.borderRightStyle !== "none") {
        border = { left: el.getBoundingClientRect().right - Number.parseFloat(cs.borderRightWidth) };
      }
    }
    // Nearest clipping ancestor on the x axis.
    let clipRight = Number.POSITIVE_INFINITY;
    for (let el = li.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowX !== "visible") {
        clipRight = Math.min(clipRight, el.getBoundingClientRect().right - (el.offsetWidth - el.clientWidth));
        break;
      }
    }
    return { card: r(li), pill: r(trigger), folderBorder: border, clipRight };
  });
}

/** The trigger's hit rect (`::before` width × button height) must overlap no other control or descendant box. */
const hitRectOverlaps = (card: Locator) =>
  card.evaluate((li) => {
    const trigger = li.querySelector("[data-testid^='session-actions-trigger-']") as HTMLElement;
    const t = trigger.getBoundingClientRect();
    const width = Number.parseFloat(getComputedStyle(trigger, "::before").width);
    const hit = { left: t.right - width, right: t.right, top: t.top, bottom: t.bottom };
    const isControl = (el: Element) => el.matches("button, a, [role=button]");
    const bad = Array.from(li.querySelectorAll("*"))
      .filter((el) => !trigger.parentElement?.contains(el) && (isControl(el) || getComputedStyle(el).position !== "absolute"))
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.left < hit.right && b.right > hit.left && b.top < hit.bottom && b.bottom > hit.top;
      })
      .map((el) => el.getAttribute("data-testid") ?? el.tagName);
    return { width, height: t.height, bad };
  });

async function expectNoHitOverlap(cards: Locator[], label: string): Promise<void> {
  for (const card of cards) {
    await card.scrollIntoViewIfNeeded();
    const o = await hitRectOverlaps(card);
    expect(o.width, `${label}: hit width`).toBeGreaterThanOrEqual(24);
    expect(o.height, `${label}: hit height`).toBeGreaterThanOrEqual(24);
    expect(o.bad, `${label}: controls inside the hit rect`).toEqual([]);
  }
}

async function setZoom(page: Page, z: string): Promise<void> {
  await page.evaluate((v) => {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = v;
  }, z);
}

/** Every desktop card currently on screen (seeded ended cards + any live session). */
function allCards(page: Page): Locator {
  return page.locator("[data-testid='session-card-desktop']");
}

async function tabTo(page: Page, target: Locator, from: Locator): Promise<void> {
  await from.focus();
  for (let i = 0; i < 40; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("could not Tab to the trigger");
}

const SEED_PREFIX = "e2e-sam";
const SEED_COUNT = 50;
const HOUR = 60 * 60 * 1000;

let containerId: string | undefined;
function inContainer(script: string): string {
  if (!containerId) {
    const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .trim()
      .split("\n")[0];
    if (!id) throw new Error("no running harness container");
    containerId = id;
  }
  return execFileSync("docker", ["exec", containerId, "sh", "-c", script], { encoding: "utf8", timeout: 120_000 }).trim();
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
const SESSIONS_DIR = `$HOME/.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;

const plantedIds: string[] = [];

/** Plant `n` ended transcripts (scanner-visible filename shape) in one `docker exec`. */
function plantEnded(n: number): void {
  plantedIds.length = 0;
  const lines: string[] = [`mkdir -p ${SESSIONS_DIR}`];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const id = crypto.randomUUID();
    plantedIds.push(id);
    const started = now - (i + 2) * HOUR;
    const stamp = new Date(started).toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const header = JSON.stringify({ type: "session", id, cwd: FIXTURE_GIT, timestamp: new Date(started).toISOString() });
    const name = `${SEED_PREFIX}-${String(i).padStart(2, "0")}`;
    const msg = JSON.stringify({ type: "session_info", name });
    lines.push(
      `printf '%s\\n%s\\n' '${header}' '${msg}' > ${SESSIONS_DIR}/${stamp}_${id}.jsonl`,
      `touch -d @${Math.floor(started / 1000)} ${SESSIONS_DIR}/${stamp}_${id}.jsonl`,
    );
  }
  inContainer(lines.join(" && "));
}

function removePlanted(): void {
  inContainer(`grep -l '${SEED_PREFIX}-' ${SESSIONS_DIR}/*.jsonl 2>/dev/null | xargs -r rm -f`);
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    const ok = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after restart");
}

/** Detach the shared session's attachment through the menu, when it has one. */
async function detachIfAttached(page: Page): Promise<void> {
  await openSessionMenu(page);
  await expandMore(page, "openspec");
  const detach = sessionMenuItem(page, "openspec-detach");
  if (await detach.isVisible().catch(() => false)) await detach.click();
  else await closeSessionMenu(page);
}

/** A card pinned by id: `nth()` over a growing list re-resolves to a different card as ended pages load. */
async function stableCard(page: Page, index: number): Promise<Locator> {
  const id = await seededCards(page).nth(index).getAttribute("data-session-id");
  return page.locator(`[data-testid='session-card-desktop'][data-session-id="${id}"]`);
}

/** Cards of the seeded ended sessions, in DOM order. */
function seededCards(page: Page): Locator {
  return page.locator(plantedIds.map((id) => `[data-testid='session-card-desktop'][data-session-id="${id}"]`).join(","));
}

/**
 * Scroll the sidebar until `card` sits ~150 px from the top of the viewport. The list keeps
 * re-laying out while ended pages load, so converge over a few passes instead of trusting
 * one measurement. A tall menu clamps to the viewport bottom for a card low on screen,
 * which would mask the placement behaviour under test.
 */
async function parkCardHigh(page: Page, card: Locator): Promise<void> {
  const scroller = page.getByTestId("session-list-scroll");
  let stable = 0;
  for (let i = 0; i < 30 && stable < 3; i++) {
    const y = (await card.boundingBox())!.y;
    if (Math.abs(y - 150) <= 3) {
      stable++;
    } else {
      // The list may scroll itself back (e.g. reveal-selected after a page of ended cards loads): re-park.
      stable = 0;
      await scroller.evaluate((el, d) => {
        el.scrollTop += d;
      }, y - 150);
    }
    await page.waitForTimeout(250);
  }
}

async function revealSeeded(page: Page): Promise<void> {
  await gotoDashboard(page);
  await expandFolder(page, FIXTURE_GIT);
  const toggle = page.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`);
  await toggle.waitFor({ state: "visible", timeout: 60_000 });
  if ((await seededCards(page).count()) === 0) await toggle.click();
  await expect.poll(() => seededCards(page).count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(6);
}

test.describe("session actions menu (L3)", () => {
  test.setTimeout(180_000);

  test("F1: trigger, right-click and Shift+F10 open the same menu; the card is not selected", async ({ page }) => {
    await ensureGitSession(page);
    await gotoDashboard(page); // nothing selected
    const card = byTestId(page, "sessionCardDesktop").first();
    await expect(card).toBeVisible();
    const url = page.url();
    const idsOf = async () =>
      sessionMenuPanel(page).locator("[data-item-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));

    // trigger
    const trigger = sessionMenuTrigger(card);
    await trigger.click();
    await expect(sessionMenuPanel(page)).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const viaTrigger = await idsOf();
    expect(viaTrigger.length).toBeGreaterThan(0);
    await closeSessionMenu(page);

    // right-click at a point on the card body
    const box = (await card.boundingBox())!;
    const px = box.x + 30;
    const py = box.y + box.height - 8;
    await page.mouse.click(px, py, { button: "right" });
    await expect(sessionMenuPanel(page)).toBeVisible();
    const panelBox = (await sessionMenuPanel(page).boundingBox())!;
    // The panel's top-left sits at the pointer, clamped to stay inside the viewport.
    const vp = page.viewportSize()!;
    const expectedX = Math.min(px, vp.width - 8 - panelBox.width);
    const expectedY = Math.min(py, vp.height - 8 - panelBox.height);
    expect(Math.abs(panelBox.x - expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(panelBox.y - expectedY)).toBeLessThanOrEqual(2);
    expect(await idsOf()).toEqual(viaTrigger);
    await closeSessionMenu(page);

    // Shift+F10 with focus on the Archive button
    const archive = card.getByTestId("session-archive-btn");
    await archive.focus();
    await page.keyboard.press("Shift+F10");
    await expect(sessionMenuPanel(page)).toBeVisible();
    expect(await idsOf()).toEqual(viaTrigger);
    await page.keyboard.press("Escape");
    await expect(archive).toBeFocused();

    expect(page.url()).toBe(url); // opening never selected / navigated
  });

  test.describe("many cards (seeded ended sessions)", () => {
    test.beforeAll(async () => {
      removePlanted();
      plantEnded(SEED_COUNT);
      await restartDashboard();
    });
    test.afterAll(async () => {
      removePlanted();
      await restartDashboard();
    });

    test("F13: anchored and right-click menus track a 60 px sidebar scroll; scrolling inside the menu does not move them", async ({ page }) => {
      await revealSeeded(page);
      // The card lifts 2 px on hover (`hover:-translate-y-0.5`) and un-lifts when the
      // scroll moves it from under the pointer; neutralise that cosmetic transform so the
      // assertion isolates the MENU's tracking (Δtop = Δcard.top ± 1 px).
      await page.addStyleTag({ content: "[data-session-card]{transform:none !important;transition:none !important}" });
      const card = await stableCard(page, 2);
      await card.scrollIntoViewIfNeeded();
      const scroller = page.getByTestId("session-list-scroll");
      await parkCardHigh(page, card);
      const top = async (el: Locator) => (await el.boundingBox())!.y;
      // The sidebar can still be re-laying out after a restart / fold expansion; measure only
      // once the card has stopped moving (three equal reads, 150 ms apart).
      const settle = async () => {
        let same = 0;
        let last = Number.NaN;
        await expect
          .poll(
            async () => {
              const y = await top(card);
              same = y === last ? same + 1 : 0;
              last = y;
              return same >= 3;
            },
            { timeout: 15_000, intervals: [150] },
          )
          .toBe(true);
      };
      const alignedAfterScroll = async (open: () => Promise<void>, expectAtCard: boolean) => {
        await settle();
        await open();
        const panel = sessionMenuPanel(page);
        await expect(panel).toBeVisible();
        // Settle: the open click may itself scroll the card into view.
        let last = Number.NaN;
        await expect
          .poll(async () => {
            const offset = (await top(panel)) - (await top(card));
            const stable = offset === last;
            last = offset;
            return stable;
          })
          .toBe(true);
        // Anchored (trigger) menus top-align with the card.
        if (expectAtCard) expect(Math.abs((await top(panel)) - (await top(card)))).toBeLessThanOrEqual(1);
        const offset0 = (await top(panel)) - (await top(card));
        await scroller.evaluate((el) => {
          el.scrollTop += 60;
        });
        await page.waitForTimeout(150);
        expect(Math.abs((await top(panel)) - (await top(card)) - offset0), "menu stays aligned to its card").toBeLessThanOrEqual(1);
        // scrolling INSIDE the menu does not reposition it
        const gap = async () => (await top(panel)) - (await top(card));
        const before = await gap();
        await panel.evaluate((el) => {
          el.scrollTop += 40;
        });
        await page.waitForTimeout(150);
        expect(Math.abs((await gap()) - before), "scrolling inside the menu leaves its offset to the card unchanged").toBeLessThanOrEqual(1);
        await closeSessionMenu(page);
        await scroller.evaluate((el) => {
          el.scrollTop -= 60;
        });
      };
      await alignedAfterScroll(async () => {
        await sessionMenuTrigger(card).click();
      }, true);
      await alignedAfterScroll(async () => {
        // Right-click near the card's top so the pointer-anchored menu is not viewport-clamped
        // (a clamped menu legitimately moves less than the card).
        const box = (await card.boundingBox())!;
        await page.mouse.click(box.x + 30, box.y + 10, { button: "right" });
      }, false);
    });

    // ── Edge trigger geometry (move-session-actions-trigger-to-card-edge) ───────────────────

    /** Cards worth measuring: a seeded (minimal ended) card plus a live session card when present. */
    async function shapes(page: Page): Promise<Locator[]> {
      await revealSeeded(page);
      await page.addStyleTag({ content: "[data-session-card]{transition:none !important}" });
      const seeded = await stableCard(page, 1);
      await seeded.scrollIntoViewIfNeeded();
      const out = [seeded];
      const live = allCards(page).filter({ hasNot: page.locator(plantedIds.map((id) => `[data-session-id="${id}"]`).join(",")) }).first();
      if (await live.isVisible().catch(() => false)) out.push(live);
      return out;
    }

    test("E7: the pill is vertically centred on the card (±1 px) and straddles the right edge", async ({ page }) => {
      await ensureGitSession(page);
      for (const card of await shapes(page)) {
        await card.scrollIntoViewIfNeeded();
        const g = await edgeGeometry(card);
        expect(Math.abs(g.pill.y + g.pill.h / 2 - g.cy), `centre offset on a ${Math.round(g.card.h)} px card`).toBeLessThanOrEqual(1);
        expect(g.pill.x).toBeLessThan(g.R);
        expect(g.pill.x + g.pill.w).toBeGreaterThan(g.R);
      }
    });

    test("E8/E10: at 90/100/125% zoom the pill clears the folder border by ≥1 px and its focus ring is not clipped", async ({ page }) => {
      const [card] = await shapes(page);
      for (const zoom of [0.9, 1, 1.25]) {
        await page.evaluate((z) => {
          (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
        }, zoom);
        await card.scrollIntoViewIfNeeded();
        await sessionMenuTrigger(card).focus();
        const m = await edgeRects(card);
        if (m.folderBorder) expect(m.pill.right, `zoom ${zoom}: pill right vs folder border`).toBeLessThanOrEqual(m.folderBorder.left - 1 + 0.01);
        // outline = 2 px width + 2 px offset around the 13 px pill
        const ringRight = m.pill.right + 4 * zoom;
        expect(ringRight, `zoom ${zoom}: focus ring right vs clip edge`).toBeLessThan(m.clipRight);
      }
      await page.evaluate(() => {
        (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = "";
      });
    });

    test("E9: the list scroller never scrolls sideways with the trigger focused, and keeps the pill inside its right clearance", async ({ page }) => {
      const [card] = await shapes(page);
      await sessionMenuTrigger(card).focus();
      const scroller = page.getByTestId("session-list-scroll");
      const dims = await scroller.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
      expect(dims.sw).toBe(dims.cw);
      const m = await edgeRects(card);
      expect(m.pill.right + 4).toBeLessThanOrEqual(dims.right);
    });

    test("E11: the hit area is real: ::before has content and the point R−10 resolves to the trigger", async ({ page }) => {
      const [card] = await shapes(page);
      const trigger = sessionMenuTrigger(card);
      expect(await trigger.evaluate((el) => getComputedStyle(el, "::before").content)).not.toBe("none");
      const g = await edgeGeometry(card);
      const hit = await page.evaluate(
        ([x, y]) => (document.elementFromPoint(x, y)?.closest("[data-testid^='session-actions-trigger-']") as HTMLElement | null)?.dataset.testid ?? null,
        [g.R - 10, g.cy],
      );
      expect(hit).toBe(await trigger.getAttribute("data-testid"));
    });

    test("E12/E13: the 24×26 hit rect overlaps no other control, at 100% and 125% zoom and at the 180 px minimum sidebar", async ({ page }) => {
      await ensureGitSession(page);
      const cards = await shapes(page);
      await expectNoHitOverlap(cards, "100%");
      await setZoom(page, "1.25");
      await expectNoHitOverlap(cards, "125%");
      await setZoom(page, "");
      // Minimum sidebar width: drag the splitter to x = 180.
      const hb = (await page.getByTestId("drag-handle").boundingBox())!;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + 200);
      await page.mouse.down();
      await page.mouse.move(180, hb.y + 200, { steps: 8 });
      await page.mouse.up();
      await expectNoHitOverlap(cards, "180px sidebar");
    });

    test("E14: a click anywhere in the hit area opens the menu and never selects the card", async ({ page }) => {
      const [card] = await shapes(page);
      const url = page.url();
      const g = await edgeGeometry(card);
      for (const dx of [3, 15]) {
        await page.mouse.click(g.R - dx, g.cy);
        await expect(sessionMenuPanel(page)).toBeVisible();
        await closeSessionMenu(page);
        await page.mouse.move(2, 2); // leave the card so the hover lift does not move the target
      }
      expect(page.url()).toBe(url);
    });

    test("E15: selecting a card does not change its height and the wrapper stays absolutely positioned", async ({ page }) => {
      const [card] = await shapes(page);
      const before = (await card.boundingBox())!.height;
      await card.click({ position: { x: 20, y: 6 } });
      await expect(card).toHaveClass(/card-selected-ring/);
      const after = (await card.boundingBox())!.height;
      expect(Math.abs(after - before)).toBeLessThanOrEqual(0.5);
      const pos = await sessionMenuTrigger(card).evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).position);
      expect(pos).toBe("absolute");
    });

    test("E16: the trigger comes after ✕ in Tab order and Enter opens the menu on its first enabled item", async ({ page }) => {
      await ensureGitSession(page);
      const card = allCards(page).filter({ has: page.getByTestId("session-close-btn") }).first();
      await card.scrollIntoViewIfNeeded();
      const trigger = sessionMenuTrigger(card);
      const close = card.getByTestId("session-close-btn");
      await tabTo(page, trigger, close);
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(sessionMenuPanel(page)).toBeVisible();
      await expect(sessionMenuPanel(page).locator("[role='menuitem']:not([aria-disabled='true'])").first()).toBeFocused();
      await closeSessionMenu(page);
    });

    test("F6/F7: dots are --text-tertiary at rest (opacity 1) and --text-secondary on hover, focus and when open", async ({ page }) => {
      const [card] = await shapes(page);
      const trigger = sessionMenuTrigger(card);
      const rgb = async (token: string) => (await resolveColor(page, `var(${token})`)).join(",");
      const colour = async () => (await trigger.evaluate((el) => getComputedStyle(el).color)).match(/\d+/g)!.slice(0, 3).join(",");
      await page.mouse.move(2, 2);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      expect(await colour()).toBe(await rgb("--text-tertiary"));
      expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      const g = await edgeGeometry(card);
      await page.mouse.move(g.card.x + 40, g.card.y + 4);
      expect(await colour()).toBe(await rgb("--text-secondary"));
      await page.mouse.move(2, 2);
      await trigger.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      expect(await colour()).toBe(await rgb("--text-secondary"));
      await page.keyboard.press("Enter"); // open: aria-expanded variant (proves Tailwind generated it)
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await page.mouse.move(2, 2);
      expect(await colour()).toBe(await rgb("--text-secondary"));
      await closeSessionMenu(page);
    });

    test("F2/F5: a click pins a hover-opened menu across a pointer leave; a dwell in the strip off the pill still opens", async ({ page }) => {
      const [card] = await shapes(page);
      const g = await edgeGeometry(card);
      // F5: rest off the pill, inside the 32 px strip.
      await page.mouse.move(g.R - 20, g.card.y + 12);
      await page.mouse.move(g.R - 20, g.card.y + 12.4);
      await expect(sessionMenuPanel(page)).toBeVisible({ timeout: 3_000 });
      // F2: click the pill (pins), leave for 600 ms, the menu is still open.
      await sessionMenuTrigger(card).click();
      await expect(sessionMenuTrigger(card)).toHaveAttribute("aria-expanded", "true");
      await page.mouse.move(g.R + 400, g.cy, { steps: 6 });
      await page.waitForTimeout(600);
      await expect(sessionMenuPanel(page)).toBeVisible();
      await expect(sessionMenuTrigger(card)).toHaveAttribute("aria-expanded", "true");
      await sessionMenuTrigger(card).click();
      await expect(sessionMenuPanel(page)).toHaveCount(0);
      await expect(sessionMenuTrigger(card)).toHaveAttribute("aria-expanded", "false");
    });

    test("F9: right-click on the pill opens the session menu at the pointer (native menu suppressed)", async ({ page }) => {
      const [card] = await shapes(page);
      const g = await edgeGeometry(card);
      await page.mouse.click(g.pill.x + g.pill.w / 2, g.cy, { button: "right" });
      await expect(sessionMenuPanel(page)).toBeVisible();
      await expect(sessionMenuTrigger(card)).toHaveAttribute("aria-expanded", "true");
      await closeSessionMenu(page);
    });

    test("X1: a slow panel chunk still flips aria-expanded at once and renders the panel when it lands", async ({ page }) => {
      await page.route("**/*SessionActionsPanel*.js", async (route) => {
        await new Promise((r) => setTimeout(r, 1_500));
        await route.continue();
      });
      const [card] = await shapes(page);
      const trigger = sessionMenuTrigger(card);
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(sessionMenuPanel(page)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/failed to load/i)).toHaveCount(0);
      await closeSessionMenu(page);
      // second run: an early second click closes with no orphan portal
      await trigger.click();
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await page.waitForTimeout(2_000);
      await expect(page.locator("[data-testid^='session-actions-menu-']")).toHaveCount(0);
    });

    test("F14: the menu paints above a neighbouring card, and below a dialog opened over it", async ({ page }) => {
      await revealSeeded(page);
      const first = await stableCard(page, 1);
      const second = first.locator("xpath=following::*[@data-testid='session-card-desktop'][1]");
      await first.scrollIntoViewIfNeeded();
      await parkCardHigh(page, first);
      const fb = (await first.boundingBox())!;
      // Right-click near the card's left edge so the pointer-anchored menu lands over the cards below.
      await page.mouse.click(fb.x + 24, fb.y + fb.height - 6, { button: "right" });
      const panel = sessionMenuPanel(page);
      await expect(panel).toBeVisible();
      const pb = (await panel.boundingBox())!;
      const sb = (await second.boundingBox())!;
      // an overlap point between the menu and the neighbour below
      const ox = Math.max(pb.x, sb.x) + 8;
      const oy = Math.max(pb.y, sb.y) + 8;
      expect(ox < Math.min(pb.x + pb.width, sb.x + sb.width) && oy < Math.min(pb.y + pb.height, sb.y + sb.height), "menu overlaps the neighbour").toBe(true);
      const inMenu = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !!el?.closest("[role='menu']");
      }, [ox, oy]);
      expect(inMenu, "overlap point resolves inside the menu").toBe(true);

      // Open a modal over the open menu WITHOUT a mousedown (which would dismiss the menu).
      await page.getByTestId(`folder-spawn-worktree-btn`).first().evaluate((el) => (el as HTMLElement).click());
      const dialog = page.getByRole("dialog").first();
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const cx = pb.x + pb.width / 2;
      const cy = pb.y + Math.min(pb.height, 200) / 2;
      // The point sits on the dialog's layer (its backdrop or panel, both under `.z-dialog`),
      // never on the menu that was open underneath.
      const owner = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { inMenu: !!el?.closest("[role='menu']"), inDialogLayer: !!el?.closest(".z-dialog") };
      }, [cx, cy]);
      expect(owner, "with a dialog open, the menu centre resolves to the dialog layer").toEqual({ inMenu: false, inDialogLayer: true });
    });

    test("P2: the menu is visible within 100 ms of a trigger click (p95 over 20 opens, 50 cards)", async ({ page }) => {
      await revealSeeded(page);
      expect(await page.locator("[data-testid='session-card-desktop']").count()).toBeGreaterThanOrEqual(SEED_COUNT);
      const card = await stableCard(page, 3);
      await card.scrollIntoViewIfNeeded();
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const ms = await page.evaluate(
          (sel) =>
            new Promise<number>((resolve) => {
              const trigger = document.querySelector(sel) as HTMLElement;
              const t0 = performance.now();
              const obs = new MutationObserver(() => {
                const panel = document.querySelector("[data-testid^='session-actions-menu-']") as HTMLElement | null;
                if (panel && panel.style.visibility === "visible") {
                  obs.disconnect();
                  resolve(performance.now() - t0);
                }
              });
              obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
              trigger.click();
            }),
          `[data-session-id="${await card.getAttribute("data-session-id")}"] [data-testid^="session-actions-trigger-"]`,
        );
        samples.push(ms);
        await closeSessionMenu(page);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
      expect(p95, `open latency samples: ${samples.map((s) => s.toFixed(0)).join(",")}`).toBeLessThanOrEqual(100);
    });
  });

  test("F24: a ui:popover paints at the popover token (40) and a dialog opened over it wins the overlap", async ({ page }) => {
    const card = await ensureGitSession(page);
    await card.click({ position: { x: 6, y: 6 } });
    // Attach a fixture change so the composer's change chip (a client-utils Popover) exists.
    await detachIfAttached(page);
    await chooseMenuItem(page, "openspec-attach", { card });
    await page.getByText("e2e-artifact-demo", { exact: false }).first().click();
    const chip = page.getByTestId("composer-change-chip");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.click();
    const popover = page.getByTestId("ui-popover");
    await expect(popover).toBeVisible();
    expect(await popover.evaluate((el) => getComputedStyle(el).zIndex)).toBe("40");

    // Open a modal over it WITHOUT a mousedown (which would dismiss the popover).
    await page.getByTestId("folder-spawn-worktree-btn").first().evaluate((el) => (el as HTMLElement).click());
    // The popover itself carries role="dialog": wait for the MODAL one.
    await expect(page.locator("[role='dialog'][aria-modal='true']").first()).toBeVisible({ timeout: 15_000 });
    const pb = (await popover.boundingBox())!;
    const owner = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { inPopover: !!el?.closest("[data-testid='ui-popover']"), inDialogLayer: !!el?.closest(".z-dialog") };
    }, [pb.x + pb.width / 2, pb.y + pb.height / 2]);
    expect(owner, "the dialog layer sits above the popover").toEqual({ inPopover: false, inDialogLayer: true });
    await page.keyboard.press("Escape");
    await detachIfAttached(page);
  });

  test("F21: Run Flow… closes the menu, and the claim-owned run dialog stays open", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await openSessionMenu(page, card);
    const run = flowMenuItem(page, /run flow/i);
    await expect(run).toBeVisible({ timeout: 60_000 });
    await run.click();
    await expect(sessionMenuPanel(page)).toHaveCount(0);
    const search = page.getByPlaceholder("Search flows...");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(search).toBeVisible();
  });
});

// test-plan #F3 (align-ui-contract-recipes): touch targets at 375×800.
//
// Rail half only. The session card switches to its mobile layout below 768 px (`useMobile`:
// width < 768 OR height < 600) and the actions menu exists only in the desktop layout, so the
// menu cannot open at 375 px and its `max-sm:min-h-[44px]` item class is unreachable on this
// build. The spec scenario "Touch viewport targets" is therefore vacuous for the menu; the menu's
// 36 px floor is pinned at L1 (`SessionCard.actions-menu.test.tsx`) and measured at desktop width.
test.describe("touch targets at 375×800 (align-ui-contract-recipes)", () => {
  test("F3: the Services strip item is ≥ 44 px tall with a bottom-edge bar, and the page does not scroll sideways", async ({ page }) => {
    // Load at desktop width (`gotoDashboard` waits for the desktop header, and only `/` is on the
    // harness's auth bypass list), then resize and enter Settings by in-app navigation.
    await gotoDashboard(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.evaluate(() => {
      window.history.pushState({}, "", "/settings/services");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const rail = page.getByTestId("settings-nav-rail");
    await expect(rail).toBeVisible({ timeout: 20_000 });

    const boxes = await buttonBoxes(rail);
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.filter((b) => b.h < 44), "strip items under 44 px").toEqual([]);

    const current = rail.locator("[aria-current='page']");
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("All services"); // the rail label of /settings/services
    const bar = await current.evaluate((el) => {
      const st = getComputedStyle(el, "::before");
      const own = el.getBoundingClientRect();
      return { height: st.height, bottom: st.bottom, left: st.left, position: st.position, bg: st.backgroundColor, boxH: Math.round(own.height) };
    });
    expect(bar.position).toBe("absolute");
    expect(bar.height).toBe("3px");
    expect(bar.bottom).toBe("0px"); // bottom edge, not the leading edge
    expect(bar.boxH).toBeGreaterThanOrEqual(44);
    expect(bar.bg).not.toBe("rgba(0, 0, 0, 0)");
    const accent = await resolveColor(page, "var(--accent-primary)");
    expect(bar.bg.replace(/\s/g, "")).toContain(`rgb(${accent.join(",")}`);

    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(overflow.sw).toBe(overflow.cw);
  });
});

// test-plan #F8 (move-session-actions-trigger-to-card-edge): on a touch device at desktop width the
// trigger is visible at rest (there is no hover to reveal it) and a tap opens the menu.
test.describe("edge trigger on touch (move-session-actions-trigger-to-card-edge)", () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

  test("F8: the trigger is visible at rest and a tap opens the menu; nothing opens without the tap", async ({ page }) => {
    const card = await ensureGitSession(page);
    const trigger = sessionMenuTrigger(card);
    await expect(trigger).toBeVisible();
    expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await page.waitForTimeout(800);
    await expect(sessionMenuPanel(page)).toHaveCount(0);
    await trigger.tap();
    await expect(sessionMenuPanel(page)).toBeVisible();
  });
});
