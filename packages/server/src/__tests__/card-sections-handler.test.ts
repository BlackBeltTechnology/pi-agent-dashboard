/**
 * `set_card_section_visibility` / `reset_folder_card_sections` handlers —
 * runtime validation, broadcast-only-on-mutation, and the full-snapshot
 * payload. See change: configurable-session-card-sections.
 */
import { describe, expect, it, vi } from "vitest";
import {
  handleResetFolderCardSections,
  handleSetCardSectionVisibility,
  handleSetFocusMode,
  handleSetFocusProfile,
  handleSetFolderExpanded,
} from "../browser-handlers/directory-handler.js";

function harness(result = true) {
  const broadcasts: any[] = [];
  const snapshot = { folders: { "/a": { git: false } } };
  const store = {
    setCardSectionVisibility: vi.fn(() => result),
    resetFolderCardSections: vi.fn(() => result),
    getCardSections: vi.fn(() => snapshot),
    setFocusEnabled: vi.fn(() => result),
    setFocusProfile: vi.fn(() => result),
    setExpandedFolder: vi.fn(() => result),
    getCollapsedFolders: vi.fn(() => []),
    getExpandedFolders: vi.fn(() => ["/a"]),
  };
  const ctx = { preferencesStore: store, broadcast: vi.fn((m: any) => broadcasts.push(m)) } as any;
  return { ctx, store, broadcasts, snapshot };
}

describe("handleSetCardSectionVisibility", () => {
  it("persists and broadcasts the full snapshot on mutation", () => {
    const { ctx, store, broadcasts, snapshot } = harness();
    handleSetCardSectionVisibility(
      { type: "set_card_section_visibility", path: "/a", section: "git", visible: false },
      ctx,
    );
    expect(store.setCardSectionVisibility).toHaveBeenCalledWith("/a", "git", false);
    expect(broadcasts).toEqual([{ type: "card_sections_updated", cardSections: snapshot }]);
  });

  it("path absent → global default", () => {
    const { ctx, store } = harness();
    handleSetCardSectionVisibility({ type: "set_card_section_visibility", section: "flows", visible: null }, ctx);
    expect(store.setCardSectionVisibility).toHaveBeenCalledWith(undefined, "flows", null);
  });

  it("no broadcast when the store reports no mutation", () => {
    const { ctx, broadcasts } = harness(false);
    handleSetCardSectionVisibility(
      { type: "set_card_section_visibility", path: "/a", section: "git", visible: false },
      ctx,
    );
    expect(broadcasts).toEqual([]);
  });

  it.each([
    ["malformed id", { path: "/a", section: "../x", visible: false }],
    ["non-string id", { path: "/a", section: 5, visible: false }],
    ["bad value", { path: "/a", section: "git", visible: "yes" }],
    ["missing value", { path: "/a", section: "git" }],
    ["empty path", { path: "", section: "git", visible: false }],
    ["non-string path", { path: 7, section: "git", visible: false }],
  ])("rejects %s without mutation or broadcast", (_label, fields) => {
    const { ctx, store, broadcasts } = harness();
    handleSetCardSectionVisibility({ type: "set_card_section_visibility", ...fields } as never, ctx);
    expect(store.setCardSectionVisibility).not.toHaveBeenCalled();
    expect(broadcasts).toEqual([]);
  });

  it("tolerates a store without the card-section API", () => {
    const ctx = { preferencesStore: {}, broadcast: vi.fn() } as any;
    handleSetCardSectionVisibility(
      { type: "set_card_section_visibility", path: "/a", section: "git", visible: false },
      ctx,
    );
    expect(ctx.broadcast).not.toHaveBeenCalled();
  });
});

describe("handleResetFolderCardSections", () => {
  it("resets and broadcasts on mutation", () => {
    const { ctx, store, broadcasts } = harness();
    handleResetFolderCardSections({ type: "reset_folder_card_sections", path: "/a" }, ctx);
    expect(store.resetFolderCardSections).toHaveBeenCalledWith("/a");
    expect(broadcasts).toHaveLength(1);
  });

  it("rejects an empty path and skips broadcast on no-op", () => {
    const a = harness();
    handleResetFolderCardSections({ type: "reset_folder_card_sections", path: "" }, a.ctx);
    expect(a.store.resetFolderCardSections).not.toHaveBeenCalled();
    const b = harness(false);
    handleResetFolderCardSections({ type: "reset_folder_card_sections", path: "/a" }, b.ctx);
    expect(b.broadcasts).toEqual([]);
  });
});

describe("focus handlers (add-focus-mode-and-card-block-toggles)", () => {
  it("set_focus_mode broadcasts the snapshot; non-boolean rejected", () => {
    const h = harness();
    handleSetFocusMode({ type: "set_focus_mode", enabled: true }, h.ctx);
    expect(h.store.setFocusEnabled).toHaveBeenCalledWith(true);
    expect(h.broadcasts).toEqual([{ type: "card_sections_updated", cardSections: h.snapshot }]);
    const bad = harness();
    handleSetFocusMode({ type: "set_focus_mode", enabled: "yes" } as never, bad.ctx);
    expect(bad.store.setFocusEnabled).not.toHaveBeenCalled();
    expect(bad.broadcasts).toEqual([]);
  });

  it("set_focus_profile delegates validation to the store; no broadcast when rejected", () => {
    const ok = harness();
    handleSetFocusProfile({ type: "set_focus_profile", profile: { sections: { git: false } } }, ok.ctx);
    expect(ok.broadcasts).toHaveLength(1);
    handleSetFocusProfile({ type: "set_focus_profile", profile: null }, ok.ctx);
    expect(ok.store.setFocusProfile).toHaveBeenLastCalledWith(null);
    const rej = harness(false);
    handleSetFocusProfile({ type: "set_focus_profile", profile: { sections: { "../x": true } } }, rej.ctx);
    expect(rej.broadcasts).toEqual([]);
  });

  it("rejects folder-scoped fx-* writes, accepts global", () => {
    const h = harness();
    handleSetCardSectionVisibility(
      { type: "set_card_section_visibility", path: "/a", section: "fx-status-animation", visible: false },
      h.ctx,
    );
    expect(h.store.setCardSectionVisibility).not.toHaveBeenCalled();
    expect(h.broadcasts).toEqual([]);
    handleSetCardSectionVisibility(
      { type: "set_card_section_visibility", section: "fx-status-animation", visible: false },
      h.ctx,
    );
    expect(h.store.setCardSectionVisibility).toHaveBeenCalledWith(undefined, "fx-status-animation", false);
  });

  it("set_folder_expanded validates and broadcasts both lists", () => {
    const h = harness();
    handleSetFolderExpanded({ type: "set_folder_expanded", path: "/a", expanded: true }, h.ctx);
    expect(h.broadcasts).toEqual([
      { type: "collapsed_folders_updated", collapsedFolders: [], expandedFolders: ["/a"] },
    ]);
    const bad = harness();
    handleSetFolderExpanded({ type: "set_folder_expanded", path: "", expanded: true }, bad.ctx);
    handleSetFolderExpanded({ type: "set_folder_expanded", path: "/a", expanded: "x" } as never, bad.ctx);
    expect(bad.store.setExpandedFolder).not.toHaveBeenCalled();
  });
});
