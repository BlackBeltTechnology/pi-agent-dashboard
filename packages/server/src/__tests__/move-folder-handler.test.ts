/**
 * `handleMoveFolderToWorkspace` — runtime guards, the gate-on-store-return
 * rule, and the load-bearing broadcast ORDER on eject.
 * Covers test-plan #E5, #X1-#X5.
 * See change: drag-folders-across-workspaces.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMoveFolderToWorkspace } from "../browser-handlers/directory-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";

vi.mock("../resolve-path.js", () => ({
  safeRealpathSync: (p: string) => p,
}));

const A_PATH = "/a";

interface Harness {
  ctx: BrowserHandlerContext & { broadcasts: any[] };
  store: any;
}

function createHarness(opts: {
  moveResult?: boolean;
  withStore?: boolean;
  withDirectoryService?: boolean;
} = {}): Harness {
  const { moveResult = true, withStore = true, withDirectoryService = true } = opts;
  const broadcasts: any[] = [];
  const store = withStore
    ? {
        moveFolderToWorkspace: vi.fn(() => moveResult),
        pinDirectory: vi.fn(),
        getPinnedDirectories: vi.fn(() => [A_PATH]),
        getWorkspaces: vi.fn(() => []),
      }
    : undefined;
  const ctx = {
    preferencesStore: store,
    directoryService: withDirectoryService
      ? { onDirectoryAdded: vi.fn(async () => ({ sessions: [], openspecData: {} })) }
      : undefined,
    sessionManager: { get: vi.fn(), register: vi.fn(), unregister: vi.fn(), update: vi.fn() },
    broadcast: vi.fn((m: any) => broadcasts.push(m)),
    broadcasts,
  } as any;
  return { ctx, store };
}

describe("handleMoveFolderToWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  // #E5 — the type annotation is not a runtime guard: `splice(NaN, 0, x)`
  // coerces to a FRONT insert where the contract promises an append.
  it("rejects a non-integer index before touching the store", () => {
    const { ctx, store } = createHarness();
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: "b", index: Number.NaN },
      ctx,
    );
    expect(store.moveFolderToWorkspace).not.toHaveBeenCalled();
    expect(ctx.broadcasts).toHaveLength(0);
  });

  it("rejects a fractional index", () => {
    const { ctx, store } = createHarness();
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: "b", index: 1.5 },
      ctx,
    );
    expect(store.moveFolderToWorkspace).not.toHaveBeenCalled();
    expect(ctx.broadcasts).toHaveLength(0);
  });

  // #X1 — `pinned_dirs_updated` must precede `workspaces_updated`; the
  // reverse order leaves the folder in NEITHER list for one render frame.
  it("broadcasts pinned_dirs_updated BEFORE workspaces_updated on eject", () => {
    const { ctx, store } = createHarness();
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: null },
      ctx,
    );
    expect(store.pinDirectory).toHaveBeenCalledWith(A_PATH);
    const types = ctx.broadcasts.map((m) => m.type);
    expect(types.indexOf("pinned_dirs_updated")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("pinned_dirs_updated")).toBeLessThan(types.indexOf("workspaces_updated"));
  });

  it("does not pin on a non-eject move", () => {
    const { ctx, store } = createHarness();
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: "b", index: 0 },
      ctx,
    );
    expect(store.pinDirectory).not.toHaveBeenCalled();
    expect(ctx.broadcasts.map((m) => m.type)).toEqual(["workspaces_updated"]);
  });

  // #X2 — a rejected request must never mutate: no pin, no discovery, no broadcast.
  it("performs no side effects when the store rejects the move", () => {
    const { ctx, store } = createHarness({ moveResult: false });
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: null },
      ctx,
    );
    expect(store.pinDirectory).not.toHaveBeenCalled();
    expect(ctx.directoryService!.onDirectoryAdded).not.toHaveBeenCalled();
    expect(ctx.broadcasts).toHaveLength(0);
  });

  // #X3 — `preferencesStore` is optional on the handler context.
  it("returns without throwing when preferencesStore is undefined", () => {
    const { ctx } = createHarness({ withStore: false });
    expect(() =>
      handleMoveFolderToWorkspace(
        { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: "b" },
        ctx,
      ),
    ).not.toThrow();
    expect(ctx.broadcasts).toHaveLength(0);
  });

  // #X4 — directory discovery is optional; the pin + broadcasts still happen.
  it("still pins and broadcasts on eject when directoryService is undefined", () => {
    const { ctx, store } = createHarness({ withDirectoryService: false });
    expect(() =>
      handleMoveFolderToWorkspace(
        { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: null },
        ctx,
      ),
    ).not.toThrow();
    expect(store.pinDirectory).toHaveBeenCalledWith(A_PATH);
    expect(ctx.broadcasts.map((m) => m.type)).toEqual([
      "pinned_dirs_updated",
      "workspaces_updated",
    ]);
  });

  // #X5 — the handler always broadcasts the store's post-move snapshot, so a
  // target mutated between the client's render and the message still
  // converges every client on the server's truth.
  it("broadcasts the store's post-move workspace snapshot", () => {
    const { ctx, store } = createHarness();
    store.getWorkspaces.mockReturnValue([{ id: "b", name: "b", collapsed: false, folders: [A_PATH] }]);
    handleMoveFolderToWorkspace(
      { type: "move_folder_to_workspace", path: A_PATH, toWorkspaceId: "b", index: 0 },
      ctx,
    );
    const ws = ctx.broadcasts.find((m) => m.type === "workspaces_updated");
    expect(ws.workspaces).toEqual([{ id: "b", name: "b", collapsed: false, folders: [A_PATH] }]);
  });
});
