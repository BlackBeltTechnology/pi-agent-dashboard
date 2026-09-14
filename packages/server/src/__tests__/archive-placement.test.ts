/**
 * Archive placement + eligibility (test-plan #E4, #E8, #E9, #X1, #X3).
 *
 * Replaces the removed hide/unhide placement suite. Covers the eligibility
 * decision table, the restore transition, restore-unknown, the write-failure
 * abort and the end-failure abort for the idle-alive path.
 * See change: archive-sessions-lazy-load.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideArchiveAction, requestArchive } from "../browser-handlers/session-meta-handler.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createPendingArchiveIntentRegistry } from "../pending/pending-archive-intent-registry.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-placement-"));
});

afterEach(() => {
  try {
    fs.chmodSync(path.join(tmpDir, "--repo--"), 0o755);
  } catch { /* not created */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Event {
  type: string;
  sessionId?: string;
  cwd?: string;
  count?: number;
}

function makeRig() {
  const manager = createMemorySessionManager();
  const metaPersistence = createMetaPersistence();
  const archive = createSessionArchive({
    sessionManager: manager,
    metaPersistence,
    getPinnedDirs: () => [],
  });
  const events: Event[] = [];
  archive.setEmitter({
    sessionArchived: (sessionId, cwd, count) => events.push({ type: "session_archived", sessionId, cwd, count }),
    archivedCountUpdated: (cwd, count) => events.push({ type: "archived_count_updated", cwd, count }),
    sessionAdded: (session) => events.push({ type: "session_added", sessionId: session.id }),
  });
  const intents = createPendingArchiveIntentRegistry();
  return { manager, metaPersistence, archive, events, intents };
}

function seedSession(
  manager: ReturnType<typeof createMemorySessionManager>,
  over: Partial<DashboardSession> = {},
  meta: Record<string, unknown> = {},
) {
  const dir = path.join(tmpDir, "--repo--");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "2026-01-01T00-00-00-000Z_s1.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "s1", cwd: "/repo" })}\n`);
  writeSessionMeta(file, { cwd: "/repo", name: "S1", status: "ended", startedAt: 1000, endedAt: 2000, ...meta });
  const session: DashboardSession = {
    id: "s1",
    cwd: "/repo",
    name: "S1",
    source: "tui",
    status: "ended",
    startedAt: 1000,
    endedAt: 2000,
    sessionFile: file,
    hidden: false,
    ...over,
  };
  manager.restore(session);
  return { file, session };
}

describe("archive eligibility decision table (E4)", () => {
  it.each<[string, Partial<DashboardSession> | undefined, string]>([
    ["ended", { status: "ended" }, "archive"],
    ["ended live", { status: "ended", live: true }, "reject-live"],
    ["idle alive", { status: "idle", endedAt: undefined }, "end-then-archive"],
    ["streaming alive", { status: "streaming", endedAt: undefined }, "reject-running"],
    ["unknown", undefined, "not-found"],
  ])("%s → %s", (_label, over, expected) => {
    const session = over === undefined ? undefined : ({ id: "s1", cwd: "/repo", ...over } as DashboardSession);
    expect(decideArchiveAction(session)).toBe(expected);
  });
});

describe("archiveSession (E4, X1)", () => {
  it("archives an ended session: sidecar, eviction, index row, broadcast", () => {
    const { manager, archive, events } = makeRig();
    seedSession(manager);
    const result = archive.archiveSession("s1", "manual");
    expect(result.ok).toBe(true);
    expect(manager.get("s1")).toBeUndefined();
    expect(archive.has("s1")).toBe(true);
    expect(events.find((e) => e.type === "session_archived")).toMatchObject({
      sessionId: "s1",
      cwd: "/repo",
      count: 1,
    });
  });

  it("rejects an ended session with live:true", () => {
    const { manager, archive } = makeRig();
    seedSession(manager, { live: true });
    expect(archive.archiveSession("s1", "manual")).toMatchObject({ ok: false });
    expect(manager.get("s1")).toBeDefined();
  });

  it("write failure aborts the archive (X1)", () => {
    const { manager, archive, events } = makeRig();
    const { file } = seedSession(manager);
    // Make the sidecar directory unwritable so the eager merge throws.
    fs.chmodSync(path.dirname(file), 0o555);
    const result = archive.archiveSession("s1", "manual");
    expect(result.ok).toBe(false);
    expect(manager.get("s1")).toBeDefined();
    expect(archive.has("s1")).toBe(false);
    expect(events).toEqual([]);
  });
});

