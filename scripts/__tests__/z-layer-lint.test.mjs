/**
 * Overlay z-index ratchet (test-plan #E4, #E5).
 *
 * #E4 — a NEW raw z-index (not in the frozen baseline) fails the gate.
 * #E5 — removing a baselined raw-z (portaling it) is allowed; the ceiling only
 *        shrinks.
 * #E28 — inline numeric `zIndex` is flagged in client + client-utils; the utility
 *        class scan keeps client/src scope only.
 * #E29 — the repo itself adds no inline occurrence and nothing beyond the pre-existing set.
 * Also guards that word-based layer utilities (`z-popover`) are NOT flagged.
 *
 * See change: add-overlay-layering-system, add-session-actions-flyout.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractInlineZ, extractRawZ, ratchetDecision, scanAllZ, scanRawZ } from "../z-layer-lint.mjs";

describe("z-layer ratchet — token detection", () => {
  it("matches raw numeric z, ignores word-based layer utilities", () => {
    const src = 'className="fixed z-popover z-50 z-[9999] z-dialog z-[60]"';
    expect(extractRawZ(src).sort()).toEqual(["z-50", "z-[60]", "z-[9999]"].sort());
    // No numeric-z tokens at all → empty.
    expect(extractRawZ('className="fixed z-popover z-dialog z-toast"')).toEqual([]);
  });
});

describe("z-layer ratchet — decision (test-plan #E4/#E5)", () => {
  const baseline = { "a.tsx|z-50": 1, "b.tsx|z-[60]": 2 };

  it("#E4 rejects a NEW raw-z occurrence not covered by the baseline", () => {
    const files = ["a.tsx", "c.tsx"];
    const read = (f) => (f === "a.tsx" ? "z-50" : "z-[123]"); // c.tsx introduces z-[123]
    const current = scanRawZ(files, read);
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(false);
    expect(additions.map((a) => a.key)).toContain("c.tsx|z-[123]");
  });

  it("#E4 rejects an INCREASED count of an already-baselined token", () => {
    const current = { "b.tsx|z-[60]": 3 }; // baseline allows 2
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(false);
    expect(additions[0]).toMatchObject({ key: "b.tsx|z-[60]", baseline: 2, current: 3 });
  });

  it("#E5 allows shrinking — a removed/reduced baselined token passes", () => {
    const current = { "a.tsx|z-50": 1 }; // b.tsx z-[60] portaled away entirely
    const { ok, additions } = ratchetDecision(current, baseline);
    expect(ok).toBe(true);
    expect(additions).toEqual([]);
  });
});

describe("z-layer ratchet — inline zIndex extractor (test-plan #E28)", () => {
  it("flags numeric inline zIndex in object, string and JSX style forms", () => {
    expect(extractInlineZ("const s = { zIndex: 1000 };")).toEqual(["zIndex:1000"]);
    expect(extractInlineZ('const s = { zIndex: "1000" };')).toEqual(["zIndex:1000"]);
    expect(extractInlineZ("<div style={{ zIndex: 10 }} />")).toEqual(["zIndex:10"]);
    expect(extractInlineZ("{ position: 'fixed', zIndex: 9999,\n top: 0 }")).toEqual(["zIndex:9999"]);
  });

  it("does not flag layer tokens, expressions or non-numeric values", () => {
    expect(extractInlineZ('{ zIndex: "var(--z-popover)" }')).toEqual([]);
    expect(extractInlineZ("{ zIndex: `var(--z-dialog)` }")).toEqual([]);
    expect(extractInlineZ("{ zIndex: base + 1 }")).toEqual([]);
    expect(extractInlineZ('{ zIndex: "auto" }')).toEqual([]);
  });

  const U = "packages/client-utils/src/Fixture.tsx";
  const C = "packages/client/src/components/Fixture.tsx";
  const run = (sources) => scanAllZ(Object.keys(sources), (f) => sources[f]);

  it("flags numeric inline zIndex in client-utils and client", () => {
    expect(run({ [U]: "<div style={{ zIndex: 1000 }} />", [C]: "const s = { zIndex: 20 };" })).toEqual({
      [`${U}|zIndex:1000`]: 1,
      [`${C}|zIndex:20`]: 1,
    });
  });

  it("does not flag the popover token in client-utils", () => {
    expect(run({ [U]: 'const s = { zIndex: "var(--z-popover)" };' })).toEqual({});
  });

  it("does not scan Tailwind utility classes in client-utils, still scans them in client", () => {
    expect(run({ [U]: '<div className="z-10" />' })).toEqual({});
    expect(run({ [C]: '<div className="z-10" />' })).toEqual({ [`${C}|z-10`]: 1 });
  });

  it("inline findings go through the same ratchet decision", () => {
    const current = run({ [U]: "{ zIndex: 1000 }" });
    expect(ratchetDecision(current, {}).additions.map((a) => a.key)).toEqual([`${U}|zIndex:1000`]);
  });
});

describe("z-layer ratchet — repo state (test-plan #E29)", () => {
  const repoRoot = resolve(import.meta.dirname, "../..");

  it("reports no inline zIndex occurrence and adds no inline baseline entry", () => {
    const baseline = JSON.parse(readFileSync(resolve(repoRoot, "scripts/z-layer-baseline.json"), "utf8"));
    expect(Object.keys(baseline).filter((k) => k.includes("|zIndex:"))).toEqual([]);
    let out = "";
    try {
      out = execFileSync("node", ["scripts/z-layer-lint.mjs"], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(out).not.toMatch(/zIndex:/);
  });
});
