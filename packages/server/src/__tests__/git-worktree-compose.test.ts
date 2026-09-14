/**
 * Unit tests for `composeWorktreePayload` — the pure helper that merges
 * a bridge-supplied `git_info_update.gitWorktree` field with the server's
 * cached `.meta.json#gitWorktreeBase` value before broadcasting.
 *
 * Pins the §2 contract from change `add-worktree-spawn-dialog`:
 *   - `undefined` from the bridge is "no change" (older bridge).
 *   - `null` from the bridge clears worktree state on the server — UNLESS
 *     parentage was already resolved for this session, in which case it is
 *     kept (the worktree was removed underneath a live session, not cwd-switched).
 *   - A `GitWorktreeInfo` object gets `base` filled in from cache iff
 *     bridge didn't already supply one.
 *   - Backward-compat: a bridge that never sends `gitWorktree` round-trips
 *     to a session whose `gitWorktree` stays `undefined`.
 */
import { describe, expect, it } from "vitest";
import { composeWorktreePayload } from "../git-worktree/git-worktree-compose.js";

describe("composeWorktreePayload", () => {
  it("returns undefined when bridge omits gitWorktree (older bridge)", () => {
    expect(composeWorktreePayload(undefined, undefined)).toBeUndefined();
    expect(composeWorktreePayload(undefined, "develop")).toBeUndefined();
  });

  it("returns null when bridge explicitly clears worktree state and no prior parentage", () => {
    expect(composeWorktreePayload(null, undefined, undefined)).toBeNull();
    expect(composeWorktreePayload(null, "develop", undefined)).toBeNull();
  });

  it("keeps the prior parentage when the bridge clears after it was set (E1)", () => {
    const prior = { mainPath: "/repo", name: "x" };
    // Same object reference so the handler's update is a no-op set.
    expect(composeWorktreePayload(null, undefined, prior)).toBe(prior);
    // Prior wins over the cached base too.
    expect(composeWorktreePayload(null, "develop", prior)).toBe(prior);
  });

  it("prior does not block an object update (E3)", () => {
    const prior = { mainPath: "/a", name: "x" };
    expect(composeWorktreePayload({ mainPath: "/b", name: "y" }, "main", prior)).toEqual({
      mainPath: "/b",
      name: "y",
      base: "main",
    });
  });

  it("returns undefined when the bridge omits the field even with prior set (E4)", () => {
    const prior = { mainPath: "/repo", name: "x" };
    expect(composeWorktreePayload(undefined, undefined, prior)).toBeUndefined();
  });

  it("returns wire shape unchanged when no cached base", () => {
    const wire = { mainPath: "/repo", name: "feat-x" };
    expect(composeWorktreePayload(wire, undefined)).toEqual(wire);
  });

  it("merges cached base into wire shape", () => {
    const wire = { mainPath: "/repo", name: "feat-x" };
    expect(composeWorktreePayload(wire, "develop")).toEqual({
      mainPath: "/repo",
      name: "feat-x",
      base: "develop",
    });
  });

  it("does NOT overwrite a bridge-supplied base (defensive)", () => {
    const wire = { mainPath: "/repo", name: "feat-x", base: "from-bridge" };
    // Even if the cache had a different value, the wire-supplied one wins.
    expect(composeWorktreePayload(wire, "from-cache")).toEqual({
      mainPath: "/repo",
      name: "feat-x",
      base: "from-bridge",
    });
  });

  it("does not mutate the input wire object", () => {
    const wire = { mainPath: "/repo", name: "feat-x" };
    composeWorktreePayload(wire, "develop");
    expect(wire).toEqual({ mainPath: "/repo", name: "feat-x" });
  });
});
