/**
 * E2E: fix-yolo-indicator-overflow — the active-YOLO signals never wrap or grow a
 * header row (issue #898); the remaining time lives on one single-line strip above
 * each dashboard prompt composer (test-plan #E1-#E8, #E19-#E21, #F8-#F12, #F11,
 * #X1-#X3; #F8-#F10 and #F12 are interaction paths, #E15 / #X4 sit in
 * `access-grant-dialog.spec.ts` / `agent-path-gate.spec.ts`).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * jsdom has no layout engine. "One line", "the row height did not change", "right
 * edge inside the column", "ellipsis before the marker", "hu is at least as wide as
 * zh-CN" and the resolved contrast of the tint are statements about LAID-OUT pixels
 * and RESOLVED colours; the L1 suite (`YoloIndicators.test.tsx`) pins structure only.
 *
 * Viewport height stays >= 600 px everywhere: `useMobile` flips below that
 * (design D7). "Legible" = node `scrollWidth <= clientWidth` and its box sits inside
 * the strip. Frozen split underlays are `inert`; queries here use the live pane.
 *
 * YOLO is started through the REST API (`POST /api/access/yolo`) before the page
 * loads so the status store's first fetch already sees it; ending it is `DELETE`.
 *
 * add-composer-dock: the strip became the composer dock's YOLO footer (same
 * `yolo-composer-strip` id and internals) — a `flex-none` fixed one-line row,
 * `YOLO_FOOTER_HEIGHT` = 32 px (`h-8`) — so "one line" below means exactly that height,
 * and the E6/E7 width probes drive the dock's width. #F9 / #F10 (add-composer-dock
 * test-plan) are the footer-never-clipped and one-line-in-every-language cases.
 *
 * See change: fix-yolo-indicator-overflow, add-composer-dock.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import { connectComposerBridge, ensureFixturePinned, openComposerSession } from "./helpers/composer-bridge.js";
import { contrastRatio, elementColors, resolveColor, setThemeMode } from "./helpers/computed-contrast.js";
import { ensureGitSession, FIXTURE_GIT, openAppearance, robustClick } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

type Scope = "scoped" | "unscoped";
type Lang = "en" | "hu";

/** `YOLO_FOOTER_HEIGHT` (chat-pane-row-class.ts): the footer is one fixed `h-8` line. */
const FOOTER_HEIGHT = 32;
const WIDTHS = [375, 768, 1500] as const;
const HEIGHT = 900;
const SCOPES: Scope[] = ["scoped", "unscoped"];
const LANGS: Lang[] = ["en", "hu"];

const THEMES = [
  "base", "dracula", "nord", "github", "catppuccin",
  "tokyo-night", "rose-pine", "solarized", "gruvbox",
];

const bar = (page: Page) => page.getByTestId("header-app-bar");
const strip = (page: Page) => page.getByTestId("yolo-composer-strip").first();
const encFolder = (p: string) => Buffer.from(p).toString("base64url");

// ── YOLO control (REST) ────────────────────────────────────────────────────

async function startYolo(page: Page, scope: Scope): Promise<void> {
  const data =
    scope === "unscoped"
      ? { durationMinutes: 15, base: FIXTURE_GIT, unscoped: true }
      : { durationMinutes: 15, base: FIXTURE_GIT, root: FIXTURE_GIT };
  await page.request.delete("/api/access/yolo").catch(() => undefined);
  const res = await page.request.post("/api/access/yolo", { data });
  expect(res.ok(), `YOLO activation: ${res.status()}`).toBe(true);
}

const endYolo = (page: Page) => page.request.delete("/api/access/yolo").catch(() => undefined);

// ── language / viewport / navigation ──────────────────────────────────────

/** Persist `lang`, then reload so the app boots in it (catalogue is lazy). */
async function setLanguage(page: Page, lang: string): Promise<void> {
  await page.evaluate((l) => localStorage.setItem("pi-dashboard-language", l), lang);
  await page.reload();
  await expect(bar(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 15_000 }).toBe(lang);
}

/** Open the in-scope session's detail at the given viewport (select on desktop, then resize). */
async function openSession(page: Page, width: number, height = HEIGHT): Promise<void> {
  // The desktop card is only rendered at desktop width: select there, then resize.
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = await ensureGitSession(page);
  await card.click();
  await expect(page.getByTestId("composer-root").first()).toBeVisible({ timeout: 30_000 });
  if (width !== 1280) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("composer-root").first()).toBeVisible();
  }
}

