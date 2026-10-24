/**
 * IPC contract between the MCP server (supervisor) and the disposable Blender host child, plus the
 * machine error codes shared by every layer. Messages travel over Node's `advanced` IPC
 * serialization, so `Uint8Array` payloads cross as-is.
 *
 * See change: add-blender-wasm-mcp (design D1, D4, D8).
 */

/** Machine codes of a failing tool call (design D8). */
export const TOOL_ERROR_CODES = [
  "invalid-arguments",
  "jspi-unavailable",
  "provision-failed",
  "boot-failed",
  "path-outside-root",
  "input-not-found",
  "unsupported-format",
  "limit-exceeded",
  "python-error",
  "import-failed",
  "export-failed",
  "timeout",
  "session-crashed",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/** Codes a host can answer with; every other code is raised by the server. */
export type HostErrorCode = "python-error" | "import-failed" | "export-failed" | "limit-exceeded";

export type OpName = "python" | "scene" | "import" | "export" | "reset";

export interface PythonArgs {
  /** Agent Python source. */
  code: string;
}
export interface SceneArgs {
  limit: number;
}
export interface ImportArgs {
  /** Lower-case extension including the dot, e.g. `.glb`. */
  ext: string;
  /** Session path the file was staged at, e.g. `/in/assets/chair.obj`. Unused for `.blend`. */
  path: string;
}
export interface ExportArgs {
  ext: string;
  /** Target file name (basename) written below `/x`. */
  name: string;
  selectedOnly: boolean;
}
export interface ResetArgs {
  mode: "factory" | "empty";
}
export interface OpArgsMap {
  python: PythonArgs;
  scene: SceneArgs;
  import: ImportArgs;
  export: ExportArgs;
  reset: ResetArgs;
}

/** Server → host. */
export interface HostRequest<K extends OpName = OpName> {
  type: "op";
  id: number;
  op: K;
  args: OpArgsMap[K];
  /** Staged inputs keyed by session path (`/in/<root-relative path>`). */
  files: Record<string, Uint8Array>;
  /** `.blend` bytes for `import` of a `.blend` (replaces the scene). */
  blend?: Uint8Array;
  /** Random per-request secret that the job wrapper echoes into its status file. */
  nonce: string;
  /** Maximum total output bytes (`/out/u/**`). */
  outputLimit: number;
}

export interface HostReady {
  type: "ready";
  runtimeVersion: string;
}

interface ResultBase {
  type: "result";
  id: number;
  /** Last 16 KiB of printed output. */
  output: string;
  outputTruncated: boolean;
}
export interface HostResultOk extends ResultBase {
  ok: true;
  result: Record<string, unknown>;
  /** Outputs keyed by path relative to `/out/u/` (unconfined: the server confines them). */
  files: Record<string, Uint8Array>;
}
export interface HostResultErr extends ResultBase {
  ok: false;
  code: HostErrorCode;
  message: string;
}
export type HostResult = HostResultOk | HostResultErr;
export type HostMessage = HostReady | HostResult;

/** Printed-output tail kept per result (design D4). */
export const OUTPUT_TAIL_BYTES = 16 * 1024;
