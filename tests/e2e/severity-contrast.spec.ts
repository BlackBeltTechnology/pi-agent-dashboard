import { expect, type Page, test } from "@playwright/test";
import { byTestId, gotoDashboard } from "./helpers/index.js";

/**
 * Browser-layer gate for change `unify-message-severity-colors`.
 *
 * The `--severity-*` triples are derived via `color-mix()`, which jsdom/vitest
 * cannot resolve — only a real browser computes them. These specs read the
 * RESOLVED colors (`getComputedStyle` of probe elements whose CSS properties
 * reference the tokens) across every named theme × {light,dark} and assert the
 * accessibility contract.
 *
 * Gate (design.md D6, resolution A — the relative gate): adding color to text
 * always lowers its contrast below the pure base text, and 5/18 theme·mode
 * combos already ship sub-AA base body text. So an absolute 4.5:1-everywhere
 * gate is unsatisfiable. Instead every accent tier clears a 3:1 legibility
 * FLOOR across all themes (AA 4.5:1 is met on the majority), `neutral` reuses
 * the theme's literal base tokens, and there is exactly ONE documented
 * exception: tokyo-night light `info` — that theme's own body text is already
 * sub-AA (~3.5:1, its `--text-primary` is itself blue), so no derived blue tint
 * can beat it. See SHIP_IT_BLOCKED.md history + design D4/D6.
 */

const THEMES = [
  "base", "dracula", "nord", "github", "catppuccin",
  "tokyo-night", "rose-pine", "solarized", "gruvbox",
];
const MODES = ["dark", "light"] as const;
const ACCENT_TIERS = ["error", "warning", "success", "info"] as const;
const ALL_TIERS = [...ACCENT_TIERS, "neutral"] as const;

const FLOOR = 3.0; // WCAG UI/large-text floor; severity color is a redundant cue.
const AA = 4.5;
// Documented theme-ceiling exceptions: cell key → its (lower) allowed floor.
const EXCEPTIONS: Record<string, number> = { "tokyo-night/light/info": 2.5 };

async function applyTheme(page: Page, theme: string, mode: string): Promise<void> {
  await page.evaluate(
    ([t, m]) => {
      localStorage.setItem("dashboard:theme-name", t);
      localStorage.setItem("dashboard:theme", m);
    },
    [theme, mode],
  );
  await page.reload();
  await byTestId(page, "headerAppBar").waitFor({ state: "visible", timeout: 30_000 });
  // useTheme applies inline --accent-*/--bg-tertiary vars on mount for non-base
  // themes; base removes overrides (CSS :root/[data-theme=light] drives it).
  if (theme !== "base") {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--accent-red")), { timeout: 10_000 })
      .not.toBe("");
  }
  if (mode === "light") {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")), { timeout: 10_000 })
      .toBe("light");
  }
}

/** Read resolved bg/fg/close colors + contrast for every tier, in-browser. */
function readTiers(page: Page, tiers: readonly string[]) {
  return page.evaluate((TIERS) => {
    // Normalize to 0..1 gamma-encoded sRGB channels + alpha. Chrome serializes
    // color-mix() results as `color(srgb r g b / a)` (0..1 floats) but plain
    // colors as `rgb(r, g, b)` (0..255) — handle both.
    const parse = (s: string): [number, number, number, number] => {
      let m = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
      if (m) return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
      m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
      if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] !== undefined ? +m[4] : 1];
      const n = (s.match(/[\d.]+/g) ?? []).map(Number);
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const contrast = (a: number[], b: number[]) => {
      const l1 = L(a), l2 = L(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };
    const out: Record<string, { bg: number[]; fg: number[]; close: number[]; contrast: number }> = {};
    for (const t of TIERS) {
      const el = document.createElement("div");
      el.style.backgroundColor = `var(--severity-${t}-bg)`;
      el.style.color = `var(--severity-${t}-fg)`;
      el.textContent = "sample";
      // Close-button pattern: variant -fg at reduced opacity (Tailwind /70).
      const close = document.createElement("span");
      close.className = `text-[var(--severity-${t}-fg)]/70`;
      el.appendChild(close);
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const bg = parse(cs.backgroundColor), fg = parse(cs.color);
      const closeColor = parse(getComputedStyle(close).color);
      out[t] = { bg, fg, close: closeColor, contrast: contrast(fg, bg) };
      el.remove();
    }
    return out;
  }, tiers as string[]);
}

