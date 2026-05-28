/**
 * Live integration test for the jj probe in `vcs-info.ts`.
 *
 * Pure unit tests against mocked recipe outputs (see vcs-info-jj.test.ts)
 * cannot catch probe/spec mismatches like the one this change exists to
 * fix: the original `jj.workspaceRoot()`-based probe compiled, tested,
 * and shipped, but produced the wrong value at runtime because the mock
 * values matched the spec's contract rather than real jj output.
 *
 * This test creates a real `jj git init --colocate` repo, adds a real
 * `jj workspace add`-created sibling workspace, and asserts the probe
 * returns the **parent repo root** in both cases.
 *
 * Skipped when `jj` is not resolvable via the tool registry, matching
 * the pattern of other jj integration tests in this repo.
 *
 * See change: fix-jj-workspace-root-probe.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { gatherJjInfo, _resetJjAvailableForTests } from "../vcs-info.js";

// Resolve jj once at module load so we can decide whether to run live.
function resolveJjPath(): string | undefined {
  try {
    const reg = getDefaultRegistry();
    const res = reg.resolve("jj");
    return res.ok ? (res.path ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

const jjPath = resolveJjPath();
const gitPath = (() => {
  try {
    const reg = getDefaultRegistry();
    const res = reg.resolve("git");
    return res.ok ? (res.path ?? undefined) : undefined;
  } catch {
    return undefined;
  }
})();
const haveTooling = Boolean(jjPath && gitPath);

const describeLive = haveTooling ? describe : describe.skip;

describeLive("gatherJjInfo against a real jj repo", () => {
  let tmpRoot: string;
  let canonicalRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-info-jj-probe-"));
    // Canonical form because the probe canonicalizes via realpath.native
    // before emit (Decision 4) — macOS `/tmp` → `/private/tmp` and other
    // symlink hazards live here.
    canonicalRoot = fs.realpathSync.native(tmpRoot);

    // Minimal user identity for jj (some subcommands require it).
    const env = {
      ...process.env,
      JJ_USER: "Test",
      JJ_EMAIL: "test@example.com",
    };
    execFileSync(gitPath!, ["init", "--quiet"], { cwd: tmpRoot, env });
    execFileSync(
      jjPath!,
      ["git", "init", "--colocate"],
      { cwd: tmpRoot, env, stdio: ["ignore", "ignore", "pipe"] },
    );

    _resetJjAvailableForTests();
  });

  afterAll(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("default workspace: workspaceRoot equals the repo root (== cwd)", () => {
    const state = gatherJjInfo(tmpRoot);
    expect(state).toBeDefined();
    expect(state!.isJjRepo).toBe(true);
    expect(state!.isColocated).toBe(true);
    expect(state!.workspaceRoot).toBe(canonicalRoot);
  });

  it("non-default workspace: workspaceRoot equals the parent repo root, NOT the workspace cwd", () => {
    const env = { ...process.env, JJ_USER: "Test", JJ_EMAIL: "test@example.com" };
    const shadowRel = path.join(".shadow", "probe-test");
    // jj workspace add does NOT create intermediate directories.
    fs.mkdirSync(path.join(tmpRoot, ".shadow"), { recursive: true });
    execFileSync(
      jjPath!,
      ["workspace", "add", shadowRel],
      { cwd: tmpRoot, env, stdio: ["ignore", "ignore", "pipe"] },
    );

    const workspaceCwd = path.join(tmpRoot, shadowRel);
    expect(fs.existsSync(path.join(workspaceCwd, ".jj"))).toBe(true);

    const state = gatherJjInfo(workspaceCwd);
    expect(state).toBeDefined();
    expect(state!.isJjRepo).toBe(true);
    expect(state!.workspaceRoot).toBe(canonicalRoot);
    expect(state!.workspaceRoot).not.toBe(workspaceCwd);
  });

  it("symlinked path: workspaceRoot is canonicalized via realpath (macOS /tmp ↔ /private/tmp hardening)", () => {
    if (process.platform === "win32") {
      // Symlink creation on Windows requires elevated privileges or developer-mode;
      // skipping rather than complicating the test.
      return;
    }
    const symlinkParent = fs.mkdtempSync(path.join(os.tmpdir(), "vcs-info-jj-symlink-"));
    const symlinkPath = path.join(symlinkParent, "linked-repo");
    fs.symlinkSync(tmpRoot, symlinkPath, "dir");

    try {
      // Probe via the symlinked path — workspaceRoot must still resolve
      // to the canonical real path, so downstream pathKey comparisons
      // against the canonical cwd succeed.
      const state = gatherJjInfo(symlinkPath);
      expect(state?.workspaceRoot).toBe(canonicalRoot);
    } finally {
      fs.rmSync(symlinkParent, { recursive: true, force: true });
    }
  });
});
