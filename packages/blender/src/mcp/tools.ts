/**
 * The five MCP tools (design D4): argument validation, workspace staging at dequeue, supervisor call,
 * confined all-or-nothing output commit, and result encoding.
 *
 * Result encoding: `content[0]` is JSON text `{sessionReset, durationMs, ...fields}` (or
 * `{code, message, sessionReset, durationMs}` with `isError: true`); printed output, when present, is
 * the LAST block (<= 16 KiB, truncation flagged in block 0).
 *
 * See change: add-blender-wasm-mcp (design D4, D5, task 4.3).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ToolError } from "../errors.js";
import { EXPORT_EXTENSIONS, IMPORT_EXTENSIONS } from "../host/jobs.js";
import type { OpName, ToolErrorCode } from "../host/protocol.js";
import type { Call, Cancelled, Outcome, OutcomeOk, Staged } from "../host/supervisor.js";
import {
  commitOutputs,
  confineExisting,
  confineOutput,
  type Limits,
  MAX_CODE_BYTES,
  MAX_INPUT_FILES,
  normaliseRelative,
  readInputs,
} from "./workspace.js";

export interface ToolResult {
  isError?: true;
  content: { type: "text"; text: string }[];
}

export interface SupervisorLike {
  enqueue(req: {
    op: OpName;
    args: never;
    timeoutSec: number;
    outputLimit: number;
    stage?: () => Promise<Staged>;
  }): Call;
  takeReset(): boolean;
}

export interface ToolContext {
  root: string;
  supervisor: SupervisorLike;
  limits: Limits;
}

export interface ToolRun {
  promise: Promise<ToolResult | Cancelled>;
  cancel(): void;
}

const TIMEOUT_DEFAULT = 120;
const BUILD_LIMITS =
  "Build limits: single-threaded Blender 5.3 alpha under WebAssembly; EEVEE only, no rendering; no Subsurf/OpenSubdiv, Draco or meshopt; no USD, Alembic or X3D; no network, no subprocess; about 1.2 GB per live session.";
const TIMEOUT_PROP = {
  type: "integer",
  minimum: 1,
  maximum: 600,
  description: `Operation timeout in seconds (default ${TIMEOUT_DEFAULT}); on expiry the session is ended and the scene lost.`,
} as const;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "blender_python",
    description: `Run Python (bpy) in the persistent headless Blender session. Files listed in \`inputs\` (root-relative) are available at /in/<same relative path>; every file the code writes under /out/ is saved below \`outputDir\` (default blender-out) inside the root, keeping its layout. Multi-file assets (OBJ+MTL, glTF with external buffers) are imported here, via inputs. ${BUILD_LIMITS}`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source (at most 1 MiB)." },
        inputs: { type: "array", items: { type: "string" }, maxItems: MAX_INPUT_FILES, description: "Root-relative files to stage under /in (at most 64, 256 MiB total)." },
        outputDir: { type: "string", description: "Root-relative directory receiving /out (default blender-out)." },
        timeoutSec: TIMEOUT_PROP,
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_scene",
    description: `List the scene: Blender and runtime version, total object count and up to \`limit\` objects (name, type, parent, location, rotation, scale, dimensions, material names, mesh vertex/face counts). ${BUILD_LIMITS}`,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum objects listed (default 200)." },
        timeoutSec: TIMEOUT_PROP,
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_import",
    description: `Import one root-relative file by extension (.glb .gltf .fbx .obj .stl .ply .svg .blend, case-insensitive). A .blend replaces the whole scene. A .gltf may only use data: URIs; for external buffers/images or multi-file assets use blender_python with inputs. ${BUILD_LIMITS}`,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Root-relative file path." }, timeoutSec: TIMEOUT_PROP },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_export",
    description: `Export the scene to a root-relative path by extension (.glb .gltf .fbx .obj .stl .ply .blend). Sidecar files the exporter makes (.mtl, .bin) are written next to the target and listed. A .gltf is written as .gltf + .bin; re-import it through blender_python with inputs (blender_import refuses external buffers). Prefer .glb. selectedOnly is rejected for .blend. ${BUILD_LIMITS}`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root-relative target path." },
        selectedOnly: { type: "boolean", description: "Export only selected objects (not for .blend)." },
        timeoutSec: TIMEOUT_PROP,
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_reset",
    description: `Replace the session scene with Blender's factory startup scene (default) or an empty scene. ${BUILD_LIMITS}`,
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["factory", "empty"] }, timeoutSec: TIMEOUT_PROP },
      additionalProperties: false,
    },
  },
];

// ── result encoding ────────────────────────────────────────────────────────

function encode(fields: Record<string, unknown>, output: string | undefined, isError: boolean): ToolResult {
  const content: ToolResult["content"] = [{ type: "text", text: JSON.stringify(fields) }];
  if (output) content.push({ type: "text", text: output });
  return isError ? { isError: true, content } : { content };
}

export function errorResult(code: ToolErrorCode, message: string, sessionReset: boolean, durationMs = 0, output?: string, outputTruncated = false): ToolResult {
  return encode({ code, message, sessionReset, durationMs, ...(outputTruncated ? { outputTruncated: true } : {}) }, output, true);
}

// ── validation ─────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;

function invalid(message: string): never {
  throw new ToolError("invalid-arguments", message);
}

function checkKeys(args: Args, allowed: readonly string[]): void {
  for (const k of Object.keys(args)) if (!allowed.includes(k)) invalid(`unknown argument "${k}"`);
}

function str(args: Args, key: string, required: boolean): string | undefined {
  const v = args[key];
  if (v === undefined) {
    if (required) invalid(`"${key}" is required`);
    return undefined;
  }
  if (typeof v !== "string") invalid(`"${key}" must be a string`);
  return v;
}

function intIn(args: Args, key: string, min: number, max: number, dflt: number): number {
  const v = args[key];
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) invalid(`"${key}" must be an integer from ${min} to ${max}`);
  return v;
}

function ext(p: string): string {
  return path.posix.extname(p.replaceAll("\\", "/")).toLowerCase();
}

const OPERATION = Symbol("operation");

interface Prepared {
  [OPERATION]: true;
  op: OpName;
  args: unknown;
  timeoutSec: number;
  stage?: (limits: Limits) => Staged;
  finish: (o: OutcomeOk) => Record<string, unknown>;
  /** Commit workspace outputs after a successful op; returns the written files. */
  commit?: (o: OutcomeOk) => { path: string; bytes: number }[];
}

