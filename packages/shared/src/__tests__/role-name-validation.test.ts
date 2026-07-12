/**
 * Tests for isValidRoleName — the shared role-name trust boundary.
 * See change: add-custom-roles-ui (design D4, task 1.1).
 */
import { describe, expect, it } from "vitest";
import { isValidRoleName } from "../role-name-validation.js";

describe("isValidRoleName", () => {
  it("accepts valid names", () => {
    for (const name of ["doubt-verifier-1", "review", "a_b", "A", "9", "coding"]) {
      expect(isValidRoleName(name, []).ok, name).toBe(true);
    }
  });

  it("rejects empty / whitespace-only names", () => {
    expect(isValidRoleName("", []).ok).toBe(false);
    expect(isValidRoleName("   ", []).ok).toBe(false);
  });

  it("rejects reserved characters", () => {
    for (const name of ["doubt/verifier", "doubt verifier", "@fast", ".hidden", "-lead"]) {
      expect(isValidRoleName(name, []).ok, name).toBe(false);
    }
  });

  it("rejects __proto__ and underscore-prefixed names (prototype-key guard)", () => {
    // Regex requires an alnum first char, so these can never become object keys.
    // Explicit regression test guards against future regex loosening.
    for (const name of ["__proto__", "_private", "_"]) {
      expect(isValidRoleName(name, []).ok, name).toBe(false);
    }
  });

  it("rejects collisions with existing names (case-sensitive)", () => {
    expect(isValidRoleName("review", ["review"]).ok).toBe(false);
    expect(isValidRoleName("coding", ["planning", "coding", "fast"]).ok).toBe(false);
    // Different case is a distinct on-disk key → not a collision.
    expect(isValidRoleName("Review", ["review"]).ok).toBe(true);
  });

  it("returns a reason string on rejection", () => {
    expect(isValidRoleName("", []).reason).toBeTruthy();
    expect(isValidRoleName("@fast", []).reason).toBeTruthy();
    expect(isValidRoleName("review", ["review"]).reason).toBeTruthy();
  });
});
