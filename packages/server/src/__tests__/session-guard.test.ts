/**
 * Session guard (change: constrain-agent-tool-surface).
 * Verifies the extensible guard policy, the origin ∪ cwd registry resolution,
 * the policy→spawn translation, the pure containment helpers, and that the
 * guard flags actually reach the pi argv.
 */
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import {
  registerGuardedDir,
  unregisterGuardedDir,
  isGuardedDir,
  resolveGuardForSpawn,
  guardPolicyToSpawn,
  collectPathCandidates,
  pathWithinRoots,
  DEFAULT_GUARD_POLICY,
} from "../session-guard.js";
import { buildHeadlessArgs } from "../spawn-process/process-manager.js";

const CWD = path.resolve("/tmp/ib-workspace");
const OTHER = path.resolve("/tmp/other");

describe("session-guard registry + resolution (origin ∪ cwd)", () => {
  beforeEach(() => {
    unregisterGuardedDir(CWD);
    unregisterGuardedDir(OTHER);
  });

  it("registers and queries a guarded directory", () => {
    expect(isGuardedDir(CWD)).toBe(false);
    registerGuardedDir(CWD);
    expect(isGuardedDir(CWD)).toBe(true);
    unregisterGuardedDir(CWD);
    expect(isGuardedDir(CWD)).toBe(false);
  });

  it("guards a session in a registered cwd (client-spawned Ask case)", () => {
    registerGuardedDir(CWD);
    const policy = resolveGuardForSpawn({ cwd: CWD });
    expect(policy).not.toBeNull();
    expect(policy!.noBuiltinTools).toBe(true);
  });

  it("guards a plugin-originated spawn even in an UNregistered cwd (origin)", () => {
    const policy = resolveGuardForSpawn({ cwd: OTHER, origin: true });
    expect(policy).not.toBeNull();
    expect(policy!.noBuiltinTools).toBe(true);
  });

  it("does NOT guard an unrelated session (neither origin nor guarded cwd)", () => {
    expect(resolveGuardForSpawn({ cwd: OTHER })).toBeNull();
  });

  it("overlays an origin policy over the cwd policy", () => {
    registerGuardedDir(CWD, { noBuiltinTools: true });
    const policy = resolveGuardForSpawn({ cwd: CWD, origin: { deniedTools: ["xx_danger"] } });
    expect(policy!.noBuiltinTools).toBe(true);
    expect(policy!.deniedTools).toEqual(["xx_danger"]);
  });
});

describe("guardPolicyToSpawn translation", () => {
  it("emits --no-builtin-tools by default (no extension when no folder policy)", () => {
    const flags = guardPolicyToSpawn(DEFAULT_GUARD_POLICY, CWD);
    expect(flags.noBuiltinTools).toBe(true);
    expect(flags.loadExtensions ?? []).toEqual([]);
    expect(flags.env).toBeUndefined();
  });

  it("loads the guard extension + passes allowed roots when a folder policy is set", () => {
    const flags = guardPolicyToSpawn({ noBuiltinTools: true, allowedRoots: [CWD] }, CWD);
    expect(flags.loadExtensions?.[0]).toMatch(/session-guard-extension\.ts$/);
    expect(flags.env?.IB_GUARD_ALLOWED_ROOTS).toBe(CWD);
  });
});

describe("pure containment helpers", () => {
  it("collects path-like args recursively from tool input", () => {
    const cands = collectPathCandidates({ ref: "/etc/passwd", n: 3, nested: { file: "sub/x.pdf" }, id: "inv-1" });
    expect(cands).toContain("/etc/passwd");
    expect(cands).toContain("sub/x.pdf");
    expect(cands).not.toContain("inv-1"); // no separator, not a path
  });

  it("allows a path inside a root and rejects one outside", () => {
    expect(pathWithinRoots("notes.txt", [CWD], CWD)).toBe(true);
    expect(pathWithinRoots("/etc/passwd", [CWD], CWD)).toBe(false);
    expect(pathWithinRoots(path.join(CWD, "sub", "a"), [CWD], CWD)).toBe(true);
  });
});

describe("guard flags reach the pi argv", () => {
  it("buildHeadlessArgs emits --no-builtin-tools and -e for guarded options", () => {
    const args = buildHeadlessArgs({ noBuiltinTools: true, loadExtensions: ["/x/guard.ts"] });
    expect(args).toContain("--no-builtin-tools");
    expect(args.join(" ")).toContain("-e /x/guard.ts");
  });

  it("buildHeadlessArgs stays clean for an unguarded spawn", () => {
    const args = buildHeadlessArgs({});
    expect(args).not.toContain("--no-builtin-tools");
    expect(args).not.toContain("-e");
  });
});
