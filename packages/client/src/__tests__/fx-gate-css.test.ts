/**
 * CSS gate for card effects (`data-fx-status` / `data-fx-glow`). Scenarios:
 * test-plan #E20, #E21. See change: add-focus-mode-and-card-block-toggles.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");

function body(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1];
}

describe("data-fx-status=off (#E20)", () => {
  it("stops the sweep animation and drops the repeating band", () => {
    expect(body('[data-fx-status="off"] .card-stripes-fx::before')).toMatch(/animation:\s*none/);
    for (const k of ["running", "unread", "input"]) {
      const rule = body(`[data-fx-status="off"] .card-stripes-${k}::before`);
      expect(rule).not.toContain("repeating-linear-gradient");
      expect(rule).toContain("background-image");
    }
  });
});

describe("data-fx-glow=off (#E20)", () => {
  it("hides the ring and glow layers", () => {
    const m = /\[data-fx-glow="off"\] \.card-ring-fx,[^{]*\{([^}]*)\}/.exec(css);
    expect(m?.[1]).toMatch(/display:\s*none/);
    expect(m?.[0]).toContain(".card-glow-mask");
  });
});

describe("reduced-motion untouched (#E21)", () => {
  it("the off-rules are scoped under [data-fx-*] and sit outside any media block", () => {
    const idx = css.indexOf('[data-fx-status="off"] .card-stripes-fx::before');
    const before = css.slice(0, idx);
    const opens = (before.match(/@media[^{]*\{/g) ?? []).length;
    // every @media opened before the gate is closed again before it (depth 0).
    let depth = 0;
    for (const ch of before) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    expect(depth).toBe(0);
    expect(opens).toBeGreaterThan(0);
  });
  it("pre-change reduced-motion card rules still present", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.card-stripes-fx::before \{ animation: none; \}\s*\}/);
    expect(css).toMatch(/\.card-ring-fx::before,\s*\.card-glow-fx::before \{ animation: none; \}/);
  });
});