async function openFolderHome(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ensureGitSession(page);
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto(`/folder/${encFolder(FIXTURE_GIT)}`);
  await expect(page.getByTestId("directory-home")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("composer-root").first()).toBeVisible({ timeout: 20_000 });
}

// ── measurements ──────────────────────────────────────────────────────────

/** Bar height once it is laid out and stable (the sidebar animates its width after a resize). */
async function barHeight(page: Page): Promise<number> {
  await expect(bar(page)).toBeVisible({ timeout: 15_000 });
  let prev = -1;
  await expect
    .poll(
      async () => {
        const h = await bar(page).evaluate((e) => e.getBoundingClientRect().height);
        const stable = h > 0 && h === prev;
        prev = h;
        return stable;
      },
      { timeout: 15_000, intervals: [150] },
    )
    .toBe(true);
  return prev;
}

interface StripGeometry {
  height: number;
  oneLine: number;
  right: number;
  columnRight: number;
  timeLegible: boolean;
  timeText: string;
}

/** Strip height vs one line box, right edge vs the composer column, time legibility. */
async function stripGeometry(page: Page): Promise<StripGeometry> {
  return strip(page).evaluate((el) => {
    const root = document.querySelector('[data-testid="composer-root"]') as HTMLElement;
    const time = el.lastElementChild as HTMLElement;
    const r = el.getBoundingClientRect();
    const tr = time.getBoundingClientRect();
    return {
      height: r.height,
      oneLine: 32, // YOLO_FOOTER_HEIGHT — the footer is a fixed one-line row
      right: r.right,
      columnRight: root.getBoundingClientRect().right,
      timeLegible: time.scrollWidth <= time.clientWidth && tr.left >= r.left - 0.5 && tr.right <= r.right + 0.5,
      timeText: time.textContent ?? "",
    };
  });
}

async function expectStripSingleLine(page: Page, label: string): Promise<void> {
  const g = await stripGeometry(page);
  expect(g.height, `${label}: footer is exactly one line (32 px)`).toBeCloseTo(g.oneLine, 0);
  expect(g.right, `${label}: strip right <= composer column right`).toBeLessThanOrEqual(g.columnRight + 0.5);
  expect(g.timeLegible, `${label}: time legible`).toBe(true);
  expect(g.timeText.length, `${label}: time present`).toBeGreaterThan(0);
}

/** Every `data-testid` in the bar, minus the focus-revealed YOLO link and the async update badge. */
const barTestIds = (page: Page) =>
  bar(page).evaluate((e) =>
    [...e.querySelectorAll("[data-testid]")]
      .map((n) => n.getAttribute("data-testid"))
      // The update badge appears asynchronously and is unrelated to YOLO.
      .filter((id) => id !== "yolo-bar-link" && id !== "pi-update-badge"),
  );

function stripHost(page: Page): Locator {
  return strip(page).locator("xpath=..");
}

/**
 * Documented theme-ceiling exceptions (operator decision at ship-it, same pattern as
 * `EXCEPTIONS` in severity-contrast.spec.ts): cell key -> the lower floor allowed instead of
 * the relative gate. tokyo-night/dark `--text-tertiary` measures 4.45:1 on the YOLO tint
 * (6.64:1 untinted); it only affects the muted row-1 icons and still clears the 3:1 UI floor.
 */
const CONTRAST_EXCEPTIONS: Record<string, number> = {
  "tokyo-night/dark --text-tertiary": 4.4,
};

/** Relative contrast gate (design D7): text >= 4.5:1 or >= 85% of its untinted contrast; underline >= 3:1. */
async function tintContrastFailures(page: Page, label: string): Promise<string[]> {
  const out: string[] = [];
  const tint = (await elementColors(bar(page))).bg;
  const plain = await resolveColor(page, "var(--bg-secondary)");
  for (const token of ["--text-secondary", "--text-tertiary"]) {
    const fg = await resolveColor(page, `var(${token})`);
    const onTint = contrastRatio(fg, tint);
    const onPlain = contrastRatio(fg, plain);
    const floor = CONTRAST_EXCEPTIONS[`${label} ${token}`];
    if (floor !== undefined ? onTint < floor : onTint < 4.5 && onTint < 0.85 * onPlain) {
      out.push(`${label} ${token}: ${onTint.toFixed(2)} on tint vs ${onPlain.toFixed(2)} on bg-secondary`);
    }
  }
  const underline = contrastRatio(await resolveColor(page, "var(--accent-orange-text)"), tint);
  if (underline < 3) out.push(`${label} underline: ${underline.toFixed(2)}:1 on tint`);
  return out;
}

