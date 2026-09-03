/**
 * Tool-call containment guard (change: constrain-agent-tool-surface), after the
 * adoption of the host's generic capability-scope mechanism.
 *
 * The former host-side guard REGISTRY and its bespoke flag translation are gone
 * — `spawn-process/cwd-policy.ts` (cwd-keyed tightening floor) and the `scope`
 * block (per-spawn capability fields) provide both. What has NO generic
 * equivalent, and is therefore still ours, is the in-session `tool_call`
 * interceptor: this file locks its config decoding, its containment helpers,
 * and the spawn-funnel expansion that loads it.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  collectPathCandidates,
  decodeGuardEnvList,
  pathWithinRoots,
  GUARD_EXTENSION_PATH,
} from "../session-guard-extension.js";
import { buildHeadlessArgs } from "../spawn-process/process-manager.js";

const CWD = path.resolve("/tmp/ib-workspace");

describe("guard config decoding (PI_EXT_GUARD_* channel)", () => {
  it("decodes the host's JSON-encoded array projection", () => {
    // The host projects `extensionConfig.guard.allowedRoots` as JSON — lossless
    // for paths containing a delimiter, a space, or a comma.
    expect(decodeGuardEnvList(JSON.stringify(["/a/b", "/c d,e"]))).toEqual(["/a/b", "/c d,e"]);
  });

  it("accepts a scalar projection as a one-element list", () => {
    expect(decodeGuardEnvList("/only/root")).toEqual(["/only/root"]);
  });

  it("absent or malformed config never throws (degrades, no crash)", () => {
    expect(decodeGuardEnvList(undefined)).toEqual([]);
    expect(decodeGuardEnvList("")).toEqual([]);
    expect(decodeGuardEnvList("[not json")).toEqual(["[not json"]);
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

  it("rejects a traversal that climbs out of the root", () => {
    expect(pathWithinRoots("../outside/x", [CWD], CWD)).toBe(false);
  });
});

describe("guard scope reaches the pi argv", () => {
  it("buildHeadlessArgs emits --no-builtin-tools and -e for a guarded spawn", () => {
    const args = buildHeadlessArgs({ noBuiltinTools: true, extensions: [GUARD_EXTENSION_PATH] });
    expect(args).toContain("--no-builtin-tools");
    expect(args.join(" ")).toContain(`-e ${GUARD_EXTENSION_PATH}`);
  });

  it("buildHeadlessArgs stays clean for an unguarded spawn", () => {
    const args = buildHeadlessArgs({});
    expect(args).not.toContain("--no-builtin-tools");
    expect(args).not.toContain("-e");
  });
});
