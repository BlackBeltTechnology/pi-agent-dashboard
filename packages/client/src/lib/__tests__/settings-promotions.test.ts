/**
 * Pure settings-nav promotion resolver.
 * See change: promote-model-roles-settings (test-plan #E12–#E16, #X1; task 3.1).
 */
import { describe, expect, it } from "vitest";
import {
  foldSettingsLabel,
  RESERVED_SETTINGS_LABELS,
  type PromotionRow,
  resolveSettingsPromotions,
} from "../settings-promotions.js";

type Nav = { group: string; label: string; description?: string; order?: number };

function row(id: string, firstParty: boolean | undefined, ...navs: Array<Nav | undefined>): PromotionRow {
  return {
    id,
    ...(firstParty === undefined ? {} : { firstParty }),
    claims: navs.map((nav) => ({ slot: "settings-section", ...(nav ? { nav } : {}) })),
  };
}

describe("RESERVED_SETTINGS_LABELS (task 3.1)", () => {
  it("holds built-in page + group labels in en, hu and zh-CN, folded", () => {
    for (const label of ["providers", "dashboard", "models", "security", "plugins", "general"]) {
      expect(RESERVED_SETTINGS_LABELS.has(label)).toBe(true);
    }
    expect(RESERVED_SETTINGS_LABELS.has(foldSettingsLabel("Szolgáltatók"))).toBe(true);
    expect(RESERVED_SETTINGS_LABELS.has(foldSettingsLabel("提供商"))).toBe(true);
    expect(RESERVED_SETTINGS_LABELS.has(foldSettingsLabel("Modellek"))).toBe(true);
    expect(RESERVED_SETTINGS_LABELS.has("model roles")).toBe(false);
  });
});

describe("resolveSettingsPromotions", () => {
  it("E12: only firstParty + allowlisted group + non-reserved label is promoted", () => {
    const rows: PromotionRow[] = [];
    for (const fp of [true, false]) {
      for (const group of ["models", "dashboard", "future-group"]) {
        for (const label of ["Model roles", "Security"]) {
          rows.push(row(`${fp}-${group}-${label}`, fp, { group, label }));
        }
      }
    }
    const map = resolveSettingsPromotions(rows, RESERVED_SETTINGS_LABELS);
    expect([...map.keys()]).toEqual(["true-models-Model roles"]);
  });

  it("E13: reserved labels (all locales, NFKC, trim, case) are ignored, locale-independent", () => {
    const rows = [" providers ", "Dashboard", "Models", "Szolgáltatók", "提供商", "Ｐroviders"].map(
      (label, i) => row(`p${i}`, true, { group: "models", label }),
    );
    const a = resolveSettingsPromotions(rows, RESERVED_SETTINGS_LABELS);
    const b = resolveSettingsPromotions(rows, RESERVED_SETTINGS_LABELS);
    expect(a.size).toBe(0);
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  it("E14: the first ELIGIBLE hint wins", () => {
    const map = resolveSettingsPromotions(
      [
        row(
          "roles",
          true,
          { group: "dashboard", label: "Foo" },
          { group: "models", label: "Model roles" },
          { group: "models", label: "Other" },
        ),
      ],
      RESERVED_SETTINGS_LABELS,
    );
    expect(map.size).toBe(1);
    expect(map.get("roles")?.label).toBe("Model roles");
  });

  it("E15: duplicate labels resolve by order then id; display order is order, label, id", () => {
    const map = resolveSettingsPromotions(
      [
        row("b", true, { group: "models", label: "Budget", order: 1000 }),
        row("a", true, { group: "models", label: "Budget", order: 1000 }),
        row("c", true, { group: "models", label: "Alpha" }),
        row("d", true, { group: "models", label: "Zed", order: 1 }),
      ],
      RESERVED_SETTINGS_LABELS,
    );
    expect(map.has("b")).toBe(false);
    expect([...map.keys()]).toEqual(["d", "c", "a"]);
    expect(map.get("a")?.label).toBe("Budget");
  });

  it("E16: a disabled plugin is still promoted (manifest claims, not enabled state)", () => {
    const r = { ...row("roles", true, { group: "models", label: "Model roles" }), status: { enabled: false } };
    expect(resolveSettingsPromotions([r], RESERVED_SETTINGS_LABELS).has("roles")).toBe(true);
  });

  it("X1: rows from an older server (no firstParty, no nav) yield no promotion", () => {
    expect(resolveSettingsPromotions([row("roles", undefined, undefined)], RESERVED_SETTINGS_LABELS).size).toBe(0);
    expect(
      resolveSettingsPromotions(
        [row("roles", undefined, { group: "models", label: "Model roles" })],
        RESERVED_SETTINGS_LABELS,
      ).size,
    ).toBe(0);
  });

  it("carries group, description and default order onto the promotion", () => {
    const p = resolveSettingsPromotions(
      [row("roles", true, { group: "models", label: "Model roles", description: "Pick." })],
      RESERVED_SETTINGS_LABELS,
    ).get("roles");
    expect(p).toEqual({ pluginId: "roles", group: "models", label: "Model roles", description: "Pick.", order: 1000 });
  });

  it("ignores nav on non-settings-section claims", () => {
    const r: PromotionRow = {
      id: "x",
      firstParty: true,
      claims: [{ slot: "session-card-badge", nav: { group: "models", label: "X" } }],
    };
    expect(resolveSettingsPromotions([r], RESERVED_SETTINGS_LABELS).size).toBe(0);
  });
});
