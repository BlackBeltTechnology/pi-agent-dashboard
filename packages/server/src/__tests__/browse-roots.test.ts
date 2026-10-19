/**
 * Allowed-root computation for browse/mkdir confinement, incl. the symlink
 * escape (task D2). See change: harden-server-capability-bounds.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWithinBrowseRoots, resolveBrowseRoots } from "../lib/browse-roots.js";

let tmp: string;
let home: string;
let pinned: string;
let outside: string;

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "browse-roots-")));
  home = path.join(tmp, "home");
  pinned = path.join(tmp, "pinned");
  outside = path.join(tmp, "outside");
  await Promise.all([home, pinned, outside].map((d) => fsp.mkdir(d)));
});
afterEach(() => fsp.rm(tmp, { recursive: true, force: true }));

describe("resolveBrowseRoots / isWithinBrowseRoots", () => {
  it("allows home, pinned dirs and their descendants", async () => {
    await fsp.mkdir(path.join(home, "proj"));
    const roots = await resolveBrowseRoots([pinned], home);
    expect(await isWithinBrowseRoots(home, roots)).toBe(true);
    expect(await isWithinBrowseRoots(path.join(home, "proj"), roots)).toBe(true);
    expect(await isWithinBrowseRoots(pinned, roots)).toBe(true);
  });

  it("rejects the filesystem root, a sibling and a parent of an allowed root", async () => {
    const roots = await resolveBrowseRoots([pinned], home);
    expect(await isWithinBrowseRoots(path.parse(tmp).root, roots)).toBe(false);
    expect(await isWithinBrowseRoots(outside, roots)).toBe(false);
    expect(await isWithinBrowseRoots(tmp, roots)).toBe(false);
  });

  it("rejects a `..` escape out of an allowed root", async () => {
    const roots = await resolveBrowseRoots([], home);
    expect(await isWithinBrowseRoots(path.join(home, "..", "outside"), roots)).toBe(false);
  });

  it("rejects a symlink inside home that points outside", async () => {
    await fsp.symlink(outside, path.join(home, "escape"));
    const roots = await resolveBrowseRoots([], home);
    expect(await isWithinBrowseRoots(path.join(home, "escape"), roots)).toBe(false);
    expect(await isWithinBrowseRoots(path.join(home, "escape", "child"), roots)).toBe(false);
  });

  it("allows a not-yet-existing path under an allowed root (nearest-ancestor realpath)", async () => {
    const roots = await resolveBrowseRoots([], home);
    expect(await isWithinBrowseRoots(path.join(home, "new", "deep"), roots)).toBe(true);
  });

  it("a symlinked HOME is compared on real paths", async () => {
    const link = path.join(tmp, "home-link");
    await fsp.symlink(home, link);
    const roots = await resolveBrowseRoots([], link);
    expect(await isWithinBrowseRoots(path.join(home, "x"), roots)).toBe(true);
    expect(await isWithinBrowseRoots(outside, roots)).toBe(false);
  });
});
