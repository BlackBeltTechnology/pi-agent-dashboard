/**
 * Tests for manifest.requires validation.
 * See change: add-plugin-activation-ui.
 */
import { describe, it, expect } from "vitest";
import { validateManifest, ManifestValidationError } from "../manifest-validator.js";

const base = { id: "x", displayName: "X", claims: [] };

describe("manifest validator — requires", () => {
  it("accepts manifests without a requires field", () => {
    const m = validateManifest(base);
    expect(m.requires).toBeUndefined();
  });

  it("accepts valid requires shape", () => {
    const m = validateManifest({
      ...base,
      requires: {
        piExtensions: ["pi-web-access"],
        binaries: ["zrok"],
        services: ["pi-model-proxy"],
      },
    });
    expect(m.requires).toEqual({
      piExtensions: ["pi-web-access"],
      binaries: ["zrok"],
      services: ["pi-model-proxy"],
    });
  });

  it("accepts partial requires (only one field present)", () => {
    const m = validateManifest({ ...base, requires: { binaries: ["zrok"] } });
    expect(m.requires).toEqual({ binaries: ["zrok"] });
  });

  it("rejects non-object requires", () => {
    expect(() => validateManifest({ ...base, requires: "yes" })).toThrow(ManifestValidationError);
    expect(() => validateManifest({ ...base, requires: [] })).toThrow(ManifestValidationError);
  });

  it("rejects non-array field", () => {
    expect(() => validateManifest({ ...base, requires: { binaries: "zrok" } })).toThrow(
      ManifestValidationError,
    );
  });

  it("rejects empty-string entries", () => {
    expect(() => validateManifest({ ...base, requires: { binaries: [""] } })).toThrow(
      ManifestValidationError,
    );
    expect(() => validateManifest({ ...base, requires: { binaries: [" "] } })).toThrow(
      ManifestValidationError,
    );
  });

  it("rejects non-string entries", () => {
    expect(() => validateManifest({ ...base, requires: { binaries: [42] } })).toThrow(
      ManifestValidationError,
    );
  });

  it("rejects duplicate entries", () => {
    expect(() =>
      validateManifest({
        ...base,
        requires: { piExtensions: ["a", "a"] },
      }),
    ).toThrow(/duplicate/);
  });
});

describe("manifest validator — dependsOn", () => {
  it("accepts manifests without dependsOn", () => {
    expect(validateManifest(base).dependsOn).toBeUndefined();
  });

  it("accepts a valid dependsOn array", () => {
    const m = validateManifest({ ...base, dependsOn: ["a", "b"] });
    expect(m.dependsOn).toEqual(["a", "b"]);
  });

  it("rejects non-array dependsOn", () => {
    expect(() => validateManifest({ ...base, dependsOn: "a" })).toThrow(ManifestValidationError);
  });

  it("rejects empty-string entries", () => {
    expect(() => validateManifest({ ...base, dependsOn: [""] })).toThrow(ManifestValidationError);
    expect(() => validateManifest({ ...base, dependsOn: [" "] })).toThrow(ManifestValidationError);
  });

  it("rejects non-string entries", () => {
    expect(() => validateManifest({ ...base, dependsOn: [42] })).toThrow(ManifestValidationError);
  });

  it("rejects self-reference", () => {
    expect(() => validateManifest({ ...base, dependsOn: ["x"] })).toThrow(/self-reference/);
  });

  it("rejects duplicates", () => {
    expect(() => validateManifest({ ...base, dependsOn: ["a", "a"] })).toThrow(/duplicate/);
  });
});
