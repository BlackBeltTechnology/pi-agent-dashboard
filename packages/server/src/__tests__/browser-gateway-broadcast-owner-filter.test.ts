/**
 * §8.2 live-broadcast owner filter. While identity is enforced, a broadcast
 * ABOUT a session (session_added / session_updated / session_removed /
 * sessions_reordered / any `sessionId` frame) reaches ONLY sockets whose
 * principal owns that session. Ownerless sessions reach no one.
 *
 * Regression (multi-user run, 2026-09-24): anna's freshly spawned session
 * appeared live in bela's sidebar (session_added / session_updated incl.
 * anna's `sub` / sessions_reordered fanned out to every socket), although the
 * snapshot and list roads were already filtered.
 *
 * See change: add-multi-user-identity-plane (§8.2 / D11).
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const anna = { iss: "https://kc/realms/app", sub: "anna" };
const bela = { iss: "https://kc/realms/app", sub: "bela" };

function fakeWs(principal?: { iss: string; sub: string }) {
  const ws = new EventEmitter() as EventEmitter & Record<string, unknown> & { send: ReturnType<typeof vi.fn> };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  ws.bufferedAmount = 0;
  if (principal) ws.principal = principal;
  return ws;
}

interface FolderOpts {
  pinned?: string[];
  heads?: { cwd: string; branch: string }[];
  known?: string[];
}

function setup(active: boolean, folder: FolderOpts = {}) {
  const piGateway = {
    start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(() => true),
    getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn(),
  } as unknown as PiGateway;
  const sessionManager = createMemorySessionManager();
  sessionManager.register({ id: "a1", cwd: "/pa", source: "dashboard" } as never);
  sessionManager.update("a1", { principalOwner: anna });
  sessionManager.register({ id: "orphan", cwd: "/pt", source: "tui" } as never);
  const skip: unknown[] = new Array(21).fill(undefined);
  // Positional deps: preferencesStore is the 7th arg, directoryService the 8th.
  skip[3] = { getPinnedDirectories: () => folder.pinned ?? [] };
  skip[4] = {
    knownDirectories: () => folder.known ?? [],
    getOpenSpecData: () => ({ initialized: true, changes: [] }),
    folderHeadSnapshot: () => folder.heads ?? [],
  };
  const gateway = createBrowserGateway(
    sessionManager, createMemoryEventStore(() => false), piGateway, ...(skip as []), () => active,
  );
  const wa = fakeWs(anna);
  const wb = fakeWs(bela);
  gateway.wss.emit("connection", wa, {});
  gateway.wss.emit("connection", wb, {});
  wa.send.mockClear();
  wb.send.mockClear();
  const frames = (ws: { send: ReturnType<typeof vi.fn> }) => ws.send.mock.calls.map((c) => JSON.parse(String(c[0])));
  const about = (ws: { send: ReturnType<typeof vi.fn> }, id: string) =>
    frames(ws).filter((m) => JSON.stringify(m).includes(`"${id}"`));
  return { gateway, sessionManager, wa, wb, frames, about };
}

describe("§8.2 live broadcast owner filter (enforced)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errorSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());

  it("session_added / session_updated for an owned session reach only the owner", () => {
    const { gateway, sessionManager, wa, wb, about } = setup(true);
    gateway.broadcastSessionAdded(sessionManager.get("a1"));
    gateway.broadcastSessionUpdated("a1", { name: "mine" });
    expect(about(wa, "a1").map((m) => m.type)).toEqual(["session_added", "session_updated"]);
    expect(about(wb, "a1")).toEqual([]);
  });

  it("an ownerless session reaches no signed-in socket", () => {
    const { gateway, sessionManager, wa, wb, about } = setup(true);
    gateway.broadcastSessionAdded(sessionManager.get("orphan"));
    gateway.broadcastSessionUpdated("orphan", { status: "idle" });
    expect(about(wa, "orphan")).toEqual([]);
    expect(about(wb, "orphan")).toEqual([]);
  });

  it("ownership established after the first add: owner gets the full session (with spawnRequestId), others nothing", () => {
    const { gateway, sessionManager, wa, wb, about } = setup(true);
    sessionManager.register({ id: "new1", cwd: "/pa", source: "unknown" } as never);
    gateway.broadcastSessionAdded(sessionManager.get("new1"), { spawnRequestId: "req-7" });
    expect(about(wa, "new1")).toEqual([]); // not owned yet ⇒ withheld
    sessionManager.update("new1", { principalOwner: anna });
    gateway.broadcastSessionUpdated("new1", { principalOwner: anna });
    const got = about(wa, "new1");
    expect(got[0]).toMatchObject({ type: "session_added", spawnRequestId: "req-7", session: { id: "new1" } });
    expect(got.some((m) => m.type === "session_updated")).toBe(true);
    expect(about(wb, "new1")).toEqual([]);
  });

  it("sessions_reordered is projected per socket to the ids it may see", () => {
    const { gateway, wa, wb, frames } = setup(true);
    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/pa", sessionIds: ["a1", "orphan"] } as never);
    expect(frames(wa).filter((m) => m.type === "sessions_reordered").map((m) => m.sessionIds)).toEqual([["a1"]]);
    expect(frames(wb).filter((m) => m.type === "sessions_reordered")).toEqual([]);
  });

  it("session_removed reaches the (last-known) owner only, even after the session is gone", () => {
    const { gateway, sessionManager, wa, wb, about } = setup(true);
    gateway.broadcastSessionAdded(sessionManager.get("a1"));
    sessionManager.remove("a1");
    gateway.broadcastSessionRemoved("a1");
    expect(about(wa, "a1").map((m) => m.type)).toContain("session_removed");
    expect(about(wb, "a1")).toEqual([]);
  });

  it("frames with no session identity (e.g. folder-level) still reach everyone", () => {
    const { gateway, wa, wb, frames } = setup(true);
    gateway.broadcastToAll({ type: "pinned_dirs_updated", dirs: ["/pa"] } as never);
    expect(frames(wa).some((m) => m.type === "pinned_dirs_updated")).toBe(true);
    expect(frames(wb).some((m) => m.type === "pinned_dirs_updated")).toBe(true);
  });
});

describe("folder-scoped frames (enforced): a folder's updates reach its session owners, or everyone when pinned", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { errorSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());
  const folderFrames = (f: { type: string; cwd?: string }[], cwd: string) =>
    f.filter((m) => (m.type === "git_head_update" || m.type === "openspec_update") && m.cwd === cwd).map((m) => m.type);

  it("git_head_update + openspec_update for anna's folder reach anna only", () => {
    const { gateway, wa, wb, frames } = setup(true);
    gateway.broadcastToAll({ type: "git_head_update", cwd: "/pa", branch: "main" } as never);
    gateway.broadcastOpenSpecUpdate("/pa", "{}");
    expect(folderFrames(frames(wa), "/pa")).toEqual(["git_head_update", "openspec_update"]);
    expect(folderFrames(frames(wb), "/pa")).toEqual([]);
  });

  it("a subfolder session counts (session cwd under the folder)", () => {
    const { gateway, sessionManager, wa, wb, frames } = setup(true);
    sessionManager.register({ id: "sub", cwd: "/mono/pkg", source: "dashboard" } as never);
    sessionManager.update("sub", { principalOwner: bela });
    gateway.broadcastToAll({ type: "git_head_update", cwd: "/mono", branch: "dev" } as never);
    expect(folderFrames(frames(wb), "/mono")).toEqual(["git_head_update"]);
    expect(folderFrames(frames(wa), "/mono")).toEqual([]);
  });

  it("a folder nobody owns a session in reaches no one; a PINNED folder reaches everyone", () => {
    const { gateway, wa, wb, frames } = setup(true, { pinned: ["/shared"] });
    gateway.broadcastToAll({ type: "git_head_update", cwd: "/nobody", branch: "x" } as never);
    gateway.broadcastToAll({ type: "git_head_update", cwd: "/shared", branch: "y" } as never);
    expect(folderFrames(frames(wa), "/nobody")).toEqual([]);
    expect(folderFrames(frames(wb), "/nobody")).toEqual([]);
    expect(folderFrames(frames(wa), "/shared")).toEqual(["git_head_update"]);
    expect(folderFrames(frames(wb), "/shared")).toEqual(["git_head_update"]);
  });

  it("the on-connect replays (folder HEAD map + openspec snapshot) are filtered the same way", () => {
    const { gateway } = setup(true, { heads: [{ cwd: "/pa", branch: "main" }], known: ["/pa"] });
    const late = fakeWs(bela);
    gateway.wss.emit("connection", late, {});
    const got = late.send.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(folderFrames(got, "/pa")).toEqual([]);
    const owner = fakeWs(anna);
    gateway.wss.emit("connection", owner, {});
    const mine = owner.send.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(folderFrames(mine, "/pa").sort()).toEqual(["git_head_update", "openspec_update"]);
  });
});

describe("inert era is unchanged", () => {
  it("every socket receives every session broadcast", () => {
    const { gateway, sessionManager, wb, about } = setup(false);
    gateway.broadcastSessionAdded(sessionManager.get("a1"));
    gateway.broadcastSessionUpdated("orphan", { status: "idle" });
    expect(about(wb, "a1").length).toBe(1);
    expect(about(wb, "orphan").length).toBe(1);
  });
});
