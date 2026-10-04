import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadBaseline, main, NON_TEXT_PAINT_FILES, ratchet, scan, total } from "../theme-token-guard.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE_ICON = "packages/client/src/lib/preview/file-icon.ts";

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

  // The fallback arm must not be an enumerated list of colour syntaxes: an
  // allow-list of #hex|rgb|hsl silently missed `transparent`, named colours,
  // `currentColor` and `color-mix()` — and color-mix is used throughout this
  // codebase, so the guard had a hole exactly where the next regression lands.
  it.each([
    ["transparent", 'const a = "bg-[var(--panel,transparent)]";'],
    ["a named colour", 'const a = "bg-[var(--panel,red)]";'],
    ["currentColor", 'const a = "text-[var(--panel,currentColor)]";'],
    ["color-mix()", 'const a = "bg-[var(--panel,color-mix(in srgb, red 10%, blue))]";'],
    ["oklch()", 'const a = "bg-[var(--panel,oklch(0.7 0.1 200))]";'],
  ])("catches a fallback written as %s", (_label, source) => {
    const { root, roots } = fixture(source);
    expect(scan({ root, roots })["fallback"]["src/components/Widget.tsx::--panel"]).toBe(1);
  });

  it("does NOT flag a token CHAIN — var(--a, var(--b)) is not a hardcoded literal", () => {
    const { root, roots } = fixture('const a = "bg-[var(--panel,var(--accent))]";');
    expect(scan({ root, roots }).fallback).toEqual({});
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

  it("carries a non-empty baseline on every arm (a ratchet with nothing to ratchet is vacuous)", () => {
    expect(total(baseline.fallback)).toBeGreaterThan(0);
    expect(total(baseline.undeclared)).toBeGreaterThan(0);
    expect(total(baseline.accentText)).toBeGreaterThan(0);
  });

  // G9 — the third arm is green on landing too.
  it("has no new accent-as-text paints", () => {
    expect(ratchet(found.accentText, baseline.accentText).added, "new accent-as-text paints").toEqual([]);
  });

  // G10 — the arm baselines fill-accent text paints only, and the allowlist
  // stays exactly the one spec-mandated file.
  it("baselines no -text token and nothing from the allowlisted icon table", () => {
    const keys = Object.keys(baseline.accentText);
    expect(keys.filter((k) => k.split("::")[1].endsWith("-text"))).toEqual([]);
    expect(keys.filter((k) => k.startsWith(`${FILE_ICON}::`))).toEqual([]);
  });

  it("keeps NON_TEXT_PAINT_FILES to the one mandated, existing, justified entry", () => {
    expect(NON_TEXT_PAINT_FILES).toHaveLength(1);
    expect(NON_TEXT_PAINT_FILES[0].path).toBe(FILE_ICON);
    expect(existsSync(join(REPO_ROOT, NON_TEXT_PAINT_FILES[0].path))).toBe(true);
    expect(NON_TEXT_PAINT_FILES[0].why.trim()).not.toBe("");
  });

  // G12 — tool-renderers mandates DiffView's accent text; it stays visible debt.
  it("keeps the spec-mandated DiffView accent text baselined", () => {
    const diff = Object.keys(baseline.accentText).filter((k) => k.includes("/DiffView.tsx::"));
    const tokens = diff.map((k) => k.split("::")[1]);
    for (const t of ["--accent-green", "--accent-red", "--accent-blue"]) expect(tokens).toContain(t);
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

// ── Arm 3: accent-as-text ───────────────────────────────────────────────────
// `--accent-<hue>` is the FILL role; coloured text must use `--accent-<hue>-text`
// (AA on every text backdrop). The arm ratchets the existing fill-accent text
// paints and fails on any new one.
// See change: remediate-accent-text-contrast (test-plan G1–G12, X1–X7).

/** A fixture tree laid out like the repo (`packages/client/src` root). */
function repoFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "theme-guard-accent-"));
  const files2 = { "packages/client/src/index.css": ":root {\n  --accent-red: #ef4444;\n}\n", ...files };
  for (const [rel, body] of Object.entries(files2)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return { root, roots: ["packages/client/src"] };
}

describe("theme-token-guard accentText scan", () => {
  it("records every text-paint form of a fill accent (G1)", () => {
    const { root, roots } = fixture(
      [
        'const a = "text-[var(--accent-red)]";',
        'const b = "text-[var(--accent-red)]/80";',
        'const c = "hover:text-[var(--accent-red)]";',
        'const d = "placeholder:text-[var(--accent-red)]";',
        "const e = `px-2 ${on ? \"text-[var(--accent-red)]\" : \"\"}`;",
        'const f = <span style={{ color: "var(--accent-blue)" }} />;',
      ].join("\n"),
    );
    const { accentText } = scan({ root, roots });
    expect(accentText["src/components/Widget.tsx::--accent-red"]).toBe(5);
    expect(accentText["src/components/Widget.tsx::--accent-blue"]).toBe(1);
  });

  it("records a CSS stylesheet colour declaration without touching the other arms (G2)", () => {
    const { root, roots } = fixture('const a = "bg-[var(--panel,#123456)]";\n');
    const before = scan({ root, roots });
    writeFileSync(join(root, "src", "components", "widget.css"), "a { color: var(--accent-green); }\n");
    const after = scan({ root, roots });
    expect(after.accentText["src/components/widget.css::--accent-green"]).toBe(1);
    expect(after.fallback).toEqual(before.fallback);
    expect(after.undeclared).toEqual(before.undeclared);
  });

  it("ignores -text tokens and every non-text paint (G3)", () => {
    const { root, roots } = fixture(
      [
        'const a = "text-[var(--accent-red-text)]";',
        'const b = <i style={{ color: "var(--accent-red-text)" }} />;',
        'const c = "bg-[var(--accent-green)] border-[var(--accent-green)] decoration-[var(--accent-red)]";',
        'const d = "background-color: var(--accent-red); border-color: var(--accent-red);";',
        'const e = "outline-color: var(--accent-red); caret-color: var(--accent-red);";',
        'const f = "accent-color: var(--accent-red); fill: var(--accent-red); stroke: var(--accent-red);";',
      ].join("\n"),
    );
    expect(scan({ root, roots }).accentText).toEqual({});
  });

  it("skips test files (G4)", () => {
    const { root, roots } = fixture("// real source\n");
    writeFileSync(join(root, "src", "components", "Widget.test.tsx"), 'const a = "text-[var(--accent-red)]";\n');
    expect(scan({ root, roots }).accentText).toEqual({});
  });

  it("skips an allowlisted file for this arm only (G5)", () => {
    const { root, roots } = repoFixture({
      [FILE_ICON]: 'const a = "text-[var(--accent-yellow)]";\nconst b = "bg-[var(--x, #fff)]";\n',
    });
    const found = scan({ root, roots });
    expect(found.accentText).toEqual({});
    expect(found.fallback[`${FILE_ICON}::--x`]).toBe(1);
  });

  it("lets the mandated icon table add a mapping without failing (G11)", () => {
    const { root, roots } = repoFixture({ [FILE_ICON]: '  { ext: "zig", cls: "text-[var(--accent-yellow)]" },\n' });
    expect(ratchet(scan({ root, roots }).accentText, {}).added).toEqual([]);
  });
});

describe("theme-token-guard accentText ratchet", () => {
  const W = "src/components/Widget.tsx";

  it("fails a new site, naming the token and the file (G6)", () => {
    const { root, roots } = fixture('const a = "text-[var(--accent-red)]";\n');
    const r = ratchet(scan({ root, roots }).accentText, {});
    expect(r.added).toEqual([{ key: `${W}::--accent-red`, found: 1, allowed: 0 }]);
  });

  it("fails when a baselined site grows (G7)", () => {
    const { root, roots } = fixture('const a = "text-[var(--accent-blue)]";\n'.repeat(3));
    const r = ratchet(scan({ root, roots }).accentText, { [`${W}::--accent-blue`]: 2 });
    expect(r.added).toEqual([{ key: `${W}::--accent-blue`, found: 3, allowed: 2 }]);
  });

  it("reports a migration as a repair, then fails its reintroduction (G8)", () => {
    const { root, roots } = fixture('const a = "text-[var(--accent-blue-text)]";\n');
    const step1 = ratchet(scan({ root, roots }).accentText, { [`${W}::--accent-blue`]: 2 });
    expect(step1.ok).toBe(true);
    expect(step1.repaired).toEqual([`${W}::--accent-blue`]);
    writeFileSync(join(root, W), 'const a = "text-[var(--accent-blue)]";\n');
    const step3 = ratchet(scan({ root, roots }).accentText, {});
    expect(step3.ok).toBe(false);
    expect(step3.added.map((a) => a.key)).toEqual([`${W}::--accent-blue`]);
  });
});

describe("theme-token-guard baseline bootstrap (--bootstrap-arm accentText)", () => {
  let err;
  beforeEach(() => {
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  const stderr = () => err.mock.calls.map((c) => c.join(" ")).join("\n");

  const OLD = { fallback: { "src/components/Widget.tsx::--panel": 1 }, undeclared: {} };
  const SRC = 'const a = "bg-[var(--panel,#123456)]";\nconst b = "text-[var(--accent-red)]";\n';

  function setup(baseline, source = SRC) {
    // Declare --accent-red so only the arms under test see the source.
    const { root, roots } = fixture(source, ":root {\n  --accent-red: #ef4444;\n}\n");
    const baselinePath = join(root, "baseline.json");
    if (baseline !== undefined) {
      writeFileSync(baselinePath, typeof baseline === "string" ? baseline : `${JSON.stringify(baseline, null, 2)}\n`);
    }
    return { opts: { root, roots, baselinePath }, baselinePath };
  }
  const BOOT = ["--write", "--bootstrap-arm", "accentText"];

  it("adds accentText to a baseline that lacks it, preserving the old maps (X1)", () => {
    const { opts, baselinePath } = setup(OLD);
    expect(main(BOOT, opts)).toBe(0);
    const out = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(out.accentText).toEqual({ "src/components/Widget.tsx::--accent-red": 1 });
    expect(JSON.stringify(out.fallback)).toBe(JSON.stringify(OLD.fallback));
    expect(JSON.stringify(out.undeclared)).toBe(JSON.stringify(OLD.undeclared));
  });

  it("refuses when accentText already exists, leaving the file untouched (X2)", () => {
    const { opts, baselinePath } = setup({ ...OLD, accentText: {} });
    const bytes = readFileSync(baselinePath, "utf8");
    const mtime = statSync(baselinePath).mtimeMs;
    expect(main(BOOT, opts)).not.toBe(0);
    expect(stderr()).toMatch(/accentText/);
    expect(readFileSync(baselinePath, "utf8")).toBe(bytes);
    expect(statSync(baselinePath).mtimeMs).toBe(mtime);
  });

  it("refuses on a missing baseline and creates nothing (X3)", () => {
    const { opts, baselinePath } = setup(undefined);
    expect(main(BOOT, opts)).not.toBe(0);
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("refuses on a malformed baseline and leaves its bytes (X4)", () => {
    const { opts, baselinePath } = setup('{ "fallback": ');
    expect(main(BOOT, opts)).not.toBe(0);
    expect(readFileSync(baselinePath, "utf8")).toBe('{ "fallback": ');
  });

  it("refuses when the tree has grown an old arm (X5)", () => {
    const { opts, baselinePath } = setup({ fallback: {}, undeclared: {} });
    const bytes = readFileSync(baselinePath, "utf8");
    expect(main(BOOT, opts)).not.toBe(0);
    expect(stderr()).toMatch(/fallback-form/);
    expect(readFileSync(baselinePath, "utf8")).toBe(bytes);
  });

  it("plain --write refuses to grow accentText once bootstrapped (X6)", () => {
    const { opts, baselinePath } = setup({ ...OLD, accentText: {} });
    const bytes = readFileSync(baselinePath, "utf8");
    expect(main(["--write"], opts)).not.toBe(0);
    expect(stderr()).toMatch(/refuses to GROW/);
    expect(readFileSync(baselinePath, "utf8")).toBe(bytes);
  });

  it("treats a missing accentText key as an error, never as {} (X7)", () => {
    const { opts, baselinePath } = setup(OLD);
    expect(() => loadBaseline(baselinePath)).toThrow(/accentText/);
    expect(main([], opts)).not.toBe(0);
  });
});
