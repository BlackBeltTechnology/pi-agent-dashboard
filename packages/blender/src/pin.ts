/**
 * Pinned Blender WebAssembly runtime identity, cache root resolution, the ordered required-file list,
 * the archive allowlist and the cache completion stamp.
 *
 * Exactly one upstream build is accepted (`@knervous/blender-web`); no registry metadata is consulted at
 * run time. `ProvisionError` lives here (not in `provision.ts`) so `tar.ts` can raise it without an import
 * cycle; `provision.ts` re-exports it.
 *
 * See change: add-blender-wasm-mcp (design D3, tasks 2.1–2.3).
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ── Errors ──────────────────────────────────────────────────────────────────

export type ProvisionErrorCode =
  | "integrity-mismatch"
  | "download-failed"
  | "unsafe-archive"
  | "runtime-manifest-mismatch"
  | "override-invalid"
  | "provision-failed";

/** Provisioning failure carrying a lowercase machine code (the CLI/MCP layer reports `code` + `message`). */
export class ProvisionError extends Error {
  override name = "ProvisionError";
  readonly code: ProvisionErrorCode;
  constructor(code: ProvisionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

// ── Pin ─────────────────────────────────────────────────────────────────────

/** Shape of a runtime pin (the real one is {@link PIN}; unit tests inject small fixtures). */
export interface PinSpec {
  readonly name: string;
  readonly version: string;
  /** Exact tarball size; a longer body fails the download. */
  readonly bytes: number;
  /** SRI string, `sha512-<base64>`. */
  readonly integrity: string;
  readonly tarball: string;
}

export const PIN = {
  name: "@knervous/blender-web",
  version: "0.0.5",
  bytes: 66057129,
  integrity: "sha512-2zvq0fCeoqEe7usry4k7hwgD7xc7gWHvzNq29vnk0VXL6PEaa+CoSiA95by1Z5P7BHwJUYtyXGHaY/j+4rv+rg==",
  tarball: "https://registry.npmjs.org/@knervous/blender-web/-/blender-web-0.0.5.tgz",
} as const satisfies PinSpec;

/** Parse an SRI string; only `sha512-<base64 of 64 bytes>` is accepted. */
export function parseSri(integrity: string): { algorithm: "sha512"; digestHex: string } {
  const m = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  const digest = m ? Buffer.from(m[1], "base64") : undefined;
  if (digest?.length !== 64) {
    throw new ProvisionError("provision-failed", `malformed integrity value "${integrity}" (expected sha512-<base64 of 64 bytes>)`);
  }
  return { algorithm: "sha512", digestHex: digest.toString("hex") };
}

// ── Cache root ──────────────────────────────────────────────────────────────

/** `BLENDER_WASM_HOME`, else `<PI_CODING_AGENT_DIR or ~/.pi/agent>/tools/blender-wasm`. */
export function resolveCacheRoot(env: NodeJS.ProcessEnv, homedir: string | (() => string)): string {
  if (env.BLENDER_WASM_HOME) return path.resolve(env.BLENDER_WASM_HOME);
  const home = typeof homedir === "function" ? homedir() : homedir;
  const agentDir = env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
  return path.join(agentDir, "tools", "blender-wasm");
}

// ── Layout ──────────────────────────────────────────────────────────────────

/** Files the session loads, in the order `override-invalid` reports the first missing one. */
export const REQUIRED_FILES: readonly string[] = [
  "package.json",
  "runtime/manifest.json",
  "runtime/session-worker.js",
  "runtime/st/blender.js",
  "runtime/st/blender.wasm",
  "runtime/st/blender.data",
  "runtime/st/manifest.json",
  "dist/browser/index.js",
  "dist/browser/brotli.js",
  "dist/project/protocol.generated.js",
];

const ALLOWED_EXACT: readonly string[] = [
  "package/dist/browser/index.js",
  "package/dist/browser/brotli.js",
  "package/dist/project/protocol.py",
  "package/runtime/session-worker.js",
  "package/runtime/st/blender.js",
  "package/runtime/st/blender.wasm.br",
  "package/runtime/st/blender.data.br",
  "package/runtime/st/manifest.json",
  "package/LICENSE",
  "package/THIRD-PARTY-LICENSES.md",
  "package/package.json",
];

const PROJECT_JS = /^package\/dist\/project\/[^/]+\.js$/;

/**
 * Archive allowlist: maps an archive path to its destination in the committed layout, or `undefined` when
 * the entry must not be extracted (pthread flavour, source maps, type declarations, docs, …).
 */
export function ARCHIVE_ALLOWLIST(archivePath: string): string | undefined {
  if (ALLOWED_EXACT.includes(archivePath) || PROJECT_JS.test(archivePath)) return archivePath.slice("package/".length);
  return undefined;
}

// ── Completion stamp ────────────────────────────────────────────────────────

export const STAMP_NAME = ".blender-wasm.json";

export interface StampedFile {
  bytes: number;
  sha256: string;
}

export interface Stamp {
  version: string;
  integrity: string;
  files: Record<string, StampedFile>;
}

/** Read and shape-check the stamp of a committed runtime dir; `undefined` when absent or malformed. */
export function readStamp(dir: string): Stamp | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, STAMP_NAME), "utf8"));
    if (typeof raw !== "object" || raw === null) return undefined;
    const { version, integrity, files } = raw as Record<string, unknown>;
    if (typeof version !== "string" || typeof integrity !== "string") return undefined;
    if (typeof files !== "object" || files === null || Array.isArray(files)) return undefined;
    for (const f of Object.values(files)) {
      const e = f as Partial<StampedFile> | null;
      if (typeof e !== "object" || e === null || typeof e.bytes !== "number" || typeof e.sha256 !== "string") return undefined;
    }
    return { version, integrity, files: files as Record<string, StampedFile> };
  } catch {
    return undefined;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** First required file missing under `dir` (list order), if any. */
export function firstMissingRequired(dir: string): string | undefined {
  return REQUIRED_FILES.find((rel) => !isFile(path.join(dir, ...rel.split("/"))));
}

/**
 * Hot-path cache validity: stamp matches the pin, every required file exists, every stamped file exists
 * with its stamped size. sha256 is NOT checked here (see `repairAfterBootFailure`).
 */
export function isValidCache(dir: string, pin: PinSpec): boolean {
  const stamp = readStamp(dir);
  if (!stamp || stamp.version !== pin.version || stamp.integrity !== pin.integrity) return false;
  if (firstMissingRequired(dir) !== undefined) return false;
  for (const [rel, want] of Object.entries(stamp.files)) {
    try {
      const st = fs.statSync(path.join(dir, ...rel.split("/")));
      if (!st.isFile() || st.size !== want.bytes) return false;
    } catch {
      return false;
    }
  }
  return true;
}
