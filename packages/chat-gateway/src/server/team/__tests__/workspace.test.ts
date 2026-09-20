/**
 * Workspace cwd resolution (change: add-chat-gateway-team-controls).
 * Scenarios: E14–E18.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isWithinWorkspace,
  resolveWorkspaceForCwd,
  type WorkspaceView,
} from "../workspace.js";

describe("workspace cwd resolution", () => {
  it("E14: a sibling whose name starts with the folder name does NOT match", () => {
    const ws: WorkspaceView[] = [{ id: "ws_1", name: "A", folders: ["/a/fo"] }];
    expect(resolveWorkspaceForCwd("/a/foo", ws)).toBeNull();
  });

  it("E15: the most specific matching folder wins", () => {
    const ws: WorkspaceView[] = [
      { id: "ws_a", name: "A", folders: ["/a"] },
      { id: "ws_b", name: "B", folders: ["/a/b"] },
    ];
    expect(resolveWorkspaceForCwd("/a/b/c", ws)).toEqual({ workspaceId: "ws_b", folder: "/a/b" });
  });

  it("E16: an exact folder match resolves", () => {
    const ws: WorkspaceView[] = [{ id: "ws_1", name: "A", folders: ["/a/b"] }];
    expect(resolveWorkspaceForCwd("/a/b", ws)).toEqual({ workspaceId: "ws_1", folder: "/a/b" });
  });

  it("E18: a cwd outside every folder does not resolve", () => {
    const ws: WorkspaceView[] = [{ id: "ws_1", name: "A", folders: ["/a/b"] }];
    expect(resolveWorkspaceForCwd("/x/y", ws)).toBeNull();
  });

  it("isWithinWorkspace is segment-boundary aware", () => {
    expect(isWithinWorkspace("/a/b/c", ["/a/b"])).toBe(true);
    expect(isWithinWorkspace("/a/bc", ["/a/b"])).toBe(false);
    expect(isWithinWorkspace("/x", [])).toBe(false);
  });

  describe("with a real filesystem (symlinks)", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-resolve-"));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("E17: a symlinked cwd resolves through the link", () => {
      const realDir = path.join(tmp, "real");
      fs.mkdirSync(path.join(realDir, "sub"), { recursive: true });
      const link = path.join(tmp, "link");
      fs.symlinkSync(realDir, link);
      const ws: WorkspaceView[] = [{ id: "ws_1", name: "A", folders: [realDir] }];

      const match = resolveWorkspaceForCwd(path.join(link, "sub"), ws);
      expect(match?.workspaceId).toBe("ws_1");
    });
  });
});