test.describe("severity tokens — derived-triple contrast (unify-message-severity-colors)", () => {
  test.setTimeout(180_000);

  // ── E12 (task 5.12): contrast sweep across all themes × light+dark ─────────
  test("derived triples clear the relative contrast gate across all themes", async ({ page }) => {
    await gotoDashboard(page);

    let aaCount = 0;
    let total = 0;
    const belowFloor: string[] = [];

    for (const theme of THEMES) {
      for (const mode of MODES) {
        await applyTheme(page, theme, mode);
        const tiers = await readTiers(page, ALL_TIERS);
        for (const tier of ALL_TIERS) {
          const key = `${theme}/${mode}/${tier}`;
          const c = tiers[tier].contrast;
          total++;
          if (c >= AA) aaCount++;
          const floor = EXCEPTIONS[key] ?? FLOOR;
          if (c + 0.01 < floor) belowFloor.push(`${key}=${c.toFixed(2)} (floor ${floor})`);
        }
      }
    }

    // Hard gate: every cell clears its floor (documented exceptions get a lower one).
    expect(belowFloor, `cells under floor: ${belowFloor.join(", ")}`).toEqual([]);
    // Documentation: the majority of the 90 cells meet full AA 4.5:1.
    expect(total).toBe(THEMES.length * MODES.length * ALL_TIERS.length);
    expect(aaCount, `only ${aaCount}/${total} cells meet AA 4.5:1`).toBeGreaterThanOrEqual(55);
  });

  // ── F1/F2/F3 (tasks 5.13–5.15): base-theme render invariants ───────────────
  test("variants are distinct, warning≠working-yellow, close reuses fg at reduced opacity", async ({ page }) => {
    await gotoDashboard(page);
    await applyTheme(page, "base", "dark");

    const tiers = await readTiers(page, ALL_TIERS);

    // F1 (5.13): every variant's computed background is distinct.
    const bgKey = (t: string) => tiers[t].bg.slice(0, 3).join(",");
    const bgs = ALL_TIERS.map(bgKey);
    expect(new Set(bgs).size, `bgs: ${bgs.join(" | ")}`).toBe(ALL_TIERS.length);

    // F2 (5.14): warning (orange) hue differs from --status-working (yellow).
    const workingHue = await page.evaluate(() => {
      const el = document.createElement("div");
      el.style.backgroundColor = "var(--status-working)";
      document.body.appendChild(el);
      const [r, g, b] = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
      el.remove();
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d !== 0) {
        if (mx === r) h = (((g - b) / d) % 6);
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
      }
      h *= 60; if (h < 0) h += 360;
      return h;
    });
    const hueOf = ([r, g, b]: number[]) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d !== 0) {
        if (mx === r) h = (((g - b) / d) % 6);
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
      }
      h *= 60; if (h < 0) h += 360;
      return h;
    };
    const warnHue = hueOf(tiers.warning.bg);
    expect(Math.abs(warnHue - workingHue), `warn ${warnHue.toFixed(0)}° vs working ${workingHue.toFixed(0)}°`).toBeGreaterThanOrEqual(10);

    // F3 (5.15): close-button color reuses the variant fg at reduced opacity
    // (alpha < 1), not a raw literal — its RGB tracks the fg while alpha drops.
    const err = tiers.error;
    expect(err.fg[3]).toBe(1); // the fg token itself is opaque
    expect(err.close[3], `close alpha ${err.close[3]}`).toBeLessThan(1);
    expect(err.close[3]).toBeGreaterThan(0);
  });
});
