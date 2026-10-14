import type { Locator, Page } from "@playwright/test";

/**
 * Computed-contrast probes for rendered surfaces, extracted from
 * `openspec/changes/align-ui-with-theme-tokens/mockups/ux-probe.cjs`.
 *
 * Why not axe alone: axe marks text over SEMI-TRANSPARENT backgrounds
 * (`bg-green-500/5`) "incomplete" and passes it — the live "New Session" tray
 * measured 1.70:1 while axe reported OK. These routines resolve every colour
 * through a 1×1 canvas (so `color-mix()`, `var()` and `oklch()` all come back as
 * sRGB bytes) and composite the ancestor background stack before computing the
 * WCAG ratio.
 *
 * See change: align-ui-with-theme-tokens (task 4.1).
 * See change: fix-slot-pill-legend-and-stale-overflow (srOnly skip, overflow probe, `contrastRatio`).
 */

export interface TextMeasure {
  /** First 40 chars of the element's own text. */
  text: string;
  /** WCAG ratio of the composited fg against the composited bg. */
  ratio: number;
  /** Required ratio: 3 for large text, else 4.5. */
  need: number;
  fontSize: number;
  /** Inside a button / label / link (interactive text floor = 12 px). */
  interactive: boolean;
  /** `[r,g,b]` 0–255 of the composited background. */
  bg: number[];
  /** Tag + testid breadcrumb for failure messages. */
  where: string;
  /**
   * Inside an `.sr-only` subtree: screen-reader-only text has no visual
   * footprint, so neither the contrast nor the size floor applies to it.
   */
  srOnly: boolean;
}

/**
 * Measure every visible element under `scope` that owns a direct text node.
 * Disabled controls are skipped (WCAG 1.4.3 exempts them), as are elements
 * inside `aria-hidden` subtrees (decoration).
 */
export function measureText(scope: Locator): Promise<TextMeasure[]> {
  return scope.evaluate((root) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): number[] => {
      cv.clearRect(0, 0, 1, 1);
      cv.fillStyle = "#000";
      cv.fillStyle = c;
      cv.fillRect(0, 0, 1, 1);
      const d = cv.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], bot: number[]): number[] => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1);
    };
    const bgOf = (el: Element): number[] => {
      const stack: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] >= 1) break;
      }
      let acc = [255, 255, 255, 1];
      for (const c of stack.reverse()) acc = over(c, acc);
      return acc;
    };
    const lum = ([r, g, b]: number[]): number => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const x = lum(a);
      const y = lum(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const els = [root, ...root.querySelectorAll("button, label, h2, h3, h4, p, span, li, a, summary, div")].filter(
      (e) =>
        (e as HTMLElement).offsetParent !== null &&
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) &&
        !e.closest("[disabled]") &&
        !e.closest('[aria-hidden="true"]') &&
        getComputedStyle(e).opacity !== "0" &&
        getComputedStyle(e).visibility !== "hidden",
    );
    return els.map((e) => {
      const cs = getComputedStyle(e);
      const bg = bgOf(e);
      const fg = over(rgba(cs.color), bg);
      const fs = Number.parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join(" ");
      const tid = e.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
      return {
        text: own.slice(0, 40),
        ratio: Number(ratio(fg, bg).toFixed(2)),
        need: large ? 3 : 4.5,
        fontSize: fs,
        interactive: !!e.closest("button, label, a"),
        bg: bg.slice(0, 3).map(Math.round),
        where: `${e.tagName.toLowerCase()}${tid ? `@${tid}` : ""}`,
        srOnly: e.closest(".sr-only") !== null,
      };
    });
  });
}

/** Human-readable failures of `measureText` against `floor` (default = per-node need). */
export function contrastFailures(ms: TextMeasure[], floor?: number): string[] {
  return ms
    .filter((m) => !m.srOnly && m.ratio + 0.01 < (floor ?? m.need))
    .map((m) => `${m.where} "${m.text}" ${m.ratio}:1 (need ${floor ?? m.need})`);
}

