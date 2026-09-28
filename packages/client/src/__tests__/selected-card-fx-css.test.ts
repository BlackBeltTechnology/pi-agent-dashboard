/**
 * Selected SessionCard iridescent FX — CSS contract.
 *
 * The glow layers must be visible ONLY outside the card edge: each rotating
 * `.card-glow-fx` sits inside a static `.card-glow-mask` wrapper carrying the
 * content-box xor mask (the mask must not rotate). Rim width is a token; the
 * light theme boosts the outside-only halo. See change:
 * fix-selected-card-light-wash.
 *
 * jsdom cannot resolve masks/stacking, so the stylesheet source is asserted
 * directly (same idiom as fx-idle-css.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface CssRule {
  selectors: string[];
  body: string;
  index: number;
}

const rules: CssRule[] = [];
for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1]
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (selectors.length > 0) rules.push({ selectors, body: match[2], index: match.index ?? 0 });
}

const rulesFor = (selector: string) => rules.filter((r) => r.selectors.includes(selector));
const bodyOf = (selector: string) =>
  rulesFor(selector)
    .map((r) => r.body)
    .join("\n");

/** Body of the top-level theme block (`:root {` / `[data-theme="light"] {`) declaring neon tokens. */
function themeBlock(opener: string): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(`${opener} {`, from);
    if (start < 0) return "";
    const end = css.indexOf("\n}", start);
    const body = css.slice(start, end);
    if (body.includes("--neon-")) return body;
    from = end;
  }
}

describe("selected card FX CSS (fix-selected-card-light-wash)", () => {
  it("masks each glow wrapper to the band outside the card edge", () => {
    const body = bodyOf(".card-glow-mask");
    expect(body).toMatch(/-webkit-mask:\s*linear-gradient\(#000 0 0\) content-box,\s*linear-gradient\(#000 0 0\)/);
    expect(body).toMatch(/-webkit-mask-composite:\s*xor/);
    expect(body).toMatch(/(^|[\s;])mask-composite:\s*exclude/);
    expect(body).toMatch(/padding:/);
    expect(bodyOf(".card-glow-mask-outer")).toMatch(/padding:/);
  });

  it("never masks the rotating layers", () => {
    for (const sel of [".card-glow-fx::before", ".card-ring-fx::before"]) {
      expect(bodyOf(sel)).not.toMatch(/mask/);
    }
  });

  it("keeps the glow wrapper absolutely positioned after the `.card-selected-ring > *` lift", () => {
    const lift = rules.find((r) => r.selectors.includes(".card-selected-ring > *"));
    expect(lift).toBeDefined();
    const override = rules.find(
      (r) => r.selectors.includes(".card-glow-mask") && /position:\s*absolute/.test(r.body) && r.index > (lift?.index ?? 0),
    );
    expect(override).toBeDefined();
  });

  it("drives the rim width from --neon-rim-width (3px)", () => {
    expect(themeBlock(":root")).toMatch(/--neon-rim-width:\s*3px/);
    const rim = bodyOf(".card-ring-fx");
    expect(rim).toMatch(/inset:\s*calc\(-1 \* var\(--neon-rim-width\)\)/);
    expect(rim).toMatch(/padding:\s*var\(--neon-rim-width\)/);
  });

  it("sets rim + glow tokens per theme", () => {
    const dark = themeBlock(":root");
    const light = themeBlock('[data-theme="light"]');
    expect(dark).toMatch(/--neon-rim-alpha:\s*0\.75/);
    expect(dark).toMatch(/--neon-glow-alpha:\s*0\.10/);
    expect(dark).toMatch(/--neon-glow-opacity:\s*0\.42/);
    expect(light).toMatch(/--neon-rim-alpha:\s*0\.75/);
    expect(light).toMatch(/--neon-glow-alpha:\s*0\.30/);
    expect(light).toMatch(/--neon-glow-opacity:\s*0\.65/);
  });

  it("folder collapse clip leaves room for the outside halo on the right", () => {
    // `.group-collapse > *` must clip (0fr collapse) but its clip box has to
    // reach 14px past the card edge, content width unchanged.
    const body = bodyOf(".group-collapse > *");
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/padding-right:\s*14px/);
    expect(body).toMatch(/margin-right:\s*-14px/);
  });

  it("hides the glow wrappers when conic-gradient is unsupported", () => {
    const start = css.indexOf("@supports not (background: conic-gradient(from 0deg, red, blue))");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toMatch(/\.card-glow-mask\s*\{\s*display:\s*none/);
  });
});
