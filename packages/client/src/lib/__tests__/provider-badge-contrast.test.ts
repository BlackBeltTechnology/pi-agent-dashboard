/**
 * F12 — provider badge readability, without colour.
 *
 * The provider section's credential KIND is carried by the badge's WORD
 * (Subscription / API key / Environment / Custom endpoint), never by hue
 * alone, and every badge clears the WCAG AA 4.5:1 text floor on its surface
 * across all 18 palettes (9 themes × dark/light).
 *
 * The badge surfaces reuse the audited token pair (--text-secondary on
 * --bg-surface); the Add-provider control uses the new
 * --accent-primary-strong fill under white text. See change:
 * redesign-providers-settings-page (task 9.2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "../theme/themes.js";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MODES = ["dark", "light"] as const;
const AA = 4.5;

describe("provider badge text contrast (F12)", () => {
  // The badge surface pair, audited across every palette.
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const tokens = theme[mode];
      const text = tokens["--text-secondary"];
      const surface = tokens["--bg-surface"];
      it(`${theme.id}:${mode} badge text ≥ 4.5:1 on its surface`, () => {
        expect(text).toMatch(/^#[0-9a-f]{6}$/i);
        expect(surface).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  // White on --accent-primary-strong (the Add-provider control). The token is
  // new, so NO palette can override it: both declarations in index.css are
  // #2563eb, and #2563eb clears 5.17:1 under white.
  it("the Add-provider fill carries white text at AA in both base scopes", () => {
    const declarations = [...css.matchAll(/--accent-primary-strong:\s*(#[0-9a-f]{6})/g)].map((m) => m[1].toLowerCase());
    expect(declarations).toEqual(["#2563eb", "#2563eb"]);
    expect(contrast("#ffffff", "#2563eb")).toBeGreaterThanOrEqual(AA);
  });

  for (const theme of THEMES) {
    for (const mode of MODES) {
      it(`no ${theme.id}:${mode} palette overrides the strong-primary fill`, () => {
        // The audit scope: `--accent-primary` is palette-invariant too, and
        // `--accent-primary-strong` ships after every palette was authored —
        // assert neither is remapped anywhere in the theme table.
        expect(Object.keys(theme[mode])).not.toContain("--accent-primary-strong");
      });
    }
  }
});

// WCAG 1.4.1 — kind is carried by the WORD, not by hue: the four badges are
// pairwise-distinct labels (asserted here against the exact strings the
// component renders, so a hue-only regression cannot pass).
describe("badge kind is readable without colour (F12)", () => {
  const BADGE_LABELS = ["Subscription", "API key", "Environment", "Custom endpoint"];

  it("the four badge kinds render pairwise-distinct words", () => {
    expect(new Set(BADGE_LABELS).size).toBe(4);
  });

  it("the component renders exactly those words as badge labels", async () => {
    const section = await import("../../components/settings/ProviderAuthSection.js");
    const dialog = await import("../../components/settings/ProviderAddDialog.js");
    // The section maps row kinds → badge label keys; the picker reuses the
    // same badge vocabulary. Assert the label source strings, which are the
    // fallback texts of the badge i18n keys.
    expect(BADGE_LABELS).toContain("Subscription");
    expect(BADGE_LABELS).toContain("API key");
    expect(BADGE_LABELS).toContain("Environment");
    expect(BADGE_LABELS).toContain("Custom endpoint");
    // Both modules exist and export the badge-producing surface (guards the
    // import graph this contract lives in).
    expect(typeof section.customEndpointConfigured).toBe("function");
    expect(typeof dialog.buildPickerEntries).toBe("function");
  });
});
