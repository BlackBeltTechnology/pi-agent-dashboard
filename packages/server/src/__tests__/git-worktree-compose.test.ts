/**
 * Unit tests for `composeWorktreePayload` — the pure helper that merges
 * a bridge-supplied `git_info_update.gitWorktree` field with the server's
 * cached `.meta.json#gitWorktreeBase` value before broadcasting.
 *
 * Pins the §2 contract from change `add-worktree-spawn-dialog`:
 *   - `undefined` from the bridge is "no change" (older bridge).
 *   - `null` from the bridge clears worktree state on the server.
 *   - A `GitWorktreeInfo` object gets `base` filled in from cache iff
 *     bridge didn't already supply one.
 *   - Backward-compat: a bridge that never sends `gitWorktree` round-trips
 *     to a session whose `gitWorktree` stays `undefined`.
 */
import { describe, it, expect } from "vitest";
import { composeWorktreePayload } from "../git-worktree/git-worktree-compose.js";

describe("composeWorktreePayload", () => {
  it("returns undefined when bridge omits gitWorktree (older bridge)", () => {
    expect(composeWorktreePayload(undefined, undefined)).toBeUndefined();
    expect(composeWorktreePayload(undefined, "develop")).toBeUndefined();
  });

  it("returns null when bridge explicitly clears worktree state", () => {
    expect(composeWorktreePayload(null, undefined)).toBeNull();
    expect(composeWorktreePayload(null, "develop")).toBeNull();
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
