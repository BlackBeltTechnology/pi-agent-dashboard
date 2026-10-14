/**
 * Manifest validation of `shell-headless` claims (test-plan #E8).
 * See change: fix-empty-status-subcard.
 */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const manifest = (claim: Record<string, unknown>) => ({
  id: "browser",
  displayName: "Browser",
  priority: 100,
  claims: [{ slot: "shell-headless", component: "BrowserRelayFeed", ...claim }],
});

describe("shell-headless claims", () => {
  it("accepts a claim with neither predicate nor shouldRender", () => {
    expect(validateManifest(manifest({})).claims[0].slot).toBe("shell-headless");
  });

  it.each([["shouldRender"], ["predicate"]])("rejects a claim declaring %s, naming plugin and slot", (field) => {
    let err: unknown;
    try {
      validateManifest(manifest({ [field]: "x" }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ManifestValidationError);
    expect((err as Error).message).toContain("browser");
    expect((err as Error).message).toContain("shell-headless");
  });
});
