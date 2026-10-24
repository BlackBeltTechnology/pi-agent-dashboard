/**
 * Python job wrappers and response validation (design D4): pure functions, no runtime.
 *
 * See change: add-blender-wasm-mcp (test-plan E24 + task 3.2 units).
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildJobScript,
  EXPORT_EXTENSIONS,
  IMPORT_EXTENSIONS,
  interpretResponse,
  stripProtocolNoise,
  tailBytes,
} from "../host/jobs.js";
import { type OpName, OUTPUT_TAIL_BYTES } from "../host/protocol.js";

const enc = (v: unknown): Uint8Array => new Uint8Array(Buffer.from(typeof v === "string" ? v : JSON.stringify(v)));
const NONCE = "n0nce-123";

/** The args blob embedded in a job script, decoded again. */
function embeddedArgs(script: string): unknown {
  const m = /base64\.b64decode\("([A-Za-z0-9+/=]*)"\)/.exec(script);
  if (!m) throw new Error("no embedded args");
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
}

const python3 = spawnSync("python3", ["--version"]).status === 0;

describe("buildJobScript", () => {
  it.each([
    [".glb", "bpy.ops.import_scene.gltf(filepath=A[\"path\"])"],
    [".gltf", "bpy.ops.import_scene.gltf(filepath=A[\"path\"])"],
    [".fbx", "bpy.ops.import_scene.fbx(filepath=A[\"path\"])"],
    [".obj", "bpy.ops.wm.obj_import(filepath=A[\"path\"])"],
    [".stl", "bpy.ops.wm.stl_import(filepath=A[\"path\"])"],
    [".ply", "bpy.ops.wm.ply_import(filepath=A[\"path\"])"],
    [".svg", "bpy.ops.import_curve.svg(filepath=A[\"path\"])"],
  ])("import %s calls %s", (ext, call) => {
    const script = buildJobScript("import", { ext, path: `/in/x${ext}` }, NONCE, 1000);
    expect(script).toContain(call);
    expect(embeddedArgs(script)).toEqual({ ext, path: `/in/x${ext}` });
  });

  it("import .blend runs no importer operator (the protocol loads the file)", () => {
    const script = buildJobScript("import", { ext: ".blend", path: "/in/x.blend" }, NONCE, 1000);
    expect(script).not.toMatch(/bpy\.ops\.(import_|wm\.\w+_import)/);
    expect(script).toContain("bpy.context.scene.objects");
  });

  it.each([
    [".glb", "export_scene.gltf", "export_format='GLB'"],
    [".gltf", "export_scene.gltf", "export_format='GLTF_SEPARATE'"],
    [".fbx", "export_scene.fbx", "use_selection=sel"],
    [".obj", "wm.obj_export", "export_selected_objects=sel"],
    [".stl", "wm.stl_export", "export_selected_objects=sel"],
    [".ply", "wm.ply_export", "export_selected_objects=sel"],
    [".blend", "wm.save_as_mainfile", "copy=True"],
  ])("export %s uses %s (%s) and writes below /x", (ext, operator, fragment) => {
    const script = buildJobScript("export", { ext, name: `scene${ext}`, selectedOnly: false }, NONCE, 1000);
    expect(script).toContain(`bpy.ops.${operator}(filepath=target`);
    expect(script).toContain(fragment);
    expect(script).toContain('target = "/x/" + A["name"]');
    expect(embeddedArgs(script)).toEqual({ ext, name: `scene${ext}`, selectedOnly: false });
  });

  it("an unknown extension throws for import and export", () => {
    expect(() => buildJobScript("import", { ext: ".usdc", path: "/in/a.usdc" }, NONCE, 1)).toThrow(/no importer for \.usdc/);
    expect(() => buildJobScript("export", { ext: ".usdc", name: "a.usdc", selectedOnly: false }, NONCE, 1)).toThrow(/no exporter for \.usdc/);
    expect(() => buildJobScript("export", { ext: ".svg", name: "a.svg", selectedOnly: false }, NONCE, 1)).toThrow(/no exporter/);
  });

  it("the extension lists match the wrapper's tables", () => {
    expect([...IMPORT_EXTENSIONS].sort()).toEqual([".blend", ".fbx", ".glb", ".gltf", ".obj", ".ply", ".stl", ".svg"]);
    expect([...EXPORT_EXTENSIONS].sort()).toEqual([".blend", ".fbx", ".glb", ".gltf", ".obj", ".ply", ".stl"]);
    for (const ext of IMPORT_EXTENSIONS) expect(() => buildJobScript("import", { ext, path: "/in/a" }, NONCE, 1)).not.toThrow();
    for (const ext of EXPORT_EXTENSIONS) expect(() => buildJobScript("export", { ext, name: "a", selectedOnly: true }, NONCE, 1)).not.toThrow();
  });

  it("python execs the agent code compiled as <blender_python>, and moves /out/** into /out/u", () => {
    const script = buildJobScript("python", { code: "print(1)" }, NONCE, 1000);
    expect(script).toContain('exec(compile(code, "<blender_python>", "exec")');
    expect(script).toContain('os.rename(stage, OUT + "/u")');
  });

  it("scene lists objects up to the limit; reset returns an empty result", () => {
    const scene = buildJobScript("scene", { limit: 7 }, NONCE, 1000);
    expect(scene).toContain("_bw_robj(o) for o in objs[:limit]");
    expect(embeddedArgs(scene)).toEqual({ limit: 7 });
    expect(buildJobScript("reset", { mode: "empty" }, NONCE, 1000)).toContain("return {}");
  });

  it("export promotes /x into /out/u refusing name collisions", () => {
    const script = buildJobScript("export", { ext: ".glb", name: "a.glb", selectedOnly: false }, NONCE, 1000);
    expect(script).toContain('"export name collision: "');
    expect(script).toContain('shutil.move("/x/" + n, OUT + "/u/" + n)');
  });

  it("embeds the nonce as the status file name, JSON-quoted even for hostile values, and floors the limit", () => {
    const script = buildJobScript("reset", { mode: "factory" }, NONCE, 1234.9);
    expect(script).toContain(`NONCE = "${NONCE}"`);
    expect(script).toContain('OUT + "/.status-" + NONCE + ".json"');
    expect(script).toContain("LIMIT = 1234\n");
    const hostile = buildJobScript("reset", { mode: "factory" }, 'x"\nimport os #', 5);
    expect(hostile).toContain('NONCE = "x\\"\\nimport os #"');
    expect(hostile).not.toMatch(/^import os #/m);
  });

  it("the args blob round-trips arbitrary code: unicode, quotes, backslashes, triple quotes, newlines, NUL", () => {
    const code = 'print("héllo 日本語 🎲")\ns = \'\'\'x\'\'\' + """y"""\npath = "C:\\\\dir\\n"\n# \u0000 end\r\n';
    const script = buildJobScript("python", { code }, NONCE, 10);
    expect(embeddedArgs(script)).toEqual({ code });
    // The agent source never appears verbatim in the Python text: it travels only inside the base64 literal.
    expect(script).not.toContain("héllo");
  });

  it.runIf(python3)("every generated script is syntactically valid Python", () => {
    const cases: [OpName, unknown][] = [
      ["python", { code: 'print("x")' }],
      ["scene", { limit: 3 }],
      ["reset", { mode: "factory" }],
      ...IMPORT_EXTENSIONS.map((ext): [OpName, unknown] => ["import", { ext, path: `/in/a${ext}` }]),
      ...EXPORT_EXTENSIONS.map((ext): [OpName, unknown] => ["export", { ext, name: `a${ext}`, selectedOnly: true }]),
    ];
    for (const [op, args] of cases) {
      const script = buildJobScript(op, args as never, NONCE, 100);
      const r = spawnSync("python3", ["-c", "import sys; compile(sys.stdin.read(), 'job', 'exec')"], { input: script, encoding: "utf8" });
      expect({ op, status: r.status, stderr: r.stderr }).toEqual({ op, status: 0, stderr: "" });
    }
  });
});

describe("interpretResponse", () => {
  const status = (s: unknown): Record<string, Uint8Array> => ({ [`/out/.status-${NONCE}.json`]: enc(s) });
  const base = (extra: Record<string, Uint8Array> = {}, report: unknown = {}): { output: string; files: Record<string, Uint8Array> } => ({
    output: "",
    files: { "/out/report.json": enc(report), ...extra },
  });

  it("ok: returns the status result and only /out/u/** files, with the prefix stripped", () => {
    const r = interpretResponse(
      "python",
      NONCE,
      1000,
      base({
        ...status({ status: "ok", result: { objects: ["Cube"] } }),
        "/out/u/a.glb": enc("GLB"),
        "/out/u/sub/dir/b.bin": enc("BIN"),
        "/out/other.txt": enc("ignored"),
        "/out/u": enc("a file named u"),
        "/in/x": enc("ignored"),
        "/x/y": enc("ignored"),
      }),
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.result).toEqual({ objects: ["Cube"] });
    expect(Object.keys(r.files).sort()).toEqual(["a.glb", "sub/dir/b.bin"]);
    expect(Buffer.from(r.files["a.glb"]).toString()).toBe("GLB");
  });

  it("ok with a non-object result yields an empty result", () => {
    for (const result of [null, 5, "s", undefined]) {
      const r = interpretResponse("reset", NONCE, 10, base(status({ status: "ok", result })));
      expect(r).toEqual({ kind: "ok", result: {}, files: {} });
    }
  });

  it("a missing report.json is corrupt", () => {
    expect(interpretResponse("python", NONCE, 10, { output: "", files: status({ status: "ok" }) })).toMatchObject({ kind: "corrupt", message: expect.stringContaining("report.json") });
  });

  it.each([["not json"], ["[]"], ["null"], ["5"], [""]])("an unparseable or non-object report.json (%j) is corrupt", (raw) => {
    const r = interpretResponse("python", NONCE, 10, { output: "", files: { "/out/report.json": enc(raw), ...status({ status: "ok" }) } });
    expect(r.kind).toBe("corrupt");
  });

  it.each<[OpName, string]>([
    ["python", "python-error"],
    ["scene", "python-error"],
    ["reset", "python-error"],
    ["import", "import-failed"],
    ["export", "export-failed"],
  ])("a report error on %s maps to %s (even without a status file)", (op, code) => {
    expect(interpretResponse(op, NONCE, 10, base({}, { error: "Traceback: boom" }))).toEqual({ kind: "error", code, message: "Traceback: boom" });
  });

  it("an empty or non-string report error is not an error", () => {
    expect(interpretResponse("python", NONCE, 10, base(status({ status: "ok", result: {} }), { error: "" })).kind).toBe("ok");
    expect(interpretResponse("python", NONCE, 10, base(status({ status: "ok", result: {} }), { error: 5 })).kind).toBe("ok");
  });

  it("a missing status file, or one written under another nonce, is corrupt (agent output cannot forge success)", () => {
    expect(interpretResponse("python", NONCE, 10, base()).kind).toBe("corrupt");
    const forged = { "/out/.status-other.json": enc({ status: "ok", result: {} }) };
    expect(interpretResponse("python", NONCE, 10, base(forged)).kind).toBe("corrupt");
    expect(interpretResponse("python", NONCE, 10, base({ [`/out/.status-${NONCE}.json`]: enc("garbage") })).kind).toBe("corrupt");
  });

  it("status `limit` is limit-exceeded; an unknown status is corrupt", () => {
    expect(interpretResponse("python", NONCE, 77, base(status({ status: "limit" })))).toMatchObject({ kind: "error", code: "limit-exceeded", message: expect.stringContaining("77") });
    expect(interpretResponse("python", NONCE, 77, base(status({ status: "weird" }))).kind).toBe("corrupt");
    expect(interpretResponse("python", NONCE, 77, base(status({}))).kind).toBe("corrupt");
  });

  it("re-sums the output bytes: over the limit is limit-exceeded even when the status says ok; exactly at the limit passes", () => {
    const files = { ...status({ status: "ok", result: {} }), "/out/u/a": enc("123"), "/out/u/b": enc("45") };
    expect(interpretResponse("python", NONCE, 5, base(files)).kind).toBe("ok");
    expect(interpretResponse("python", NONCE, 4, base(files))).toMatchObject({ kind: "error", code: "limit-exceeded" });
  });

  it("files outside /out/u do not count against the output limit", () => {
    const files = { ...status({ status: "ok", result: {} }), "/out/u/a": enc("1"), "/out/junk": enc("x".repeat(500)) };
    expect(interpretResponse("python", NONCE, 1, base(files)).kind).toBe("ok");
  });
});

describe("stripProtocolNoise", () => {
  it("drops the protocol's DeprecationWarning line and its indented source line", () => {
    const text = '/ipc/server.py:123: DeprecationWarning: x is deprecated\n  self.sock.settimeout(0)\nhello\nworld';
    expect(stripProtocolNoise(text)).toBe("hello\nworld");
  });

  it("keeps ordinary output, other warnings and a warning-looking line with a different prefix", () => {
    const text = "a.py:1: DeprecationWarning: mine\nprint\n/other/server.py:2: Warning: no\n";
    expect(stripProtocolNoise(text)).toBe(text);
  });

  it("drops several warnings, and a trailing warning without a source line", () => {
    const text = "/ipc/server.py:1: ResourceWarning: a\n  src\nkeep\n/ipc/server.py:99: DeprecationWarning: b";
    expect(stripProtocolNoise(text)).toBe("keep");
  });

  it("does not eat the next line when it is not indented", () => {
    expect(stripProtocolNoise("/ipc/server.py:1: DeprecationWarning: a\nnext")).toBe("next");
    expect(stripProtocolNoise("x\n/ipc/server.py:1: DeprecationWarning: a\nnext")).toBe("x\nnext");
  });

  it("passes empty and clean text through", () => {
    expect(stripProtocolNoise("")).toBe("");
    expect(stripProtocolNoise("plain\ntext")).toBe("plain\ntext");
  });
});

describe("tailBytes", () => {
  it("E24: boundaries at 16 KiB − 1, 16 KiB and 16 KiB + 1 (truncated flag only when over)", () => {
    expect(OUTPUT_TAIL_BYTES).toBe(16384);
    for (const [n, truncated] of [[16383, false], [16384, false], [16385, true]] as const) {
      const text = `${"x".repeat(n - 4)}DONE`;
      const r = tailBytes(text, OUTPUT_TAIL_BYTES);
      expect(r.truncated).toBe(truncated);
      expect(Buffer.byteLength(r.text)).toBe(Math.min(n, 16384));
      expect(r.text.endsWith("DONE")).toBe(true);
      if (!truncated) expect(r.text).toBe(text);
    }
  });

  it("E24: a 1 MiB output keeps the last 16 KiB ending DONE", () => {
    const text = `${"y".repeat(1024 * 1024 - 4)}DONE`;
    const r = tailBytes(text, OUTPUT_TAIL_BYTES);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.text)).toBe(16384);
    expect(r.text.endsWith("DONE")).toBe(true);
  });

  it("keeps the tail (a traceback sits at the end), not the head", () => {
    expect(tailBytes("0123456789", 4)).toEqual({ text: "6789", truncated: true });
    expect(tailBytes("0123456789", 10)).toEqual({ text: "0123456789", truncated: false });
    expect(tailBytes("", 5)).toEqual({ text: "", truncated: false });
  });

  it("never cuts inside a multi-byte character: the result is the longest whole-character suffix that fits", () => {
    const text = "aé€😀bé€😀c".repeat(3);
    const chars = [...text];
    for (let max = 1; max <= 30; max++) {
      const r = tailBytes(text, max);
      expect(r.text).not.toContain("�");
      expect(text.endsWith(r.text)).toBe(true);
      expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(max);
      // maximality: adding the next character to the front would exceed `max`
      const kept = [...r.text].length;
      if (kept < chars.length) expect(Buffer.byteLength(chars.slice(chars.length - kept - 1).join(""))).toBeGreaterThan(max);
    }
  });

  it("3-byte characters straddling the 16 KiB boundary are dropped whole", () => {
    const r = tailBytes("€".repeat(6000), OUTPUT_TAIL_BYTES); // 18000 bytes
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.text)).toBe(16383); // 5461 × 3 (the 16384th byte would split a character)
    expect(r.text).toBe("€".repeat(5461));
  });
});
