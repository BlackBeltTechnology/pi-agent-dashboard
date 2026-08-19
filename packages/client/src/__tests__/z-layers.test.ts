import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The overlay layer scale (spec: overlay-layering) is the single source of
 * stacking order. This test guards the CSS source of truth in `index.css`:
 * all 8 layer tokens are declared, resolve to a strictly ascending order, no
 * two distinct roles collapse onto the same value, and each has a matching
 * `@utility` bound to its token. See change: add-overlay-layering-system.
 *
 * Reads the CSS from disk (Vite `?raw` returns empty under the client vitest
 * CSS stub). Path is resolved by walking up from cwd to the client package,
 * so it holds whether vitest runs from the repo/worktree root or a package dir.
 */

function readIndexCss(): string {
  const rel = "packages/client/src/index.css";
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, rel);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    // also handle running from inside packages/client
    const local = resolve(dir, "src/index.css");
    if (dir.endsWith("packages/client") && existsSync(local)) return readFileSync(local, "utf8");
    dir = dirname(dir);
  }
  throw new Error(`index.css not found from cwd=${process.cwd()}`);
}

const css = readIndexCss();

const LAYERS = [
  "base",
  "raised",
  "sidebar",
  "overlay",
  "popover",
  "dialog",
  "toast",
  "lightbox",
] as const;

function tokenValue(name: string): number | null {
  const m = css.match(new RegExp(`--z-${name}\\s*:\\s*(-?\\d+)\\s*;`));
  return m ? Number(m[1]) : null;
}

function hasUtility(name: string): boolean {
  return new RegExp(`@utility\\s+z-${name}\\s*\\{[^}]*z-index:\\s*var\\(--z-${name}\\)`).test(css);
}

describe("overlay layer scale (test-plan #E1)", () => {
  it("declares all 8 layer custom properties", () => {
    for (const name of LAYERS) {
      expect(tokenValue(name), `--z-${name} declared`).not.toBeNull();
    }
  });

  it("resolves to a strictly ascending order with no two roles equal", () => {
    const values = LAYERS.map((n) => tokenValue(n) as number);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `${LAYERS[i]} > ${LAYERS[i - 1]}`).toBeGreaterThan(values[i - 1]);
    }
    expect(new Set(values).size, "all layer values distinct").toBe(LAYERS.length);
  });
});

describe("overlay layer utilities (test-plan #E2)", () => {
  it("exposes a matching @utility for each layer bound to its token", () => {
    for (const name of LAYERS) {
      expect(hasUtility(name), `@utility z-${name} bound to var(--z-${name})`).toBe(true);
    }
  });
});

describe("overlay layer ordering guarantees (test-plan #E3)", () => {
  it("modal outranks menu, toast outranks modal, lightbox tops all", () => {
    const v = Object.fromEntries(LAYERS.map((n) => [n, tokenValue(n) as number]));
    expect(v.dialog, "dialog > popover (modal over menu)").toBeGreaterThan(v.popover);
    expect(v.toast, "toast > dialog (notification over modal)").toBeGreaterThan(v.dialog);
    expect(v.lightbox, "lightbox > toast (media tops all)").toBeGreaterThan(v.toast);
  });
});