// ── file-wide setup ───────────────────────────────────────────────────────

test.describe.serial("YOLO indicator layout (fix-yolo-indicator-overflow)", () => {
  test.beforeAll(async ({ request }) => {
    // YOLO activation refuses in report mode; same narrowing as access-grant-dialog.spec.ts.
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
  });

  test.afterEach(async ({ page }) => {
    await endYolo(page);
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/access/yolo").catch(() => undefined);
  });

  // ── E1 / E2 : the bar ───────────────────────────────────────────────────

  for (const scope of SCOPES) {
    for (const lang of LANGS) {
      test(`#E1 row-1 height is the same with and without YOLO (${scope}, ${lang})`, async ({ page }) => {
        await ensureGitSession(page);
        await setLanguage(page, lang);
        await startYolo(page, scope);
        const heights: Record<number, number> = {};
        const idsOn: Record<number, (string | null)[]> = {};
        await page.reload();
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: HEIGHT });
          await expect(bar(page)).toHaveAttribute("data-yolo", scope, { timeout: 20_000 });
          heights[w] = await barHeight(page);
          idsOn[w] = await barTestIds(page);
        }
        await endYolo(page);
        await page.reload();
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: HEIGHT });
          await expect(bar(page)).toBeVisible();
          await expect(bar(page)).not.toHaveAttribute("data-yolo", /.*/);
          expect(await barHeight(page), `${scope}/${lang}@${w}: bar height`).toBeCloseTo(heights[w], 0);
          expect(await barTestIds(page), `${scope}/${lang}@${w}: visible controls`).toEqual(idsOn[w]);
        }
      });
    }
  }

  test("#E2 focusing the bar link reveals it without changing the bar height", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    const link = page.getByTestId("yolo-bar-link");
    const before = await barHeight(page);
    await expect(link).toHaveCSS("opacity", "0");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((n) => n === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("opacity", "1");
    const box = await link.boundingBox();
    expect(box && box.width > 0 && box.height > 0).toBe(true);
    expect(await barHeight(page)).toBeCloseTo(before, 0);
  });

  // declutter-sidebar-header #F9: the tint does not change the row-1 height at 375 (drawer) / 768 / 1500
  // in en and hu — that is #E1 above — and the YOLO link stays the FIRST focusable element of row 1,
  // ahead of the (moved) Discord link.
  for (const lang of LANGS) {
    test(`#F9 (declutter) YOLO link is the first focusable in row 1, before discord-btn (${lang})`, async ({ page }) => {
      await ensureGitSession(page);
      await setLanguage(page, lang);
      await startYolo(page, "unscoped");
      await page.reload();
      await page.setViewportSize({ width: 1500, height: HEIGHT });
      await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
      const order = await bar(page).evaluate((el) =>
        Array.from(el.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")).map(
          (n) => n.getAttribute("data-testid") ?? n.tagName.toLowerCase(),
        ),
      );
      expect(order[0]).toBe("yolo-bar-link");
      expect(order.indexOf("yolo-bar-link")).toBeLessThan(order.indexOf("discord-btn"));
    });
  }

  // ── E3 / E4 / E20: the strip ────────────────────────────────────────────

  for (const scope of SCOPES) {
    for (const lang of LANGS) {
      test(`#E3 strip is one line above the session composer (${scope}, ${lang})`, async ({ page }) => {
        await ensureGitSession(page);
        await setLanguage(page, lang);
        await startYolo(page, scope);
        await page.reload();
        for (const w of WIDTHS) {
          await openSession(page, w);
          await expect(strip(page)).toHaveAttribute("data-scope", scope, { timeout: 20_000 });
          await expectStripSingleLine(page, `${scope}/${lang}@${w}`);
        }
      });
    }
  }

  for (const scope of SCOPES) {
    for (const lang of LANGS) {
      test(`#E4 strip is one line above the folder-home composer (${scope}, ${lang})`, async ({ page }) => {
        await ensureGitSession(page);
        await setLanguage(page, lang);
        await startYolo(page, scope);
        for (const w of [375, 1500]) {
          await openFolderHome(page, w);
          await expect(strip(page)).toHaveAttribute("data-scope", scope, { timeout: 20_000 });
          await expectStripSingleLine(page, `home ${scope}/${lang}@${w}`);
        }
      });
    }
  }

  test("#E5 strip keeps one line while a tall draft scrolls the composer card", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await openSession(page, 768, 600);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    const card = page.getByTestId("composer-card").first();
    await card.locator("textarea").first().fill(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));
    await expectStripSingleLine(page, "tall draft");
    expect(await card.evaluate((e) => e.scrollHeight > e.clientHeight || getComputedStyle(e).overflowY !== "visible")).toBe(
      true,
    );
  });

  test("#E6 / #E7 strip degrades sentence first; shield + time stay legible down to the floor", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "hu");
    await startYolo(page, "unscoped");
    await page.reload();
    await openSession(page, 1500);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    // The footer's host is the dock. Hide its lane region so the dock's max-content width is
    // the footer's own preferred width (a Changes/Context lane would otherwise widen it).
    const wrapper = stripHost(page);
    await page.getByTestId("composer-dock-scroll").evaluate((e) => ((e as HTMLElement).style.display = "none")).catch(() => undefined);

    const measure = () =>
      strip(page).evaluate((el) => {
        const host = el.parentElement as HTMLElement;
        const link = el.firstElementChild as HTMLElement;
        const shield = link.querySelector("svg") as SVGElement;
        const sentence = link.querySelector("span") as HTMLElement;
        const time = el.lastElementChild as HTMLElement;
        const r = el.getBoundingClientRect();
        const inside = (n: Element) => {
          const b = n.getBoundingClientRect();
          return b.left >= r.left - 0.5 && b.right <= r.right + 0.5;
        };
        return {
          height: r.height,
          oneLine: 32, // YOLO_FOOTER_HEIGHT
          ellipsed: sentence.scrollWidth > sentence.clientWidth,
          shieldInside: inside(shield),
          timeInside: inside(time),
          timeLegible: time.scrollWidth <= time.clientWidth,
          right: r.right,
          hostRight: host.getBoundingClientRect().right,
        };
      });

    // Preferred width = the wrapper's max-content width.
    await wrapper.evaluate((e) => {
      (e as HTMLElement).style.cssText = "width:max-content;max-width:none;flex:none;";
    });
    const preferred = await wrapper.evaluate((e) => e.getBoundingClientRect().width);

    // E6: preferred - 1 px -> the sentence ellipses; shield + time legible; one line; inside the host.
    // (The dock's `mx-3` margins sit outside its width, so `width` is the footer's width + the dock border.)
    await wrapper.evaluate((e, w) => {
      (e as HTMLElement).style.cssText = `width:${w}px;max-width:none;flex:none;`;
    }, preferred - 1);
    const e6 = await measure();
    expect(e6.ellipsed, "E6: sentence ellipsed").toBe(true);
    expect(e6.shieldInside && e6.timeInside && e6.timeLegible, "E6: shield + time legible").toBe(true);
    expect(e6.height, "E6: one line").toBeCloseTo(e6.oneLine, 0);
    expect(e6.right, "E6: inside host").toBeLessThanOrEqual(e6.hostRight + 0.5);

    // E7: floor = shield + time + 2 gaps + padding + border (+ wrapper px-3).
    const floor = await strip(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const link = el.firstElementChild as HTMLElement;
      const shield = link.querySelector("svg") as SVGElement;
      const time = el.lastElementChild as HTMLElement;
      const hostCs = getComputedStyle(el.parentElement as HTMLElement);
      const hostBorders = px(hostCs.borderLeftWidth) + px(hostCs.borderRightWidth);
      return (
        shield.getBoundingClientRect().width +
        time.scrollWidth +
        2 * px(cs.columnGap) +
        px(cs.paddingLeft) +
        px(cs.paddingRight) +
        px(cs.borderLeftWidth) +
        px(cs.borderRightWidth) +
        px(hostCs.paddingLeft) +
        px(hostCs.paddingRight) +
        hostBorders
      );
    });
    await wrapper.evaluate((e, w) => {
      (e as HTMLElement).style.cssText = `width:${w}px;max-width:none;flex:none;`;
    }, Math.ceil(floor));
    const e7 = await measure();
    expect(e7.shieldInside && e7.timeInside && e7.timeLegible, "E7: shield + time legible at the floor").toBe(true);
    expect(e7.height, "E7: one line at the floor").toBeCloseTo(e7.oneLine, 0);
    expect(e7.right, "E7: inside host at the floor").toBeLessThanOrEqual(e7.hostRight + 0.5);
  });

  test("#E8 the hu strip sentence is at least as wide as the zh-CN one", async ({ page }) => {
    await ensureGitSession(page);
    await startYolo(page, "unscoped");
    const widths: Record<string, number> = {};
    for (const lang of ["hu", "zh-CN"]) {
      await page.goto("/");
      await setLanguage(page, lang);
      await openSession(page, 1500);
      await expect(strip(page)).toBeVisible({ timeout: 20_000 });
      widths[lang] = await strip(page).evaluate((el) => (el.querySelector("span") as HTMLElement).scrollWidth);
    }
    await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "en"));
    expect(widths.hu, `hu ${widths.hu} >= zh-CN ${widths["zh-CN"]}`).toBeGreaterThanOrEqual(widths["zh-CN"]);
  });

  test("#E20 the footer sits outside the composer card, inside the dock directly above the composer root", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "scoped");
    await page.reload();
    await openSession(page, 1500);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    const rel = await strip(page).evaluate((el) => {
      const card = document.querySelector('[data-testid="composer-card"]') as HTMLElement;
      const root = document.querySelector('[data-testid="composer-root"]') as HTMLElement;
      const dock = document.querySelector('[data-testid="composer-dock"]') as HTMLElement;
      return {
        insideCard: card.contains(el),
        insideDock: dock.contains(el),
        gap: root.getBoundingClientRect().top - el.getBoundingClientRect().bottom,
      };
    });
    expect(rel.insideCard).toBe(false);
    expect(rel.insideDock, "the footer belongs to the dock").toBe(true);
    expect(rel.gap).toBeGreaterThanOrEqual(-0.5);
  });

  // ── E19: read-only surface ──────────────────────────────────────────────

  test("#E19 an archived session opened read-only carries no strip (bar still tinted)", async ({ page }) => {
    const id = crypto.randomUUID();
    const cwd = FIXTURE_GIT;
    const encodeCwd = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const startedAt = Date.now() - 3 * 3_600_000;
    const stamp = new Date(startedAt).toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const base = `.pi/agent/sessions/${encodeCwd}/${stamp}_${id}`;
    const container = execFileSync(
      "docker",
      ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`],
      { encoding: "utf8", timeout: 30_000 },
    )
      .trim()
      .split("\n")[0];
    const runNode = (script: string) =>
      execFileSync("docker", ["exec", container, "node", "-e", script], { encoding: "utf8", timeout: 60_000 });
    const write = (rel: string, body: string) =>
      runNode(
        `const fs=require("fs"),p=require("path");const f=p.join(process.env.HOME,${JSON.stringify(rel)});` +
          `fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,${JSON.stringify(body)});`,
      );
    const cleanup = () =>
      runNode(
        `const fs=require("fs"),p=require("path");for(const e of [".jsonl",".meta.json"]){try{fs.unlinkSync(p.join(process.env.HOME,${JSON.stringify(base)}+e))}catch{}}`,
      );
    write(
      `${base}.jsonl`,
      `${JSON.stringify({ type: "session", id, cwd, timestamp: new Date(startedAt).toISOString() })}\n`,
    );
    write(
      `${base}.meta.json`,
      JSON.stringify({
        cwd,
        status: "ended",
        name: "e2e-yolo-readonly",
        firstMessage: "e2e-yolo-readonly",
        startedAt,
        endedAt: startedAt + 3_600_000,
        archived: true,
        archivedAt: startedAt + 3_600_000,
      }),
    );
    try {
      // The boot scanner builds the archive index: restart so it sees the seed.
      await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2_000));
      await expect
        .poll(async () => (await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`).catch(() => null))?.ok ?? false, {
          timeout: 150_000,
          intervals: [1_000],
        })
        .toBe(true);
      await startYolo(page, "unscoped");
      await page.setViewportSize({ width: 1500, height: HEIGHT });
      await page.goto(`/session/${id}?archived=1`);
      await expect(page.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("composer-card")).toHaveCount(0);
      await expect(page.getByTestId("composer-dock")).toHaveCount(0);
      await expect(page.getByTestId("yolo-composer-strip")).toHaveCount(0);
      await expect(page.getByTestId("yolo-session-indicator")).toHaveCount(0);
      await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    } finally {
      cleanup();
    }
  });

  // ── E21: contrast across 18 theme × mode combinations ──────────────────

  test("#E21 row-1 text and underline stay legible on the tint in every theme x mode", async ({ page }) => {
    await ensureGitSession(page);
    await startYolo(page, "unscoped");
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    const failures: string[] = [];
    for (const theme of THEMES) {
      for (const mode of ["dark", "light"] as const) {
        await setThemeMode(page, mode, theme);
        await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
        failures.push(...(await tintContrastFailures(page, `${theme}/${mode}`)));
      }
    }
    await setThemeMode(page, "dark", "base");
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // ── F8 - F12: interaction paths ─────────────────────────────────────────

  test("#F8 hover tooltips carry the coverage sentence and never navigate", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await openSession(page, 1500);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    const sentence = await strip(page).locator("a").first().getAttribute("title");
    expect(sentence).toMatch(/^YOLO is on everywhere: .*every folder.*Open Access to end it\.$/);
    const url = page.url();
    await bar(page).hover({ position: { x: 2, y: 2 } });
    expect(await bar(page).getAttribute("title")).toBe(sentence);
    await strip(page).locator("a").first().hover();
    expect(page.url()).toBe(url);
  });

  test("#F9 keyboard: Tab to the bar link, Enter opens Access without a full reload", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    await page.evaluate(() => {
      (window as unknown as { __yoloMarker: number }).__yoloMarker = 1;
    });
    const link = page.getByTestId("yolo-bar-link");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await link.evaluate((n) => n === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/access/, { timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __yoloMarker?: number }).__yoloMarker)).toBe(1);
    await expect(page.getByTestId("yolo-access-active")).toBeVisible({ timeout: 15_000 });
  });

  test("#F11 a click on the bar or inside its open dropdown never navigates", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    const url = page.url();

    await bar(page).click({ position: { x: 2, y: 2 } });
    expect(page.url()).toBe(url);

    const dropdown = await openAppearance(page);
    await dropdown.click({ position: { x: 2, y: 2 } });
    expect(page.url()).toBe(url);
    await page.keyboard.press("Escape");

    // The question panel / scrim (portaled to <body>, whose React clicks bubble to the bar) is
    // covered by construction: the bar carries NO click handler (L1 "the bar carries no click
    // handler"), so there is nothing for a bubbled click to trigger. Raising a real question needs
    // a hidden pi run, which the harness cannot start in every environment (faux-ask.spec.ts #F2).
  });

  test("#F12 with the sidebar hidden the strip remains (mobile detail, collapsed desktop sidebar)", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "scoped");
    await page.reload();
    await openSession(page, 375);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    await expect(strip(page)).toContainText(/\d+:\d\d/);

    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await robustClick(page, "sidebar-collapse");
    await expect(page.getByTestId("sidebar-expand")).toBeVisible({ timeout: 10_000 });
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText(/\d+:\d\d/);
    await page.getByTestId("sidebar-expand").click();
  });

  // ── X1 - X3: faults ────────────────────────────────────────────────────

  test("#X3 a failing YOLO status fetch renders no tint and no strip, and does not crash", async ({ page }) => {
    await ensureGitSession(page);
    await startYolo(page, "unscoped");
    await page.route("**/api/access/prompts", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false }) }),
    );
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await page.goto("/");
    await expect(bar(page)).toBeVisible({ timeout: 30_000 });
    await expect(bar(page)).not.toHaveAttribute("data-yolo", /.*/);
    expect(await bar(page).getAttribute("title")).toBeNull();
    await expect(page.getByTestId("yolo-bar-link")).toHaveCount(0);
    await page.getByTestId("session-card-desktop").first().click();
    await expect(page.getByTestId("composer-root").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("yolo-composer-strip")).toHaveCount(0);
    await page.unroute("**/api/access/prompts");
  });
});