/** Text below 11 px anywhere, or below 12 px on interactive text. */
export function sizeFailures(ms: TextMeasure[], opts: { dense?: number; interactive?: number } = {}): string[] {
  const dense = opts.dense ?? 11;
  const interactive = opts.interactive ?? 12;
  return ms
    .filter((m) => !m.srOnly && (m.fontSize < dense || (m.interactive && m.fontSize < interactive)))
    .map((m) => `${m.where} "${m.text}" ${m.fontSize}px`);
}

/** WCAG contrast ratio of two opaque `[r,g,b]` 0–255 colours (node-side twin of the in-page closure). */
export function contrastRatio(fg: number[], bg: number[]): number {
  const lum = ([r, g, b]: number[]): number => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const x = lum(fg);
  const y = lum(bg);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Border box in viewport coordinates (the `getBoundingClientRect` subset used here). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OverflowItem {
  /** Tag + testid breadcrumb for failure messages. */
  where: string;
  /** Transform-inclusive border box. */
  rect: Rect;
  /** Border boxes of every clipping ancestor strictly between the item and the root. */
  clips: Rect[];
  /** Ignore the TOP edge only (the capsule legend overhangs the top border by design). */
  topExempt: boolean;
}

/** Sub-pixel slack: `getBoundingClientRect` rounds under `-translate-x-1/2`. */
const OVERFLOW_TOLERANCE_PX = 0.5;

function intersect(a: Rect, b: Rect): Rect | null {
  const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return r.right > r.left && r.bottom > r.top ? r : null;
}

/**
 * Items whose EFFECTIVE box (own rect ∩ every clipping ancestor) paints past
 * `root` by more than 0.5 px, one entry per offending edge. An item fully
 * clipped away is skipped. `topExempt` items are ignored on the top edge only.
 */
export function overflowOf(root: Rect, items: OverflowItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const box = it.clips.reduce<Rect | null>((acc, c) => (acc ? intersect(acc, c) : null), it.rect);
    if (!box) continue;
    const edges: Array<[string, number]> = [
      ["left", root.left - box.left],
      ["right", box.right - root.right],
      ["bottom", box.bottom - root.bottom],
      ["top", it.topExempt ? 0 : root.top - box.top],
    ];
    for (const [edge, px] of edges) {
      if (px > OVERFLOW_TOLERANCE_PX) out.push(`${it.where} ${edge} +${px.toFixed(1)}px`);
    }
  }
  return out;
}

/**
 * Every visible, non-`.sr-only` descendant of `root` whose painted box leaves
 * `root`'s border box. `topExempt` is a selector matched on the element itself.
 */
export async function overflowFailures(root: Locator, topExempt?: string): Promise<string[]> {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one self-contained in-page collector (it cannot call out to node-side helpers).
  const { box, items } = await root.evaluate((rootEl, exempt) => {
    const rectOf = (e: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = e.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const found: Array<{
      where: string;
      rect: ReturnType<typeof rectOf>;
      clips: Array<ReturnType<typeof rectOf>>;
      topExempt: boolean;
    }> = [];
    for (const e of rootEl.querySelectorAll("*")) {
      const cs = getComputedStyle(e);
      if ((e as HTMLElement).offsetParent === null || cs.opacity === "0" || cs.visibility === "hidden" || e.closest(".sr-only")) continue;
      const clips: Array<ReturnType<typeof rectOf>> = [];
      let transparent = false; // opacity is not inherited: a child of an `opacity:0` ancestor still computes opacity 1
      for (let a = e.parentElement; a && a !== rootEl; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.opacity === "0") transparent = true;
        if (acs.overflowX !== "visible" || acs.overflowY !== "visible") clips.push(rectOf(a));
      }
      if (transparent) continue;
      const tid = e.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
      found.push({
        where: `${e.tagName.toLowerCase()}${tid ? `@${tid}` : ""}`,
        rect: rectOf(e),
        clips,
        topExempt: exempt ? e.matches(exempt) : false,
      });
    }
    return { box: rectOf(rootEl), items: found };
  }, topExempt ?? null);
  return overflowOf(box, items);
}

/**
 * Composited text colour and effective background of ONE element as `[r,g,b]`,
 * resolved through the same canvas + ancestor-stack path as `measureText`.
 * For text `measureText` skips (an `aria-hidden` count), pair with `contrastRatio`.
 */
