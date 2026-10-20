/**
 * Shared schema + validation tests.
 *
 * DEFAULTS + KNOWN_KEYS are mirrored from `pi-hermes-memory@0.9.10`; the
 * expected values come from a fixture generated from that package (the plugin
 * does not import the external package at runtime).
 * See change: add-hermes-memory-settings-plugin, resync-hermes-memory-config-0-9.
 */
import { describe, expect, it } from "vitest";
import { upstreamHermes, upstreamLoadConfig, upstreamMemoryConfigKeys } from "../../__tests__/upstream-hermes.js";
import { DEFAULTS, KNOWN_KEYS, validateHermesConfig } from "../hermes-config.js";
import upstream from "./fixtures/hermes-0.9.10-fields.json" with { type: "json" };

// Drift guard (design D5): the upstream field set + defaults, generated once
// from pi-hermes-memory@0.9.10 itself (`src/types.ts` MemoryConfig keys +
// `loadConfig()` on a missing file = DEFAULT_CONFIG). Re-generate on every
// hermes upgrade; a mismatch here is the signal to re-mirror.
// See change: resync-hermes-memory-config-0-9.

const EXPECTED_KEYS = [...upstream.keys].sort();
const EXPECTED_DEFAULTS = upstream.defaults;

describe("hermes-config schema", () => {
  it("KNOWN_KEYS lists every MemoryConfig key", () => {
    expect([...KNOWN_KEYS].sort()).toEqual(EXPECTED_KEYS);
  });

  it("DEFAULTS matches the extension's DEFAULT_CONFIG values", () => {
    expect(DEFAULTS).toEqual(EXPECTED_DEFAULTS);
  });
});

