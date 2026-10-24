/**
 * Python job wrappers (design D4) and response validation. `buildJobScript` turns one op into the
 * Python the Blender protocol executes; `interpretResponse` checks what came back (report.json,
 * nonce status file, re-summed output bytes) so agent code that mimics protocol markers can never
 * produce a result it did not earn.
 *
 * Pure functions: no I/O, fully unit-testable without a runtime.
 * See change: add-blender-wasm-mcp (design D4).
 */
import type { HostErrorCode, OpArgsMap, OpName } from "./protocol.js";

/** Operators per import extension. `.blend` is loaded by the protocol's `load` step instead. */
const IMPORTERS: Record<string, string> = {
  ".glb": "import_scene.gltf",
  ".gltf": "import_scene.gltf",
  ".fbx": "import_scene.fbx",
  ".obj": "wm.obj_import",
  ".stl": "wm.stl_import",
  ".ply": "wm.ply_import",
  ".svg": "import_curve.svg",
};

/** Exporter call per extension (the `{T}` placeholder is the target path, `{SEL}` the selection flag). */
const EXPORTERS: Record<string, string> = {
  ".glb": "bpy.ops.export_scene.gltf(filepath={T}, export_format='GLB', use_selection={SEL})",
  ".gltf": "bpy.ops.export_scene.gltf(filepath={T}, export_format='GLTF_SEPARATE', use_selection={SEL})",
  ".fbx": "bpy.ops.export_scene.fbx(filepath={T}, use_selection={SEL})",
  ".obj": "bpy.ops.wm.obj_export(filepath={T}, export_selected_objects={SEL})",
  ".stl": "bpy.ops.wm.stl_export(filepath={T}, export_selected_objects={SEL})",
  ".ply": "bpy.ops.wm.ply_export(filepath={T}, export_selected_objects={SEL})",
  ".blend": "bpy.ops.wm.save_as_mainfile(filepath={T}, check_existing=False, copy=True)",
};

export const IMPORT_EXTENSIONS = [...Object.keys(IMPORTERS), ".blend"];
export const EXPORT_EXTENSIONS = Object.keys(EXPORTERS);

const PRELUDE = `import bpy, os, sys, json, shutil, base64, traceback

def _bw_size(root):
    total = 0
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            try:
                total += os.lstat(dirpath + "/" + n).st_size
            except OSError:
                pass
    return total

def _bw_check(ret, what):
    if ret is not None and 'FINISHED' not in ret:
        raise RuntimeError(what + " did not finish: " + str(set(ret)))

def _bw_robj(o):
    d = {"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None,
         "location": [round(float(v), 6) for v in o.location],
         "rotation": [round(float(v), 6) for v in o.rotation_euler],
         "scale": [round(float(v), 6) for v in o.scale],
         "dimensions": [round(float(v), 6) for v in o.dimensions],
         "materials": [s.material.name for s in o.material_slots if s.material]}
    if o.type == "MESH":
        d["vertices"] = len(o.data.vertices)
        d["faces"] = len(o.data.polygons)
    return d
`;

function body(op: OpName, args: OpArgsMap[OpName]): { body: string; promote: "out" | "x" | "none" } {
  switch (op) {
    case "python":
      return {
        promote: "out",
        body: `    code = A["code"]
    exec(compile(code, "<blender_python>", "exec"), {"__name__": "__main__", "bpy": bpy})
    return {}`,
      };
    case "scene":
      return {
        promote: "none",
        body: `    objs = list(bpy.context.scene.objects)
    limit = A["limit"]
    return {"blender": bpy.app.version_string, "total": len(objs), "truncated": len(objs) > limit,
            "objects": [_bw_robj(o) for o in objs[:limit]]}`,
      };
    case "import": {
      const a = args as OpArgsMap["import"];
      if (a.ext === ".blend") {
        return {
          promote: "none",
          body: `    return {"objects": [o.name for o in bpy.context.scene.objects]}`,
        };
      }
      const op2 = IMPORTERS[a.ext];
      if (!op2) throw new Error(`no importer for ${a.ext}`);
      return {
        promote: "none",
        body: `    before = set(o.as_pointer() for o in bpy.data.objects)
    _bw_check(bpy.ops.${op2}(filepath=A["path"]), "import")
    return {"objects": [o.name for o in bpy.data.objects if o.as_pointer() not in before]}`,
      };
    }
    case "export": {
      const a = args as OpArgsMap["export"];
      const call = EXPORTERS[a.ext];
      if (!call) throw new Error(`no exporter for ${a.ext}`);
      return {
        promote: "x",
        body: `    os.makedirs("/x", exist_ok=True)
    target = "/x/" + A["name"]
    sel = bool(A["selectedOnly"])
    _bw_check(${call.replace("{T}", "target").replace("{SEL}", "sel")}, "export")
    if not os.path.exists(target):
        raise RuntimeError("exporter produced no file")
    return {}`,
      };
    }
    case "reset":
      return { promote: "none", body: "    return {}" };
  }
}

