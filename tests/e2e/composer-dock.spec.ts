/**
 * L3 — the composer dock (change: add-composer-dock; test-plan #F16, #F18 and the
 * rendered-UI half of #E1/#F1/#F9/#F11/#E22).
 *
 * A SYNTHETIC bridge (`helpers/composer-bridge.ts`) drives the session under the
 * pre-trusted `FIXTURE_GIT`: it reports background processes (`process_list`) and a
 * worktree + PR (`git_info_update`), which the harness cannot produce on demand.
 * `/api/session-diff` and `/api/quota` are stubbed per page. The dashboard port is
 * the fixtures' baseURL — never hardcoded. Exemplars: `canvas-chip-tray-overlay.spec.ts`
 * (layout probes), `action-menu-tones.spec.ts` (computed contrast per theme/mode).
 *
 * Covered here: collapsed default · accordion · compact chips at 480 px · the YOLO
 * footer fully visible and one line while an expanded lane scrolls (also in `hu` at
 * 375 px) · Kill on a background process · plugin subagent rows with 44 px targets at
 * 375 px · #F16 (a replacing canvas hides the dock at 767 px) · #F18 (contrast in base
 * dark, base light and nord dark). The claimed `composer-toolbar-action` at 375 px and
 * the 200 % root font size live in `split-composer-overflow.spec.ts` (#X10, #X11).
 */
import type { Locator, Page } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import {
  type ComposerBridge,
  connectComposerBridge,
  ensureFixturePinned,
  fakeProcesses,
  openComposerSession,
  pushWorktreeWithPr,
  stubQuota,
  stubSessionDiff,
} from "./helpers/composer-bridge.js";
import { contrastFailures, measureText, setThemeMode, sizeFailures } from "./helpers/computed-contrast.js";
import { chooseLayoutMode, FIXTURE_GIT, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/** `YOLO_FOOTER_HEIGHT` (chat-pane-row-class.ts): the footer is one fixed `h-8` line. */
const FOOTER_HEIGHT = 32;

const dock = (page: Page) => page.getByTestId("composer-dock");
const lane = (page: Page, name: string) => dock(page).getByRole("group", { name, exact: true });
const toggle = (page: Page, key: string) => dock(page).locator(`[data-dock-toggle='${key}']`);

async function startYolo(page: Page): Promise<void> {
  await page.request.delete("/api/access/yolo").catch(() => undefined);
  const res = await page.request.post("/api/access/yolo", {
    data: { durationMinutes: 15, base: FIXTURE_GIT, root: FIXTURE_GIT },
  });
  expect(res.ok(), `YOLO activation: ${res.status()}`).toBe(true);
}

/** Persist `lang`, then reload so the app boots in it (the catalogue is lazy). */
async function setLanguage(page: Page, lang: string): Promise<void> {
  await page.evaluate((l) => localStorage.setItem("pi-dashboard-language", l), lang);
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 15_000 }).toBe(lang);
}

/** Pin the chat pane to `px` wide (the dock measures its composer COLUMN, i.e. this pane). */
async function setChatPaneWidth(page: Page, px: number): Promise<void> {
  await page.getByTestId("split-chat-pane").evaluate((el, w) => {
    const e = el as HTMLElement;
    e.style.flex = "none";
    e.style.width = `${w}px`;
  }, px);
}

