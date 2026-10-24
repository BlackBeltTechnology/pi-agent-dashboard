/**
 * L1-real: the real `pi-blender mcp` server (launcher → server → Blender host) against the real pinned
 * Blender WebAssembly runtime. Gated by `BLENDER_WASM_E2E=1` (+ JSPI on the host Node), see helpers/runtime.ts.
 * Fixtures (obj/mtl/glb/fbx/blend/gltf) are produced inside the tests, by Blender or as hand-written text.
 *
 *   BLENDER_WASM_E2E=1 vitest run src/__tests__/real-binary.test.ts
 *
 * Covers E10, E12, E26–E29, E31–E35, E37, E39–E41, E43, E44, E50, E51, P1–P3.
 * See change: add-blender-wasm-mcp (test-plan.md; tasks 2.14, 2.16, 4.x).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PIN } from "../pin.js";
import { provision } from "../provision.js";
import { hostPidBelow, type McpClient, SOCKET_GUARD, startServer, type ToolResultJson } from "./helpers/mcp-client.js";
import { describeReal, REAL_TIMEOUT_MS, TEST_CACHE } from "./helpers/runtime.js";

// ── tmp bookkeeping + server lifecycle ──────────────────────────────────────

const tmpDirs: string[] = [];
function tmpDir(prefix = "pi-blender-real-"): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
const servers: McpClient[] = [];

interface Session {
  ws: string;
  c: McpClient;
}

/** A real server whose cwd (= project root) is a fresh tmp workspace. */
function boot(env: NodeJS.ProcessEnv = {}): Session {
  const ws = tmpDir("pi-blender-ws-");
  const c = startServer({ cwd: ws, env });
  servers.push(c);
  return { ws, c };
}

async function closeServer(c: McpClient): Promise<void> {
  c.child.stdin?.end();
  const timer = setTimeout(() => c.child.kill("SIGKILL"), 15_000);
  await c.exited;
  clearTimeout(timer);
}

