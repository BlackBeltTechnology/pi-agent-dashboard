/**
 * Sandbox hardening at the MCP tool layer: path confinement (absolute, `..`, symlink), size limits, and the
 * environment limit knobs (which may only lower). Every rejected call must leave the fake host untouched.
 *
 * See change: add-blender-wasm-mcp (test-plan E45, E46, E49, E52).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_CODE_BYTES, MAX_INPUT_BYTES, MAX_INPUT_FILES, MAX_OUTPUT_BYTES, resolveLimits } from "../mcp/workspace.js";
import { callTool, cleanupAll, makeHarness, makeRoot, tmpDir, toolCtx } from "./helpers/fake-host-kit.js";

afterEach(cleanupAll);

const MIB = 1024 * 1024;

/** Create `link -> target` or report that symlinks are unavailable (Windows without privileges). */
function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") return false;
    throw e;
  }
}

describe("path confinement", () => {
  it("E45: an absolute path (/etc/hosts) to blender_import is path-outside-root and the host is never touched", async () => {
    const h = makeHarness();
    const root = makeRoot();
    const r = await callTool("blender_import", { path: "/etc/hosts" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("path-outside-root");
    expect(h.logEntries()).toEqual([]);
    expect(h.spies.probe).not.toHaveBeenCalled();
  });

  it.each([
    ["blender_import", { path: "../secret.glb" }],
    ["blender_import", { path: "a/../../secret.glb" }],
    ["blender_import", { path: "/etc/passwd.glb" }],
    ["blender_import", { path: "C:\\Windows\\x.glb" }],
    ["blender_import", { path: "\\\\server\\share\\x.glb" }],
    ["blender_export", { path: "../escape.glb" }],
    ["blender_export", { path: "/tmp/escape.glb" }],
    ["blender_export", { path: "..\\escape.glb" }],
    ["blender_python", { code: "pass", inputs: ["../secret.txt"] }],
    ["blender_python", { code: "pass", inputs: ["/etc/hosts"] }],
    ["blender_python", { code: "pass", outputDir: "../out" }],
    ["blender_python", { code: "pass", outputDir: "/tmp/out" }],
  ])("%s %j is path-outside-root and never reaches the host", async (tool, args) => {
    const h = makeHarness();
    const r = await callTool(tool, args, toolCtx(makeRoot(), h.supervisor()));
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("path-outside-root");
    expect(h.logEntries()).toEqual([]);
  });

  it("a NUL byte in a path is invalid-arguments, not a filesystem call", async () => {
    const h = makeHarness();
    const r = await callTool("blender_import", { path: "a\0b.glb" }, toolCtx(makeRoot(), h.supervisor()));
    expect(r).toMatchObject({ isError: true, data: { code: "invalid-arguments" } });
    expect(h.logEntries()).toEqual([]);
  });

  it("E46: blender_export through a root symlink that points outside is path-outside-root and writes nothing there", async (ctx) => {
    const h = makeHarness({ steps: [{ files: { "out.glb": "GLB" } }] });
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    if (!trySymlink(outside, path.join(root, "link"))) return ctx.skip();
    const r = await callTool("blender_export", { path: "link/out.glb" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("path-outside-root");
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(h.ops()).toHaveLength(0);
  });

  it("E46: symlinked inputs and outputDir are refused the same way", async (ctx) => {
    const h = makeHarness();
    const root = makeRoot();
    const outside = tmpDir("blender-outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    if (!trySymlink(outside, path.join(root, "link"))) return ctx.skip();
    const sup = h.supervisor();
    const read = await callTool("blender_python", { code: "pass", inputs: ["link/secret.txt"] }, toolCtx(root, sup));
    expect(read.data.code).toBe("path-outside-root");
    const write = await callTool("blender_python", { code: "pass", outputDir: "link/sub" }, toolCtx(root, sup));
    expect(write.data.code).toBe("path-outside-root");
    const imp = await callTool("blender_import", { path: "link/secret.txt.glb" }, toolCtx(root, sup));
    expect(imp.data.code).toBe("path-outside-root");
    expect(fs.readdirSync(outside)).toEqual(["secret.txt"]);
    expect(h.logEntries()).toEqual([]);
  });

  it("E46: a symlink that stays inside the root is allowed", async (ctx) => {
    const h = makeHarness({ steps: [{ files: { "out.glb": "GLB" } }] });
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "real"));
    if (!trySymlink(path.join(root, "real"), path.join(root, "alias"))) return ctx.skip();
    const r = await callTool("blender_export", { path: "alias/out.glb" }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(false);
    expect(fs.readFileSync(path.join(root, "real", "out.glb"), "utf8")).toBe("GLB");
  });
});

describe("size limits", () => {
  it("E49: 64 distinct inputs are accepted; 65 are limit-exceeded and the host is not called", async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "in"));
    const names = Array.from({ length: MAX_INPUT_FILES + 1 }, (_, i) => `in/f${i}.txt`);
    for (const n of names) fs.writeFileSync(path.join(root, n), "x");
    expect(MAX_INPUT_FILES).toBe(64);

    const ok = makeHarness();
    const accepted = await callTool("blender_python", { code: "pass", inputs: names.slice(0, 64) }, toolCtx(root, ok.supervisor()));
    expect(accepted.isError).toBe(false);
    expect(Object.keys(ok.ops()[0].files ?? {})).toHaveLength(64);

    const over = makeHarness();
    const rejected = await callTool("blender_python", { code: "pass", inputs: names }, toolCtx(root, over.supervisor()));
    expect(rejected.isError).toBe(true);
    expect(rejected.data.code).toBe("limit-exceeded");
    expect(over.logEntries()).toEqual([]);
  });

  it("E49: duplicate input entries count once (64 distinct + repeats is accepted)", async () => {
    const root = makeRoot();
    const names = Array.from({ length: 64 }, (_, i) => `f${i}.txt`);
    for (const n of names) fs.writeFileSync(path.join(root, n), "x");
    const h = makeHarness();
    const r = await callTool("blender_python", { code: "pass", inputs: [...names, "f0.txt", "f1.txt"] }, toolCtx(root, h.supervisor()));
    expect(r.isError).toBe(false);
    expect(Object.keys(h.ops()[0].files ?? {})).toHaveLength(64);
  });

  it("E49: code of exactly 1 MiB is accepted; 1 MiB + 1 B is limit-exceeded and the host is not called", async () => {
    expect(MAX_CODE_BYTES).toBe(MIB);
    const ok = makeHarness();
    const accepted = await callTool("blender_python", { code: "a".repeat(MIB) }, toolCtx(makeRoot(), ok.supervisor()));
    expect(accepted.isError).toBe(false);
    expect((ok.ops()[0].args as { code: string }).code).toHaveLength(MIB);

    const over = makeHarness();
    const rejected = await callTool("blender_python", { code: "a".repeat(MIB + 1) }, toolCtx(makeRoot(), over.supervisor()));
    expect(rejected.isError).toBe(true);
    expect(rejected.data.code).toBe("limit-exceeded");
    expect(over.logEntries()).toEqual([]);
  });

  it("E49: the code limit counts UTF-8 bytes, not characters", async () => {
    const twoByte = "é".repeat(MIB / 2); // exactly 1 MiB
    const ok = makeHarness();
    expect((await callTool("blender_python", { code: twoByte }, toolCtx(makeRoot(), ok.supervisor()))).isError).toBe(false);
    const over = makeHarness();
    const r = await callTool("blender_python", { code: `${twoByte}a` }, toolCtx(makeRoot(), over.supervisor()));
    expect(r.data.code).toBe("limit-exceeded");
    expect(over.logEntries()).toEqual([]);
  });

  it("the total input byte limit is enforced when staging and the host is not called", async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "a.bin"), Buffer.alloc(600));
    fs.writeFileSync(path.join(root, "b.bin"), Buffer.alloc(600));
    const h = makeHarness();
    const ctx = toolCtx(root, h.supervisor(), { inputBytes: 1000, outputBytes: MIB });
    const over = await callTool("blender_python", { code: "pass", inputs: ["a.bin", "b.bin"] }, ctx);
    expect(over.data.code).toBe("limit-exceeded");
    expect(h.logEntries()).toEqual([]);
    const exact = await callTool("blender_python", { code: "pass", inputs: ["a.bin"] }, ctx);
    expect(exact.isError).toBe(false);
  });

  it("E52: BLENDER_WASM_MAX_OUTPUT_MB=4096 cannot raise the output limit above 512 MiB (nor MAX_INPUT_MB above 256 MiB)", () => {
    expect(MAX_OUTPUT_BYTES).toBe(512 * MIB);
    expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: "4096" }).outputBytes).toBe(512 * MIB);
    expect(resolveLimits({ BLENDER_WASM_MAX_INPUT_MB: "4096" }).inputBytes).toBe(256 * MIB);
    expect(MAX_INPUT_BYTES).toBe(256 * MIB);
    expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: "513" }).outputBytes).toBe(512 * MIB);
    expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: "512" }).outputBytes).toBe(512 * MIB);
  });

  it("E52: lower values are honoured; garbage, zero, negative and non-finite values fall back to the caps", () => {
    expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: "4", BLENDER_WASM_MAX_INPUT_MB: "8" })).toEqual({ inputBytes: 8 * MIB, outputBytes: 4 * MIB });
    expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: "0.5" }).outputBytes).toBe(MIB / 2);
    for (const bad of ["", "abc", "0", "-5", "Infinity", "NaN"]) {
      expect(resolveLimits({ BLENDER_WASM_MAX_OUTPUT_MB: bad, BLENDER_WASM_MAX_INPUT_MB: bad })).toEqual({ inputBytes: MAX_INPUT_BYTES, outputBytes: MAX_OUTPUT_BYTES });
    }
    expect(resolveLimits({})).toEqual({ inputBytes: MAX_INPUT_BYTES, outputBytes: MAX_OUTPUT_BYTES });
  });
});