/** A synthetic session with `processes` background processes, open in the composer. */
async function openProcessSession(page: Page, tag: string, processes = 2): Promise<ComposerBridge> {
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

test.describe("composer dock (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("#E1/#F1: every lane starts collapsed; the accordion keeps one lane open at a time", async ({ page }) => {
    await stubSessionDiff(page);
    await stubQuota(page);
    const bridge = await openProcessSession(page, "accordion");
    try {
      pushWorktreeWithPr(bridge);
      const processes = toggle(page, "processes");
      const changes = toggle(page, "changes");
      await expect(processes).toBeVisible({ timeout: 20_000 });
      await expect(changes).toBeVisible({ timeout: 20_000 });

      // Collapsed default: no lane is expanded, no lane body is mounted.
      await expect(processes).toHaveAttribute("aria-expanded", "false");
      await expect(changes).toHaveAttribute("aria-expanded", "false");
      await expect(dock(page).locator("[id$='-body']")).toHaveCount(0);

      // Accordion: opening Changes closes Processes.
      await processes.click();
      await expect(processes).toHaveAttribute("aria-expanded", "true");
      await changes.click();
      await expect(changes).toHaveAttribute("aria-expanded", "true");
      await expect(processes).toHaveAttribute("aria-expanded", "false");
      await expect(dock(page).locator("[id$='-body']")).toHaveCount(1);

      // The lanes keep their fixed order: Processes above Changes above Context.
      const order = await dock(page).locator("[data-dock-lane]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-lane")));
      expect(order.indexOf("processes")).toBeLessThan(order.indexOf("changes"));
      expect(order.indexOf("changes")).toBeLessThan(order.indexOf("context"));
    } finally {
      bridge.close();
    }
  });

  test("compact chips at 480 px: one chip per lane, a chip opens a sheet; rows return at 640 px", async ({ page }) => {
    await stubSessionDiff(page);
    await stubQuota(page);
    const bridge = await openProcessSession(page, "compact");
    try {
      pushWorktreeWithPr(bridge);
      await expect(lane(page, "Changes")).toBeVisible({ timeout: 20_000 });

      await setChatPaneWidth(page, 640);
      await expect(dock(page)).toHaveAttribute("data-layout", "rows");
      await setChatPaneWidth(page, 480);
      await expect(dock(page)).toHaveAttribute("data-layout", "compact", { timeout: 10_000 });

      const chips = dock(page).getByTestId("composer-dock-chips");
      // Every lane is a chip in compact mode, also a lane that is not expandable in rows (spec
      // "Compact dock below 520 px"): Processes, Changes and the Context lane the stubbed quota brings.
      await expect(chips.locator("[data-dock-toggle]")).toHaveCount(3);
      await expect(chips.getByTestId("composer-dock-chip-processes")).toBeVisible();
      await expect(chips.getByTestId("composer-dock-chip-changes")).toBeVisible();
      await expect(chips.getByTestId("composer-dock-chip-context")).toBeVisible();

      await chips.getByTestId("composer-dock-chip-processes").click();
      await expect(dock(page).getByTestId("composer-dock-sheet")).toBeVisible();
      await expect(chips.getByTestId("composer-dock-chip-processes")).toHaveAttribute("aria-expanded", "true");
      // The open lane survives the flip back to rows.
      await setChatPaneWidth(page, 640);
      await expect(dock(page)).toHaveAttribute("data-layout", "rows", { timeout: 10_000 });
      await expect(toggle(page, "processes")).toHaveAttribute("aria-expanded", "true");
    } finally {
      bridge.close();
    }
  });

  test("#E22: Kill on a background process sends kill_process, shows Stopping…, and the row leaves with the next scan", async ({ page }) => {
    const bridge = await openProcessSession(page, "kill", 2);
    try {
      await toggle(page, "processes").click();
      const kill = lane(page, "Processes").getByRole("button", { name: "Kill node worker-1.js" });
      await expect(kill).toBeVisible({ timeout: 10_000 });
      await kill.click();

      // The bridge received a process-group kill — never an abort.
      await expect
        .poll(() => bridge.received().filter((m) => m.type === "kill_process").map((m) => m.pgid), { timeout: 10_000 })
        .toEqual([70_001]);
      expect(bridge.received().some((m) => m.type === "abort")).toBe(false);
      await expect(kill).toBeDisabled();
      await expect(lane(page, "Processes")).toContainText("Stopping…");

      // The next scan no longer lists it: the row is gone, the other stays.
      bridge.setProcesses(fakeProcesses(1));
      await expect(lane(page, "Processes").getByRole("button", { name: "Kill node worker-1.js" })).toHaveCount(0, { timeout: 15_000 });
      await expect(lane(page, "Processes").getByRole("button", { name: "Kill node worker-0.js" })).toBeVisible();
    } finally {
      bridge.close();
    }
  });

  test("subagent rows from the plugin render in the Processes lane with ≥ 44 px targets at 375 px", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await page.keyboard.press("Escape").catch(() => {});
    await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 375, height: 800 });
    await sendPrompt(page, "[[faux:subagent-reasoning]] go");

    // ~10 s run: the plugin's summary instance puts a lane in the dock while it runs.
    const chip = page.getByTestId("composer-dock-chip-processes");
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(chip).toHaveAccessibleName(/subagent/i);
    await chip.click();
    const sheet = page.getByTestId("composer-dock-sheet");
    await expect(sheet).toBeVisible();

    const open = sheet.getByRole("link", { name: /^Open subagent/ }).first();
    await expect(open).toBeVisible({ timeout: 20_000 });
    for (const target of [open]) {
      const b = await box(target);
      expect(b.width, "action target width").toBeGreaterThanOrEqual(44);
      expect(b.height, "action target height").toBeGreaterThanOrEqual(44);
    }
    // Rows are ≥ 32 px and never overflow the sheet horizontally.
    const row = sheet.getByTestId("composer-dock-row").first();
    expect((await box(row)).height).toBeGreaterThanOrEqual(32);
    const dockBox = await box(dock(page));
    expect((await box(row)).x + (await box(row)).width).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);
  });

  test("#F16: at 767 px a replacing canvas hides ChatView, the dock and CommandInput; the preview is shown", async ({ page }) => {
    const bridge = await openProcessSession(page, "f16", 2);
    try {
      await page.setViewportSize({ width: 767, height: 800 });
      await expect(dock(page)).toBeVisible();
      await expect(page.getByTestId("composer-card")).toBeVisible();

      // The Editor layout is the canvas taking the chat's place (mobile tier: the chat pane is
      // kept mounted but hidden; tablet omits it).
      await chooseLayoutMode(page, "full");
      await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
      await expect(dock(page)).toBeHidden();
      await expect(page.getByTestId("composer-card")).toBeHidden();
      await expect(page.getByTestId("chat-scroll-container")).toBeHidden();

      // Back to Chat restores all three.
      await chooseLayoutMode(page, "closed");
      await expect(dock(page)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("composer-card")).toBeVisible();
    } finally {
      bridge.close();
    }
  });
});

