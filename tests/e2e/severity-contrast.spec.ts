import { expect, type Page, test } from "./fixtures.js";
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

/**
 * The governed tool-result error surfaces (change: repair-tool-error-surfaces).
 *
 * Each entry is the token PAIR the component now declares: a foreground against
 * the background it actually sits on. `bg` may be semi-transparent (the severity
 * fills are `color-mix` tints), so it is composited over `under` — the opaque
 * surface behind it — before the ratio is computed.
 *
 * Tokens are referenced by NAME and resolved in the browser; the arithmetic runs
 * here in Node. The Tailwind class strings are asserted at the SOURCE layer by
 * scripts/__tests__/severity-literal-guard.test.mjs — reading them here would
 * make this gate depend on Tailwind's JIT having emitted that exact
 * arbitrary-value class into the bundle.
 */
interface Surface {
  name: string;
  fg: string;
  bg: string;
  under: string;
  /**
   * `accent` = a `--severity-*` token is involved, so the 3:1 floor applies.
   * `base`   = the pair is the theme's OWN body tokens (`--text-secondary` on
   *            `--bg-code`/`--bg-primary`) with no severity color added. Those
   *            are held to the same RELATIVE rule the `neutral` tier already
   *            uses: never worse than the theme's own
   *            `--text-secondary`-on-`--bg-tertiary`. 5 of 18 combos ship
   *            sub-AA base body text, so an absolute floor here would fail on a
   *            theme deficiency this change neither caused nor can fix.
   */
  tier: "accent" | "base";
}

const TOOL_SURFACES: readonly Surface[] = [
  // CtxToolRenderer.tsx:187-189 — chrome carries the signal, body stays neutral.
  { name: "ctx error label", fg: "--severity-error-fg", bg: "--severity-error-bg", under: "--bg-primary", tier: "accent" },
  { name: "ctx error body", fg: "--text-secondary", bg: "--bg-code", under: "--severity-error-bg", tier: "base" },
  { name: "ctx exit badge", fg: "--severity-error-fg", bg: "--bg-code", under: "--severity-error-bg", tier: "accent" },
  // ToolBurstGroup.tsx:383 — the `N failed` badge.
  { name: "burst failed badge", fg: "--severity-error-fg", bg: "--severity-error-bg", under: "--bg-primary", tier: "accent" },
  // BashOutputCard.tsx:46 — the non-zero `exit N` badge.
  { name: "bash exit badge", fg: "--severity-error-fg", bg: "--severity-error-bg", under: "--bg-primary", tier: "accent" },
  // ToolCallStep.tsx:149 — the errored tool's status icon, on the chat surface.
  { name: "tool-step error icon", fg: "--severity-error-fg", bg: "transparent", under: "--bg-primary", tier: "accent" },
  // AskUserToolRenderer.tsx:220-221 — icon accent + neutral message.
  { name: "ask_user error icon", fg: "--severity-error-fg", bg: "transparent", under: "--bg-primary", tier: "accent" },
  { name: "ask_user error message", fg: "--text-secondary", bg: "transparent", under: "--bg-primary", tier: "base" },
  // AgentToolRenderer.tsx:346 — `Error:` marker accent + neutral message.
  { name: "agent error marker", fg: "--severity-error-fg", bg: "transparent", under: "--bg-primary", tier: "accent" },
  { name: "agent error message", fg: "--text-secondary", bg: "transparent", under: "--bg-primary", tier: "base" },
];

type Rgba = [number, number, number, number];

/** Gamma-encoded sRGB 0..1 + alpha, from any serialization Chrome emits. */
function parseColor(s: string): Rgba {
  const t = s.trim();
  if (t === "transparent") return [0, 0, 0, 0];
  const mix = t.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (mix) return [+mix[1], +mix[2], +mix[3], mix[4] !== undefined ? +mix[4] : 1];
  const rgb = t.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255, rgb[4] !== undefined ? +rgb[4] : 1];
  // Never fall through to black: a serialization this function cannot read
  // (oklab()/lab()/color(display-p3 …)) would silently measure the wrong color
  // and report a confident, wrong ratio in either direction.
  throw new Error(`unparsed computed color: ${s}`);
}

/** Source-over composite of `top` onto an already-opaque `base`. */
function composite(top: Rgba, base: Rgba): Rgba {
  return [
    top[0] * top[3] + base[0] * (1 - top[3]),
    top[1] * top[3] + base[1] * (1 - top[3]),
    top[2] * top[3] + base[2] * (1 - top[3]),
    1,
  ];
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (c: Rgba) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Resolve each token name to its computed color string, in the live document. */
function resolveTokens(page: Page, names: readonly string[]): Promise<Record<string, string>> {
  return page.evaluate((TOKENS) => {
    const out: Record<string, string> = {};
    for (const token of TOKENS) {
      const el = document.createElement("div");
      el.style.backgroundColor = token.startsWith("--") ? `var(${token})` : token;
      document.body.appendChild(el);
      out[token] = getComputedStyle(el).backgroundColor;
      el.remove();
    }
    return out;
  }, names as string[]);
}

/** fg-on-bg contrast per surface, with alpha composited over the opaque base. */
function surfaceContrast(resolved: Record<string, string>, s: Surface): number {
  const white: Rgba = [1, 1, 1, 1];
  const under = composite(parseColor(resolved[s.under]), white); // themes ship opaque bases
  const bg = composite(parseColor(resolved[s.bg]), under);
  const fg = composite(parseColor(resolved[s.fg]), bg);
  return contrastRatio(fg, bg);
}

/**
 * Surfaces failing their floor, given one theme·mode's resolved tokens.
 * `accent` cells take the fixed 3:1 floor; `base` cells take the theme's own
 * `--text-secondary`-on-`--bg-tertiary` ratio when that is already below it.
 */
function failingSurfaces(resolved: Record<string, string>): string[] {
  const themeBase = surfaceContrast(resolved, {
    name: "theme base",
    fg: "--text-secondary",
    bg: "--bg-tertiary",
    under: "--bg-primary",
    tier: "base",
  });
  const out: string[] = [];
  for (const s of TOOL_SURFACES) {
    const c = surfaceContrast(resolved, s);
    const floor = s.tier === "accent" ? FLOOR : Math.min(FLOOR, themeBase);
    if (c + 0.01 < floor) out.push(`${s.name}=${c.toFixed(2)} (floor ${floor.toFixed(2)})`);
  }
  return out;
}

test.describe("tool-result error surfaces — token contrast (repair-tool-error-surfaces)", () => {
  test.setTimeout(180_000);

  // The reported bug was light-mode-only: 7/7 surfaces failed light, 0/7 dark,
  // because the raw literals they replaced were only ever eyeballed on a dark ground.
  test("every governed tool-result error surface clears the floor in all themes/modes", async ({ page }) => {
    await gotoDashboard(page);

    const tokens = [...new Set([...TOOL_SURFACES.flatMap((s) => [s.fg, s.bg, s.under]), "--bg-tertiary"])];
    const belowFloor: string[] = [];
    let cells = 0;

    for (const theme of THEMES) {
      for (const mode of MODES) {
        await applyTheme(page, theme, mode);
        const resolved = await resolveTokens(page, tokens);
        cells += TOOL_SURFACES.length;
        belowFloor.push(...failingSurfaces(resolved).map((f) => `${theme}/${mode}/${f}`));
      }
    }

    expect(cells).toBe(THEMES.length * MODES.length * TOOL_SURFACES.length);
    expect(belowFloor, `surfaces under their floor: ${belowFloor.join(", ")}`).toEqual([]);
  });
});
