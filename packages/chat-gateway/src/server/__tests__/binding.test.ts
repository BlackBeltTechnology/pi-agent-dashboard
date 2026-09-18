import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isWithinAllowedRoots, resolveCwd, resolveInteractiveCwd } from "../binding.js";

let tmp: string;
let repos: string;
let proj: string;
let proj2: string;
let outside: string;
let link: string;

beforeAll(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cg-binding-")));
  repos = path.join(tmp, "repos");
  proj = path.join(repos, "proj");
  proj2 = path.join(repos, "proj-2");
  outside = path.join(tmp, "etc");
  link = path.join(repos, "link");
  fs.mkdirSync(path.join(proj, "sub"), { recursive: true });
  fs.mkdirSync(proj2, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, link, "dir");
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("isWithinAllowedRoots", () => {
  it("E1: accepts an in-range cwd", () => {
    expect(isWithinAllowedRoots(proj, [proj])).toBe(true);
    expect(isWithinAllowedRoots(path.join(proj, "sub"), [proj])).toBe(true);
  });

  it("E1: accepts a not-yet-created path inside an allowed root", () => {
    expect(isWithinAllowedRoots(path.join(proj, "not-created-yet"), [proj])).toBe(true);
  });

  it("E2: refuses an out-of-range cwd (segment-aware, proj-2 is not inside proj)", () => {
    expect(isWithinAllowedRoots(outside, [proj])).toBe(false);
    expect(isWithinAllowedRoots(proj2, [proj])).toBe(false);
  });

  it("E3: empty allowedRoots refuses every spawn (fail closed)", () => {
    expect(isWithinAllowedRoots(proj, [])).toBe(false);
    expect(isWithinAllowedRoots(outside, [])).toBe(false);
  });

  it("E4: rejects `..` traversal", () => {
    expect(isWithinAllowedRoots(path.join(proj, "..", "..", "etc"), [proj])).toBe(false);
  });

  it("E4: rejects a real symlink escaping the allowed root", () => {
    // repos/link -> tmp/etc ; link is lexically inside `repos` but realpath is not.
    expect(isWithinAllowedRoots(link, [repos])).toBe(false);
    expect(isWithinAllowedRoots(path.join(link, "passwd"), [repos])).toBe(false);
  });
});

describe("resolveCwd", () => {
  // `repos` is assigned in beforeAll, so the base must be built per test.
  const mkBase = () => ({
    fixedMap: {} as Record<string, string>,
    channelKey: "discord:c1:-",
    allowedRoots: [repos],
  });

  it("E7: precedence persisted > fixedMap > default", () => {
    const r = resolveCwd({
      ...mkBase(),
      persisted: { cwd: proj },
      fixedMap: { "discord:c1:-": proj2 },
      defaultCwd: repos,
    });
    expect(r).toEqual({ kind: "resolved", cwd: proj, source: "persisted" });
  });

  it("E7: fixedMap wins over default when no persisted binding", () => {
    const r = resolveCwd({ ...mkBase(), fixedMap: { "discord:c1:-": proj2 }, defaultCwd: repos });
    expect(r).toEqual({ kind: "resolved", cwd: proj2, source: "fixed-map" });
  });

  it("E7: default is used when nothing more specific resolves", () => {
    const r = resolveCwd({ ...mkBase(), defaultCwd: proj });
    expect(r).toEqual({ kind: "resolved", cwd: proj, source: "default" });
  });

  it("E7: a refused persisted binding does NOT fall through to a wider source", () => {
    const r = resolveCwd({
      ...mkBase(),
      persisted: { cwd: outside },
      fixedMap: { "discord:c1:-": proj2 },
      defaultCwd: proj,
    });
    expect(r).toEqual({ kind: "refused", reason: "persisted_outside_allowed_roots" });
  });

  it("E2: an out-of-range fixedMap entry is refused, not skipped", () => {
    const r = resolveCwd({ ...mkBase(), fixedMap: { "discord:c1:-": outside }, defaultCwd: proj });
    expect(r).toEqual({ kind: "refused", reason: "fixed_map_outside_allowed_roots" });
  });

  it("E4: a `..` traversal / symlink persisted cwd is refused", () => {
    expect(
      resolveCwd({ ...mkBase(), persisted: { cwd: path.join(proj, "..", "..", "etc") } }),
    ).toEqual({
      kind: "refused",
      reason: "persisted_outside_allowed_roots",
    });
    expect(resolveCwd({ ...mkBase(), persisted: { cwd: link } })).toEqual({
      kind: "refused",
      reason: "persisted_outside_allowed_roots",
    });
  });

  it("E3: empty allowedRoots refuses every source", () => {
    expect(resolveCwd({ ...mkBase(), allowedRoots: [], persisted: { cwd: proj } })).toEqual({
      kind: "refused",
      reason: "persisted_outside_allowed_roots",
    });
  });

  it("no binding source -> refused(no_binding_source) so the caller can go interactive", () => {
    expect(resolveCwd(mkBase())).toEqual({ kind: "refused", reason: "no_binding_source" });
  });
});

describe("resolveInteractiveCwd", () => {
  it("E5: an in-range attach candidate is accepted with source attach", () => {
    expect(resolveInteractiveCwd({ candidateCwd: proj, allowedRoots: [repos] })).toEqual({
      kind: "resolved",
      cwd: proj,
      source: "attach",
    });
  });

  it("E6: an out-of-range attach candidate is refused", () => {
    expect(resolveInteractiveCwd({ candidateCwd: outside, allowedRoots: [repos] })).toEqual({
      kind: "refused",
      reason: "outside_allowed_roots",
    });
  });

  it("E3: empty allowedRoots refuses the attach candidate", () => {
    expect(resolveInteractiveCwd({ candidateCwd: proj, allowedRoots: [] })).toEqual({
      kind: "refused",
      reason: "outside_allowed_roots",
    });
  });
});
