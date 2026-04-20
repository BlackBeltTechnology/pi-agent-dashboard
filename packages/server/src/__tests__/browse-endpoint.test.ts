/**
 * Tests for the browse directory endpoint logic.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listDirectories, createDirectory, validateMkdirName } from "../browse.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";

describe("listDirectories", () => {
  it("should return directory entries for a valid path", async () => {
    // Use the project root — known to have subdirectories
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const result = await listDirectories(projectRoot);

    expect(result.current).toBe(projectRoot);
    expect(result.parent).toBe(path.dirname(projectRoot));
    expect(result.entries.length).toBeGreaterThan(0);

    // Should contain known subdirectories at the monorepo root
    const names = result.entries.map((e) => e.name);
    expect(names).toContain("packages");
    expect(names).toContain("node_modules");
  });

  it("should default to home directory when no path given", async () => {
    const result = await listDirectories();
    expect(result.current).toBe(os.homedir());
  });

  it("should return entries sorted alphabetically", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const result = await listDirectories(projectRoot);
    const names = result.entries.map((e) => e.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("should exclude hidden directories", async () => {
    // Home dir typically has hidden dirs like .config, .cache
    const result = await listDirectories(os.homedir());
    const names = result.entries.map((e) => e.name);
    const hidden = names.filter((n) => n.startsWith("."));
    expect(hidden).toEqual([]);
  });

  it("should detect isGit flag for git repos", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const parentDir = path.dirname(projectRoot);
    const result = await listDirectories(parentDir);

    const projectEntry = result.entries.find(
      (e) => e.name === path.basename(projectRoot)
    );
    expect(projectEntry).toBeDefined();
    expect(projectEntry!.isGit).toBe(true);
  });

  it("should detect isPi flag for pi projects", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const parentDir = path.dirname(projectRoot);
    const result = await listDirectories(parentDir);

    const projectEntry = result.entries.find(
      (e) => e.name === path.basename(projectRoot)
    );
    expect(projectEntry).toBeDefined();
    expect(projectEntry!.isPi).toBe(true);
  });

  it("should return null parent for root directory", async () => {
    const result = await listDirectories("/");
    expect(result.parent).toBeNull();
  });

  it("should throw for non-existent directory", async () => {
    await expect(
      listDirectories("/nonexistent/path/that/does/not/exist")
    ).rejects.toThrow();
  });

  it("should cap entries at 200", async () => {
    // Can't easily create 200+ dirs, but test the logic path exists
    const result = await listDirectories(os.homedir());
    expect(result.entries.length).toBeLessThanOrEqual(200);
  });

  it("should only return directories, not files", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const result = await listDirectories(projectRoot);
    const names = result.entries.map((e) => e.name);
    // package.json is a file, should not appear
    expect(names).not.toContain("package.json");
    expect(names).not.toContain("tsconfig.json");
  });

  it("should include full path in each entry", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const result = await listDirectories(projectRoot);
    for (const entry of result.entries) {
      expect(entry.path).toBe(path.join(projectRoot, entry.name));
    }
  });

  it("should return the server's platform", async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../../../..");
    const result = await listDirectories(projectRoot);
    expect(result.platform).toBe(process.platform);
  });

  it("returns parent=null at the filesystem root", async () => {
    // Use whichever root is appropriate for the host: "/" on Unix, the
    // process's drive root on Windows. Previously this test only
    // exercised Unix; `isFilesystemRoot` covers both branches now.
    const root = process.platform === "win32"
      ? path.parse(process.cwd()).root    // e.g., "C:\\" or "B:\\"
      : "/";
    const result = await listDirectories(root);
    expect(result.parent).toBeNull();
  });
});

describe("listDirectories with q filter", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "browse-q-"));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function makeDirs(names: string[]) {
    for (const n of names) await fsp.mkdir(path.join(tmp, n));
  }

  it("treats empty q as no filter", async () => {
    await makeDirs(["alpha", "beta"]);
    const r1 = await listDirectories(tmp, "");
    const r2 = await listDirectories(tmp, "   ");
    const r3 = await listDirectories(tmp);
    const names1 = r1.entries.map((e) => e.name);
    const names2 = r2.entries.map((e) => e.name);
    const names3 = r3.entries.map((e) => e.name);
    expect(names1).toEqual(["alpha", "beta"]);
    expect(names2).toEqual(["alpha", "beta"]);
    expect(names3).toEqual(["alpha", "beta"]);
  });

  it("returns non-prefix substring matches", async () => {
    await makeDirs(["pi-dashboard", "my-dashboard-old", "readme-dir"]);
    const r = await listDirectories(tmp, "dash");
    const names = r.entries.map((e) => e.name);
    expect(names).toContain("pi-dashboard");
    expect(names).toContain("my-dashboard-old");
    expect(names).not.toContain("readme-dir");
  });

  it("ranks by tier: exact, prefix, word-boundary, substring", async () => {
    await makeDirs(["pi", "pi-core", "my-pi-tools", "epiphany"]);
    const r = await listDirectories(tmp, "pi");
    const names = r.entries.map((e) => e.name);
    expect(names).toEqual(["pi", "pi-core", "my-pi-tools", "epiphany"]);
  });

  it("sorts alphabetically within the same tier", async () => {
    await makeDirs(["pi-zeta", "pi-alpha", "pi-mu"]);
    const r = await listDirectories(tmp, "pi");
    const names = r.entries.map((e) => e.name);
    // all prefix-tier → alphabetical
    expect(names).toEqual(["pi-alpha", "pi-mu", "pi-zeta"]);
  });

  it("is case-insensitive", async () => {
    await makeDirs(["Pi-Dashboard", "OtherThing"]);
    const r = await listDirectories(tmp, "dash");
    const names = r.entries.map((e) => e.name);
    expect(names).toContain("Pi-Dashboard");
    expect(names).not.toContain("OtherThing");
  });

  it("applies the 200-cap AFTER filtering so late-alphabet matches survive", async () => {
    // Create 210 dummy dirs that don't match 'pi', plus one that does.
    // The matching one alphabetically sorts near the end.
    const dummy: string[] = [];
    for (let i = 0; i < 210; i++) {
      dummy.push(`z-${String(i).padStart(3, "0")}-other`);
    }
    // 'pi-dashboard' is the only match; sorts after all 'z-*'? No — 'p' < 'z',
    // so use 'pi-dashboard' which alphabetically precedes them anyway. Use
    // a different setup: create one matching dir named so alphabetically it
    // falls past position 200 in the unfiltered list.
    await makeDirs(dummy);
    // 'zz-pi-match' will alphabetically be past the 200 'z-*' entries if we
    // keep them, but since we only have 210 total, let's just make the matcher
    // something that would be cut without filtering. Easier: 'aa-other' ×210
    // plus a single 'pi-found'.
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp);
    const many: string[] = [];
    for (let i = 0; i < 210; i++) many.push(`aa-${String(i).padStart(3, "0")}`);
    many.push("pi-found");
    await makeDirs(many);

    // Without filter: 'pi-found' sorts alphabetically past 210 'aa-*' entries,
    // so it lands at position 210 — cut by the 200 cap.
    const unfiltered = await listDirectories(tmp);
    expect(unfiltered.entries.length).toBe(200);
    expect(unfiltered.entries.map((e) => e.name)).not.toContain("pi-found");

    // With filter: it should survive because filtering happens first.
    const filtered = await listDirectories(tmp, "pi");
    expect(filtered.entries.map((e) => e.name)).toContain("pi-found");
  });
});

describe("validateMkdirName", () => {
  it("accepts normal names", () => {
    expect(validateMkdirName("foo")).toBeNull();
    expect(validateMkdirName("foo-bar")).toBeNull();
    expect(validateMkdirName("foo_bar")).toBeNull();
    expect(validateMkdirName("foo.bar")).toBeNull();
    expect(validateMkdirName("foo bar")).toBeNull();
    expect(validateMkdirName("\u00e9l\u00e9phant")).toBeNull();
  });

  it("rejects empty / whitespace", () => {
    expect(validateMkdirName("")).toBe("invalid name");
    expect(validateMkdirName("   ")).toBe("invalid name");
    expect(validateMkdirName(" foo")).toBe("invalid name");
    expect(validateMkdirName("foo ")).toBe("invalid name");
  });

  it("rejects . and ..", () => {
    expect(validateMkdirName(".")).toBe("invalid name");
    expect(validateMkdirName("..")).toBe("invalid name");
  });

  it("rejects path separators", () => {
    expect(validateMkdirName("foo/bar")).toBe("invalid name");
    expect(validateMkdirName("foo\\bar")).toBe("invalid name");
  });

  it("rejects null byte", () => {
    expect(validateMkdirName("foo\0bar")).toBe("invalid name");
  });
});

describe("createDirectory", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "mkdir-"));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("creates a new directory and returns its absolute path", async () => {
    const result = await createDirectory(tmp, "new-thing");
    expect(result).toBe(path.join(tmp, "new-thing"));
    const stat = await fsp.stat(result);
    expect(stat.isDirectory()).toBe(true);
  });

  it("throws 'already exists' when target already exists", async () => {
    await fsp.mkdir(path.join(tmp, "dup"));
    await expect(createDirectory(tmp, "dup")).rejects.toThrow("already exists");
  });

  it("throws 'parent not found' when parent does not exist", async () => {
    await expect(createDirectory("/nonexistent/path/really", "x")).rejects.toThrow("parent not found");
  });

  it("throws 'parent is not a directory' when parent is a file", async () => {
    const filePath = path.join(tmp, "somefile");
    await fsp.writeFile(filePath, "hi");
    await expect(createDirectory(filePath, "x")).rejects.toThrow("parent is not a directory");
  });

  it("rejects invalid names without touching disk", async () => {
    await expect(createDirectory(tmp, "foo/bar")).rejects.toThrow("invalid name");
    await expect(createDirectory(tmp, "..")).rejects.toThrow("invalid name");
    await expect(createDirectory(tmp, ".")).rejects.toThrow("invalid name");
    await expect(createDirectory(tmp, "")).rejects.toThrow("invalid name");
    await expect(createDirectory(tmp, "foo\0bar")).rejects.toThrow("invalid name");
    const entries = await fsp.readdir(tmp);
    expect(entries).toEqual([]);
  });
});

// ── S1: rankTier word-boundary edge cases ────────────────────
// rankTier isn't exported; exercise it indirectly via listDirectories.
describe("listDirectories word-boundary ranking", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "browse-wb-"));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  async function makeDirs(names: string[]) {
    for (const n of names) await fsp.mkdir(path.join(tmp, n));
  }

  it("treats hyphen, underscore, dot, space as word boundaries", async () => {
    // All four should rank at tier 2 for query 'foo' (word boundary before 'foo');
    // 'embeddedfoo' ranks tier 3 (plain substring).
    await makeDirs([
      "pi-foo",    // hyphen boundary
      "pi_foo",    // underscore boundary
      "pi.foo",    // dot boundary
      "pi foo",    // space boundary
      "embeddedfoo", // no boundary
    ]);
    const r = await listDirectories(tmp, "foo");
    const names = r.entries.map((e) => e.name);
    // The first four are tier 2 (alphabetical within tier); 'embeddedfoo' is tier 3 last.
    expect(names[names.length - 1]).toBe("embeddedfoo");
    // All four boundary-matched names appear before embeddedfoo.
    const boundaryNames = ["pi foo", "pi-foo", "pi.foo", "pi_foo"];
    const boundaryPositions = boundaryNames.map((n) => names.indexOf(n));
    for (const p of boundaryPositions) expect(p).toBeGreaterThanOrEqual(0);
    for (const p of boundaryPositions) expect(p).toBeLessThan(names.indexOf("embeddedfoo"));
  });

  it("treats start-of-string as a word boundary (prefix trumps via tier 1)", async () => {
    await makeDirs(["foo-bar", "xx-foo"]);
    const r = await listDirectories(tmp, "foo");
    // 'foo-bar' is prefix (tier 1), 'xx-foo' is word-boundary (tier 2).
    const names = r.entries.map((e) => e.name);
    expect(names).toEqual(["foo-bar", "xx-foo"]);
  });
});
