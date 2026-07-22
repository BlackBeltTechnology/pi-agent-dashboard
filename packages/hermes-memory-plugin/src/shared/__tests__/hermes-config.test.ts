/**
 * Shared schema + validation tests.
 *
 * DEFAULTS + KNOWN_KEYS are mirrored from `pi-hermes-memory@0.8.1`; the
 * expected values here are the extension's `DEFAULT_CONFIG` literals and the
 * full `MemoryConfig` key set (the plugin does not import the external
 * package). See change: add-hermes-memory-settings-plugin.
 */
import { describe, expect, it } from "vitest";
import { DEFAULTS, KNOWN_KEYS, validateHermesConfig } from "../hermes-config.js";

// The complete MemoryConfig key set as declared in pi-hermes-memory types.ts.
const EXPECTED_KEYS = [
  "memoryMode",
  "memoryPolicyStyle",
  "memoryPolicyCustomText",
  "memoryCharLimit",
  "userCharLimit",
  "projectCharLimit",
  "nudgeInterval",
  "reviewRecentMessages",
  "reviewEnabled",
  "reviewTransport",
  "flushOnCompact",
  "flushOnShutdown",
  "flushMinTurns",
  "flushRecentMessages",
  "memoryDir",
  "projectsMemoryDir",
  "sessionSearch",
  "llmModelOverride",
  "llmThinkingOverride",
  "childExtensionPaths",
  "memoryOverflowStrategy",
  "autoConsolidate",
  "correctionDetection",
  "correctionStrongPatterns",
  "correctionWeakPatterns",
  "correctionNegativePatterns",
  "correctionDirectiveWords",
  "failureInjectionEnabled",
  "failureInjectionMaxAgeDays",
  "failureInjectionMaxEntries",
  "nudgeToolCalls",
  "consolidationTimeoutMs",
].sort();

// The extension's DEFAULT_CONFIG literal values (config.ts + constants.ts).
const EXPECTED_DEFAULTS = {
  memoryMode: "policy-only",
  memoryPolicyStyle: "full",
  memoryCharLimit: 5000,
  userCharLimit: 5000,
  projectCharLimit: 5000,
  nudgeInterval: 10,
  reviewRecentMessages: 0,
  reviewEnabled: true,
  reviewTransport: "direct",
  flushOnCompact: true,
  flushOnShutdown: true,
  flushMinTurns: 6,
  flushRecentMessages: 0,
  memoryOverflowStrategy: "auto-consolidate",
  autoConsolidate: true,
  correctionDetection: true,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: 7,
  failureInjectionMaxEntries: 5,
  consolidationTimeoutMs: 60000,
  nudgeToolCalls: 15,
  projectsMemoryDir: "projects-memory",
  sessionSearch: { variant: "legacy" },
};

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
});
