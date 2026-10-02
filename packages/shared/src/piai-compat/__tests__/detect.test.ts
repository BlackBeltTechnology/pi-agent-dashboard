/**
 * Shape detection (design D2) — the factory generation is the only supported
 * one; a complete legacy module is positively identified and REJECTED as an
 * unsupported legacy pi-ai below the 1.0.0 floor.
 *
 * Covers test-plan #E3 (partial module rejected naming the missing member)
 * and #E4 (unrecognized module rejected with a diagnosable reason).
 *
 * See change: adopt-piai-factory-api-registry, update-pi-core-1-0-adopt-apis (#E9).
 */
import { describe, expect, it } from "vitest";
import { detectPiAiShape, FACTORY_MEMBERS, LEGACY_MEMBERS } from "../detect.js";
import { factoryFake, legacyFake } from "./fakes.js";

describe("detectPiAiShape", () => {
  it("rejects an all-seven-member legacy module as unsupported below the floor (E9)", () => {
    const result = detectPiAiShape(legacyFake());
    expect(result.kind).toBe("unrecognized");
    const reason = (result as { reason: string }).reason;
    expect(reason).toMatch(/unsupported legacy pi-ai/);
    expect(reason).toContain("1.0.0");
  });

  it("classifies a createModels + createProvider module as factory", () => {
    expect(detectPiAiShape(factoryFake())).toEqual({ kind: "factory" });
  });

  // test-plan #E3
  it("rejects a partial legacy module, naming the missing member", () => {
    const partial = legacyFake();
    delete partial.streamSimple;
    const result = detectPiAiShape(partial);
    expect(result.kind).toBe("unrecognized");
    expect((result as { reason: string }).reason).toContain("streamSimple");
  });

  it("does not classify a partial legacy module as factory", () => {
    const partial = legacyFake();
    delete partial.streamSimple;
    expect(detectPiAiShape(partial).kind).not.toBe("factory");
  });

  // test-plan #E4
  it("rejects an empty module with a diagnosable reason naming both APIs", () => {
    const result = detectPiAiShape({});
    expect(result.kind).toBe("unrecognized");
    const reason = (result as { reason: string }).reason;
    for (const m of LEGACY_MEMBERS) expect(reason).toContain(m);
    for (const m of FACTORY_MEMBERS) expect(reason).toContain(m);
  });

  it("rejects a half-factory module naming what is missing", () => {
    const result = detectPiAiShape({ createModels: () => ({}) });
    expect(result.kind).toBe("unrecognized");
    expect((result as { reason: string }).reason).toContain("createProvider");
  });

  it("rejects a module carrying BOTH generations rather than guessing", () => {
    const result = detectPiAiShape(factoryFake({ streamSimple: () => undefined }));
    expect(result.kind).toBe("unrecognized");
    expect((result as { reason: string }).reason).toContain("streamSimple");
  });

  it("rejects non-object modules", () => {
    expect(detectPiAiShape(null).kind).toBe("unrecognized");
    expect(detectPiAiShape(undefined).kind).toBe("unrecognized");
    expect(detectPiAiShape("pi-ai").kind).toBe("unrecognized");
  });
});