describe("unarchiveSession (E8, E9)", () => {
  it("restores a migrated (hidden) session as visible ended + broadcasts", () => {
    const { manager, archive, events } = makeRig();
    const { file } = seedSession(
      manager,
      {},
      { archived: true, archivedAt: 2100, hidden: true },
    );
    // Evict from the live set and seed the index (as boot would).
    manager.remove("s1");
    archive.seed([
      {
        id: "s1",
        name: "S1",
        cwd: "/repo",
        groupPath: "/repo",
        endedAt: 2000,
        archivedAt: 2100,
        sessionFile: file,
      },
    ]);

    const before = Date.now();
    const result = archive.unarchiveSession("s1");
    expect(result.ok).toBe(true);
    const restored = manager.get("s1");
    expect(restored).toMatchObject({ status: "ended", hidden: false, archived: false });
    expect(restored?.restoredAt).toBeGreaterThanOrEqual(before);
    expect(archive.has("s1")).toBe(false);
    expect(events.map((e) => e.type)).toContain("session_added");
    expect(events.find((e) => e.type === "archived_count_updated")).toMatchObject({ cwd: "/repo", count: 0 });
    expect(readSessionMeta(file)).toMatchObject({ archived: false, hidden: false });
  });

  it("restores a stale non-ended sidecar as ended (B2)", () => {
    const { manager, archive } = makeRig();
    // A clean-stop sidecar can carry a stale non-ended status (boot migrates
    // those). Restore must re-add it as ended, not as a live-looking zombie.
    const { file } = seedSession(
      manager,
      { status: "idle", endedAt: undefined },
      { status: "idle", endedAt: undefined },
    );
    manager.remove("s1");
    archive.seed([
      { id: "s1", name: "S1", cwd: "/repo", groupPath: "/repo", endedAt: 5000, archivedAt: 6000, sessionFile: file },
    ]);
    expect(archive.unarchiveSession("s1").ok).toBe(true);
    expect(manager.get("s1")?.status).toBe("ended");
    expect(manager.get("s1")?.endedAt).toBeDefined();
  });

  it("rejects an unknown id and broadcasts nothing (E9)", () => {
    const { archive, events } = makeRig();
    expect(archive.unarchiveSession("nope")).toMatchObject({ ok: false });
    expect(events).toEqual([]);
  });
});

describe("idle-alive archive request (X3)", () => {
  it("records an intent and returns pending on the happy path", async () => {
    const { manager, archive, intents } = makeRig();
    seedSession(manager, { status: "idle", endedAt: undefined });
    const result = await requestArchive("s1", {
      sessionManager: manager,
      sessionArchive: archive,
      pendingArchiveIntents: intents,
      broadcast: () => {},
      piGateway: { sendToSession: () => {} } as never,
      headlessPidRegistry: { killBySessionId: async () => {} } as never,
      endSession: async () => {},
    });
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(intents.consume("s1")).toBe(true);
  });

  it("clears the intent and reports an error when ending fails (X3)", async () => {
    const { manager, archive, intents, events } = makeRig();
    seedSession(manager, { status: "idle", endedAt: undefined });
    const result = await requestArchive("s1", {
      sessionManager: manager,
      sessionArchive: archive,
      pendingArchiveIntents: intents,
      broadcast: () => {},
      piGateway: { sendToSession: () => {} } as never,
      headlessPidRegistry: { killBySessionId: async () => {} } as never,
      endSession: async () => {
        throw new Error("end failed");
      },
    });
    expect(result.ok).toBe(false);
    expect(intents.size()).toBe(0);
    expect(archive.has("s1")).toBe(false);
    expect(events).toEqual([]);
  });
});
