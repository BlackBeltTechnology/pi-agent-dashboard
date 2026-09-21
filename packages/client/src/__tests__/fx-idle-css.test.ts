/**
 * Regression coverage for test-plan row E20 (capability `ui-animation-energy`,
 * change: fix-long-session-ux-degradation §7, design D8).
 *
 * Markup carrying `animate-pulse` or `.tool-group-spin-pulse` must NOT be
 * matched by the idle exemption — those are decorative liveness animations that
 * merely restate a static state (status-dot pulses, group shimmer), and they
 * are exactly the continuous cost this change removes. Only indeterminate
 * ROTATION (`animate-spin`, `fx-progress`) is exempt, and only while idleness
 * is the sole reason to pause (the hidden-window and off-screen re-pauses win).
 *
 * jsdom does not resolve stylesheet selectors against rendered markup, so the
 * exemption selector list is asserted against the CSS source directly. See
 * `packages/client/src/components/__tests__/body-drag-delegation.test.tsx` for
 * the same source-scan idiom.
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
}

const rules: CssRule[] = [];
for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1]
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (selectors.length > 0) rules.push({ selectors, body: match[2] });
}

/** Every selector of every rule that sets a given `animation-play-state`. */
const playState = (state: "running" | "paused"): string[] =>
  rules
    .filter((r) => new RegExp(`animation-play-state:\\s*${state}`).test(r.body))
    .flatMap((r) => r.selectors);

describe("fx-idle exemption ladder in index.css (E20)", () => {
  it("exempts exactly the two indeterminate-rotation indicator selectors", () => {
    expect(playState("running")).toEqual([
      ":root.fx-idle .animate-spin",
      ":root.fx-idle .fx-progress",
    ]);
  });

  it("does not exempt the decorative liveness classes", () => {
    const exempt = playState("running");
    for (const cls of ["animate-pulse", "tool-group-spin-pulse"]) {
      expect(exempt.some((s) => s.includes(cls))).toBe(false);
    }
  });

  it("re-pauses the exemption when the hidden or off-screen pause also applies", () => {
    // Without these, the (0,3,0) exemption beats `:root.app-hidden *` (0,2,0)
    // and `.fx-offscreen *` (0,1,0) — leaking spinners in a hidden window and
    // off an off-screen card.
    expect(playState("paused")).toEqual(
      expect.arrayContaining([
        ":root.fx-idle *",
        ":root.app-hidden .animate-spin",
        ":root.app-hidden .fx-progress",
        ":root.fx-idle .fx-offscreen .animate-spin",
        ":root.fx-idle .fx-offscreen .fx-progress",
      ]),
    );
  });
});
