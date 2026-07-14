import { describe, expect, it, vi } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";

const validManifest = {
  id: "demo",
  displayName: "Demo Plugin",
  priority: 100,
  claims: [
    { slot: "session-card-badge", component: "DemoBadge" },
    { slot: "settings-section", component: "DemoSettings", tab: "general" },
    { slot: "tool-renderer", toolName: "DashboardDemo", component: "DemoToolRenderer" },
  ],
};

describe("validateManifest — valid cases", () => {
  it("accepts a valid manifest", () => {
    const m = validateManifest(validManifest);
    expect(m.id).toBe("demo");
    expect(m.claims).toHaveLength(3);
    expect(m.priority).toBe(100);
  });

  it("passes through i18nCatalog when a string (change: make-all-ui-text-i18n)", () => {
    const m = validateManifest({ ...validManifest, i18nCatalog: "catalog" });
    expect(m.i18nCatalog).toBe("catalog");
    // Omitted when absent or non-string.
    expect(validateManifest(validManifest).i18nCatalog).toBeUndefined();
    expect(validateManifest({ ...validManifest, i18nCatalog: 123 }).i18nCatalog).toBeUndefined();
  });

  it("defaults priority to 1000 when omitted", () => {
    const m = validateManifest({ ...validManifest, priority: undefined });
    expect(m.priority).toBe(1000);
  });

  it("accepts fixture: true", () => {
    const m = validateManifest({ ...validManifest, fixture: true });
    expect(m.fixture).toBe(true);
  });

  it("accepts settings-section claim without tab (defaults handled downstream)", () => {
    const m = validateManifest({
      ...validManifest,
      claims: [{ slot: "settings-section", component: "Foo" }],
    });
    expect(m.claims[0].tab).toBeUndefined();
  });
});

describe("validateManifest — invalid cases", () => {
  it("throws when manifest is not an object", () => {
    expect(() => validateManifest("bad")).toThrow(ManifestValidationError);
    expect(() => validateManifest(null)).toThrow(ManifestValidationError);
  });

  it("throws when id is missing", () => {
    expect(() => validateManifest({ ...validManifest, id: undefined })).toThrow(
      ManifestValidationError,
    );
  });

  it("throws when displayName is missing", () => {
    expect(() => validateManifest({ ...validManifest, displayName: "" })).toThrow(
      ManifestValidationError,
    );
  });

  it("throws on unknown slot id", () => {
    try {
      validateManifest({ ...validManifest, claims: [{ slot: "does-not-exist" }] });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).reason).toContain("does-not-exist");
    }
  });

  it("throws on unknown tab value for settings-section", () => {
    try {
      validateManifest({
        ...validManifest,
        claims: [{ slot: "settings-section", tab: "nonexistent" }],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).reason).toContain("nonexistent");
    }
  });

  it("throws on duplicate tool-renderer claims for same toolName", () => {
    try {
      validateManifest({
        ...validManifest,
        claims: [
          { slot: "tool-renderer", toolName: "Agent", component: "A" },
          { slot: "tool-renderer", toolName: "Agent", component: "B" },
        ],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).reason).toContain("duplicate");
    }
  });

  it("throws on duplicate command-route claims for same command", () => {
    try {
      validateManifest({
        ...validManifest,
        claims: [
          { slot: "command-route", command: "/specs", component: "A" },
          { slot: "command-route", command: "/specs", component: "B" },
        ],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).reason).toContain("duplicate");
    }
  });

  it("throws when claims is not an array", () => {
    expect(() => validateManifest({ ...validManifest, claims: "bad" })).toThrow(
      ManifestValidationError,
    );
  });

  it("throws when a claim is not an object", () => {
    expect(() =>
      validateManifest({ ...validManifest, claims: ["bad"] }),
    ).toThrow(ManifestValidationError);
  });
});

describe("validateManifest — shouldRender + predicate (auto-hide-empty-session-subcards)", () => {
  it("accepts shouldRender as a string", () => {
    const m = validateManifest({
      ...validManifest,
      claims: [
        {
          slot: "session-card-memory",
          component: "Mem",
          shouldRender: "shouldRenderMemory",
        },
      ],
    });
    expect(m.claims[0].shouldRender).toBe("shouldRenderMemory");
  });

  it("accepts predicate as a string (existing behavior preserved)", () => {
    const m = validateManifest({
      ...validManifest,
      claims: [
        {
          slot: "session-card-badge",
          component: "Badge",
          predicate: "isInJjRepo",
        },
      ],
    });
    expect(m.claims[0].predicate).toBe("isInJjRepo");
  });

  it("rejects non-string shouldRender", () => {
    expect(() =>
      validateManifest({
        ...validManifest,
        claims: [{ slot: "session-card-memory", component: "Mem", shouldRender: 42 }],
      }),
    ).toThrow(ManifestValidationError);
  });

  it("manifest without shouldRender field still valid (no field present in resolved claim)", () => {
    const m = validateManifest(validManifest);
    for (const c of m.claims) {
      expect(c.shouldRender).toBeUndefined();
    }
  });
});

describe("validateManifest — shell-overlay-route depth (fix-plugin-and-scoped-back-navigation)", () => {
  const overlay = (extra: Record<string, unknown>) => ({
    ...validManifest,
    claims: [{ slot: "shell-overlay-route", component: "Foo", path: "/foo/:id", ...extra }],
  });

  it("warns and omits depth when a shell-overlay-route claim has no depth", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = validateManifest(overlay({}));
    expect(m.claims[0].depth).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('omits "depth"'));
    warn.mockRestore();
  });

  it("passes through declared depth + parentPath", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = validateManifest(
      overlay({ depth: 2, parentPath: "/folder/:encodedCwd/automations" }),
    );
    expect(m.claims[0].depth).toBe(2);
    expect(m.claims[0].parentPath).toBe("/folder/:encodedCwd/automations");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects an out-of-range depth", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateManifest(overlay({ depth: 3 }))).toThrow(ManifestValidationError);
  });

  it("rejects a non-rooted parentPath", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateManifest(overlay({ depth: 2, parentPath: "folder/x" }))).toThrow(
      ManifestValidationError,
    );
  });
});
