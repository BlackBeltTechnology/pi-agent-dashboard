/**
 * Workspace confinement, input staging and all-or-nothing output commits (design D5).
 *
 * See change: add-blender-wasm-mcp (test-plan E47, E48 + confinement edge cases).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolError } from "../errors.js";
import {
  commitOutputs,
  confineExisting,
  confineOutput,
  MAX_INPUT_FILES,
  normaliseRelative,
  readInputs,
  resolveRoot,
} from "../mcp/workspace.js";
import { callTool, cleanupAll, makeHarness, makeRoot, tmpDir, toolCtx } from "./helpers/fake-host-kit.js";

afterEach(cleanupAll);

const LIMITS = { inputBytes: 1024 * 1024, outputBytes: 1024 * 1024 };
const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s));

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ToolError) return e.code;
    throw e;
  }
  return "no-error";
}

function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch (e) {
    if (["EPERM", "EACCES", "ENOSYS"].includes((e as NodeJS.ErrnoException).code ?? "")) return false;
    throw e;
  }
}

/** Every file and directory below `dir`, relative, sorted. */
const tree = (dir: string): string[] => fs.readdirSync(dir, { recursive: true }).map(String).sort();

describe("normaliseRelative", () => {
  it.each([
    ["a/b.glb", "a/b.glb"],
    ["./a//b.glb", "a/b.glb"],
    ["a\\b\\c.glb", "a/b/c.glb"],
    ["a/./b/../c.glb", "a/c.glb"],
    ["dir/", "dir"],
    [".", ""],
    ["a/..", ""],
  ])("%j → %j", (raw, expected) => {
    expect(normaliseRelative(raw)).toBe(expected);
  });

  it.each(["/etc/hosts", "\\windows\\x", "C:\\x", "c:/x", "C:x", "\\\\server\\share", "//server/share"])("absolute %j is path-outside-root", (raw) => {
    expect(codeOf(() => normaliseRelative(raw))).toBe("path-outside-root");
  });

  it.each(["..", "../x", "a/../../x", "..\\x", "a/b/../../../x"])("escaping %j is path-outside-root", (raw) => {
    expect(codeOf(() => normaliseRelative(raw))).toBe("path-outside-root");
  });

  it("a name that merely starts with two dots is not an escape", () => {
    expect(normaliseRelative("..hidden/x")).toBe("..hidden/x");
    expect(normaliseRelative("a/..b")).toBe("a/..b");
  });

  it("empty, NUL and non-string are invalid-arguments", () => {
    expect(codeOf(() => normaliseRelative(""))).toBe("invalid-arguments");
    expect(codeOf(() => normaliseRelative("a\0b"))).toBe("invalid-arguments");
    expect(codeOf(() => normaliseRelative(undefined as unknown as string))).toBe("invalid-arguments");
    expect(codeOf(() => normaliseRelative(5 as unknown as string))).toBe("invalid-arguments");
  });
});

describe("resolveRoot", () => {
  it("returns the realpath of an existing directory (relative paths resolve against cwd; default is cwd)", () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "sub"));
    expect(resolveRoot(dir, "sub")).toBe(path.join(dir, "sub"));
    expect(resolveRoot(dir, undefined)).toBe(dir);
    expect(resolveRoot("/", dir)).toBe(dir);
  });

  it("resolves a symlinked root to its real directory", (ctx) => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "real"));
    if (!trySymlink(path.join(dir, "real"), path.join(dir, "alias"))) return ctx.skip();
    expect(resolveRoot(dir, "alias")).toBe(path.join(dir, "real"));
  });

  it("a missing directory and a regular file are errors naming the path", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "f"), "x");
    expect(() => resolveRoot(dir, "does-not-exist")).toThrow(/does-not-exist.*no such directory/);
    expect(() => resolveRoot(dir, "f")).toThrow(/not a directory/);
  });
});

