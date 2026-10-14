/** `claims[].module` shape check. See change: lazy-plugin-claim-modules (task 1.3). */
import { describe, expect, it } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const withClaim = (claim: Record<string, unknown>) => ({
  id: "demo",
  displayName: "Demo",
  claims: [{ slot: "settings-section", component: "DemoSettings", ...claim }],
});

describe("validateManifest — claim module", () => {
  it("passes a package-relative module through to the normalized claim", () => {
    const m = validateManifest(withClaim({ module: "./src/client/DemoSettings.tsx" }));
    expect(m.claims[0].module).toBe("./src/client/DemoSettings.tsx");
  });

  it("omits module when absent (additive field)", () => {
    expect(validateManifest(withClaim({})).claims[0]).not.toHaveProperty("module");
  });

  it.each([
    ["empty", ""],
    ["non-string", 5],
    ["not ./-relative", "src/client/X.tsx"],
    ["absolute", "/abs/X.tsx"],
    ["parent segment", "./../other/X.tsx"],
  ])("rejects %s module", (_label, module) => {
    expect(() => validateManifest(withClaim({ module }))).toThrow(ManifestValidationError);
  });

  it("rejects module without a component", () => {
    expect(() =>
      validateManifest({
        id: "demo",
        displayName: "Demo",
        claims: [{ slot: "settings-section", module: "./src/X.tsx" }],
      }),
    ).toThrow(/module requires a non-empty "component"/);
  });
});
