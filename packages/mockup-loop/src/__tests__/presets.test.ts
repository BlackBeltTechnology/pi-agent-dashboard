/**
 * Unit tests for the selectable design-system feature: registry, DTCG
 * contract loading, and the layered validators.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listPresets, getPreset, resolvePreset, presetIds } from "../presets/registry.js";
import { loadContract, isDtcg } from "../presets/contract.js";
import {
  runL1,
  runL2,
  runL4,
  validateMockup,
  contrastRatio,
  parseHex,
  loadRubric,
} from "../presets/validators.js";

const ALL_IDS = ["shadcn", "mui", "material-3", "fluent-2", "apple-hig"];

describe("registry", () => {
  it("lists the 5 v1 presets with required fields", () => {
    const presets = listPresets();
    expect(presets).toHaveLength(5);
    expect(presetIds().sort()).toEqual([...ALL_IDS].sort());
    for (const p of presets) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(["web", "ios"]).toContain(p.platform);
      expect(p.substrate).toBeTruthy();
      expect(Array.isArray(p.validators)).toBe(true);
      // Every preset carries the L2 a11y floor (bundled gate).
      expect(p.validators.some((v) => v.layer === "L2" && v.gate && v.bundled)).toBe(true);
    }
  });

  it("rejects an unknown system id without throwing", () => {
    const r = resolvePreset("nope");
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("nope");
      expect(r.error).toContain("shadcn");
    }
  });

  it("apple-hig is a rule-pack source on ios", () => {
    const p = getPreset("apple-hig")!;
    expect(p.contractSource).toBe("rule-pack");
    expect(p.platform).toBe("ios");
    expect(p.minTouchTarget).toBe(44);
  });
});

describe("contract", () => {
  it("loads each bundled snapshot and asserts DTCG shape", () => {
    for (const id of ALL_IDS) {
      const contract = loadContract(id);
      expect(isDtcg(contract)).toBe(true);
    }
  });

  it("loads a rubric for each preset", () => {
    for (const id of ALL_IDS) {
      const checks = loadRubric(id);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks[0]).toHaveProperty("id");
      expect(checks[0]).toHaveProperty("text");
    }
  });
});

describe("contrast math", () => {
  it("computes WCAG ratios (black on white ~21:1)", () => {
    expect(parseHex("#000000")).toEqual([0, 0, 0]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });
});

function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("L1 token-lint", () => {
  it("fails a shadcn mockup with a raw hex literal", () => {
    const dir = tmpdir("ml-l1-fail-");
    fs.writeFileSync(path.join(dir, "index.html"), `<div style="color:#ff0000">hi</div>`);
    const res = runL1(getPreset("shadcn")!, dir);
    expect(res.gate).toBe(true);
    expect(res.status).toBe("fail");
  });

  it("passes a shadcn mockup that only uses token classes", () => {
    const dir = tmpdir("ml-l1-pass-");
    fs.writeFileSync(path.join(dir, "index.html"), `<div class="text-primary bg-background">hi</div>`);
    const res = runL1(getPreset("shadcn")!, dir);
    expect(res.status).toBe("pass");
  });

  it("ignores hex inside CSS custom-property definitions", () => {
    const dir = tmpdir("ml-l1-tokendef-");
    fs.writeFileSync(path.join(dir, "theme.css"), `:root { --primary: #0f172a; }`);
    const res = runL1(getPreset("shadcn")!, dir);
    expect(res.status).toBe("pass");
  });

  it("skips + notes optional linters (mui) without erroring", () => {
    const res = runL1(getPreset("mui")!, undefined);
    expect(res.status).toBe("skipped");
    expect(res.gate).toBe(false);
  });
});

describe("L2 a11y floor", () => {
  it("fails a deliberately low-contrast fixture", () => {
    const dir = tmpdir("ml-l2-fail-");
    fs.writeFileSync(
      path.join(dir, "low.html"),
      `<style>.box { color: #777777; background-color: #888888; }</style><div class="box">x</div>`,
    );
    const res = runL2(getPreset("shadcn")!, dir);
    expect(res.gate).toBe(true);
    expect(res.status).toBe("fail");
  });

  it("passes a high-contrast fixture", () => {
    const dir = tmpdir("ml-l2-pass-");
    fs.writeFileSync(
      path.join(dir, "ok.html"),
      `<style>.box { color: #000000; background-color: #ffffff; }</style><div class="box">x</div>`,
    );
    const res = runL2(getPreset("shadcn")!, dir);
    expect(res.status).toBe("pass");
  });
});

describe("L4 rubric scoring", () => {
  it("computes score = pass/N in code", () => {
    const preset = getPreset("apple-hig")!;
    const checks = loadRubric("apple-hig");
    const answers: Record<string, boolean> = {};
    checks.forEach((c, i) => (answers[c.id] = i % 2 === 0));
    const res = runL4(preset, answers);
    const expectedPass = checks.filter((_, i) => i % 2 === 0).length;
    expect(res.score).toBeCloseTo(expectedPass / checks.length, 5);
  });

  it("returns the rubric (no score) when unanswered", () => {
    const res = runL4(getPreset("apple-hig")!);
    expect(res.score).toBeNull();
    expect(res.checks.length).toBeGreaterThan(0);
  });
});

describe("validate_mockup orchestrator", () => {
  it("returns { gates, advisory, pass } shape", () => {
    const dir = tmpdir("ml-validate-");
    fs.writeFileSync(path.join(dir, "index.html"), `<div class="text-primary">ok</div>`);
    const res = validateMockup({ preset: getPreset("shadcn")!, dir });
    expect(res).toHaveProperty("gates.l1");
    expect(res).toHaveProperty("gates.l2");
    expect(res).toHaveProperty("advisory.l3");
    expect(res).toHaveProperty("advisory.l4");
    expect(typeof res.pass).toBe("boolean");
    expect(res.pass).toBe(true);
  });

  it("a gate failure makes pass false regardless of advisory", () => {
    const dir = tmpdir("ml-validate-fail-");
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<style>.x{color:#777;background-color:#888}</style><div style="color:#123456" class="x">bad</div>`,
    );
    const res = validateMockup({ preset: getPreset("shadcn")!, dir });
    expect(res.pass).toBe(false);
  });
});
