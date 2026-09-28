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

  it("accepts a composer-panel claim (change: make-grammar-fully-plugin-contained)", () => {
    const m = validateManifest({
      ...validManifest,
      claims: [{ slot: "composer-panel", component: "GrammarPanel" }],
    });
    expect(m.claims[0].slot).toBe("composer-panel");
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

  // `tab` is inert since plugin-settings-pages (design D3), so a value outside
  // the enumerated set is no longer a load failure. Kept here (in the
  // invalid-cases block it used to fail in) as the regression sentinel.
  // (test-plan #E12)
  it("still rejects a non-string tab", () => {
    // The VALUE is inert, but `tab` is copied onto the normalized claim, so the
    // TYPE still has to hold. (plugin-settings-pages)
    expect(() =>
      validateManifest({
        ...validManifest,
        claims: [{ slot: "settings-section", tab: 42 }],
      }),
    ).toThrow(ManifestValidationError);
  });

  it("accepts an unknown tab value for settings-section", () => {
    const manifest = validateManifest({
      ...validManifest,
      claims: [{ slot: "settings-section", tab: "nonexistent" }],
    });
    expect(manifest.claims[0].tab).toBe("nonexistent");
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

describe("validateManifest — shell-overlay-route presentation (add-route-backed-overlay-dialogs)", () => {
  const overlay = (extra: Record<string, unknown>) => ({
    ...validManifest,
    claims: [
      { slot: "shell-overlay-route", component: "Foo", path: "/foo/:id", depth: 1, ...extra },
    ],
  });

  it("passes through presentation: \"dialog\"", () => {
    expect(validateManifest(overlay({ presentation: "dialog" })).claims[0].presentation).toBe(
      "dialog",
    );
  });

  it("passes through presentation: \"page\"", () => {
    expect(validateManifest(overlay({ presentation: "page" })).claims[0].presentation).toBe("page");
  });

  it("omits presentation when absent (the shell applies the dialog default at render)", () => {
    expect(validateManifest(overlay({})).claims[0].presentation).toBeUndefined();
  });

  it("REJECTS an unrecognised presentation instead of warn-and-defaulting", () => {
    // Fatal on purpose: a typo silently falling back to "dialog" would hand the
    // author exactly the behaviour they wrote the field to opt OUT of. The
    // `depth` field's warn-and-default precedent is the argument FOR this — a
    // non-fatal warning let four claims ship with broken back navigation.
    expect(() => validateManifest(overlay({ presentation: "modal" }))).toThrow(
      ManifestValidationError,
    );
    expect(() => validateManifest(overlay({ presentation: "modal" }))).toThrow(/"page" or "dialog"/);
  });

  it("REJECTS a non-string presentation rather than coercing", () => {
    expect(() => validateManifest(overlay({ presentation: 42 }))).toThrow(ManifestValidationError);
  });
});

describe("validateManifest — custom-entry-renderer (add-custom-entry-renderer-slot)", () => {
  const claim = (extra: Record<string, unknown>) => ({
    ...validManifest,
    claims: [{ slot: "custom-entry-renderer", ...extra }],
  });

  it("E2: accepts a well-formed claim and carries customType onto the resolved claim", () => {
    const m = validateManifest(claim({ customType: "om.observations.recorded", component: "OmRow" }));
    expect(m.claims[0].slot).toBe("custom-entry-renderer");
    expect(m.claims[0].customType).toBe("om.observations.recorded");
    expect(m.claims[0].component).toBe("OmRow");
  });

  it("E2: rejects a claim missing customType, naming plugin + claim index", () => {
    try {
      validateManifest(claim({ component: "OmRow" }));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).pluginId).toBe("demo");
      expect((e as Error).message).toContain("claims[0]");
      expect((e as Error).message).toContain("customType");
    }
  });

  it("E2: rejects a blank customType", () => {
    expect(() => validateManifest(claim({ customType: "", component: "OmRow" }))).toThrow(
      ManifestValidationError,
    );
  });

  it("E2: rejects a claim missing component", () => {
    try {
      validateManifest(claim({ customType: "om.x" }));
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as Error).message).toContain("claims[0]");
      expect((e as Error).message).toContain("component");
    }
  });

  it("E3: rejects an intra-plugin duplicate customType, naming plugin + duplicated value", () => {
    const dup = {
      ...validManifest,
      claims: [
        { slot: "custom-entry-renderer", customType: "om.observations.recorded", component: "A" },
        { slot: "custom-entry-renderer", customType: "om.observations.recorded", component: "B" },
      ],
    };
    try {
      validateManifest(dup);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).pluginId).toBe("demo");
      expect((e as Error).message).toContain("om.observations.recorded");
    }
  });

  it("accepts distinct customTypes in one manifest", () => {
    const m = validateManifest({
      ...validManifest,
      claims: [
        { slot: "custom-entry-renderer", customType: "om.a", component: "A" },
        { slot: "custom-entry-renderer", customType: "om.b", component: "B" },
      ],
    });
    expect(m.claims).toHaveLength(2);
  });
});

