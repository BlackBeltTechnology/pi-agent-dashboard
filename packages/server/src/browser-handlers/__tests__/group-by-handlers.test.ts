/**
 * Group-by WS handlers: validate → mutate → broadcast only on real change.
 * See change: session-list-group-by.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore, type PreferencesStore } from "../../persistence/preferences-store.js";
import { handleSetDefaultGroupBy, handleSetFolderGroupBy, handleSetLaneCollapsed } from "../directory-handler.js";
import type { BrowserHandlerContext } from "../handler-context.js";

const REPO = path.resolve(os.tmpdir(), "gb-repo");

describe("group-by handlers", () => {
  let tmpDir: string;
  let store: PreferencesStore;
  let broadcast: ReturnType<typeof vi.fn>;
  let ctx: BrowserHandlerContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-handlers-"));
    store = createPreferencesStore(path.join(tmpDir, "preferences.json"));
    broadcast = vi.fn();
    ctx = { preferencesStore: store, broadcast } as unknown as BrowserHandlerContext;
  });

  afterEach(() => {
    store.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("set_folder_group_by broadcasts the aggregate on change, not on no-op", () => {
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO, mode: "status" }, ctx);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "group_by_prefs_updated",
      defaultGroupBy: "none",
      folderGroupBy: { [REPO]: "status" },
      collapsedLanes: [],
    });
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: `${REPO}/`, mode: "status" }, ctx);
    expect(broadcast).toHaveBeenCalledTimes(1);
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO, mode: null }, ctx);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it("a missing mode is malformed, never an implicit 'use default'", () => {
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO, mode: "status" }, ctx);
    broadcast.mockClear();
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO } as never, ctx);
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO, mode: undefined } as never, ctx);
    expect(broadcast).not.toHaveBeenCalled();
    expect(store.getGroupByPrefs().folderGroupBy).toEqual({ [REPO]: "status" });
  });

  it("invalid values never broadcast or write", () => {
    handleSetFolderGroupBy({ type: "set_folder_group_by", path: REPO, mode: "bogus" as never }, ctx);
    handleSetDefaultGroupBy({ type: "set_default_group_by", mode: "x" as never }, ctx);
    handleSetLaneCollapsed({ type: "set_lane_collapsed", path: REPO, lane: "ended" as never, collapsed: true }, ctx);
    handleSetLaneCollapsed({ type: "set_lane_collapsed", path: 5 as never, lane: "idle", collapsed: true }, ctx);
    expect(broadcast).not.toHaveBeenCalled();
    expect(store.getGroupByPrefs()).toEqual({ defaultGroupBy: "none", folderGroupBy: {}, collapsedLanes: [] });
  });

  it("set_default_group_by and set_lane_collapsed broadcast on change", () => {
    handleSetDefaultGroupBy({ type: "set_default_group_by", mode: "location" }, ctx);
    handleSetDefaultGroupBy({ type: "set_default_group_by", mode: "location" }, ctx);
    handleSetLaneCollapsed({ type: "set_lane_collapsed", path: REPO, lane: "idle", collapsed: true }, ctx);
    handleSetLaneCollapsed({ type: "set_lane_collapsed", path: REPO, lane: "idle", collapsed: true }, ctx);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultGroupBy: "location", collapsedLanes: [`${REPO}::idle`] }),
    );
  });
});
