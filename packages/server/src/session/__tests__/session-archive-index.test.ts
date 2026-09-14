/**
 * Archive index group-keying + re-key on a pin change (test-plan #E21).
 *
 * The index must fold path-spelling drift (`/a` vs `/a/`) and worktree rows
 * onto the SAME key the client groups by, and a pin change must re-key every
 * row and broadcast `archived_count_updated` for each key whose count moved.
 *
 * See change: archive-sessions-lazy-load.
 */
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionManager } from "../memory-session-manager.js";
import { createSessionArchive } from "../session-archive.js";

interface CountEvent {
  cwd: string;
  count: number;
}

function row(id: string, cwd: string, mainPath?: string): ArchivedSessionSummary {
  return {
    id,
    cwd,
    groupPath: cwd,
    gitWorktree: mainPath ? { mainPath, name: "x" } : undefined,
    endedAt: 2000,
    archivedAt: 2100,
    sessionFile: `/sessions/${id}.jsonl`,
  };
}

let pinned: string[];
let events: CountEvent[];
let archive: ReturnType<typeof createSessionArchive>;

beforeEach(() => {
  pinned = [];
  events = [];
  archive = createSessionArchive({
    sessionManager: {} as unknown as SessionManager,
    metaPersistence: { flush: () => {} },
    getPinnedDirs: () => pinned,
    platform: "linux",
  });
  archive.setEmitter({
    sessionArchived: () => {},
    archivedCountUpdated: (cwd, count) => events.push({ cwd, count }),
    sessionAdded: () => {},
  });
  archive.seed([row("s1", "/a"), row("s2", "/a/"), row("s3", "/a/.worktrees/x", "/a")]);
});

describe("archive index group keying (E21)", () => {
  it("folds path drift and worktree rows onto one key while unpinned", () => {
    expect(archive.countsByKey()).toEqual({ "/a": 3 });
  });

  it("re-keys the worktree row under its own key when pinned and broadcasts both keys", () => {
    pinned = ["/a/.worktrees/x"];
    archive.rekey();

    expect(archive.countsByKey()).toEqual({ "/a": 2, "/a/.worktrees/x": 1 });
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        { cwd: "/a", count: 2 },
        { cwd: "/a/.worktrees/x", count: 1 },
      ]),
    );
    expect(archive.getById("s3")?.groupPath).toBe("/a/.worktrees/x");
  });

  it("folds the worktree row back under the main path when unpinned again", () => {
    pinned = ["/a/.worktrees/x"];
    archive.rekey();
    events.length = 0;

    pinned = [];
    archive.rekey();

    expect(archive.countsByKey()).toEqual({ "/a": 3 });
    expect(events).toEqual(
      expect.arrayContaining([
        { cwd: "/a", count: 3 },
        { cwd: "/a/.worktrees/x", count: 0 },
      ]),
    );
    expect(archive.getById("s3")?.groupPath).toBe("/a");
  });

  it("broadcasts nothing when a re-key leaves every count unchanged", () => {
    archive.rekey();
    expect(events).toEqual([]);
  });
});