// ── X1 / X2: hu catalogue faults ──────────────────────────────────────────
// A service worker serves the lazy catalogue chunk and bypasses `page.route`, so it is blocked here.

test.describe("YOLO hu catalogue faults", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeAll(async ({ request }) => {
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
  });

  test.afterEach(async ({ page }) => {
    await endYolo(page);
  });

  test("#X1 an aborted hu catalogue falls back to English; layout holds", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await page.route(/\/assets\/i18n-hu-[^/]+\.js(\?|$)/, (route) => route.abort());
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    const before = await barHeight(page);
    await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "hu"));
    await page.reload();
    await expect(bar(page)).toBeVisible({ timeout: 30_000 });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    // English inline fallbacks are rendered.
    expect(await bar(page).getAttribute("title")).toMatch(/^YOLO is on everywhere/);
    expect(await barHeight(page)).toBeCloseTo(before, 0);
    await openSession(page, 375);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    await expectStripSingleLine(page, "hu aborted @375");
    await page.unroute(/\/assets\/i18n-hu-[^/]+\.js(\?|$)/);
    await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "en"));
  });

  test("#X2 a delayed hu catalogue changes strings, never the layout", async ({ page }) => {
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await page.route(/\/assets\/i18n-hu-[^/]+\.js(\?|$)/, async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });
    await page.setViewportSize({ width: 1500, height: HEIGHT });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    const enHeight = await barHeight(page);
    expect(await bar(page).getAttribute("title")).toMatch(/^YOLO is on everywhere/);
    // Cold start in hu: React mounts nothing until the catalogue lands (lazy-islands.spec.ts).
    await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "hu"));
    await page.reload({ waitUntil: "commit" });
    await expect(bar(page)).toBeVisible({ timeout: 30_000 });
    await expect(bar(page)).toHaveAttribute("data-yolo", "unscoped", { timeout: 20_000 });
    expect(await bar(page).getAttribute("title")).toMatch(/^A YOLO MINDENHOL/);
    expect(await barHeight(page)).toBeCloseTo(enHeight, 0);
    await openSession(page, 375);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    await expectStripSingleLine(page, "hu delayed @375");
    await page.unroute(/\/assets\/i18n-hu-[^/]+\.js(\?|$)/);
    await page.evaluate(() => localStorage.setItem("pi-dashboard-language", "en"));
  });
});

