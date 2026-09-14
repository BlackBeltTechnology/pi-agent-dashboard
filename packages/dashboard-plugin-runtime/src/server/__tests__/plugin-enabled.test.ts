/**
 * defaultEnabled unit tests (spec add-browser-relay, design Migration Plan
 * step 2 / GAP B):
 *  - plugin with defaultEnabled:false and empty config → disabled
 *  - with explicit enabled:true → enabled (config always wins)
 *  - plugin without the field → enabled (historical default-allow)
 *  - validator accepts boolean defaultEnabled and rejects non-boolean
 *
 * See change: add-browser-relay (GAP B).
 */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../../manifest-validator.js";
import { resolvePluginEnabled } from "../plugin-enabled.js";

function manifest(extra: Record<string, unknown> = {}) {
  return {
    id: "test-plugin",
    displayName: "Test",
    claims: [{ slot: "settings-section", component: "X" }],
    ...extra,
  };
}

describe("resolvePluginEnabled (GAP B)", () => {
  it("defaultEnabled:false + empty config → disabled", () => {
    expect(resolvePluginEnabled(undefined, false)).toBe(false);
    expect(resolvePluginEnabled({}, false)).toBe(false);
    expect(resolvePluginEnabled({ browsers: { Default: {} } }, false)).toBe(false);
  });

  it("defaultEnabled:false + explicit enabled:true → enabled (config wins)", () => {
    expect(resolvePluginEnabled({ enabled: true }, false)).toBe(true);
    // explicit false stays false regardless of default
    expect(resolvePluginEnabled({ enabled: false }, true)).toBe(false);
  });

  it("plugin without the field → enabled (historical default-allow)", () => {
    expect(resolvePluginEnabled(undefined, undefined)).toBe(true);
    expect(resolvePluginEnabled({}, undefined)).toBe(true);
    expect(resolvePluginEnabled({ enabled: true }, undefined)).toBe(true);
  });

  it("non-boolean enabled values fall back to the default (old !== false parity)", () => {
    // e.g. a hand-edited config with enabled: "false" — the historical check
    // treated any non-false as enabled; resolvePluginEnabled treats any
    // non-boolean as unset and applies the default.
    expect(resolvePluginEnabled({ enabled: "false" }, false)).toBe(false);
    expect(resolvePluginEnabled({ enabled: "false" }, undefined)).toBe(true);
  });
});

describe("manifest-validator defaultEnabled (GAP B)", () => {
  it("accepts and passes through boolean defaultEnabled", () => {
    const v = validateManifest(manifest({ defaultEnabled: false }), "t");
    expect(v.defaultEnabled).toBe(false);
    expect(validateManifest(manifest({ defaultEnabled: true }), "t").defaultEnabled).toBe(true);
    expect(validateManifest(manifest(), "t").defaultEnabled).toBeUndefined();
  });

  it("rejects a non-boolean defaultEnabled", () => {
    expect(() => validateManifest(manifest({ defaultEnabled: "false" }), "t")).toThrow(
      ManifestValidationError,
    );
    expect(() => validateManifest(manifest({ defaultEnabled: 0 }), "t")).toThrow(
      /defaultEnabled must be a boolean/,
    );
  });
});
