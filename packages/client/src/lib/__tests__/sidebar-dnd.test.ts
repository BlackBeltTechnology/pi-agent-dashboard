import { describe, expect, it, vi } from "vitest";

// Capture what closestCenter receives so we can assert type-filtering.
const closestCenterSpy = vi.fn((args: { droppableContainers: unknown[] }) => args.droppableContainers);
vi.mock("@dnd-kit/core", () => ({
  closestCenter: (args: { droppableContainers: unknown[] }) => closestCenterSpy(args),
}));

import {
  compatibleClosestCenter,
  dropIndicatorProps,
  resolveFolderMove,
  resolveWorkspaceFolderReorder,
  resolveWorkspaceReorder,
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

describe("compatibleClosestCenter", () => {
  function run(activeType: string | undefined, types: string[]) {
    closestCenterSpy.mockClear();
    compatibleClosestCenter({
      active: { data: { current: activeType === undefined ? {} : { type: activeType } } },
      droppableContainers: types.map((type) => ({ data: { current: { type } } })),
    } as never);
    return (closestCenterSpy.mock.calls[0][0].droppableContainers as Array<{
      data: { current: { type: string } };
    }>).map((c) => c.data.current.type);
  }

  it("filters candidate droppables to the active draggable's type", () => {
    expect(run("workspace", ["workspace", "session", "workspace"])).toEqual([
      "workspace",
      "workspace",
    ]);
  });

  it("passes all containers through when active has no type", () => {
    expect(run(undefined, ["session"])).toEqual(["session"]);
  });

  // #E21 — a session drag must not reach a workspace or a folder.
  it("resolves a session active only among session candidates", () => {
    expect(
      run("session", ["session", "workspace", "workspace-folder", "workspace-header"]),
    ).toEqual(["session"]);
  });

  // #E22 — a workspace drag must not reach inner folders/sessions.
  it("resolves a workspace active only among workspace candidates", () => {
    expect(run("workspace", ["workspace-folder", "session", "workspace"])).toEqual([
      "workspace",
    ]);
  });

  it("lets a workspace-folder active reach headers, folders, and both eject targets", () => {
    expect(
      run("workspace-folder", [
        "workspace-folder",
        "workspace-header",
        "pinned-group",
        "pinned-tier",
        "session",
        "workspace",
      ]),
    ).toEqual(["workspace-folder", "workspace-header", "pinned-group", "pinned-tier"]);
  });

  // A pinned group is already ejected — `pinned-tier` would be a dead target.
  it("excludes pinned-tier for a pinned-group active", () => {
    expect(run("pinned-group", ["pinned-group", "pinned-tier", "workspace-header"])).toEqual([
      "pinned-group",
      "workspace-header",
    ]);
  });

  // #E23 — an unmatrixed typed active keeps today's same-type wall. Falling
  // back to closestCenter-over-all would be strictly WEAKER than shipped.
  it("same-type filters a typed active absent from the matrix", () => {
    expect(run("future-thing", ["future-thing", "session", "workspace-folder"])).toEqual([
      "future-thing",
    ]);
  });

  // #E24
  it("closestCenters over ALL candidates when the active has no type", () => {
    expect(run(undefined, ["session", "workspace", "pinned-group"])).toEqual([
      "session",
      "workspace",
      "pinned-group",
    ]);
  });
});

// Covers test-plan #E10-#E18 and #P1. See change: drag-folders-across-workspaces.
describe("resolveFolderMove", () => {
  const workspaces = [
    { id: "A", folders: ["/a"] },
    { id: "B", folders: ["/x", "/y", "/z"] },
  ];
  const resolve = (o: Partial<Parameters<typeof resolveFolderMove>[0]>) =>
    resolveFolderMove({
      activeId: "/a",
      activeType: "workspace-folder",
      activeWsId: "A",
      overId: "/y",
      overType: "workspace-folder",
      overWsId: "B",
      workspaces,
      ...o,
    });

  // #E10
  it("resolves pinned-group over pinned-group to the shipped pinned reorder", () => {
    expect(
      resolve({
        activeId: "/p",
        activeType: "pinned-group",
        activeWsId: undefined,
        overId: "/q",
        overType: "pinned-group",
        overWsId: undefined,
      }),
    ).toEqual({ kind: "reorder-pinned" });
  });

  // #E11
  it("resolves same-workspace folder drops to the shipped folder reorder", () => {
    expect(
      resolve({ activeId: "/x", activeWsId: "B", overId: "/y", overWsId: "B" }),
    ).toEqual({ kind: "reorder-folders", wsId: "B" });
  });

  // #E12 — index is computed against the TARGET's array.
  it("resolves a cross-workspace folder drop to a positional move", () => {
    expect(resolve({})).toEqual({ kind: "move", toWorkspaceId: "B", index: 1 });
  });

  // #E13
  it("resolves a pinned group dropped on a workspace folder to a positional move", () => {
    expect(
      resolve({ activeId: "/p", activeType: "pinned-group", activeWsId: undefined }),
    ).toEqual({ kind: "move", toWorkspaceId: "B", index: 1 });
  });

  // #E14 — a header drop appends, so it carries NO index.
  it("resolves a header drop to an append with no index", () => {
    const r = resolve({ overId: "wsh:B", overType: "workspace-header", overWsId: "B" });
    expect(r).toEqual({ kind: "move", toWorkspaceId: "B" });
    expect((r as { index?: number }).index).toBeUndefined();
  });

  // #E15 — dropping on your OWN header must not detach-and-re-append.
  it("returns null for a header drop when the active is already a member", () => {
    expect(
      resolve({ overId: "wsh:A", overType: "workspace-header", overWsId: "A" }),
    ).toBeNull();
  });

  // #E16
  it.each(["pinned-group", "pinned-tier"])(
    "resolves a workspace-folder dropped on %s to an eject",
    (overType) => {
      expect(resolve({ overId: "/p", overType, overWsId: undefined })).toEqual({
        kind: "move",
        toWorkspaceId: null,
      });
    },
  );

  // #E17
  it("returns null when the active and over ids are identical", () => {
    expect(resolve({ overId: "/a", overWsId: "A" })).toBeNull();
  });

  // #E18 — a stale render can point at a workspace that no longer exists.
  it("returns null (and does not throw) for an unknown over wsId", () => {
    expect(() => resolve({ overWsId: "gone" })).not.toThrow();
    expect(resolve({ overWsId: "gone" })).toBeNull();
    expect(resolve({ overWsId: undefined })).toBeNull();
  });
});

// #P1 — the matrix runs on EVERY pointer move; it must stay cheap on a
// realistically large sidebar.
describe("compatibleClosestCenter performance", () => {
  it("stays under 2 ms p95 over ~420 droppables", () => {
    const containers: unknown[] = [];
    for (let w = 0; w < 20; w++) {
      containers.push({ data: { current: { type: "workspace" } } });
      containers.push({ data: { current: { type: "workspace-header", wsId: `w${w}` } } });
      for (let f = 0; f < 20; f++) {
        containers.push({ data: { current: { type: "workspace-folder", wsId: `w${w}` } } });
      }
    }
    const active = { data: { current: { type: "workspace-folder" } } };
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      compatibleClosestCenter({ active, droppableContainers: containers } as never);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(2);
  });
});