// ── F10: touch path ───────────────────────────────────────────────────────

test.describe("YOLO strip touch path", () => {
  test.use({ hasTouch: true });

  // An unscoped session auto-allows every access prompt: never leave it on the shared harness.
  test.afterEach(async ({ page }) => {
    await endYolo(page);
  });

  test("#F10 tapping the strip sentence opens Access; tapping the time does nothing", async ({ page, request }) => {
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    await ensureGitSession(page);
    await setLanguage(page, "en");
    await startYolo(page, "unscoped");
    await page.reload();
    await openSession(page, 375);
    await expect(strip(page)).toBeVisible({ timeout: 20_000 });
    const url = page.url();
    await strip(page).locator("xpath=./*[last()]").tap();
    expect(page.url()).toBe(url);
    await strip(page).locator("a span").first().tap();
    await expect(page).toHaveURL(/\/settings\/access/, { timeout: 10_000 });
    const active = page.getByTestId("yolo-access-active");
    await expect(active).toBeVisible({ timeout: 15_000 });
    await expect(active).toContainText(/agent path gate/i);
    await expect(active).toContainText(/planes/i);
    await expect(active).toContainText(/every folder|everywhere/i);
  });
});

// ── add-composer-dock: the YOLO footer inside the dock (test-plan #F9, #F10) ────────────────

