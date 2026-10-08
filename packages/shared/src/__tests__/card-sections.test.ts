import { describe, expect, it } from "vitest";
import {
  CARD_SECTION_IDS,
  type CardSectionPrefs,
  countFolderOverrides,
  DEFAULT_FOCUS_PROFILE,
  folderKeyForSession,
  isValidSectionId,
  parentOf,
  pluginSectionId,
  resolveCardSectionVisible,
  resolveFolderListMode,
  sanitizeFocusProfile,
  validateFocusProfile,
} from "../card-sections.js";

describe("CARD_SECTION_IDS", () => {
  it("lists exactly the toggleable sections (no context bar)", () => {
    expect([...CARD_SECTION_IDS]).toEqual([
      "openspec", "git", "process", "kb", "status", "flows", "memory", "tags", "spawn",
      "openspec-badge", "folder-git", "folder-banner", "folder-openspec", "folder-create",
      "folder-ended", "fx-status-animation", "fx-selected-glow",
    ]);
  });
});

describe("isValidSectionId", () => {
  it("accepts built-in and future plugin ids", () => {
    for (const id of CARD_SECTION_IDS) expect(isValidSectionId(id)).toBe(true);
    expect(isValidSectionId("my-plugin-2")).toBe(true);
    expect(isValidSectionId("a".repeat(64))).toBe(true);
  });
  it("rejects malformed ids", () => {
    for (const bad of ["", "../x", "Git", "a b", "a/b", "a".repeat(65), "__proto__"]) {
      expect(isValidSectionId(bad)).toBe(false);
    }
    expect(isValidSectionId(42)).toBe(false);
    expect(isValidSectionId(undefined)).toBe(false);
  });
});

describe("resolveCardSectionVisible", () => {
  it("defaults to visible with no prefs", () => {
    expect(resolveCardSectionVisible(undefined, "/a", "git")).toBe(true);
    expect(resolveCardSectionVisible({}, "/a", "git")).toBe(true);
  });
  it("applies global default when folder has no override", () => {
    const prefs: CardSectionPrefs = { global: { flows: false } };
    expect(resolveCardSectionVisible(prefs, "/a", "flows")).toBe(false);
    expect(resolveCardSectionVisible(prefs, "/a", "git")).toBe(true);
  });
  it("folder override beats global", () => {
    const prefs: CardSectionPrefs = { global: { git: false }, folders: { "/a": { git: true } } };
    expect(resolveCardSectionVisible(prefs, "/a", "git")).toBe(true);
    expect(resolveCardSectionVisible(prefs, "/b", "git")).toBe(false);
  });
  it("folder hide beats global show", () => {
    const prefs: CardSectionPrefs = { global: { git: true }, folders: { "/a": { git: false } } };
    expect(resolveCardSectionVisible(prefs, "/a", "git")).toBe(false);
  });
  it("tolerates an undefined folder key (global only)", () => {
    const prefs: CardSectionPrefs = { global: { tags: false }, folders: { "/a": { tags: true } } };
    expect(resolveCardSectionVisible(prefs, undefined, "tags")).toBe(false);
  });
});

describe("folderKeyForSession", () => {
  it("uses the worktree main path when present", () => {
    expect(
      folderKeyForSession({ cwd: "/repo/.worktrees/feat", gitWorktree: { mainPath: "/repo" } as never }),
    ).toBe("/repo");
  });
  it("falls back to cwd and folds cosmetic drift", () => {
    expect(folderKeyForSession({ cwd: "/repo/" })).toBe("/repo");
  });
  it("folds Windows case", () => {
    expect(folderKeyForSession({ cwd: "C:\\Repo\\" })).toBe(folderKeyForSession({ cwd: "c:\\repo" }));
  });
});

describe("countFolderOverrides", () => {
  it("counts folders overriding each section", () => {
    const prefs: CardSectionPrefs = {
      folders: { "/a": { flows: false }, "/b": { flows: true, git: false }, "/c": {} },
    };
    expect(countFolderOverrides(prefs, "flows")).toBe(2);
    expect(countFolderOverrides(prefs, "git")).toBe(1);
    expect(countFolderOverrides(prefs, "tags")).toBe(0);
    expect(countFolderOverrides(undefined, "tags")).toBe(0);
  });
});

describe("pluginSectionId / parentOf", () => {
  it("derives valid ids", () => {
    expect(pluginSectionId("badge", "automation")).toBe("badge-automation");
    expect(pluginSectionId("actionbar", "mcp-client")).toBe("actionbar-mcp-client");
    expect(pluginSectionId("pill", "kb")).toBe("pill-kb");
  });
  it("returns null for invalid results", () => {
    expect(pluginSectionId("badge", "a".repeat(58))).toBe(`badge-${"a".repeat(58)}`);
    expect(pluginSectionId("badge", "a".repeat(59))).toBeNull();
    expect(pluginSectionId("pill", "Bad_Id")).toBeNull();
  });
  it("maps legacy parents", () => {
    expect(parentOf("openspec-badge")).toBe("openspec");
    expect(parentOf("badge-goal")).toBe("status");
    expect(parentOf("git")).toBeNull();
  });
});