describe("confineExisting / confineOutput", () => {
  it("confineExisting returns the real path of an existing file and normalises the relative name", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "a"));
    fs.writeFileSync(path.join(root, "a", "b.obj"), "o");
    expect(confineExisting(root, "./a\\b.obj")).toEqual({ rel: "a/b.obj", real: path.join(root, "a", "b.obj") });
  });

  it("confineExisting: a missing file is input-not-found; escapes are path-outside-root", () => {
    const root = makeRoot();
    expect(codeOf(() => confineExisting(root, "missing.obj"))).toBe("input-not-found");
    expect(codeOf(() => confineExisting(root, "no/such/dir/x.obj"))).toBe("input-not-found");
    expect(codeOf(() => confineExisting(root, "../x"))).toBe("path-outside-root");
    expect(codeOf(() => confineExisting(root, "/etc/hosts"))).toBe("path-outside-root");
  });

  it("confineExisting: a file used as a directory is input-not-found (ENOTDIR)", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "f.txt"), "x");
    expect(codeOf(() => confineExisting(root, "f.txt/inner"))).toBe("input-not-found");
  });

  it("confineExisting: a symlink ancestor resolving outside the root is path-outside-root, even to an existing file", (ctx) => {
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    if (!trySymlink(outside, path.join(root, "link"))) return ctx.skip();
    expect(codeOf(() => confineExisting(root, "link/secret.txt"))).toBe("path-outside-root");
    expect(codeOf(() => confineExisting(root, "link/missing.txt"))).toBe("path-outside-root");
  });

  it("confineExisting: a file symlink pointing outside is refused", (ctx) => {
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "peek.txt"));
    } catch {
      return ctx.skip();
    }
    expect(codeOf(() => confineExisting(root, "peek.txt"))).toBe("path-outside-root");
  });

  it("confineOutput: a nested target that does not exist yet is confined through its nearest existing ancestor", () => {
    const root = makeRoot();
    expect(confineOutput(root, "new/deep/out.glb")).toEqual({ rel: "new/deep/out.glb", abs: path.join(root, "new", "deep", "out.glb") });
    expect(confineOutput(root, "out.glb").abs).toBe(path.join(root, "out.glb"));
  });

  it("confineOutput: escapes, absolute paths and symlinked ancestors are path-outside-root", (ctx) => {
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    expect(codeOf(() => confineOutput(root, "../x.glb"))).toBe("path-outside-root");
    expect(codeOf(() => confineOutput(root, "/tmp/x.glb"))).toBe("path-outside-root");
    if (!trySymlink(outside, path.join(root, "link"))) return ctx.skip();
    expect(codeOf(() => confineOutput(root, "link/x.glb"))).toBe("path-outside-root");
    expect(codeOf(() => confineOutput(root, "link/new/dir/x.glb"))).toBe("path-outside-root");
  });
});

describe("readInputs", () => {
  it("stages files under /in/<relative path>, deduplicating repeated and equivalent paths", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets", "chair.obj"), "OBJ");
    fs.writeFileSync(path.join(root, "assets", "chair.mtl"), "MTL");
    const { files } = readInputs(root, ["assets/chair.obj", "./assets/chair.obj", "assets\\chair.mtl"], LIMITS);
    expect(Object.keys(files).sort()).toEqual(["/in/assets/chair.mtl", "/in/assets/chair.obj"]);
    expect(Buffer.from(files["/in/assets/chair.obj"]).toString()).toBe("OBJ");
  });

  it("a directory as an input is invalid-arguments", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "dir"));
    expect(codeOf(() => readInputs(root, ["dir"], LIMITS))).toBe("invalid-arguments");
  });

  it("missing → input-not-found; absolute / `..` / NUL → path-outside-root / invalid-arguments; nothing is read on any failure", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "ok.txt"), "x");
    expect(codeOf(() => readInputs(root, ["ok.txt", "missing.txt"], LIMITS))).toBe("input-not-found");
    expect(codeOf(() => readInputs(root, ["ok.txt", "/etc/hosts"], LIMITS))).toBe("path-outside-root");
    expect(codeOf(() => readInputs(root, ["ok.txt", "../ok.txt"], LIMITS))).toBe("path-outside-root");
    expect(codeOf(() => readInputs(root, ["ok.txt", "C:\\x"], LIMITS))).toBe("path-outside-root");
    expect(codeOf(() => readInputs(root, ["ok.txt", "a\0b"], LIMITS))).toBe("invalid-arguments");
  });

  it("the file-count limit is 64 distinct paths", () => {
    const root = makeRoot();
    const names = Array.from({ length: MAX_INPUT_FILES + 1 }, (_, i) => `f${i}`);
    for (const n of names) fs.writeFileSync(path.join(root, n), "x");
    expect(Object.keys(readInputs(root, names.slice(0, 64), LIMITS).files)).toHaveLength(64);
    expect(codeOf(() => readInputs(root, names, LIMITS))).toBe("limit-exceeded");
  });

  it("the byte limit is on the total: exactly at the limit passes, one byte over fails", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a"), Buffer.alloc(60));
    fs.writeFileSync(path.join(root, "b"), Buffer.alloc(40));
    expect(codeOf(() => readInputs(root, ["a", "b"], { ...LIMITS, inputBytes: 100 }))).toBe("no-error");
    expect(codeOf(() => readInputs(root, ["a", "b"], { ...LIMITS, inputBytes: 99 }))).toBe("limit-exceeded");
  });
});