test.describe.serial("composer dock YOLO footer (add-composer-dock)", () => {
  test.beforeAll(async ({ request }) => {
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
  });

  test.afterEach(async ({ page }) => {
    await endYolo(page);
  });

  test.afterAll(async ({ request }) => {
    await request.delete("/api/access/yolo").catch(() => undefined);
  });

  test("#F9 (dock): with an expanded 12-row Processes lane the footer stays fully inside the dock and the viewport at every scroll position", async ({ page }) => {
    await ensureGitSession(page);
    await ensureFixturePinned(page);
    await setLanguage(page, "en");
    await startYolo(page, "scoped");
    await page.reload();
    await page.setViewportSize({ width: 1280, height: 900 });
    const bridge = await connectComposerBridge(page, "dock-f9");
    try {
      await openComposerSession(page, bridge.sessionId);
      bridge.setProcesses(
        Array.from({ length: 12 }, (_, i) => ({ pid: 70_000 + i, pgid: 70_000 + i, command: `node worker-${i}.js`, elapsedMs: 5_000 + i * 1_000, kind: "task" as const })),
      );
      const dock = page.getByTestId("composer-dock");
      const lane = dock.getByRole("group", { name: "Processes", exact: true });
      await expect(lane).toBeVisible({ timeout: 20_000 });
      await lane.locator("[data-dock-toggle='processes']").click();
      await expect(lane.getByRole("button", { name: /Kill/ }).first()).toBeVisible({ timeout: 10_000 });

      // The chat pane is 600 px tall: the dock gives height by scrolling, never the footer.
      await page.getByTestId("split-chat-pane").evaluate((el) => {
        const e = el as HTMLElement;
        e.style.flex = "none";
        e.style.height = "600px";
        e.style.maxHeight = "600px";
      });

      const footer = strip(page);
      await expect(footer).toBeVisible();
      const viewport = page.viewportSize() as { width: number; height: number };
      const check = async (label: string) => {
        const f = (await footer.boundingBox()) as { x: number; y: number; width: number; height: number };
        const d = (await dock.boundingBox()) as { x: number; y: number; width: number; height: number };
        expect(f.height, `${label}: footer keeps its one 32 px line`).toBeCloseTo(FOOTER_HEIGHT, 0);
        expect(f.y, `${label}: footer top inside the dock`).toBeGreaterThanOrEqual(d.y - 0.5);
        expect(f.y + f.height, `${label}: footer bottom inside the dock`).toBeLessThanOrEqual(d.y + d.height + 0.5);
        expect(f.y, `${label}: footer top inside the viewport`).toBeGreaterThanOrEqual(0);
        expect(f.y + f.height, `${label}: footer bottom inside the viewport`).toBeLessThanOrEqual(viewport.height);
      };

      await check("lane expanded");
      // Every scrollport of the lane region: the dock's lane scroller and the expanded body.
      const scrollers = [page.getByTestId("composer-dock-scroll"), lane.locator("[id$='-body']")];
      for (const scroller of scrollers) {
        const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
        for (const frac of [0, 0.5, 1]) {
          await scroller.evaluate((el, top) => ((el as HTMLElement).scrollTop = top), Math.round(max * frac));
          await check(`scrollTop ${Math.round(frac * 100)}%`);
        }
      }
      await expect(footer).toContainText(/\d+:\d\d/);
    } finally {
      bridge.close();
    }
  });

  for (const scope of SCOPES) {
    for (const lang of LANGS) {
      test(`#F10 footer is one 32 px line, time fully visible, accessible name = description (${scope}, ${lang}) at 375 / 768 / 1500`, async ({ page }) => {
        await ensureGitSession(page);
        await setLanguage(page, lang);
        await startYolo(page, scope);
        await page.reload();
        for (const w of WIDTHS) {
          await openSession(page, w);
          const footer = strip(page);
          await expect(footer).toHaveAttribute("data-scope", scope, { timeout: 20_000 });
          const label = `${scope}/${lang}@${w}`;
          const g = await stripGeometry(page);
          expect(g.height, `${label}: footer height`).toBeCloseTo(FOOTER_HEIGHT, 0);
          expect(g.timeLegible, `${label}: time fully visible`).toBe(true);
          expect(g.timeText, `${label}: time text`).toMatch(/\d+:\d\d|∞|no expiry/);

          const link = footer.locator("a").first();
          const description = await link.getAttribute("title");
          expect(description, `${label}: link carries the full description`).toBeTruthy();
          await expect(link, `${label}: accessible name is the full description`).toHaveAccessibleName(description as string);
          const name = await link.evaluate((el) => el.textContent ?? "");
          expect(name, `${label}: the time is not part of the link name`).not.toMatch(/\d+:\d\d/);
          expect(
            await footer.evaluate((el) => !!el.closest("[aria-live], [role='status'], [role='alert'], [role='log']")),
            `${label}: footer has no live-region ancestor`,
          ).toBe(false);
        }
      });
    }
  }
});
