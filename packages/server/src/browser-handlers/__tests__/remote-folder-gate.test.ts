/**
 * Remote sockets cannot widen their own browse roots: pin / add-to-workspace /
 * move-to-workspace outside the shared roots are refused; local sockets and
 * paths inside the roots are unchanged.
 * See change: harden-server-capability-bounds (test-plan #E26, #E27, #E37).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBrowseRootSources, resolveBrowseRoots } from "../../lib/browse-roots.js";
import {
  handleAddFolderToWorkspace,
  handleMoveFolderToWorkspace,
  handlePinDirectory,
} from "../directory-handler.js";
import type { BrowserHandlerContext } from "../handler-context.js";

let tmp: string;
let home: string;
let pinned: string[];
let wsFolders: string[];
const mk = async (...p: string[]) => {
  const d = path.join(tmp, ...p);
  await fsp.mkdir(d, { recursive: true });
  return d;
};

function makeCtx(locallyTrusted: boolean | undefined) {
  const store = {
    getPinnedDirectories: () => pinned,
    getWorkspaces: () => [{ id: "W", name: "W", folders: wsFolders }],
    pinDirectory: vi.fn((p: string) => void pinned.push(p)),
    flush: vi.fn(),
    addFolderToWorkspace: vi.fn((_id: string, p: string) => (wsFolders.push(p), true)),
    moveFolderToWorkspace: vi.fn(() => true),
  };
  const sources = buildBrowseRootSources({ preferencesStore: store, sessionManager: { listAll: () => [] } });
  const sendTo = vi.fn();
  const broadcast = vi.fn();
  const ws = { id: "socket" };
  const ctx = {
    ws,
    sendTo,
    broadcast,
    preferencesStore: store,
    sessionManager: { get: vi.fn(), listAll: () => [] },
    ...(locallyTrusted === undefined ? {} : { locallyTrusted }),
    browseRoots: () => resolveBrowseRoots(sources, { homedir: home }),
  } as unknown as BrowserHandlerContext;
  return { ctx, store, sendTo, ws };
}
const refusedFor = (sendTo: ReturnType<typeof vi.fn>, ws: object, p: string) =>
  expect(sendTo).toHaveBeenCalledWith(ws, { type: "folder_refused", path: p, reason: "outside_allowed_roots" });

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "folder-gate-")));
  home = await mk("home");
  pinned = [];
  wsFolders = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe("E26 pin_directory", () => {
  it("remote `/` is refused: not pinned, folder_refused to that socket only", async () => {
    const { ctx, store, sendTo, ws } = makeCtx(false);
    handlePinDirectory({ type: "pin_directory", path: path.parse(tmp).root }, ctx);
    await vi.waitFor(() => refusedFor(sendTo, ws, path.parse(tmp).root));
    expect(store.pinDirectory).not.toHaveBeenCalled();
    expect(ctx.broadcast).not.toHaveBeenCalled();
  });

  it("remote path inside home is pinned", async () => {
    const proj = await mk("home", "Project", "app");
    const { ctx, store } = makeCtx(false);
    handlePinDirectory({ type: "pin_directory", path: proj }, ctx);
    await vi.waitFor(() => expect(store.pinDirectory).toHaveBeenCalledWith(proj));
  });

  it("remote `/srv/work` (outside) is refused; local pins it synchronously", async () => {
    const work = await mk("srv", "work");
    const remote = makeCtx(false);
    handlePinDirectory({ type: "pin_directory", path: work }, remote.ctx);
    await vi.waitFor(() => refusedFor(remote.sendTo, remote.ws, work));
    expect(remote.store.pinDirectory).not.toHaveBeenCalled();

    const localCtx = makeCtx(true);
    handlePinDirectory({ type: "pin_directory", path: work }, localCtx.ctx);
    expect(localCtx.store.pinDirectory).toHaveBeenCalledWith(work); // no await: unchanged sync path
    expect(localCtx.sendTo).not.toHaveBeenCalled();
  });

  it("a remote socket without a root resolver fails closed", async () => {
    const { ctx, store, sendTo } = makeCtx(false);
    (ctx as { browseRoots?: unknown }).browseRoots = undefined;
    handlePinDirectory({ type: "pin_directory", path: home }, ctx);
    await vi.waitFor(() => expect(sendTo).toHaveBeenCalled());
    expect(store.pinDirectory).not.toHaveBeenCalled();
  });

  it("a context with no locality flag is ungated (contexts built outside the gateway)", async () => {
    const work = await mk("srv", "work");
    const { ctx, store } = makeCtx(undefined);
    handlePinDirectory({ type: "pin_directory", path: work }, ctx);
    expect(store.pinDirectory).toHaveBeenCalledWith(work);
  });
});

describe("browse.confineRemote = false", () => {
  it("a remote socket pins anywhere when the resolver reports confinement off (null)", async () => {
    const work = await mk("srv", "work");
    const { ctx, store } = makeCtx(false);
    (ctx as { browseRoots?: unknown }).browseRoots = async () => null;
    handlePinDirectory({ type: "pin_directory", path: work }, ctx);
    await vi.waitFor(() => expect(store.pinDirectory).toHaveBeenCalledWith(work));
  });
});

describe("E27 add_folder_to_workspace", () => {
  it("remote outside is refused and the workspace is unchanged; inside is added; local outside is added", async () => {
    const outside = await mk("opt", "x");
    const inside = await mk("home", "p");
    const r = makeCtx(false);
    handleAddFolderToWorkspace({ type: "add_folder_to_workspace", id: "W", path: outside }, r.ctx);
    await vi.waitFor(() => refusedFor(r.sendTo, r.ws, outside));
    expect(r.store.addFolderToWorkspace).not.toHaveBeenCalled();

    handleAddFolderToWorkspace({ type: "add_folder_to_workspace", id: "W", path: inside }, r.ctx);
    await vi.waitFor(() => expect(r.store.addFolderToWorkspace).toHaveBeenCalledWith("W", inside));

    const l = makeCtx(true);
    handleAddFolderToWorkspace({ type: "add_folder_to_workspace", id: "W", path: outside }, l.ctx);
    expect(l.store.addFolderToWorkspace).toHaveBeenCalledWith("W", outside);
  });
});

describe("E37 move_folder_to_workspace", () => {
  it("remote outside (eject to pins) is refused; an existing root is moved", async () => {
    const outside = await mk("opt", "x");
    const app = await mk("home", "Project", "app");
    pinned = [app];
    const r = makeCtx(false);
    handleMoveFolderToWorkspace({ type: "move_folder_to_workspace", path: outside, toWorkspaceId: null }, r.ctx);
    await vi.waitFor(() => refusedFor(r.sendTo, r.ws, outside));
    expect(r.store.moveFolderToWorkspace).not.toHaveBeenCalled();
    expect(r.store.pinDirectory).not.toHaveBeenCalled();

    handleMoveFolderToWorkspace({ type: "move_folder_to_workspace", path: app, toWorkspaceId: "W" }, r.ctx);
    await vi.waitFor(() => expect(r.store.moveFolderToWorkspace).toHaveBeenCalled());
  });
});
