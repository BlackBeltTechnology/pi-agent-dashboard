/**
 * Merge-only, atomic config writers for the two user-owned files the installer
 * touches: `~/.pi/agent/mcp.json` (the `mcpServers.iMCP` entry) and
 * `~/.pi/agent/settings.json` (the `packages[]` adapter entry).
 *
 * Discipline (see change: add-apple-tools-imcp-plugin, Decision 4):
 *   - read → deep-merge exactly one key → write. Never clobber siblings.
 *   - refuse to write a present-but-unparseable file (surface, don't "fix").
 *   - write via temp-file + atomic rename; never leave a truncated config.
 *   - never interpolate any probed value into a shell string.
 *
 * All filesystem access is injected (`ConfigIO`) so the suite runs on Linux CI
 * without touching real user config.
 */
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";

/** Injected filesystem surface. `readFile` returns null when the file is absent. */
export interface ConfigIO {
  readFile: (path: string) => string | null;
  /** Atomic write (temp-file + rename). Throws an Error whose `.code` may be EACCES/ENOSPC. */
  writeFileAtomic: (path: string, content: string) => void;
}

/** Outcome of a config write; `state` is set only on a terminal failure. */
export type ConfigWriteResult =
  | { ok: true }
  | { ok: false; state: "CONFIG_UNPARSEABLE" | "CONFIG_WRITE_FAILED"; message: string };

/** The npm source string appended to settings.json packages[] for the adapter. */
export const ADAPTER_PACKAGE_SOURCE = "npm:pi-mcp-adapter";

function parseOrError(
  io: ConfigIO,
  path: string,
): { parsed: Record<string, unknown> } | { error: ConfigWriteResult } {
  const raw = io.readFile(path);
  if (raw === null || raw.trim() === "") return { parsed: {} };
  try {
    const val = JSON.parse(raw);
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
      return {
        error: {
          ok: false,
          state: "CONFIG_UNPARSEABLE",
          message: `${path} is not a JSON object`,
        },
      };
    }
    return { parsed: val as Record<string, unknown> };
  } catch (e) {
    return {
      error: {
        ok: false,
        state: "CONFIG_UNPARSEABLE",
        message: `${path} contains invalid JSON: ${(e as Error).message}`,
      },
    };
  }
}

/**
 * Read `mcpServers` as an object. A present-but-wrong-typed value (array,
 * string) is refused rather than coerced to `{}` — coercing would silently
 * drop the user's data on the next write.
 */
function readServers(
  config: Record<string, unknown>,
  path: string,
): { servers: Record<string, unknown> } | { error: ConfigWriteResult } {
  const raw = config.mcpServers;
  if (raw === undefined) return { servers: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error: {
        ok: false,
        state: "CONFIG_UNPARSEABLE",
        message: `${path}: "mcpServers" must be an object`,
      },
    };
  }
  return { servers: raw as Record<string, unknown> };
}

function writeOrError(io: ConfigIO, path: string, obj: unknown): ConfigWriteResult {
  try {
    io.writeFileAtomic(path, `${JSON.stringify(obj, null, 2)}\n`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      state: "CONFIG_WRITE_FAILED",
      message: `failed to write ${path}: ${(e as Error).message}`,
    };
  }
}

/**
 * Ensure `mcpServers.iMCP = { command: <imcpServerPath> }` in mcp.json,
 * preserving every other server and unknown top-level key. imcp-server is a
 * stdio server that takes no args — `command` alone is the full contract
 * (verified against pi-mcp-adapter's documented mcpServers shape).
 */
export function ensureMcpEntry(
  io: ConfigIO,
  mcpJsonPath: string,
  imcpServerPath: string,
): ConfigWriteResult {
  const r = parseOrError(io, mcpJsonPath);
  if ("error" in r) return r.error;
  const config = r.parsed;
  const sr = readServers(config, mcpJsonPath);
  if ("error" in sr) return sr.error;
  const { servers } = sr;
  const existing =
    servers.iMCP && typeof servers.iMCP === "object" && !Array.isArray(servers.iMCP)
      ? (servers.iMCP as Record<string, unknown>)
      : {};
  // Merge-only: preserve any operator-added fields on the iMCP entry (e.g. a
  // `disabled` flag), overriding just `command` with the re-discovered path.
  const merged = { ...existing, command: imcpServerPath };
  const next = { ...config, mcpServers: { ...servers, iMCP: merged } };
  return writeOrError(io, mcpJsonPath, next);
}

/**
 * Append the adapter to settings.json `packages[]` if absent. Presence is
 * detected with the cross-kind `sourcesMatch()` (npm ↔ git ↔ raw), so a
 * user who installed pi-mcp-adapter from git receives no duplicate npm entry.
 * Never reorders or removes existing entries.
 */
export function ensureAdapterPackage(io: ConfigIO, settingsJsonPath: string): ConfigWriteResult {
  const r = parseOrError(io, settingsJsonPath);
  if ("error" in r) return r.error;
  const config = r.parsed;
  if (config.packages !== undefined && !Array.isArray(config.packages)) {
    return {
      ok: false,
      state: "CONFIG_UNPARSEABLE",
      message: `${settingsJsonPath}: "packages" must be an array`,
    };
  }
  const packages = Array.isArray(config.packages) ? (config.packages as unknown[]) : [];
  const already = packages.some(
    (p) => typeof p === "string" && sourcesMatch(p, ADAPTER_PACKAGE_SOURCE),
  );
  if (already) return { ok: true };
  const next = { ...config, packages: [...packages, ADAPTER_PACKAGE_SOURCE] };
  return writeOrError(io, settingsJsonPath, next);
}

/**
 * Write the iMCP `disabled` override to the project-local `.pi/mcp.json` (the
 * adapter's highest-precedence layer and its own write target for the flag).
 * Deliberately a different file from `~/.pi/agent/mcp.json` — the override folds
 * over the lower layer's `command` without mutating it.
 *
 * Mirrors `writeProjectServerDisabledOverride` in the installed pi-mcp-adapter
 * (`config.ts`): disabling writes `disabled: true`; ENABLING removes the key
 * rather than writing `false`. `isServerDisabled` treats only a literal `true`
 * as disabled (`types.ts`), and we never write `disabled` to any lower layer,
 * so key-removal is the correct enable path. Verified against the installed
 * adapter v2.19.0 (task 7.8).
 */
export function setServerDisabled(
  io: ConfigIO,
  projectMcpJsonPath: string,
  disabled: boolean,
): ConfigWriteResult {
  const r = parseOrError(io, projectMcpJsonPath);
  if ("error" in r) return r.error;
  const config = r.parsed;
  const sr = readServers(config, projectMcpJsonPath);
  if ("error" in sr) return sr.error;
  const { servers } = sr;
  const existing =
    servers.iMCP && typeof servers.iMCP === "object" && !Array.isArray(servers.iMCP)
      ? (servers.iMCP as Record<string, unknown>)
      : {};
  const merged = disabled
    ? { ...existing, disabled: true }
    : Object.fromEntries(Object.entries(existing).filter(([k]) => k !== "disabled"));
  const next = { ...config, mcpServers: { ...servers, iMCP: merged } };
  return writeOrError(io, projectMcpJsonPath, next);
}
