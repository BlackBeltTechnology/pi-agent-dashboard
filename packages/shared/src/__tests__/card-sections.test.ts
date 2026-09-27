import { describe, expect, it } from "vitest";
import {
  CARD_SECTION_IDS,
  type CardSectionPrefs,
  countFolderOverrides,
  folderKeyForSession,
  isValidSectionId,
  resolveCardSectionVisible,
} from "../card-sections.js";

describe("CARD_SECTION_IDS", () => {
  it("lists exactly the toggleable sections (no context bar)", () => {
    expect([...CARD_SECTION_IDS]).toEqual([
      "openspec", "git", "process", "kb", "status", "flows", "memory", "tags", "spawn",
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