/** Reject a `.gltf` whose buffers or images are not `data:` URIs (the session has no way to resolve them). */
function checkGltfSelfContained(bytes: Uint8Array, rel: string): void {
  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return; // not JSON: let the importer report it
  }
  const refs: string[] = [];
  for (const group of ["buffers", "images"] as const) {
    const list = (doc as Record<string, unknown> | null)?.[group];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const uri = (item as { uri?: unknown } | null)?.uri;
      if (typeof uri === "string" && !uri.startsWith("data:")) refs.push(uri);
    }
  }
  if (refs.length > 0) {
    throw new ToolError(
      "unsupported-format",
      `${rel} references external files (${refs.slice(0, 5).join(", ")}); blender_import only takes self-contained glTF. Import it with blender_python and \`inputs\` instead.`,
    );
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-tool argument validation: one switch branch per tool.
function prepare(name: string, raw: unknown, ctx: ToolContext): Prepared {
  if (raw === undefined) raw = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid("arguments must be an object");
  const args = raw as Args;
  const op = { [OPERATION]: true as const };
  switch (name) {
    case "blender_python": {
      checkKeys(args, ["code", "inputs", "outputDir", "timeoutSec"]);
      const code = str(args, "code", true) as string;
      const timeoutSec = intIn(args, "timeoutSec", 1, 600, TIMEOUT_DEFAULT);
      const inputsRaw = args.inputs;
      if (inputsRaw !== undefined && (!Array.isArray(inputsRaw) || inputsRaw.some((i) => typeof i !== "string"))) invalid('"inputs" must be an array of strings');
      const inputs = (inputsRaw as string[] | undefined) ?? [];
      const outputDir = str(args, "outputDir", false) ?? "blender-out";
      if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) throw new ToolError("limit-exceeded", `code is over ${MAX_CODE_BYTES} bytes`);
      if (new Set(inputs).size > MAX_INPUT_FILES) throw new ToolError("limit-exceeded", `more than ${MAX_INPUT_FILES} input files`);
      return {
        ...op,
        op: "python",
        args: { code },
        timeoutSec,
        stage: (limits) => {
          confineOutput(ctx.root, outputDir);
          return readInputs(ctx.root, inputs, limits);
        },
        finish: () => ({}),
        commit: (o) => commitOutputs(ctx.root, outputDir, Object.entries(o.files).map(([key, bytes]) => ({ key, bytes })), ctx.limits.outputBytes),
      };
    }
    case "blender_scene": {
      checkKeys(args, ["limit", "timeoutSec"]);
      const limit = intIn(args, "limit", 1, 1000, 200);
      return {
        ...op,
        op: "scene",
        args: { limit },
        timeoutSec: intIn(args, "timeoutSec", 1, 600, TIMEOUT_DEFAULT),
        finish: (o) => ({
          blenderVersion: o.result.blender,
          runtimeVersion: o.result.runtimeVersion,
          total: o.result.total,
          truncated: o.result.truncated,
          objects: o.result.objects,
        }),
      };
    }
    case "blender_import": {
      checkKeys(args, ["path", "timeoutSec"]);
      const p = str(args, "path", true) as string;
      const timeoutSec = intIn(args, "timeoutSec", 1, 600, TIMEOUT_DEFAULT);
      normaliseRelative(p); // confinement first: an absolute / escaping path is path-outside-root whatever its extension
      const e = ext(p);
      if (!IMPORT_EXTENSIONS.includes(e)) throw new ToolError("unsupported-format", `${p}: cannot import "${e || "(no extension)"}"; supported: ${IMPORT_EXTENSIONS.join(" ")}`);
      return {
        ...op,
        op: "import",
        args: { ext: e, path: `/in/${normaliseRelative(p)}` },
        timeoutSec,
        stage: (limits) => {
          const { rel, real } = confineExisting(ctx.root, p);
          const st = fs.statSync(real);
          if (!st.isFile()) invalid(`${rel}: not a regular file`);
          if (st.size > limits.inputBytes) throw new ToolError("limit-exceeded", `${rel} is over the input limit`);
          const bytes = new Uint8Array(fs.readFileSync(real));
          if (e === ".gltf") checkGltfSelfContained(bytes, rel);
          return e === ".blend" ? { files: {}, blend: bytes } : { files: { [`/in/${rel}`]: bytes } };
        },
        finish: (o) => ({ path: normaliseRelative(p), objects: o.result.objects }),
      };
    }
    case "blender_export": {
      checkKeys(args, ["path", "selectedOnly", "timeoutSec"]);
      const p = str(args, "path", true) as string;
      const timeoutSec = intIn(args, "timeoutSec", 1, 600, TIMEOUT_DEFAULT);
      const sel = args.selectedOnly;
      if (sel !== undefined && typeof sel !== "boolean") invalid('"selectedOnly" must be a boolean');
      normaliseRelative(p); // confinement first: an absolute / escaping path is path-outside-root whatever its extension
      const e = ext(p);
      if (!EXPORT_EXTENSIONS.includes(e)) throw new ToolError("unsupported-format", `${p}: cannot export "${e || "(no extension)"}"; supported: ${EXPORT_EXTENSIONS.join(" ")}`);
      if (e === ".blend" && sel === true) invalid("selectedOnly is not supported for .blend");
      const name2 = path.posix.basename(p.replaceAll("\\", "/"));
      return {
        ...op,
        op: "export",
        args: { ext: e, name: name2, selectedOnly: sel === true },
        timeoutSec,
        stage: () => {
          confineOutput(ctx.root, p);
          return { files: {} };
        },
        finish: () => ({}),
        commit: (o) => {
          const target = normaliseRelative(p);
          return commitOutputs(ctx.root, path.posix.dirname(target) === "." ? "" : path.posix.dirname(target), Object.entries(o.files).map(([key, bytes]) => ({ key, bytes })), ctx.limits.outputBytes);
        },
      };
    }
    case "blender_reset": {
      checkKeys(args, ["mode", "timeoutSec"]);
      const mode = str(args, "mode", false) ?? "factory";
      if (mode !== "factory" && mode !== "empty") invalid('"mode" must be "factory" or "empty"');
      return { ...op, op: "reset", args: { mode }, timeoutSec: intIn(args, "timeoutSec", 1, 600, TIMEOUT_DEFAULT), finish: () => ({}) };
    }
    default:
      throw new ToolError("invalid-arguments", `unknown tool "${name}"`);
  }
}

