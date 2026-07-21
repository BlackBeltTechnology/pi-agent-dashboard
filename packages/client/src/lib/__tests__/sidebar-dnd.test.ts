import { describe, it, expect, vi } from "vitest";

// Capture what closestCenter receives so we can assert type-filtering.
const closestCenterSpy = vi.fn((args: { droppableContainers: unknown[] }) => args.droppableContainers);
vi.mock("@dnd-kit/core", () => ({
  closestCenter: (args: { droppableContainers: unknown[] }) => closestCenterSpy(args),
}));

import {
  sameTypeClosestCenter,
  dropIndicatorProps,
  resolveWorkspaceReorder,
  resolveWorkspaceFolderReorder,
} from "../layout/sidebar-dnd.js";

describe("resolveWorkspaceReorder", () => {
  it("moves the dragged workspace to the drop slot", () => {
    expect(resolveWorkspaceReorder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  });
  it("returns null when dropped on itself", () => {
    expect(resolveWorkspaceReorder(["a", "b"], "a", "a")).toBeNull();
  });
  it("returns null when an id is missing", () => {
    expect(resolveWorkspaceReorder(["a", "b"], "a", "z")).toBeNull();
  });
});

describe("resolveWorkspaceFolderReorder", () => {
  it("reorders folders within the same workspace", () => {
    expect(resolveWorkspaceFolderReorder(["/x", "/y"], "/x", "/y", "w1", "w1")).toEqual(["/y", "/x"]);
  });
  it("rejects cross-workspace drops (returns null)", () => {
    expect(resolveWorkspaceFolderReorder(["/x", "/y"], "/x", "/y", "w1", "w2")).toBeNull();
  });
  it("returns null when wsId is undefined", () => {
    expect(resolveWorkspaceFolderReorder(["/x", "/y"], "/x", "/y", undefined, undefined)).toBeNull();
  });
  it("returns null on self-drop", () => {
    expect(resolveWorkspaceFolderReorder(["/x", "/y"], "/x", "/x", "w1", "w1")).toBeNull();
  });
});

describe("dropIndicatorProps", () => {
  it("activates the indicator when hovered by another item", () => {
    const p = dropIndicatorProps(true, false);
    expect(p["data-over"]).toBe("true");
    expect(p.className).not.toBe("");
  });
  it("is inactive when not over", () => {
    const p = dropIndicatorProps(false, false);
    expect(p["data-over"]).toBeUndefined();
    expect(p.className).toBe("");
  });
  it("is inactive over itself", () => {
    const p = dropIndicatorProps(true, true);
    expect(p["data-over"]).toBeUndefined();
    expect(p.className).toBe("");
  });
});

describe("sameTypeClosestCenter", () => {
  it("filters candidate droppables to the active draggable's type", () => {
    closestCenterSpy.mockClear();
    const containers = [
      { data: { current: { type: "workspace" } } },
      { data: { current: { type: "session" } } },
      { data: { current: { type: "workspace" } } },
    ];
    sameTypeClosestCenter({
      active: { data: { current: { type: "workspace" } } },
      droppableContainers: containers,
    } as never);
    const passed = closestCenterSpy.mock.calls[0][0].droppableContainers;
    expect(passed).toHaveLength(2);
  });
  it("passes all containers through when active has no type", () => {
    closestCenterSpy.mockClear();
    const containers = [{ data: { current: { type: "session" } } }];
    sameTypeClosestCenter({
      active: { data: { current: {} } },
      droppableContainers: containers,
    } as never);
    expect(closestCenterSpy.mock.calls[0][0].droppableContainers).toHaveLength(1);
  });
});