afterAll(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const py = (s: Session, code: string, extra: Record<string, unknown> = {}): Promise<ToolResultJson> => s.c.call("blender_python", { code, ...extra });
const scene = (s: Session, args: Record<string, unknown> = {}): Promise<ToolResultJson> => s.c.call("blender_scene", args);
const reset = (s: Session, mode: "factory" | "empty" = "factory"): Promise<ToolResultJson> => s.c.call("blender_reset", { mode });

interface OutRef {
  path: string;
  bytes: number;
}
const outputs = (r: ToolResultJson): OutRef[] => r.data.outputs as OutRef[];
const files = (r: ToolResultJson): OutRef[] => r.data.files as OutRef[];
const names = (r: ToolResultJson): string[] => (r.data.objects as { name: string }[]).map((o) => o.name);

/** Fail with the tool's own message when a call was not a success. */
function ok(r: ToolResultJson): ToolResultJson {
  if (r.isError) throw new Error(`tool error: ${JSON.stringify(r.data)}${r.output ? `\n${r.output}` : ""}`);
  return r;
}

/** Parse the `RESULT=<json>` line the test snippets print (Blender itself may print other lines). */
function result<T>(r: ToolResultJson): T {
  const m = /^RESULT=(.*)$/m.exec(r.output ?? "");
  if (!m) throw new Error(`no RESULT line in output: ${r.output}`);
  return JSON.parse(m[1]) as T;
}

const write = (ws: string, rel: string, data: string | Uint8Array): string => {
  const p = path.join(ws, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
};

/** OBJ text for `count` unit cubes, each its own object (`<prefix>1`, `<prefix>2`, ...). */
function cubesObj(prefix: string, count: number, mtl?: { lib: string; name: string }): string {
  const lines: string[] = mtl ? [`mtllib ${mtl.lib}`] : [];
  for (let i = 0; i < count; i++) {
    const o = i * 3; // each cube is shifted 3 units on x
    lines.push(`o ${prefix}${i + 1}`);
    for (const [x, y, z] of [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ]) lines.push(`v ${x + o} ${y} ${z}`);
    if (mtl) lines.push(`usemtl ${mtl.name}`);
    const b = i * 8;
    for (const f of [[1, 2, 3, 4], [5, 8, 7, 6], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 8, 4], [5, 1, 4, 8]]) lines.push(`f ${f.map((n) => n + b).join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every regular file below `dir` as a POSIX path relative to it. */
function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

function hasKey(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKey(x, key));
  if (v !== null && typeof v === "object") return Object.entries(v).some(([k, x]) => k === key || hasKey(x, key));
  return false;
}

/** Resident set size of `pid` in bytes (`ps` on POSIX, `tasklist` on Windows). */
function rssBytes(pid: number): number {
  if (process.platform === "win32") {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
    const cells = out.trim().split('","');
    const kb = Number((cells[cells.length - 1] ?? "").replace(/[^0-9]/g, ""));
    return kb * 1024;
  }
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) * 1024;
}

// ── E10 / E12: provisioning layout and a no-brotli boot ─────────────────────

describeReal("blender-wasm real: provisioned cache (E10, E12)", () => {
  let home: string;
  let versionDir: string;
  let note = "";

  beforeAll(async () => {
    // A fresh BLENDER_WASM_HOME with the real pinned tarball; if the network is unreachable fall back to
    // the shared, already provisioned test cache (the layout assertions are then made on that copy).
    home = tmpDir("pi-blender-home-");
    try {
      const r = await provision({ env: { BLENDER_WASM_HOME: home }, log: () => {} });
      expect(r.source).toBe("download");
      versionDir = r.dir;
    } catch (e) {
      note = `fresh provisioning failed (${(e as Error).message}); using ${TEST_CACHE}`;
      home = TEST_CACHE;
      versionDir = path.join(TEST_CACHE, PIN.version);
      if (!fs.existsSync(versionDir)) throw e;
    }
  }, REAL_TIMEOUT_MS);

  it("E10: the provisioned cache has runtime/st/*, no runtime/mt, no *.map, no *.d.ts", () => {
    const all = walk(versionDir);
    for (const f of ["blender.js", "blender.wasm", "blender.data", "manifest.json"]) expect(all, note).toContain(`runtime/st/${f}`);
    expect(fs.existsSync(path.join(versionDir, "runtime", "mt")), "runtime/mt must not exist").toBe(false);
    expect(all.filter((f) => f.startsWith("runtime/mt/"))).toEqual([]);
    expect(all.filter((f) => f.endsWith(".map"))).toEqual([]);
    expect(all.filter((f) => f.endsWith(".d.ts"))).toEqual([]);
  });

  it("E12: no brotli artefacts on disk and the runtime boots from the cache", async () => {
    const all = walk(versionDir);
    expect(all.filter((f) => f.endsWith(".br"))).toEqual([]);
    expect(all.filter((f) => path.posix.basename(f) === "brotli-decode.wasm")).toEqual([]);
    const manifest: unknown = JSON.parse(fs.readFileSync(path.join(versionDir, "runtime", "manifest.json"), "utf8"));
    expect(hasKey(manifest, "encoding"), "runtime/manifest.json must carry no `encoding` key").toBe(false);

    // Boot a session from exactly this cache; the socket guard proves no outbound connection was made.
    const guardLog = path.join(tmpDir("pi-blender-guard-"), "guard.log");
    const ws = tmpDir("pi-blender-ws-");
    const c = startServer({ cwd: ws, env: { BLENDER_WASM_HOME: home, NODE_OPTIONS: `--require ${SOCKET_GUARD}`, BLENDER_WASM_GUARD_LOG: guardLog } });
    servers.push(c);
    try {
      const r = ok(await c.call("blender_scene"));
      expect(r.data.total).toBe(3);
      expect(r.data.blenderVersion).toMatch(/^\d+\.\d+/);
    } finally {
      await closeServer(c);
    }
    const logged = fs.existsSync(guardLog) ? fs.readFileSync(guardLog, "utf8").trim().split("\n").filter(Boolean) : [];
    // tsx's own loader IPC connects to a local `tsx-<uid>/<pid>.pipe` unix socket; nothing else may connect.
    const outbound = logged.filter((l) => /"kind":"(connect|websocket|dgram)"/.test(l) && !/tsx-\d+[\\/\\]+\d+\.pipe/.test(l));
    expect(outbound, "no outbound connection while booting").toEqual([]);
  });
});

// ── the shared session: tools against the real scene ────────────────────────

describeReal("blender-wasm real: tools on a live session", () => {
  let s: Session;

  beforeAll(() => {
    s = boot();
  });

  beforeEach(async () => {
    // Every test starts from Blender's factory scene (E34 asserts exactly that).
    ok(await reset(s, "factory"));
  });

  it("E26: a Probe object added by python persists and is listed by blender_scene", async () => {
    ok(await py(s, "bpy.context.collection.objects.link(bpy.data.objects.new('Probe', None))"));
    const r = ok(await scene(s));
    expect(names(r)).toContain("Probe");
  });

  it("E27: /out/model.glb with no outputDir lands in blender-out/ as a GLB and is listed", async () => {
    const r = ok(await py(s, "bpy.ops.export_scene.gltf(filepath='/out/model.glb', export_format='GLB')"));
    const file = path.join(s.ws, "blender-out", "model.glb");
    expect(fs.readFileSync(file).subarray(0, 4).toString("latin1")).toBe("glTF");
    expect(outputs(r)).toEqual([{ path: "blender-out/model.glb", bytes: fs.statSync(file).size }]);
  });

  it("E28: same-named inputs a/part.obj and b/part.obj stay distinct (1 and 2 objects)", async () => {
    write(s.ws, "a/part.obj", cubesObj("A", 1));
    write(s.ws, "b/part.obj", cubesObj("B", 2));
    const r = ok(
      await py(
        s,
        `import json
def imp(p):
    before = set(bpy.data.objects.keys())
    bpy.ops.wm.obj_import(filepath=p)
    return len(set(bpy.data.objects.keys()) - before)
print("RESULT=" + json.dumps([imp('/in/a/part.obj'), imp('/in/b/part.obj')]))`,
        { inputs: ["a/part.obj", "b/part.obj"] },
      ),
    );
    expect(result<number[]>(r)).toEqual([1, 2]);
  });

  it("E29: assets/chair.obj + chair.mtl (red diffuse) imports with a red base colour", async () => {
    write(s.ws, "assets/chair.obj", cubesObj("Chair", 1, { lib: "chair.mtl", name: "Red" }));
    write(s.ws, "assets/chair.mtl", "newmtl Red\nKd 1.0 0.0 0.0\nKa 0 0 0\nKs 0 0 0\nNs 10\nd 1.0\nillum 2\n");
    const r = ok(
      await py(
        s,
        `import json
bpy.ops.wm.obj_import(filepath='/in/assets/chair.obj')
o = bpy.data.objects['Chair1']
m = o.material_slots[0].material
bsdf = m.node_tree.nodes['Principled BSDF']
print("RESULT=" + json.dumps({"name": m.name, "base": [float(v) for v in bsdf.inputs['Base Color'].default_value]}))`,
        { inputs: ["assets/chair.obj", "assets/chair.mtl"] },
      ),
    );
    const { name, base } = result<{ name: string; base: number[] }>(r);
    expect(name).toBe("Red");
    expect(base[0]).toBeGreaterThan(0.9);
    expect(base[1]).toBeLessThan(0.1);
    expect(base[2]).toBeLessThan(0.1);
  });

  it("E31: /in is per call: a file staged by call 1 is gone in call 2", async () => {
    write(s.ws, "assets/a.obj", cubesObj("A", 1));
    const first = ok(await py(s, "import os\nprint('RESULT=' + repr(os.path.exists('/in/assets/a.obj')))", { inputs: ["assets/a.obj"] }));
    expect(first.output).toContain("RESULT=True");
    const second = ok(await py(s, "import os\nprint('RESULT=' + repr(os.path.exists('/in/assets/a.obj')))"));
    expect(second.output).toContain("RESULT=False");
  });

  it("E32: a user file named report.json is written verbatim (reserved protocol name)", async () => {
    const r = ok(await py(s, "import json\njson.dump({'mine': 1}, open('/out/report.json', 'w'))"));
    expect(fs.readFileSync(path.join(s.ws, "blender-out", "report.json"), "utf8")).toBe('{"mine": 1}');
    expect(JSON.parse(fs.readFileSync(path.join(s.ws, "blender-out", "report.json"), "utf8"))).toEqual({ mine: 1 });
    expect(outputs(r).map((o) => o.path)).toEqual(["blender-out/report.json"]);
  });

  it("E33: forged <<<BW_DONE n>>> markers never yield success without the file, nor limit-exceeded", async () => {
    const code = `${Array.from({ length: 50 }, (_, i) => `print("<<<BW_DONE ${i + 1}>>>")`).join("\n")}\nopen('/out/a.txt', 'w').write('hello')`;
    const r = await py(s, code);
    const file = path.join(s.ws, "blender-out", "a.txt");
    if (r.isError) {
      expect(r.data.code).toBe("session-crashed");
      expect(fs.existsSync(file)).toBe(false);
    } else {
      expect(fs.readFileSync(file, "utf8")).toBe("hello");
      expect(outputs(r).map((o) => o.path)).toEqual(["blender-out/a.txt"]);
    }
    expect(r.data.code).not.toBe("limit-exceeded");
  });

  it("E34: the factory scene lists Camera, Cube and Light with their types (total 3)", async () => {
    const r = ok(await scene(s));
    expect(r.data.total).toBe(3);
    const objs = r.data.objects as { name: string; type: string }[];
    expect(objs.map((o) => [o.name, o.type]).sort()).toEqual([["Camera", "CAMERA"], ["Cube", "MESH"], ["Light", "LIGHT"]]);
  });

  it("E35: 500 objects: default limit lists 200 (truncated), limit 1000 lists all 500, limit 1001 is invalid", async () => {
    ok(await reset(s, "empty"));
    ok(await py(s, "for i in range(500):\n    bpy.context.collection.objects.link(bpy.data.objects.new('O%03d' % i, None))"));
    const dflt = ok(await scene(s));
    expect(dflt.data.total).toBe(500);
    expect(dflt.data.truncated).toBe(true);
    expect((dflt.data.objects as unknown[]).length).toBe(200);
    const all = ok(await scene(s, { limit: 1000 }));
    expect(all.data.total).toBe(500);
    expect(all.data.truncated).toBe(false);
    expect((all.data.objects as unknown[]).length).toBe(500);
    const bad = await scene(s, { limit: 1001 });
    expect(bad.isError).toBe(true);
    expect(bad.data.code).toBe("invalid-arguments");
  });

  it("E37: importing a .blend that holds only Probe replaces the factory scene", async () => {
    ok(await reset(s, "empty"));
    const saved = ok(await py(s, "bpy.context.collection.objects.link(bpy.data.objects.new('Probe', None))\nbpy.ops.wm.save_as_mainfile(filepath='/out/probe.blend', copy=True)"));
    expect(outputs(saved).map((o) => o.path)).toEqual(["blender-out/probe.blend"]);
    ok(await reset(s, "factory"));
    expect(ok(await scene(s)).data.total).toBe(3);
    ok(await s.c.call("blender_import", { path: "blender-out/probe.blend" }));
    const r = ok(await scene(s));
    expect(names(r)).toEqual(["Probe"]);
    expect(r.data.total).toBe(1);
  });

  it("E39: MODEL.GLB (upper-case extension) imports", async () => {
    const exp = ok(await s.c.call("blender_export", { path: "models/lower.glb" }));
    expect(files(exp).map((f) => f.path)).toEqual(["models/lower.glb"]);
    fs.copyFileSync(path.join(s.ws, "models", "lower.glb"), path.join(s.ws, "models", "MODEL.GLB"));
    ok(await reset(s, "empty"));
    const imp = ok(await s.c.call("blender_import", { path: "models/MODEL.GLB" }));
    expect((imp.data.objects as string[]).length).toBeGreaterThan(0);
    expect(ok(await scene(s)).data.total).toBeGreaterThan(0);
  });

  it("E40: exporting a scene with a material to .obj writes scene.obj and scene.mtl, both listed", async () => {
    ok(await py(s, "m = bpy.data.materials.new('Painted')\nm.use_nodes = True\nbpy.data.objects['Cube'].data.materials.append(m)"));
    const r = ok(await s.c.call("blender_export", { path: "out/scene.obj" }));
    expect(files(r).map((f) => f.path).sort()).toEqual(["out/scene.mtl", "out/scene.obj"]);
    for (const f of files(r)) expect(fs.statSync(path.join(s.ws, f.path)).size).toBe(f.bytes);
    expect(fs.readFileSync(path.join(s.ws, "out", "scene.mtl"), "utf8")).toContain("Painted");
  });

  it("E41: .fbx export round-trips through blender_import and names its objects", async () => {
    const exp = ok(await s.c.call("blender_export", { path: "out/scene.fbx" }));
    expect(files(exp).map((f) => f.path)).toEqual(["out/scene.fbx"]);
    expect(fs.statSync(path.join(s.ws, "out", "scene.fbx")).size).toBeGreaterThan(0);
    ok(await reset(s, "empty"));
    const imp = ok(await s.c.call("blender_import", { path: "out/scene.fbx" }));
    expect((imp.data.objects as string[]).length).toBeGreaterThan(0);
    expect(names(ok(await scene(s))).length).toBeGreaterThan(0);
  });

  it("E43: exporting .gltf writes s.gltf and s.bin, both listed", async () => {
    const r = ok(await s.c.call("blender_export", { path: "out/s.gltf" }));
    expect(files(r).map((f) => f.path).sort()).toEqual(["out/s.bin", "out/s.gltf"]);
    for (const f of files(r)) expect(fs.statSync(path.join(s.ws, f.path)).size).toBe(f.bytes);
    const doc = JSON.parse(fs.readFileSync(path.join(s.ws, "out", "s.gltf"), "utf8")) as { buffers: { uri: string }[] };
    expect(doc.buffers[0].uri).toBe("s.bin");
  });

  it("E44: blender_reset {mode:'empty'} on a session with objects leaves total 0", async () => {
    expect(ok(await scene(s)).data.total).toBe(3);
    ok(await reset(s, "empty"));
    const r = ok(await scene(s));
    expect(r.data.total).toBe(0);
    expect(r.data.objects).toEqual([]);
  });
});

// ── E50 / E51: output size limit ────────────────────────────────────────────

describeReal("blender-wasm real: output size limit (E50, E51)", () => {
  let s: Session;
  const MIB = 1024 * 1024;

  beforeAll(() => {
    s = boot({ BLENDER_WASM_MAX_OUTPUT_MB: "1" });
  });

  it("E50: 1 MiB-1 B is written; 2 MiB is limit-exceeded with nothing written and the session stays live", async () => {
    const first = ok(await py(s, `open('/out/ok.bin', 'wb').write(b'x' * (${MIB} - 1))`));
    expect(outputs(first)).toEqual([{ path: "blender-out/ok.bin", bytes: MIB - 1 }]);
    expect(fs.statSync(path.join(s.ws, "blender-out", "ok.bin")).size).toBe(MIB - 1);

    const second = await py(s, `open('/out/too-big.bin', 'wb').write(b'x' * (2 * ${MIB}))`);
    expect(second.isError).toBe(true);
    expect(second.data.code).toBe("limit-exceeded");
    expect(fs.existsSync(path.join(s.ws, "blender-out", "too-big.bin"))).toBe(false);
    expect(fs.readdirSync(path.join(s.ws, "blender-out"))).toEqual(["ok.bin"]);

    const next = ok(await scene(s));
    expect(next.data.sessionReset).toBe(false);
  });

  it("E51: patching os.path.getsize to return 0 does not defeat the limit (limit-exceeded, no file)", async () => {
    const r = await py(s, `import os\nos.path.getsize = lambda p: 0\nopen('/out/tamper.bin', 'wb').write(b'x' * (2 * ${MIB}))`, { outputDir: "tamper-out" });
    expect(r.isError).toBe(true);
    expect(r.data.code).toBe("limit-exceeded");
    expect(fs.existsSync(path.join(s.ws, "tamper-out", "tamper.bin"))).toBe(false);
    expect(fs.existsSync(path.join(s.ws, "tamper-out")) ? fs.readdirSync(path.join(s.ws, "tamper-out")) : []).toEqual([]);
  });
});

// ── P1–P3: performance budget ───────────────────────────────────────────────

describeReal("blender-wasm real: performance budget (P1–P3)", () => {
  let s: Session;

  beforeAll(() => {
    s = boot();
  });

  it("P1: the first blender_scene (boot included) from a fresh server against a valid cache takes <= 15 s", async () => {
    const t0 = Date.now();
    const r = ok(await scene(s));
    const ms = Date.now() - t0;
    expect(r.data.total).toBe(3);
    expect(ms, `first call took ${ms} ms`).toBeLessThanOrEqual(15_000);
  });

  it("P2: the median of 5 blender_scene calls on a live factory session is <= 2 s", async () => {
    ok(await reset(s, "factory"));
    ok(await scene(s)); // make sure the session is live whatever ran before
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      ok(await scene(s));
      times.push(Date.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[2];
    expect(median, `call times ms: ${times.join(", ")}`).toBeLessThanOrEqual(2_000);
  });

  it("P3: after boot and a .glb export the Blender host process holds <= 2.5 GB RSS", async () => {
    ok(await reset(s, "factory"));
    ok(await s.c.call("blender_export", { path: "out/f.glb" }));
    expect(fs.statSync(path.join(s.ws, "out", "f.glb")).size).toBeGreaterThan(0);
    const launcher = s.c.child.pid as number;
    const host = hostPidBelow(launcher);
    expect(host, "host pid below the launcher").toBeDefined();
    const rss = rssBytes(host as number);
    expect(rss, `host RSS ${(rss / 2 ** 20).toFixed(0)} MiB`).toBeGreaterThan(0);
    expect(rss, `host RSS ${(rss / 2 ** 20).toFixed(0)} MiB`).toBeLessThanOrEqual(2.5 * 1024 ** 3);
  });
});