describe("commitOutputs", () => {
  it("writes files below baseDir (POSIX paths + sizes), creating directories, with no temp files left", () => {
    const root = makeRoot();
    const written = commitOutputs(root, "blender-out", [{ key: "a.glb", bytes: bytes("AAA") }, { key: "sub/b.bin", bytes: bytes("BB") }], 100);
    expect(written).toEqual([
      { path: "blender-out/a.glb", bytes: 3 },
      { path: "blender-out/sub/b.bin", bytes: 2 },
    ]);
    expect(tree(root)).toEqual(["blender-out", "blender-out/a.glb", "blender-out/sub", "blender-out/sub/b.bin"]);
    expect(fs.readFileSync(path.join(root, "blender-out", "a.glb"), "utf8")).toBe("AAA");
  });

  it("an empty baseDir writes below the root; no files is a no-op", () => {
    const root = makeRoot();
    expect(commitOutputs(root, "", [{ key: "x.glb", bytes: bytes("x") }], 10)).toEqual([{ path: "x.glb", bytes: 1 }]);
    expect(commitOutputs(root, "never-created", [], 10)).toEqual([]);
    expect(tree(root)).toEqual(["x.glb"]);
  });

  it("replaces an existing file atomically and leaves no backup", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "o"));
    fs.writeFileSync(path.join(root, "o", "a.glb"), "old");
    commitOutputs(root, "o", [{ key: "a.glb", bytes: bytes("new") }], 100);
    expect(fs.readFileSync(path.join(root, "o", "a.glb"), "utf8")).toBe("new");
    expect(tree(root)).toEqual(["o", "o/a.glb"]);
  });

  it.each(["../../x", "../x", "/abs/x", "..\\x", "a/../../x", "C:\\x"])("a host key %j is rejected (path-outside-root) and nothing is written", (key) => {
    const root = makeRoot();
    expect(codeOf(() => commitOutputs(root, "blender-out", [{ key: "good.glb", bytes: bytes("g") }, { key, bytes: bytes("evil") }], 100))).toBe("path-outside-root");
    expect(tree(root)).toEqual([]);
  });

  it("an empty host key is refused and nothing is written", () => {
    const root = makeRoot();
    expect(codeOf(() => commitOutputs(root, "o", [{ key: "", bytes: bytes("x") }], 100))).toBe("invalid-arguments");
    expect(tree(root)).toEqual([]);
  });

  it("a baseDir through a symlink to outside is rejected and nothing is written there", (ctx) => {
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    if (!trySymlink(outside, path.join(root, "link"))) return ctx.skip();
    expect(codeOf(() => commitOutputs(root, "link", [{ key: "x.glb", bytes: bytes("x") }], 100))).toBe("path-outside-root");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("a dangling symlink at the target is replaced by a regular file inside the root; its outside destination is never created", (ctx) => {
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    const victim = path.join(outside, "victim.txt");
    try {
      fs.symlinkSync(victim, path.join(root, "out.glb"));
    } catch {
      return ctx.skip();
    }
    commitOutputs(root, "", [{ key: "out.glb", bytes: bytes("data") }], 100);
    expect(fs.existsSync(victim)).toBe(false);
    expect(fs.lstatSync(path.join(root, "out.glb")).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(root, "out.glb"), "utf8")).toBe("data");
  });

  it("the byte total is checked before anything is written: exactly at the limit passes, one byte over is limit-exceeded", () => {
    const root = makeRoot();
    const files = [{ key: "a", bytes: bytes("123") }, { key: "b", bytes: bytes("45") }];
    expect(codeOf(() => commitOutputs(root, "o", files, 5))).toBe("no-error");
    const root2 = makeRoot();
    expect(codeOf(() => commitOutputs(root2, "o", files, 4))).toBe("limit-exceeded");
    expect(tree(root2)).toEqual([]);
  });

  it("an existing directory at a target path is export-failed and nothing changes", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "o", "a.glb"), { recursive: true });
    const before = tree(root);
    expect(codeOf(() => commitOutputs(root, "o", [{ key: "new.glb", bytes: bytes("n") }, { key: "a.glb", bytes: bytes("x") }], 100))).toBe("export-failed");
    expect(tree(root)).toEqual(before);
  });

  it("E48: a rename failure on the 2nd output leaves the existing file as it was, no temp or backup files, created dirs removed", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "blender-out"));
    fs.writeFileSync(path.join(root, "blender-out", "a.glb"), "old");
    const before = tree(root);
    const renames: string[] = [];
    const failOnSecond = (from: fs.PathLike, to: fs.PathLike): void => {
      renames.push(path.basename(String(to)));
      if (path.basename(String(to)) === "b.glb") throw new Error("EXDEV: injected rename failure");
      fs.renameSync(from, to);
    };
    const files = [{ key: "a.glb", bytes: bytes("new-a") }, { key: "deep/dir/b.glb", bytes: bytes("new-b") }, { key: "b.glb", bytes: bytes("new-b2") }];
    // Order matters: a.glb is replaced first (existing file → backup → rename), then deep/dir/b.glb lands, then b.glb fails.
    expect(codeOf(() => commitOutputs(root, "blender-out", files, 1000, { rename: failOnSecond as typeof fs.renameSync }))).toBe("export-failed");
    expect(renames.some((n) => n === "b.glb")).toBe(true);
    expect(fs.readFileSync(path.join(root, "blender-out", "a.glb"), "utf8")).toBe("old");
    expect(tree(root)).toEqual(before); // `deep/` (created for the 2nd output) is gone too; no `.bw-*.tmp` files
  });

  it("E48: a rename failure on the second of two outputs, where both are new, creates nothing", () => {
    const root = makeRoot();
    let calls = 0;
    const failSecond = (from: fs.PathLike, to: fs.PathLike): void => {
      if (++calls === 2) throw new Error("injected");
      fs.renameSync(from, to);
    };
    const files = [{ key: "a.glb", bytes: bytes("a") }, { key: "b.glb", bytes: bytes("b") }];
    expect(codeOf(() => commitOutputs(root, "fresh/out", files, 100, { rename: failSecond as typeof fs.renameSync }))).toBe("export-failed");
    expect(calls).toBe(2);
    expect(tree(root)).toEqual([]); // `fresh/out` and `fresh` were created by the commit and are removed again
  });

  it("E48: a failure while backing up the existing 2nd output restores the first and leaves no files", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "o"));
    fs.writeFileSync(path.join(root, "o", "a.glb"), "old-a");
    fs.writeFileSync(path.join(root, "o", "b.glb"), "old-b");
    const before = tree(root);
    let calls = 0;
    // renames: 1 backup(a), 2 place(a), 3 backup(b) ← fails
    const failThird = (from: fs.PathLike, to: fs.PathLike): void => {
      if (++calls === 3) throw new Error("injected");
      fs.renameSync(from, to);
    };
    expect(codeOf(() => commitOutputs(root, "o", [{ key: "a.glb", bytes: bytes("new-a") }, { key: "b.glb", bytes: bytes("new-b") }], 100, { rename: failThird as typeof fs.renameSync }))).toBe("export-failed");
    expect(fs.readFileSync(path.join(root, "o", "a.glb"), "utf8")).toBe("old-a");
    expect(fs.readFileSync(path.join(root, "o", "b.glb"), "utf8")).toBe("old-b");
    expect(tree(root)).toEqual(before);
  });
});

