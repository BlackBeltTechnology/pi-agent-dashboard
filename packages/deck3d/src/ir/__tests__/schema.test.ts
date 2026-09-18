import { describe, expect, it } from "vitest";
import { validate } from "../validate.js";
import { flowchartIR, validIR } from "./fixtures.js";

describe("IR schema validation", () => {
  it("accepts a valid fixture", () => {
    const result = validate(validIR());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a string where depthRelief expects a number, naming the path", () => {
    const ir = validIR() as unknown as { defaults: Record<string, unknown> };
    ir.defaults.depthRelief = "high";
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: "defaults.depthRelief", message: "expected number" }),
    );
  });

  it("rejects an unknown field", () => {
    const ir = validIR() as unknown as { defaults: Record<string, unknown> };
    ir.defaults.notAKnob = true;
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: "defaults", message: "unknown key 'notAKnob'" }),
    );
  });

  it("rejects an unknown per-slide override key with a bracket path", () => {
    const ir = validIR();
    (ir.overrides as Record<string, unknown>).slides = { intro: { bogus: 1 } };
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'overrides.slides["intro"]', message: "unknown key 'bogus'" }),
    );
  });

  it("rejects an out-of-enum node shape", () => {
    const ir = flowchartIR();
    (ir.overrides as Record<string, unknown>).nodes = { "intro/A": { shape: "banana" } };
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path === 'overrides.nodes["intro/A"].shape')).toBe(true);
  });
});

describe("IR derived-data integrity", () => {
  it("errors on a dangling edge target inside derived data", () => {
    const ir = flowchartIR();
    ir.slides[0].diagram.edges![0].to = "missing";
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors[0].path).toBe("slides[0].diagram.edges[0].to");
    expect(result.errors[0].message).toContain("missing");
  });
});

describe("IR orphan + derived-hash warnings", () => {
  it("warns (exit 0) on an override whose node vanished", () => {
    const ir = flowchartIR();
    (ir.overrides as Record<string, unknown>).nodes = { "intro/Z": { shape: "hexagon" } };
    const result = validate(ir);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ path: 'overrides.nodes["intro/Z"]' }),
    );
  });

  it("warns when meta.derivedHash does not match the derived fields", () => {
    const ir = validIR();
    ir.meta.derivedHash = "deadbeef";
    const result = validate(ir);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.message.includes("edited outside overrides"))).toBe(true);
  });

  it("does not warn when derivedHash matches", async () => {
    const { computeDerivedHash } = await import("../hash.js");
    const ir = validIR();
    ir.meta.derivedHash = computeDerivedHash(ir);
    const result = validate(ir);
    expect(result.warnings).toEqual([]);
  });
});