// ── YOLO footer + contrast (need YOLO, so the trust gate is narrowed like yolo-indicator-layout) ──

test.describe.serial("composer dock with YOLO and themes (L3)", () => {
  test.beforeAll(async ({ request }) => {
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete("/api/access/yolo").catch(() => undefined);
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/access/yolo").catch(() => undefined);
  });

  for (const lang of ["en", "hu"] as const) {
    test(`YOLO footer stays fully visible and one line while an expanded lane scrolls at 375 px (${lang})`, async ({ page }) => {
      await gotoDashboard(page);
      await setLanguage(page, lang);
      await startYolo(page);
      await page.reload();
      await page.setViewportSize({ width: 375, height: 700 });
      await ensureFixturePinned(page);
      const bridge = await connectComposerBridge(page, `yolo-${lang}`);
      try {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openComposerSession(page, bridge.sessionId);
        await page.setViewportSize({ width: 375, height: 700 });
        bridge.setProcesses(fakeProcesses(12));
        await expect(dock(page)).toHaveAttribute("data-layout", "compact", { timeout: 20_000 });
        await page.getByTestId("composer-dock-chip-processes").click();
        const sheet = dock(page).getByTestId("composer-dock-sheet");
        await expect(sheet).toBeVisible();

        const footer = dock(page).getByTestId("yolo-composer-strip");
        await expect(footer).toBeVisible({ timeout: 20_000 });
        const check = async (label: string) => {
          const f = await box(footer);
          const d = await box(dock(page));
          expect(f.height, `${lang} ${label}: footer is one 32 px line`).toBeCloseTo(FOOTER_HEIGHT, 0);
          expect(f.y, `${lang} ${label}: footer top inside the dock`).toBeGreaterThanOrEqual(d.y - 0.5);
          expect(f.y + f.height, `${lang} ${label}: footer bottom inside the dock`).toBeLessThanOrEqual(d.y + d.height + 0.5);
          expect(f.y + f.height, `${lang} ${label}: footer inside the viewport`).toBeLessThanOrEqual(700);
          const g = await footer.evaluate((el) => {
            const time = el.lastElementChild as HTMLElement;
            return { timeLegible: time.scrollWidth <= time.clientWidth, text: time.textContent ?? "" };
          });
          expect(g.timeLegible, `${lang} ${label}: time fully visible`).toBe(true);
          expect(g.text, `${lang} ${label}: time present`).toMatch(/\d+:\d\d|∞|no expiry|nincs lejárat/);
        };
        await check("sheet open");

        // Scroll every scrollport of the lane region: the footer never moves out.
        for (const scroller of [page.getByTestId("composer-dock-scroll"), sheet.locator(":scope > div").last()]) {
          const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight).catch(() => 0);
          for (const frac of [0, 1]) {
            await scroller.evaluate((el, top) => ((el as HTMLElement).scrollTop = top), Math.round(max * frac)).catch(() => undefined);
            await check(`scroll ${frac * 100}%`);
          }
        }

        // No horizontal overflow anywhere: the dock, its footer and the document.
        const overflow = await page.evaluate(() => {
          const d = document.querySelector('[data-testid="composer-dock"]') as HTMLElement;
          const f = d.querySelector('[data-testid="yolo-composer-strip"]') as HTMLElement;
          return {
            dock: d.scrollWidth - d.clientWidth,
            footer: f.scrollWidth - f.clientWidth,
            doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        expect(overflow.dock, `${lang}: dock overflows horizontally`).toBeLessThanOrEqual(0);
        expect(overflow.footer, `${lang}: footer overflows horizontally`).toBeLessThanOrEqual(0);
        expect(overflow.doc, `${lang}: page overflows horizontally`).toBeLessThanOrEqual(0);
      } finally {
        bridge.close();
        await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "en"));
      }
    });
  }

  // #F18 — computed contrast over dock + card in base dark, base light and nord dark.
  for (const [theme, mode] of [["base", "dark"], ["base", "light"], ["nord", "dark"]] as const) {
    test(`#F18: dock and composer card meet text contrast and size floors in ${theme} ${mode}`, async ({ page }) => {
      test.setTimeout(180_000);
      await stubQuota(page);
      await stubSessionDiff(page);
      await gotoDashboard(page);
      await ensureFixturePinned(page);
      await startYolo(page);
      const bridge = await connectComposerBridge(page, `f18-${theme}-${mode}`);
      try {
        await setThemeMode(page, mode, theme);
        await openComposerSession(page, bridge.sessionId);
        bridge.setProcesses(fakeProcesses(3));
        pushWorktreeWithPr(bridge);
        // A full-feature dock: Processes, Changes and Context lanes plus the YOLO footer.
        await expect(lane(page, "Processes")).toBeVisible({ timeout: 20_000 });
        await expect(lane(page, "Changes")).toBeVisible({ timeout: 20_000 });
        await expect(lane(page, "Context")).toBeVisible({ timeout: 20_000 });
        await expect(dock(page).getByTestId("yolo-composer-strip")).toBeVisible({ timeout: 20_000 });
        await toggle(page, "processes").click();
        await expect(lane(page, "Processes").getByRole("button", { name: /^Kill / }).first()).toBeVisible();

        const measures = [...(await measureText(dock(page))), ...(await measureText(page.getByTestId("composer-card")))];
        expect(measures.length, "measured text nodes").toBeGreaterThan(5);
        expect(contrastFailures(measures), `${theme}/${mode} contrast`).toEqual([]);
        // No text under 11 px anywhere; interactive text at least 12 px.
        expect(sizeFailures(measures, { dense: 11, interactive: 12 }), `${theme}/${mode} size`).toEqual([]);
      } finally {
        bridge.close();
        await setThemeMode(page, "dark", "base");
      }
    });
  }
});
