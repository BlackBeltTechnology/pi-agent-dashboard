/**
 * Guard for MermaidBlock's test-only colour fallbacks: `FALLBACK_ACCENTS` and the
 * `--text-primary` hex fallback never paint in a browser ONLY IF every palette
 * defines the seven variables as `#rgb` / `#rrggbb`. `rgba()` in MermaidBlock
 * parses hex only, so a palette written in `oklch()` would silently break node
 * tinting. See change: retro-ux-chat-rendering (design D2; test-plan E6, E7).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "../theme/themes.js";

// index.css lives two dirs up from this __tests__ folder (src/lib/__tests__ -> src).
const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

const GUARDED = [
  "--accent-blue",
  "--accent-green",
  "--accent-yellow",
  "--accent-red",
  "--accent-purple",
  "--accent-orange",
  "--text-primary",
] as const;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface PaletteLike {
  id: string;
  dark: Record<string, string>;
  light: Record<string, string>;
}

export interface NonHexEntry {
  palette: string;
  mode: string;
  variable: string;
  value: string | undefined;
}

/** Declarations of the first top-level rule whose selector is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const start = source.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"));
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  const open = source.indexOf("{", start);
  return source.slice(open + 1, source.indexOf("}", open));
}

function declared(body: string, variable: string): string | undefined {
  return new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim();
}

/** Every guarded variable that is missing or not hex, per palette/mode and in the CSS blocks. */
export function nonHexAccents(themes: readonly PaletteLike[], cssSource: string): NonHexEntry[] {
  const out: NonHexEntry[] = [];
  const check = (palette: string, mode: string, value: string | undefined, variable: string, required: boolean) => {
    if (value === undefined ? required : !HEX.test(value)) out.push({ palette, mode, variable, value });
  };

  // `:root` defines all seven.
  const root = ruleBody(cssSource, ":root");
  for (const v of GUARDED) check(":root", "dark", declared(root, v), v, true);

  // The light block inherits the accents; it must define --text-primary, and any accent it does define.
  const light = ruleBody(cssSource, '[data-theme="light"]');
  for (const v of GUARDED) check('[data-theme="light"]', "light", declared(light, v), v, v === "--text-primary");

  for (const theme of themes) {
    for (const mode of ["dark", "light"] as const) {
      for (const v of GUARDED) check(theme.id, mode, theme[mode][v], v, true);
    }
  }
  return out;
}

describe("mermaid accent fallback guard", () => {
  it("E6: every palette, :root and the light block define the guarded variables as hex", () => {
    expect(nonHexAccents(THEMES, css)).toEqual([]);
  });

  it("E7: a non-hex accent is reported with palette, mode and variable", () => {
    const bad: PaletteLike = {
      id: "x",
      dark: { ...THEMES[0].dark, "--accent-red": "oklch(0.6 0.2 25)" },
      light: THEMES[0].light,
    };
    const found = nonHexAccents([bad], css);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ palette: "x", mode: "dark", variable: "--accent-red" });
  });
});
