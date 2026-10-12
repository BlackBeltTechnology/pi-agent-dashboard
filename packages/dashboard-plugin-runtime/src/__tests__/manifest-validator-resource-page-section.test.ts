/**
 * Manifest validation of `resource-page-section` claims (test-plan #E23, runtime half).
 * See change: add-skill-atlas-screen.
 */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const manifest = (claim: Record<string, unknown>) => ({
  id: "skill-atlas",
  displayName: "Skill Atlas",
  priority: 100,
  claims: [{ slot: "resource-page-section", component: "SkillAtlasSection", ...claim }],
});

describe("resource-page-section claims", () => {
  it("accepts and keeps a valid resourceType", () => {
    const m = validateManifest(manifest({ resourceType: "skill" }));
    expect(m.claims[0]).toMatchObject({ slot: "resource-page-section", resourceType: "skill" });
  });

  it("accepts a claim without resourceType", () => {
    const m = validateManifest(manifest({}));
    expect(m.claims[0].resourceType).toBeUndefined();
  });

  it("rejects an unknown resourceType", () => {
    expect(() => validateManifest(manifest({ resourceType: "widget" }))).toThrow(ManifestValidationError);
  });
});
