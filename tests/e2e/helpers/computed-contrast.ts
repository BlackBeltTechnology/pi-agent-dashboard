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
      };
    });
  });
}

/** Human-readable failures of `measureText` against `floor` (default = per-node need). */
export function contrastFailures(ms: TextMeasure[], floor?: number): string[] {
  return ms
    .filter((m) => m.ratio + 0.01 < (floor ?? m.need))
    .map((m) => `${m.where} "${m.text}" ${m.ratio}:1 (need ${floor ?? m.need})`);
}

/** Text below 11 px anywhere, or below 12 px on interactive text. */
export function sizeFailures(ms: TextMeasure[], opts: { dense?: number; interactive?: number } = {}): string[] {
  const dense = opts.dense ?? 11;
  const interactive = opts.interactive ?? 12;
  return ms
    .filter((m) => m.fontSize < dense || (m.interactive && m.fontSize < interactive))
    .map((m) => `${m.where} "${m.text}" ${m.fontSize}px`);
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