export function elementColors(el: Locator): Promise<{ fg: number[]; bg: number[] }> {
  return el.evaluate((e) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): number[] => {
      cv.clearRect(0, 0, 1, 1);
      cv.fillStyle = "#000";
      cv.fillStyle = c;
      cv.fillRect(0, 0, 1, 1);
      const d = cv.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], bot: number[]): number[] => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1);
    };
    const stack: number[][] = [];
    for (let n: Element | null = e; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) stack.push(c);
      if (c[3] >= 1) break;
    }
    let bg = [255, 255, 255, 1];
    for (const c of stack.reverse()) bg = over(c, bg);
    const fg = over(rgba(getComputedStyle(e).color), bg);
    return { fg: fg.slice(0, 3), bg: bg.slice(0, 3) };
  });
}

/** Every visible button under `scope`, with its rendered box. */
export function buttonBoxes(scope: Locator): Promise<Array<{ name: string; w: number; h: number }>> {
  return scope.evaluate((root) =>
    [...root.querySelectorAll("button")]
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => {
        const r = b.getBoundingClientRect();
        const name = b.getAttribute("data-testid") ?? b.getAttribute("aria-label") ?? (b.textContent ?? "").trim().slice(0, 24);
        return { name, w: Math.round(r.width), h: Math.round(r.height) };
      }),
  );
}

/**
 * Resolve a CSS colour expression (`var(--tint-green-bg)`, `#fff`, …) to
 * `[r,g,b]` 0–255 in the live document, through the same canvas path as
 * `measureText`, so the two are directly comparable.
 */
export function resolveColor(page: Page, expr: string): Promise<number[]> {
  return page.evaluate((e) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = e;
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    cv.fillStyle = "#000";
    cv.fillStyle = computed;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, expr);
}

/** Computed background of one element as `[r,g,b]` (canvas-resolved, own layer only). */
export function ownBackground(el: Locator): Promise<number[]> {
  return el.evaluate((e) => {
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    cv.fillStyle = "#000";
    cv.fillStyle = getComputedStyle(e).backgroundColor;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
}

/** Max per-channel distance between two `[r,g,b]` triples (canvas rounding ≤ 1). */
export function colorDistance(a: number[], b: number[]): number {
  return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));
}

/**
 * Buttons under `scope` that show NO focus indicator when keyboard-focused.
 * Focus is moved with the keyboard-modality heuristic (`focus({focusVisible})`
 * where supported) so `:focus-visible` rules apply.
 */
export async function buttonsWithoutFocusIndicator(page: Page, scope: Locator): Promise<string[]> {
  const handles = await scope.locator("button:visible").all();
  const missing: string[] = [];
  for (const h of handles) {
    if (await h.isDisabled()) continue;
    await h.focus();
    await page.keyboard.press("Shift"); // keyboard modality → :focus-visible
    const shown = await h.evaluate((e) => {
      const s = getComputedStyle(e);
      const outline = s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0;
      const ring = /rgb/.test(s.boxShadow) && s.boxShadow !== "none";
      return outline || ring;
    });
    if (!shown) {
      missing.push(
        (await h.getAttribute("data-testid")) ?? (await h.getAttribute("aria-label")) ?? ((await h.textContent()) ?? "").trim().slice(0, 24),
      );
    }
  }
  return missing;
}

/**
 * Switch the dashboard theme + mode the way the user does (the persisted
 * localStorage keys `useTheme` reads), then wait for the result to apply.
 * Mirrors `applyTheme` in severity-contrast.spec.ts.
 */
export async function setThemeMode(page: Page, mode: "dark" | "light", theme = "base"): Promise<void> {
  await page.evaluate(
    ([t, m]) => {
      localStorage.setItem("dashboard:theme-name", t);
      localStorage.setItem("dashboard:theme", m);
    },
    [theme, mode],
  );
  await page.reload();
  // App mounted (useTheme runs on mount), then the mode actually applied.
  await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, undefined, { timeout: 30_000 });
  await page.waitForFunction(
    ([m]) => (document.documentElement.getAttribute("data-theme") === "light") === (m === "light"),
    [mode],
    { timeout: 10_000 },
  );
}