describe("all-or-nothing through the tools", () => {
  it("E47: a host result with good.glb plus the key ../../x is path-outside-root and blender-out/good.glb is absent", async () => {
    const h = makeHarness({ steps: [{ files: { "good.glb": "GLB", "../../x": "evil" } }] });
    const parent = makeRoot();
    const root = path.join(parent, "a", "b");
    fs.mkdirSync(root, { recursive: true });
    const r = await callTool("blender_python", { code: "pass" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("path-outside-root");
    expect(fs.existsSync(path.join(root, "blender-out", "good.glb"))).toBe(false);
    expect(fs.existsSync(path.join(parent, "x"))).toBe(false); // root/../../x
    expect(fs.readdirSync(root)).toEqual([]);
    expect(h.ops()).toHaveLength(1); // the host did run: the refusal is the server's
  });

  it("E47: outputs over the output limit are limit-exceeded and nothing is written", async () => {
    const h = makeHarness({ steps: [{ files: { "a.bin": "12345", "b.bin": "67890" } }] });
    const root = makeRoot();
    const r = await callTool("blender_python", { code: "pass" }, toolCtx(root, h.supervisor(), { inputBytes: 1000, outputBytes: 9 }));
    expect(r.data.code).toBe("limit-exceeded");
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("a successful python call lands /out files below outputDir and lists them", async () => {
    const h = makeHarness({ steps: [{ files: { "a.txt": "AA", "sub/b.txt": "B" } }] });
    const root = makeRoot();
    const r = await callTool("blender_python", { code: "pass", outputDir: "renders/v1" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(false);
    expect((r.data.outputs as { path: string; bytes: number }[]).sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "renders/v1/a.txt", bytes: 2 },
      { path: "renders/v1/sub/b.txt", bytes: 1 },
    ]);
    expect(fs.readFileSync(path.join(root, "renders", "v1", "sub", "b.txt"), "utf8")).toBe("B");
  });

  it("blender_export to a root-level path writes next to the root and lists it", async () => {
    const h = makeHarness({ steps: [{ files: { "scene.glb": "GLB" } }] });
    const root = makeRoot();
    const r = await callTool("blender_export", { path: "scene.glb" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(false);
    expect(r.data.files).toEqual([{ path: "scene.glb", bytes: 3 }]);
    expect(fs.readFileSync(path.join(root, "scene.glb"), "utf8")).toBe("GLB");
  });

  it("blender_export to a nested new directory creates it and lists the sidecars", async () => {
    const h = makeHarness({ steps: [{ files: { "scene.obj": "O", "scene.mtl": "M" } }] });
    const root = makeRoot();
    const r = await callTool("blender_export", { path: "out/models/scene.obj" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(false);
    expect(tree(root)).toEqual(["out", "out/models", "out/models/scene.mtl", "out/models/scene.obj"]);
    expect(h.ops()[0].args).toEqual({ ext: ".obj", name: "scene.obj", selectedOnly: false });
  });

  it("a python-error result writes no outputs", async () => {
    const h = makeHarness({ steps: [{ error: { code: "python-error", message: "Traceback ..." } }] });
    const root = makeRoot();
    const r = await callTool("blender_python", { code: "raise" }, toolCtx(root, h.supervisor()));
    expect(r.data.code).toBe("python-error");
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
