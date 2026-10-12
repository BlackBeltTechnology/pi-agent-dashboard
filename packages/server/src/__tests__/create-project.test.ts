/**
 * `createProjectDirectory` — create-or-reuse `<home>/Projects/<name>` with
 * portable-name validation and realpath containment.
 * See change: streamline-first-run (test-plan E1–E7, E9–E15, X3, X4).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateProjectError, createProjectDirectory } from "../browse.js";

let tmp: string;
let home: string;

beforeEach(async () => {
  tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "create-project-")));
  home = path.join(tmp, "home");
  await fsp.mkdir(home);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.chmod(path.join(home, "Projects"), 0o755).catch(() => undefined);
  await fsp.rm(tmp, { recursive: true, force: true });
});

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof CreateProjectError) return err.reason;
    throw err;
  }
  throw new Error("expected CreateProjectError, got success");
}

const exists = (p: string) => fs.existsSync(p) || fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;

describe("createProjectDirectory — happy paths", () => {
  it("E1: fresh home creates root and child", async () => {
    const res = await createProjectDirectory("my-first-project", home);
    const child = path.join(home, "Projects", "my-first-project");
    expect(fs.statSync(child).isDirectory()).toBe(true);
    expect(res).toEqual({ path: await fsp.realpath(child), existed: false });
  });

  it("E2: root present, child created", async () => {
    await fsp.mkdir(path.join(home, "Projects"));
    const res = await createProjectDirectory("demo", home);
    expect(res.existed).toBe(false);
    expect(fs.statSync(path.join(home, "Projects", "demo")).isDirectory()).toBe(true);
  });

  it("E3: reuse keeps contents", async () => {
    const dir = path.join(home, "Projects", "demo");
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, "a.txt");
    await fsp.writeFile(file, "hello");
    const before = fs.statSync(file).mtimeMs;
    const res = await createProjectDirectory("demo", home);
    expect(res.existed).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("hello");
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});

describe("createProjectDirectory — occupied names", () => {
  it("E4: file at target", async () => {
    await fsp.mkdir(path.join(home, "Projects"));
    const target = path.join(home, "Projects", "demo");
    await fsp.writeFile(target, "bytes");
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("not_a_directory");
    expect(fs.readFileSync(target, "utf8")).toBe("bytes");
  });

  it("E5: file at root", async () => {
    const root = path.join(home, "Projects");
    await fsp.writeFile(root, "bytes");
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("root_not_a_directory");
    expect(fs.readFileSync(root, "utf8")).toBe("bytes");
    expect(fs.readdirSync(home)).toEqual(["Projects"]);
  });
});

describe("createProjectDirectory — name validation", () => {
  // 25 names from test-plan E6. Each must leave `home` untouched.
  const INVALID: Array<[string, string]> = [
    ["", "invalid_name"],
    [" demo", "invalid_name"],
    ["demo ", "invalid_name"],
    ["   ", "invalid_name"],
    [".", "invalid_name"],
    ["..", "invalid_name"],
    ["../outside", "invalid_name"],
    ["a/b", "invalid_name"],
    ["a\\b", "invalid_name"],
    ["a\0b", "invalid_name"],
    ["a\nb", "invalid_name"],
    ["a\u0085b", "invalid_name"],
    ["a:b", "invalid_name"],
    ["a*b", "invalid_name"],
    ["a?b", "invalid_name"],
    ['a"b', "invalid_name"],
    ["a<b", "invalid_name"],
    ["a>b", "invalid_name"],
    ["a|b", "invalid_name"],
    ["name.", "invalid_name"],
    ["con", "reserved_name"],
    ["AUX.txt", "reserved_name"],
    ["Com1", "reserved_name"],
    ["lpt\u00B9", "reserved_name"],
    ["CONIN$", "reserved_name"],
  ];

  it.each(INVALID)("E6: %j → %s", async (name, reason) => {
    const before = fs.readdirSync(home);
    expect(await reasonOf(createProjectDirectory(name, home))).toBe(reason);
    expect(fs.readdirSync(home)).toEqual(before);
  });

  it("E7: 255-byte boundary", async () => {
    const ok254 = "a".repeat(254);
    const ok255 = "b".repeat(255);
    const okUni = "é".repeat(127); // 254 bytes
    const tooLong256 = "c".repeat(256);
    const tooLongUni = "é".repeat(128); // 256 bytes
    expect((await createProjectDirectory(ok254, home)).existed).toBe(false);
    expect((await createProjectDirectory(ok255, home)).existed).toBe(false);
    expect((await createProjectDirectory(okUni, home)).existed).toBe(false);
    const root = path.join(home, "Projects");
    const before = fs.readdirSync(root).sort();
    expect(await reasonOf(createProjectDirectory(tooLong256, home))).toBe("too_long");
    expect(await reasonOf(createProjectDirectory(tooLongUni, home))).toBe("too_long");
    expect(fs.readdirSync(root).sort()).toEqual(before);
  });
});

describe("createProjectDirectory — symlinks", () => {
  beforeEach(async () => {
    await fsp.mkdir(path.join(home, "Projects"));
  });

  it("E9: child link escaping the root", async () => {
    const outside = path.join(tmp, "outside");
    await fsp.mkdir(outside);
    const link = path.join(home, "Projects", "demo");
    await fsp.symlink(outside, link);
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("outside_root");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("E10: child link equal to the root", async () => {
    const root = path.join(home, "Projects");
    await fsp.symlink(root, path.join(root, "demo"));
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("outside_root");
  });

  it("E11: child link inside the root is reused", async () => {
    const root = path.join(home, "Projects");
    await fsp.mkdir(path.join(root, "real-demo"));
    await fsp.symlink(path.join(root, "real-demo"), path.join(root, "demo"));
    const res = await createProjectDirectory("demo", home);
    expect(res).toEqual({ path: await fsp.realpath(path.join(root, "real-demo")), existed: true });
  });

  it("E12: symlinked root", async () => {
    await fsp.rmdir(path.join(home, "Projects"));
    const data = path.join(tmp, "data");
    await fsp.mkdir(data);
    await fsp.symlink(data, path.join(home, "Projects"));
    const res = await createProjectDirectory("demo", home);
    expect(fs.statSync(path.join(data, "demo")).isDirectory()).toBe(true);
    expect(res.path).toBe(await fsp.realpath(path.join(data, "demo")));
  });

  it("E13: dangling child link", async () => {
    const missing = path.join(tmp, "missing");
    await fsp.symlink(missing, path.join(home, "Projects", "demo"));
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("not_a_directory");
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("E14: dangling root link", async () => {
    await fsp.rmdir(path.join(home, "Projects"));
    const missing = path.join(tmp, "missing");
    await fsp.symlink(missing, path.join(home, "Projects"));
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("root_not_a_directory");
    expect(fs.existsSync(missing)).toBe(false);
  });
});

describe("createProjectDirectory — environment failures", () => {
  it("E15: home missing", async () => {
    const gone = path.join(tmp, "nope");
    expect(await reasonOf(createProjectDirectory("demo", gone))).toBe("home_missing");
    expect(fs.existsSync(gone)).toBe(false);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "X3: unexpected fs error → fs_error, nothing created",
    async () => {
      const root = path.join(home, "Projects");
      await fsp.mkdir(root, { mode: 0o500 });
      expect(await reasonOf(createProjectDirectory("demo", home))).toBe("fs_error");
      expect(fs.existsSync(path.join(root, "demo"))).toBe(false);
    },
  );

  it("X4: escape detected after creation removes the created dir, never a pre-existing link", async () => {
    const root = path.join(home, "Projects");
    await fsp.mkdir(root);
    const realRealpath = fsp.realpath.bind(fsp);
    const spy = vi.spyOn(fsp, "realpath").mockImplementation((async (p: string, ...rest: unknown[]) => {
      if (String(p) === path.join(root, "demo")) return "/elsewhere/demo";
      return (realRealpath as (p: string, ...r: unknown[]) => Promise<string>)(p, ...rest);
    }) as typeof fsp.realpath);
    expect(await reasonOf(createProjectDirectory("demo", home))).toBe("outside_root");
    spy.mockRestore();
    expect(exists(path.join(root, "demo"))).toBe(false);

    // Pre-existing link at that name: never removed.
    const outside = path.join(tmp, "outside");
    await fsp.mkdir(outside);
    await fsp.symlink(outside, path.join(root, "linked"));
    expect(await reasonOf(createProjectDirectory("linked", home))).toBe("outside_root");
    expect(fs.lstatSync(path.join(root, "linked")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  });
});