describe("resolveCardSectionVisible - focus, parent, fx", () => {
  it("highest layer wins: focus > folder > global > parent > visible", () => {
    const prefs: CardSectionPrefs = {
      global: { "openspec-badge": true },
      folders: { "/a": { "openspec-badge": false } },
      focus: { enabled: true, profile: { sections: { "openspec-badge": true } } },
    };
    expect(resolveCardSectionVisible(prefs, "/a", "openspec-badge")).toBe(true);
    expect(resolveCardSectionVisible({ ...prefs, focus: undefined }, "/a", "openspec-badge")).toBe(false);
    expect(resolveCardSectionVisible({ ...prefs, focus: undefined }, "/b", "openspec-badge")).toBe(true);
  });
  it("focus off ignores the profile", () => {
    const prefs: CardSectionPrefs = { focus: { enabled: false, profile: { sections: { git: false } } } };
    expect(resolveCardSectionVisible(prefs, "/a", "git")).toBe(true);
  });
  it("legacy parent applies, child overrides", () => {
    expect(resolveCardSectionVisible({ global: { openspec: false } }, "/a", "openspec-badge")).toBe(false);
    expect(resolveCardSectionVisible({ global: { status: false } }, "/a", "badge-goal")).toBe(false);
    expect(
      resolveCardSectionVisible({ global: { openspec: false, "badge-goal": true, status: false } }, "/a", "badge-goal"),
    ).toBe(true);
    expect(resolveCardSectionVisible({ global: { openspec: false, "openspec-badge": true } }, "/a", "openspec-badge")).toBe(true);
  });
  it("folder parent override reaches the child", () => {
    expect(resolveCardSectionVisible({ folders: { "/a": { openspec: false } } }, "/a", "openspec-badge")).toBe(false);
  });
  it("fx ids ignore folder overrides", () => {
    const prefs: CardSectionPrefs = { folders: { "/a": { "fx-status-animation": false } } };
    expect(resolveCardSectionVisible(prefs, "/a", "fx-status-animation")).toBe(true);
  });
  it("built-in focus profile", () => {
    const prefs: CardSectionPrefs = { focus: { enabled: true } };
    const r = (id: string) => resolveCardSectionVisible(prefs, "/a", id);
    expect(r("git")).toBe(false);
    expect(r("process")).toBe(true);
    expect(r("pill-automation")).toBe(false);
    expect(r("badge-goal")).toBe(false);
    expect(r("actionbar-x")).toBe(false);
    expect(r("fx-selected-glow")).toBe(false);
    expect(r("fx-status-animation")).toBe(false);
    expect(DEFAULT_FOCUS_PROFILE.folderListMode).toBe("accordion");
    expect(resolveFolderListMode(prefs, { folderListMode: "classic" })).toBe("accordion");
  });
  it("stored profile replaces the built-in rule", () => {
    const prefs: CardSectionPrefs = { focus: { enabled: true, profile: { sections: { git: false } } } };
    expect(resolveCardSectionVisible(prefs, "/a", "badge-goal")).toBe(true);
    expect(resolveFolderListMode(prefs, { folderListMode: "classic" })).toBe("classic");
    expect(resolveFolderListMode({ focus: { enabled: false } }, { folderListMode: "accordion" })).toBe("accordion");
    expect(resolveFolderListMode(undefined, {})).toBe("classic");
  });
});

describe("validateFocusProfile / sanitizeFocusProfile", () => {
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, true]));
  it("accepts 255/256 keys, rejects 257", () => {
    expect(validateFocusProfile({ sections: many(255) })).not.toBeNull();
    expect(validateFocusProfile({ sections: many(256) })).not.toBeNull();
    expect(validateFocusProfile({ sections: many(257) })).toBeNull();
  });
  it("rejects bad id / value / mode / shape", () => {
    expect(validateFocusProfile({ sections: { "../x": true } })).toBeNull();
    expect(validateFocusProfile({ sections: { git: "yes" } })).toBeNull();
    expect(validateFocusProfile({ folderListMode: "grid" })).toBeNull();
    expect(validateFocusProfile("x")).toBeNull();
    expect(validateFocusProfile(null)).toBeNull();
    expect(validateFocusProfile({ folderListMode: "accordion", sections: { git: false } })).toEqual({
      folderListMode: "accordion",
      sections: { git: false },
    });
  });
  it("sanitize drops garbage", () => {
    expect(sanitizeFocusProfile({ sections: { git: "no", ok: false, "Bad": true }, folderListMode: "x" })).toEqual({
      sections: { ok: false },
    });
    expect(sanitizeFocusProfile(5)).toBeUndefined();
  });
});
