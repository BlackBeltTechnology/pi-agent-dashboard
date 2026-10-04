/**
 * Git-dir watcher routing + attach failure. test-plan ids: X3 (+routing).
 * See change: optimize-polling-hot-paths.
 */
import { describe, expect, it, vi } from "vitest";
import { createGitDirWatcher, laneForGitDirFile, type WatchFn } from "../git-dir-watcher.js";

function fakeWatch() {
  const listeners = new Map<string, (e: string, f: string | null) => void>();
  const closed: string[] = [];
  const watch: WatchFn = (dir, _opts, listener) => {
    listeners.set(dir, listener as any);
    return { close: () => void closed.push(dir), on: () => ({}) as any } as any;
  };
  return { watch, listeners, closed };
}

describe("laneForGitDirFile", () => {
  it("routes branch-affecting files to the fast lane", () => {
    for (const f of ["HEAD", "packed-refs", "ORIG_HEAD", "FETCH_HEAD", "MERGE_HEAD"]) expect(laneForGitDirFile(f)).toBe("fast");
  });
  it("routes index and unknown (null) events to the slow lane", () => {
    expect(laneForGitDirFile("index")).toBe("slow");
    expect(laneForGitDirFile(null)).toBe("slow");
  });
  it("ignores everything else (lock files, objects)", () => {
    for (const f of ["index.lock", "HEAD.lock", "objects", "config"]) expect(laneForGitDirFile(f)).toBeUndefined();
  });
});

describe("createGitDirWatcher", () => {
  it("watches gitDir and, when different, commonDir; events reach onEvent by lane", () => {
    const { watch, listeners } = fakeWatch();
    const onEvent = vi.fn();
    const w = createGitDirWatcher({ onEvent, watch });
    expect(w.attach("/r/.git/worktrees/x", "/r/.git")).toBe(true);
    expect([...listeners.keys()].sort()).toEqual(["/r/.git", "/r/.git/worktrees/x"]);
    listeners.get("/r/.git")!("rename", "HEAD");
    listeners.get("/r/.git")!("change", "index");
    listeners.get("/r/.git")!("change", "index.lock");
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual(["fast", "slow"]);
  });

  it("X3: attach failure (EMFILE) returns false and never throws", () => {
    const watch: WatchFn = () => {
      throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
    };
    const w = createGitDirWatcher({ onEvent: vi.fn(), watch });
    expect(w.attach("/r/.git")).toBe(false);
  });

  it("detach closes every watch; re-attach detaches first", () => {
    const { watch, closed } = fakeWatch();
    const w = createGitDirWatcher({ onEvent: vi.fn(), watch });
    w.attach("/a/.git");
    w.attach("/b/.git");
    expect(closed).toEqual(["/a/.git"]);
    w.detach();
    expect(closed).toEqual(["/a/.git", "/b/.git"]);
  });
});
