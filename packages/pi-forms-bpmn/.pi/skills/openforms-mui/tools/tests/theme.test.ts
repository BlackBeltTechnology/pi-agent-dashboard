import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { themeFromTokens, defaultTheme } from "../src/theme/from-tokens";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

describe("theme bridge (tasks 5.1, 5.2)", () => {
  it("produces a MUI theme from DTCG tokens", () => {
    const theme = themeFromTokens({
      color: {
        primary: { $value: "#0a7d33" },
        secondary: { $value: "#333333" },
      },
      radius: { base: { $value: 12 } },
    });
    expect(theme.palette.primary.main).toBe("#0a7d33");
    expect(theme.shape.borderRadius).toBe(12);
  });

  it("falls back to a documented default when no tokens are present", () => {
    const theme = themeFromTokens(null);
    expect(theme.palette.primary.main).toBe(defaultTheme().palette.primary.main);
  });
});

describe("token-lint: no literal colour in component sources (task 5.3)", () => {
  // Colour literals belong only in the token/theme layer. Component widgets must
  // read from the theme. Scan field components + the root component.
  const COMPONENT_DIRS = [join(srcDir, "fields")];
  const COMPONENT_FILES = [join(srcDir, "OpenFormsMui.tsx")];

  function collectSources(): string[] {
    const files: string[] = [];
    for (const dir of COMPONENT_DIRS) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".tsx") || f.endsWith(".ts")) files.push(join(dir, f));
      }
    }
    for (const f of COMPONENT_FILES) if (existsSync(f)) files.push(f);
    return files;
  }

  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const RGB = /\brgba?\(/;
  const HSL = /\bhsla?\(/;

  it("contains no hex / rgb / hsl colour literals", () => {
    const offenders: string[] = [];
    for (const file of collectSources()) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (HEX.test(line) || RGB.test(line) || HSL.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
