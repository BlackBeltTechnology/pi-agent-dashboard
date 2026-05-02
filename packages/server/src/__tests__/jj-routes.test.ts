/**
 * Unit tests for the jj REST routes module — focused on the pure helpers
 * (`checkInitColocatedPreconditions`) and validation logic. Full route
 * integration tests are deferred until the test harness wires up a live
 * Fastify instance + browserGateway mock.
 *
 * See change: add-jj-workspace-plugin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const { statusPorcelain } = vi.hoisted(() => ({
  statusPorcelain: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", async () => {
  const real = await vi.importActual<
    typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git.js")
  >("@blackbelt-technology/pi-dashboard-shared/platform/git.js");
  return { ...real, statusPorcelain };
});

import { checkInitColocatedPreconditions } from "../routes/jj-routes.js";

describe("checkInitColocatedPreconditions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jj-routes-test-"));
    statusPorcelain.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns INVALID_CWD when cwd is empty", () => {
    expect(checkInitColocatedPreconditions("")?.code).toBe("INVALID_CWD");
  });

  it("returns INVALID_CWD when cwd does not exist", () => {
    expect(checkInitColocatedPreconditions("/nonexistent/path/12345")?.code).toBe("INVALID_CWD");
  });

  it("returns ALREADY_JJ when .jj/ exists", () => {
    fs.mkdirSync(path.join(tmpDir, ".jj"));
    expect(checkInitColocatedPreconditions(tmpDir)?.code).toBe("ALREADY_JJ");
  });

  it("returns NOT_GIT_REPO when neither .jj/ nor .git/ exist", () => {
    expect(checkInitColocatedPreconditions(tmpDir)?.code).toBe("NOT_GIT_REPO");
  });

  it("returns DIRTY_INDEX when git status has staged entries", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    statusPorcelain.mockReturnValue({
      ok: true,
      value: "M  src/foo.ts\nA  src/bar.ts\n",
    });
    const result = checkInitColocatedPreconditions(tmpDir);
    expect(result?.code).toBe("DIRTY_INDEX");
    expect(result?.message).toContain("2 entries");
  });

  it("returns null on clean .git/ tree (working-tree dirt is fine)", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    // Lines starting with " M" (space then M) are working-tree-only changes.
    // Lines starting with "??" are untracked files. Both are SAFE per spec
    // scenario "Init allowed on unstaged dirty working tree".
    statusPorcelain.mockReturnValue({
      ok: true,
      value: " M src/working-tree-mod.ts\n?? src/new-untracked.ts\n",
    });
    expect(checkInitColocatedPreconditions(tmpDir)).toBeNull();
  });

  it("returns null on totally clean tree", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    statusPorcelain.mockReturnValue({ ok: true, value: "" });
    expect(checkInitColocatedPreconditions(tmpDir)).toBeNull();
  });

  it("returns null when statusPorcelain itself fails (defensive: don't refuse on probe error)", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    statusPorcelain.mockReturnValue({
      ok: false,
      error: { kind: "not-found", binary: "git" },
    });
    expect(checkInitColocatedPreconditions(tmpDir)).toBeNull();
  });
});
