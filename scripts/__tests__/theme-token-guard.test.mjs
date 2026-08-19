import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBaseline, ratchet, scan, total } from "../theme-token-guard.mjs";

/**
 * The guard's two arms are RATCHETS. The tests that matter are therefore not
 * "does it detect a fallback literal" (trivial) but the three ratchet
 * invariants: the pre-existing tree passes, a NEW binding fails, and a repaired
 * entry cannot be reintroduced once removed from the baseline.
 *
 * See change: add-zrok-custom-reserved-name (test-plan E22/E23/E24).
 */

/** A throwaway source tree with one component file. */
function fixture(source, css = ":root {\n  --accent: #3b82f6;\n}\n") {
  const root = mkdtempSync(join(tmpdir(), "theme-guard-"));
  mkdirSync(join(root, "src", "components"), { recursive: true });
  mkdirSync(join(root, "packages", "client", "src"), { recursive: true });
  writeFileSync(join(root, "packages", "client", "src", "index.css"), css);
  writeFileSync(join(root, "src", "components", "Widget.tsx"), source);
  return { root, roots: ["src"] };
}

describe("theme-token-guard scan", () => {
  it("records a fallback-form binding with its occurrence count", () => {
    const { root, roots } = fixture(
      'const a = "bg-[var(--panel,#1d3a63)]";\nconst b = "text-[var(--panel,#1d3a63)]";\n',
    );
    const { fallback } = scan({ root, roots });
    expect(fallback["src/components/Widget.tsx::--panel"]).toBe(2);
  });

  it("does NOT record a binding that resolves from a declared token", () => {
    const { root, roots } = fixture('const a = "bg-[var(--accent)]";\n');
    const { fallback, undeclared } = scan({ root, roots });
    expect(fallback).toEqual({});
    expect(undeclared).toEqual({});
  });

  it("records a bare reference to a colour token declared nowhere", () => {
    const { root, roots } = fixture('const a = "border-[var(--border-focus)]";\n');
    expect(scan({ root, roots }).undeclared["src/components/Widget.tsx::--border-focus"]).toBe(1);
  });

  it("ignores non-colour custom properties in the undeclared arm", () => {
    const { root, roots } = fixture('const a = "w-[var(--rail-width)] blur-[var(--glow-blur)]";\n');
    expect(scan({ root, roots }).undeclared).toEqual({});
  });

  it("skips test files, which may hold fixtures that are not real paints", () => {
    const { root, roots } = fixture("// real source\n");
    writeFileSync(
      join(root, "src", "components", "Widget.test.tsx"),
      'const a = "bg-[var(--nope,#fff)]";\n',
    );
    expect(scan({ root, roots }).fallback).toEqual({});
  });
});

describe("theme-token-guard ratchet", () => {
  // E22 — the baseline does not fail the build.
  it("passes when the tree matches the baseline exactly", () => {
    const found = { "a.tsx::--x": 2, "b.tsx::--y": 1 };
    const r = ratchet(found, { "a.tsx::--x": 2, "b.tsx::--y": 1 });
    expect(r.ok).toBe(true);
    expect(r.added).toEqual([]);
  });

  // E23 — a NEW binding outside the baseline fails, naming binding and file.
  it("fails on a binding at a site the baseline never had", () => {
    const r = ratchet({ "a.tsx::--x": 1, "new.tsx::--z": 1 }, { "a.tsx::--x": 1 });
    expect(r.ok).toBe(false);
    expect(r.added).toEqual([{ key: "new.tsx::--z", found: 1, allowed: 0 }]);
  });

  // Presence-only keys would let a baselined site GROW silently.
  it("fails when a baselined site gains an extra occurrence", () => {
    const r = ratchet({ "a.tsx::--x": 3 }, { "a.tsx::--x": 2 });
    expect(r.ok).toBe(false);
    expect(r.added).toEqual([{ key: "a.tsx::--x", found: 3, allowed: 2 }]);
  });

  // E24 — the baseline only shrinks.
  it("reports a repair as shrinkable rather than failing", () => {
    const r = ratchet({ "a.tsx::--x": 1 }, { "a.tsx::--x": 1, "b.tsx::--y": 1 });
    expect(r.ok).toBe(true);
    expect(r.repaired).toEqual(["b.tsx::--y"]);
  });

  it("fails when a repaired entry, removed from the baseline, is reintroduced", () => {
    const afterRepair = { "a.tsx::--x": 1 }; // --y deleted from the baseline
    const r = ratchet({ "a.tsx::--x": 1, "b.tsx::--y": 1 }, afterRepair);
    expect(r.ok).toBe(false);
    expect(r.added.map((a) => a.key)).toEqual(["b.tsx::--y"]);
  });
});

describe("theme-token-guard against the real tree", () => {
  const found = scan();
  const baseline = loadBaseline();

  // E22 — the load-bearing one: this must pass on an unmodified checkout, or
  // the guard forces the repo-wide reflow the change declares out of scope.
  it("passes on the repository as it stands", () => {
    const fallbackR = ratchet(found.fallback, baseline.fallback);
    const undeclaredR = ratchet(found.undeclared, baseline.undeclared);
    expect(fallbackR.added, "new fallback-form bindings").toEqual([]);
    expect(undeclaredR.added, "new undeclared colour tokens").toEqual([]);
  });

  it("carries a non-empty baseline on both arms (a ratchet with nothing to ratchet is vacuous)", () => {
    expect(total(baseline.fallback)).toBeGreaterThan(0);
    expect(total(baseline.undeclared)).toBeGreaterThan(0);
  });

  // The change repaired these; if any reappears in the baseline the repair was
  // undone and re-blessed instead of fixed.
  it("baselines NONE of the four accent-ramp tokens this change declared", () => {
    const ramp = ["--accent", "--accent-soft", "--accent-solid", "--accent-text"];
    const offenders = [...Object.keys(baseline.fallback), ...Object.keys(baseline.undeclared)].filter(
      (k) => ramp.includes(k.split("::")[1]),
    );
    expect(offenders).toEqual([]);
  });

  it("enumerates the pre-existing undeclared tokens rather than ignoring them", () => {
    const tokens = new Set(Object.keys(baseline.undeclared).map((k) => k.split("::")[1]));
    for (const t of ["--border", "--danger", "--success", "--bg-input", "--border-focus"]) {
      expect(tokens.has(t), `${t} must be baselined, not silently skipped`).toBe(true);
    }
  });
});