describe("validateHermesConfig", () => {
  const validFull = { ...EXPECTED_DEFAULTS };

  it("accepts a full valid object", () => {
    const r = validateHermesConfig(validFull);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a valid partial object", () => {
    const r = validateHermesConfig({ nudgeInterval: 5, llmModelOverride: "anthropic/claude-haiku-4-5" });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(validateHermesConfig(null).ok).toBe(false);
    expect(validateHermesConfig([]).ok).toBe(false);
    expect(validateHermesConfig("x").ok).toBe(false);
  });

  it("rejects an unknown key", () => {
    const r = validateHermesConfig({ ...validFull, bogusKey: 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === "bogusKey")).toBe(true);
  });

  it("rejects a wrong type", () => {
    const r = validateHermesConfig({ reviewEnabled: "yes" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("reviewEnabled");
  });

  it("rejects an out-of-range enum (memoryMode)", () => {
    const r = validateHermesConfig({ memoryMode: "bogus" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("memoryMode");
  });

  it("rejects a negative numeric bound", () => {
    const r = validateHermesConfig({ memoryCharLimit: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("memoryCharLimit");
  });

  it("rejects a non-integer numeric bound", () => {
    const r = validateHermesConfig({ nudgeInterval: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("nudgeInterval");
  });

  it("rejects an uncompilable correction regex", () => {
    const r = validateHermesConfig({ correctionStrongPatterns: ["(unbalanced"] });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("correctionStrongPatterns");
  });

  it("accepts a compilable correction regex array", () => {
    const r = validateHermesConfig({ correctionStrongPatterns: ["/don't do that/i", "^no\\b"] });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid sessionSearch object", () => {
    expect(validateHermesConfig({ sessionSearch: { variant: "anchors" } }).ok).toBe(true);
  });

  it("rejects a sessionSearch object with extra keys", () => {
    const r = validateHermesConfig({ sessionSearch: { variant: "legacy", extra: 1 } });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("sessionSearch");
  });
});

describe("llmModelOverride model kind (add-context-mode-settings-plugin)", () => {
  it("is a `model` descriptor validated like a string", async () => {
    const { FIELD_DESCRIPTORS, validateHermesConfig } = await import("../hermes-config.js");
    expect(FIELD_DESCRIPTORS.llmModelOverride).toEqual({ kind: "model" });
    expect(validateHermesConfig({ llmModelOverride: "anthropic/claude-sonnet-4" }).ok).toBe(true);
    expect(validateHermesConfig({ llmModelOverride: 5 }).ok).toBe(false);
  });
});

/** Keys missing from / extra in `actual` relative to `expected` (named in failures). */
function keyDiff(actual: readonly string[], expected: readonly string[]): { missing: string[]; extra: string[] } {
  return {
    missing: expected.filter((k) => !actual.includes(k)),
    extra: actual.filter((k) => !expected.includes(k)),
  };
}

describe("E1 drift guard (resync-hermes-memory-config-0-9)", () => {
  it("fixture pins version 0.9.10 with 44 keys and 34 defaults", () => {
    expect(upstream.version).toBe("0.9.10");
    expect(upstream.keys).toHaveLength(44);
    expect(Object.keys(upstream.defaults)).toHaveLength(34);
  });

  it("KNOWN_KEYS has no missing/extra keys vs the fixture (diff names the key)", () => {
    expect(keyDiff(KNOWN_KEYS as string[], upstream.keys)).toEqual({ missing: [], extra: [] });
    // A synthetic one-key drift is reported by name.
    expect(keyDiff([...KNOWN_KEYS, "brandNewKey"] as string[], upstream.keys)).toEqual({ missing: [], extra: ["brandNewKey"] });
    expect(keyDiff((KNOWN_KEYS as string[]).filter((k) => k !== "sessionRetentionDays"), upstream.keys)).toEqual({
      missing: ["sessionRetentionDays"],
      extra: [],
    });
  });
});

describe("E3 llmThinkingOverride enum", () => {
  it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"])("accepts %s", (v) => {
    expect(validateHermesConfig({ llmThinkingOverride: v }).ok).toBe(true);
  });
  it("rejects ultra naming the field", () => {
    const r = validateHermesConfig({ llmThinkingOverride: "ultra" });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe("llmThinkingOverride");
  });
});

/** Validate one field; returns the error field name or null. */
const fieldErr = (key: string, value: unknown): string | null => {
  const r = validateHermesConfig({ [key]: value });
  return r.ok ? null : r.errors[0].field;
};

describe("E4 consolidationChunkChars bounds", () => {
  it("499 and \"500\" error naming the field; 500 / 4000 / 500.5 ok", () => {
    expect(fieldErr("consolidationChunkChars", 499)).toBe("consolidationChunkChars");
    expect(fieldErr("consolidationChunkChars", "500")).toBe("consolidationChunkChars");
    for (const v of [500, 4000, 500.5]) expect(fieldErr("consolidationChunkChars", v)).toBeNull();
  });
});

describe("E5 sessionRetentionDays bounds", () => {
  it("-1 and 0.5 error naming the field; 0 / 1 / 3650 ok", () => {
    expect(fieldErr("sessionRetentionDays", -1)).toBe("sessionRetentionDays");
    expect(fieldErr("sessionRetentionDays", 0.5)).toBe("sessionRetentionDays");
    for (const v of [0, 1, 3650]) expect(fieldErr("sessionRetentionDays", v)).toBeNull();
  });
});

describe("E6 timeout bounds", () => {
  it("flushCompactTimeoutMs: only NaN errors", () => {
    for (const v of [-1, 0, 60000, 1.5]) expect(fieldErr("flushCompactTimeoutMs", v)).toBeNull();
    expect(fieldErr("flushCompactTimeoutMs", Number.NaN)).toBe("flushCompactTimeoutMs");
  });
  it("overflowGraceMs: only -1 errors", () => {
    expect(fieldErr("overflowGraceMs", -1)).toBe("overflowGraceMs");
    for (const v of [0, 0.5]) expect(fieldErr("overflowGraceMs", v)).toBeNull();
  });
});

describe("E7 new-field types", () => {
  it.each([
    "lazyInitialization",
    "quickCheckOnOpen",
    "consolidationChunking",
    "usageHitTrackingEnabled",
    "consolidationUsageSignals",
    "autoConsolidationWarnOnFailure",
    "standingInstructionsEnabled",
  ])("%s rejects the string \"true\"", (key) => {
    expect(fieldErr(key, "true")).toBe(key);
  });
  it("llmFallbackModels: string and mixed array error; string array ok", () => {
    expect(fieldErr("llmFallbackModels", "a/b")).toBe("llmFallbackModels");
    expect(fieldErr("llmFallbackModels", ["a/b", 1])).toBe("llmFallbackModels");
    expect(fieldErr("llmFallbackModels", ["a/b"])).toBeNull();
  });
  it("every 0.9.10 default validates", () => {
    expect(validateHermesConfig(upstream.defaults).ok).toBe(true);
  });
});

const up = upstreamHermes();

describe("E2 local upstream check (skipped without a local pi-hermes-memory)", () => {
  it.skipIf(!up)("installed version matches the fixture", () => {
    expect(up?.version, `upstream is ${up?.version}, fixture is ${upstream.version} — re-mirror`).toBe(upstream.version);
  });

  it.skipIf(!up || up.version !== upstream.version)("interface MemoryConfig has the fixture's 44 keys", () => {
    if (!up) return;
    const keys = upstreamMemoryConfigKeys(up);
    expect(keys).toHaveLength(44);
    expect(keys).toEqual([...upstream.keys].sort());
  });

  it.skipIf(!up || up.version !== upstream.version)("loadConfig(<missing file>) equals the fixture defaults", async () => {
    if (!up) return;
    const loadConfig = await upstreamLoadConfig(up);
    expect(loadConfig("/nonexistent/hermes-memory-config.json")).toEqual(upstream.defaults);
  });
});