/**
 * The job script for one op. `nonce` is echoed into `/out/.status-<nonce>.json`; `limit` is the
 * in-session output cap (re-checked by the host, so agent tampering cannot lift it).
 */
export function buildJobScript(op: OpName, args: OpArgsMap[OpName], nonce: string, limit: number): string {
  const { body: opBody, promote } = body(op, args);
  const argsB64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  return `${PRELUDE}
def _bw_job():
    NONCE = ${JSON.stringify(nonce)}
    LIMIT = ${Math.floor(limit)}
    A = json.loads(base64.b64decode(${JSON.stringify(argsB64)}).decode("utf-8"))
    OUT = "/out"

    def run():
${opBody
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}

    shutil.rmtree("/x", ignore_errors=True)
    try:
        result = run()
        ${promoteCode(promote)}
        if os.path.isdir(OUT + "/u") and _bw_size(OUT + "/u") > LIMIT:
            shutil.rmtree(OUT + "/u", ignore_errors=True)
            status = {"status": "limit"}
        else:
            status = {"status": "ok", "result": result}
        with open(OUT + "/.status-" + NONCE + ".json", "w") as f:
            json.dump(status, f)
    finally:
        shutil.rmtree("/in", ignore_errors=True)
        shutil.rmtree("/x", ignore_errors=True)

_bw_job()
`;
}

function promoteCode(promote: "out" | "x" | "none"): string {
  if (promote === "out") {
    return `names = os.listdir(OUT)
        stage = OUT + "/.stage-" + NONCE
        os.makedirs(stage)
        for n in names:
            shutil.move(OUT + "/" + n, stage + "/" + n)
        os.rename(stage, OUT + "/u")`;
  }
  if (promote === "x") {
    return `os.makedirs(OUT + "/u", exist_ok=True)
        for n in os.listdir("/x"):
            if os.path.exists(OUT + "/u/" + n):
                raise RuntimeError("export name collision: " + n)
            shutil.move("/x/" + n, OUT + "/u/" + n)`;
  }
  return "pass";
}

export interface SessionResponse {
  output: string;
  files: Record<string, Uint8Array>;
}

export type Interpreted =
  | { kind: "ok"; result: Record<string, unknown>; files: Record<string, Uint8Array> }
  | { kind: "error"; code: HostErrorCode; message: string }
  /** Report or status missing: agent output mimicked a protocol marker. The session must be killed. */
  | { kind: "corrupt"; message: string };

const ERROR_CODE: Record<OpName, HostErrorCode> = {
  python: "python-error",
  scene: "python-error",
  reset: "python-error",
  import: "import-failed",
  export: "export-failed",
};

const OUT_PREFIX = "/out/u/";

function parseJson(bytes: Uint8Array | undefined): Record<string, unknown> | undefined {
  if (!bytes) return undefined;
  try {
    const v: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Validate a session response and extract the confined outputs (design D4, "Host response validation"). */
export function interpretResponse(op: OpName, nonce: string, limit: number, r: SessionResponse): Interpreted {
  const report = parseJson(r.files["/out/report.json"]);
  if (!report) return { kind: "corrupt", message: "response lacks report.json" };
  if (typeof report.error === "string" && report.error.length > 0) {
    return { kind: "error", code: ERROR_CODE[op], message: report.error };
  }
  const status = parseJson(r.files[`/out/.status-${nonce}.json`]);
  if (!status) return { kind: "corrupt", message: "response lacks the nonce status file" };
  if (status.status === "limit") return { kind: "error", code: "limit-exceeded", message: `outputs exceed the ${limit}-byte limit` };
  if (status.status !== "ok") return { kind: "corrupt", message: "unknown status" };

  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [key, bytes] of Object.entries(r.files)) {
    if (!key.startsWith(OUT_PREFIX)) continue;
    total += bytes.byteLength;
    files[key.slice(OUT_PREFIX.length)] = bytes;
  }
  // Re-sum: the in-session check ran beside agent code and can be tampered with.
  if (total > limit) return { kind: "error", code: "limit-exceeded", message: `outputs exceed the ${limit}-byte limit` };
  const result = status.result !== null && typeof status.result === "object" ? (status.result as Record<string, unknown>) : {};
  return { kind: "ok", result, files };
}

/**
 * Drop the protocol's own deprecation warning (`/ipc/server.py:<n>: DeprecationWarning ...` + its source
 * line), which Blender prints on every request and which is noise to the agent.
 */
export function stripProtocolNoise(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\/ipc\/server\.py:\d+: \w*Warning:/.test(lines[i])) {
      if (i + 1 < lines.length && /^\s/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join("\n").replace(/^\n+/, "");
}

/** Keep the last `max` bytes of `text` (tracebacks sit at the end), cutting on a character boundary. */
export function tailBytes(text: string, max: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return { text, truncated: false };
  let start = buf.length - max;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return { text: buf.subarray(start).toString("utf8"), truncated: true };
}