function shape(prepared: Prepared, outcome: Outcome): ToolResult {
  if (!outcome.ok) {
    return errorResult(outcome.code, outcome.message, outcome.sessionReset, outcome.durationMs, outcome.output, outcome.outputTruncated);
  }
  let written: { path: string; bytes: number }[] = [];
  if (prepared.commit) {
    try {
      written = prepared.commit(outcome);
    } catch (e) {
      if (e instanceof ToolError) return errorResult(e.code, e.message, outcome.sessionReset, outcome.durationMs, outcome.output, outcome.outputTruncated);
      throw e;
    }
  }
  const fields: Record<string, unknown> = { sessionReset: outcome.sessionReset, durationMs: outcome.durationMs, ...prepared.finish(outcome) };
  if (prepared.op === "python") fields.outputs = written;
  if (prepared.op === "export") fields.files = written;
  if (outcome.outputTruncated) fields.outputTruncated = true;
  return encode(fields, outcome.output, false);
}

/** Validate and start one tool call. Never throws: failures are tool results. */
export function startTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolRun {
  let prepared: Prepared;
  try {
    prepared = prepare(name, rawArgs, ctx);
  } catch (e) {
    if (e instanceof ToolError) {
      return { promise: Promise.resolve(errorResult(e.code, e.message, ctx.supervisor.takeReset())), cancel() {} };
    }
    throw e;
  }
  const p = prepared;
  const call = ctx.supervisor.enqueue({
    op: p.op,
    args: p.args as never,
    timeoutSec: p.timeoutSec,
    outputLimit: ctx.limits.outputBytes,
    stage: p.stage ? async () => (p.stage as (l: Limits) => Staged)(ctx.limits) : undefined,
  });
  const promise = call.promise.then((o) => {
    if ("cancelled" in o) return o;
    try {
      return shape(p, o);
    } catch (e) {
      return errorResult("export-failed", (e as Error).message, o.sessionReset, o.durationMs);
    }
  });
  return { promise, cancel: () => call.cancel() };
}