// See change: promote-model-roles-settings (test-plan #E1–#E8).
describe("validateManifest — settings-section nav hint", () => {
  const withNav = (nav: unknown, slot = "settings-section") => ({
    id: "demo",
    displayName: "Demo",
    claims: [
      { slot, component: "DemoSettings", nav },
      { slot: "session-card-badge", component: "DemoBadge" },
    ],
  });
  const run = (nav: unknown, slot?: string) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const m = validateManifest(withNav(nav, slot));
      return { m, warnings: warn.mock.calls.map((c) => String(c[0])) };
    } finally {
      warn.mockRestore();
    }
  };

  it("E1: accepts and normalises a valid hint", () => {
    const { m, warnings } = run({ group: " models ", label: "  Model roles ", description: " Pick… ", order: 5 });
    expect(warnings).toEqual([]);
    // NFKC folds U+2026 HORIZONTAL ELLIPSIS to "..." (spec: stored NFKC-normalised).
    expect(m.claims[0].nav).toEqual({ group: "models", label: "Model roles", description: "Pick...", order: 5 });
  });

  it("E2: label length boundary 40 / 41", () => {
    for (const label of ["a", "b".repeat(40), `  ${"c".repeat(40)}  `]) {
      const { m, warnings } = run({ group: "models", label });
      expect(warnings).toEqual([]);
      expect(m.claims[0].nav?.label).toBe(label.trim());
    }
    const { m, warnings } = run({ group: "models", label: "d".repeat(41) });
    expect(m.claims).toHaveLength(2);
    expect(m.claims[0].nav).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/demo/);
    expect(warnings[0]).toMatch(/claims\[0\]/);
    expect(warnings[0]).toMatch(/label/);
  });

  it("E3: description length boundary 200 / 201", () => {
    const ok = run({ group: "models", label: "X", description: "e".repeat(200) });
    expect(ok.warnings).toEqual([]);
    expect(ok.m.claims[0].nav?.description).toHaveLength(200);
    const bad = run({ group: "models", label: "X", description: "e".repeat(201) });
    expect(bad.m.claims[0].nav).toBeUndefined();
    expect(bad.warnings).toHaveLength(1);
    expect(bad.warnings[0]).toMatch(/description/);
  });

  it("E4: invalid shapes are dropped with a warning, never fatal", () => {
    const cases: Array<[unknown, string]> = [
      [null, "nav"],
      [[], "nav"],
      ["models", "nav"],
      [{ group: "models" }, "label"],
      [{ group: "", label: "X" }, "group"],
      [{ group: "models", label: "   " }, "label"],
      [{ group: "models", label: "X", description: 5 }, "description"],
      [{ group: "models", label: "X", order: Number.NaN }, "order"],
      [{ group: "models", label: "X", order: Number.POSITIVE_INFINITY }, "order"],
      [{ group: "models", label: "X", order: "1" }, "order"],
    ];
    for (const [nav, field] of cases) {
      const { m, warnings } = run(nav);
      expect(m.claims).toHaveLength(2);
      expect(m.claims[0].nav).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/demo/);
      expect(warnings[0]).toMatch(/claims\[0\]/);
      expect(warnings[0]).toContain(field);
    }
  });

  it("E5: Unicode Cc/Cf characters invalidate the hint", () => {
    // Boundary controls count too: trimming must not launder a leading/trailing
    // newline, tab or BOM into a valid label.
    for (const label of ["a\u202Eb", "a\u200Eb", "a\u200Bb", "a\uFEFFb", "a\nb", "\nModel roles", "Model roles\t", "\uFEFFModel roles"]) {
      const { m, warnings } = run({ group: "models", label });
      expect(m.claims[0].nav).toBeUndefined();
      expect(warnings).toHaveLength(1);
    }
    const { m, warnings } = run({ group: "models", label: "X", description: "a\u2066b" });
    expect(m.claims[0].nav).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("E6: blank description is dropped alone", () => {
    const { m, warnings } = run({ group: "models", label: "Model roles", description: "  " });
    expect(warnings).toEqual([]);
    expect(m.claims[0].nav).toEqual({ group: "models", label: "Model roles" });
  });

  it("E7: nav on a non-settings-section slot is dropped silently", () => {
    const { m, warnings } = run({ group: "models", label: "X" }, "session-card-badge");
    expect(m.claims[0].nav).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("E8: unknown group is accepted", () => {
    const { m, warnings } = run({ group: "future-group", label: "X" });
    expect(warnings).toEqual([]);
    expect(m.claims[0].nav?.group).toBe("future-group");
  });
});
