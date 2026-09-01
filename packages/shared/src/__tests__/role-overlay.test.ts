import { describe, it, expect } from "vitest";
import { DEFAULT_ROLE_NAMES, overlayDefaultRoles } from "../role-overlay.js";

describe("role-overlay", () => {
  it("DEFAULT_ROLE_NAMES is the canonical stock set", () => {
    expect([...DEFAULT_ROLE_NAMES]).toEqual([
      "planning",
      "coding",
      "compact",
      "fast",
      "vision",
      "research",
      "naming",
    ]);
  });

  it("overlays every default as empty when nothing is assigned", () => {
    const out = overlayDefaultRoles({});
    expect(out).toEqual({
      planning: "",
      coding: "",
      compact: "",
      fast: "",
      vision: "",
      research: "",
      naming: "",
    });
  });

  it("assigned values win over the empty default overlay", () => {
    const out = overlayDefaultRoles({ fast: "anthropic/opus", coding: "openai/gpt" });
    expect(out.fast).toBe("anthropic/opus");
    expect(out.coding).toBe("openai/gpt");
    // Unassigned defaults still present as empty.
    expect(out.planning).toBe("");
    expect(out.vision).toBe("");
  });

  it("preserves non-default assigned roles", () => {
    const out = overlayDefaultRoles({ extraction: "x/y", classification: "a/b" });
    expect(out.extraction).toBe("x/y");
    expect(out.classification).toBe("a/b");
    // All six defaults still present.
    for (const name of DEFAULT_ROLE_NAMES) expect(name in out).toBe(true);
  });
});
