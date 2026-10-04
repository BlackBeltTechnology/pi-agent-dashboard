/**
 * Derive the `--accent-<hue>-text` ramp (design D1) from the live `THEMES`.
 *
 * Run from `packages/client`:
 *   npx tsx ../../openspec/changes/archive/2026-10-04-remediate-accent-text-contrast/derive-accent-text.ts
 *
 * For each (palette, hue): a source accent whose floor (min contrast over the
 * four text backdrops) is already ≥ 4.5 is copied unchanged. Otherwise HSL
 * lightness is stepped by 1/300 (H, S fixed) toward the pole `--bg-surface`
 * contrasts best with, converting back with the CSS `hsl()` formula and
 * `Math.round` per channel, stopping at the first ROUNDED hex whose floor ≥ 4.5.
 *
 * Not a runtime or build dependency. `theme-body-text-contrast.test.ts`
 * re-measures every literal; this script exists for reproducibility only.
 */

// themes.ts pulls in i18n, which reads `window.navigator` at import time.
(globalThis as { window?: unknown }).window ??= { navigator: { language: "en" } };
const { THEMES } = await import("../../../../packages/client/src/lib/theme/themes.js");

const HUES = ["purple", "blue", "green", "orange", "red", "yellow"] as const;
const AA = 4.5;
const STEP = 1 / 300;

const rgb = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function luminance(hex: string): number {
  const ch = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB #rrggbb → HSL, all components in 0–1 (CSS model). */
function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

/** CSS Color 4 `hsl()` → sRGB, channels rounded with Math.round. */
function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([f(0), f(8), f(4)].map((v) => v * 255));
}

/** Card fill: `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))`, 50/50. */
function cardFill(vars: Record<string, string>): string {
  const a = rgb(vars["--bg-secondary"]);
  const b = rgb(vars["--bg-tertiary"]);
  return toHex(a.map((x, i) => x * 0.5 + b[i] * 0.5));
}

/** CIE76 ΔE: sRGB → linear → XYZ (D65) → CIELAB. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deltaE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

let remediated = 0;
let unchanged = 0;
let infeasible = 0;
const deltaRows: string[] = [];

for (const theme of THEMES) {
  for (const mode of ["dark", "light"] as const) {
    const vars = theme[mode];
    const backdrops = [vars["--bg-surface"], vars["--bg-tertiary"], vars["--bg-primary"], cardFill(vars)];
    const floor = (c: string) => Math.min(...backdrops.map((b) => contrast(c, b)));
    const up = contrast("#ffffff", vars["--bg-surface"]) > contrast("#000000", vars["--bg-surface"]);
    const out: Record<string, string> = {};
    console.log(`// ${theme.id}:${mode}`);
    for (const hue of HUES) {
      const src = vars[`--accent-${hue}`];
      let value: string | null = null;
      if (floor(src) >= AA) {
        value = src;
        unchanged++;
      } else {
        const [h, s, l0] = toHsl(src);
        for (let i = 1; ; i++) {
          const l = up ? l0 + i * STEP : l0 - i * STEP;
          if (l > 1 || l < 0) break;
          const cand = fromHsl(h, s, l);
          if (floor(cand) >= AA) {
            value = cand;
            break;
          }
        }
        if (value) remediated++;
        else infeasible++;
      }
      out[hue] = value ?? "INFEASIBLE";
      console.log(`  "--accent-${hue}-text": "${out[hue]}",`);
    }
    let min = Number.POSITIVE_INFINITY;
    let pair = "";
    for (let i = 0; i < HUES.length; i++) {
      for (let j = i + 1; j < HUES.length; j++) {
        const d = deltaE(out[HUES[i]], out[HUES[j]]);
        if (d < min) [min, pair] = [d, `${HUES[i]}/${HUES[j]}`];
      }
    }
    deltaRows.push(`${theme.id}:${mode}  min ΔE ${min.toFixed(1)}  (${pair})`);
  }
}

console.log(`\n${remediated} remediated / ${unchanged} unchanged / ${infeasible} infeasible`);
console.log(deltaRows.join("\n"));
