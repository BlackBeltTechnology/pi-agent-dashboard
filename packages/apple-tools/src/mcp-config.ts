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

/**
 * Read the existing `mcpServers.iMCP` entry. A present-but-wrong-typed value
 * (scalar, null, array) is REFUSED rather than coerced to `{}` — coercing would
 * destroy the operator's parseable value on the next write.
 */
function readExistingImcp(
  servers: Record<string, unknown>,
  path: string,
): { existing: Record<string, unknown> } | { error: ConfigWriteResult } {
  const raw = servers.iMCP;
  if (raw === undefined) return { existing: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      error: {
        ok: false,
        state: "CONFIG_UNPARSEABLE",
        message: `${path}: "mcpServers.iMCP" must be an object`,
      },
    };
  }
  return { existing: raw as Record<string, unknown> };
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
  const er = readExistingImcp(servers, mcpJsonPath);
  if ("error" in er) return er.error;
  const { existing } = er;
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
 * Read-only structural validation of a config file, using the SAME rules the
 * writers enforce. Check mode calls this so `--check` can never report a
 * healthy state that write mode would fail on (parity: invalid JSON, non-object
 * root, malformed `mcpServers` / `mcpServers.iMCP` / `packages`).
 * Returns null when the file would be writable.
 */
export function validateConfigShape(
  io: ConfigIO,
  path: string,
  kind: "mcp" | "settings",
): Extract<ConfigWriteResult, { ok: false }> | null {
  const r = parseOrError(io, path);
  if ("error" in r) return r.error as Extract<ConfigWriteResult, { ok: false }>;
  if (kind === "mcp") {
    const sr = readServers(r.parsed, path);
    if ("error" in sr) return sr.error as Extract<ConfigWriteResult, { ok: false }>;
    const er = readExistingImcp(sr.servers, path);
    if ("error" in er) return er.error as Extract<ConfigWriteResult, { ok: false }>;
  } else if (r.parsed.packages !== undefined && !Array.isArray(r.parsed.packages)) {
    return {
      ok: false,
      state: "CONFIG_UNPARSEABLE",
      message: `${path}: "packages" must be an array`,
    };
  }
  return null;
}

/** Read the iMCP entry's operator-facing fields from a given mcp.json layer. */
export function readImcpEntry(
  io: ConfigIO,
  mcpJsonPath: string,
): { disabled: boolean; directTools: string[] } {
  const r = parseOrError(io, mcpJsonPath);
  if ("error" in r) return { disabled: false, directTools: [] };
  const servers = r.parsed.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    return { disabled: false, directTools: [] };
  }
  const entry = (servers as Record<string, unknown>).iMCP;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { disabled: false, directTools: [] };
  }
  const e = entry as Record<string, unknown>;
  return {
    // pi-mcp-adapter's isServerDisabled: only a literal `true` disables.
    disabled: e.disabled === true,
    directTools: Array.isArray(e.directTools)
      ? (e.directTools as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  };
}

/** Merge a patch into `mcpServers.iMCP`; an `undefined` value removes the key. */
function patchImcpEntry(
  io: ConfigIO,
  mcpJsonPath: string,
  patch: Record<string, unknown>,
): ConfigWriteResult {
  const r = parseOrError(io, mcpJsonPath);
  if ("error" in r) return r.error;
  const config = r.parsed;
  const sr = readServers(config, mcpJsonPath);
  if ("error" in sr) return sr.error;
  const { servers } = sr;
  const er = readExistingImcp(servers, mcpJsonPath);
  if ("error" in er) return er.error;
  const merged: Record<string, unknown> = { ...er.existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const next = { ...config, mcpServers: { ...servers, iMCP: merged } };
  return writeOrError(io, mcpJsonPath, next);
}

/**
 * Write the iMCP `disabled` override into a given mcp.json layer. BOTH levels
 * are supported and use the identical merge discipline:
 *   - global  → `~/.pi/agent/mcp.json` (the layer the installer writes `command`
 *     to; the target for the dashboard's global settings panel)
 *   - project → `<cwd>/.pi/mcp.json` (the adapter's highest-precedence layer,
 *     so a project override folds over the global value without mutating it)
 *
 * Mirrors `writeProjectServerDisabledOverride` in the installed pi-mcp-adapter
 * (`config.ts`): disabling writes `disabled: true`; ENABLING removes the key
 * rather than writing `false`. `isServerDisabled` treats only a literal `true`
 * as disabled (`types.ts:395`). Verified against adapter v2.19.0 (task 7.8).
 */
export function setServerDisabled(
  io: ConfigIO,
  mcpJsonPath: string,
  disabled: boolean,
): ConfigWriteResult {
  return patchImcpEntry(io, mcpJsonPath, { disabled: disabled ? true : undefined });
}

/**
 * Write the adapter's per-server `directTools` filter onto the iMCP entry
 * (`ServerEntry.directTools?: boolean | string[]`, consumed by the adapter's
 * `direct-tools.ts`). An empty selection removes the key rather than writing
 * `[]`, which the adapter would read as "promote nothing".
 */
export function setDirectTools(
  io: ConfigIO,
  mcpJsonPath: string,
  tools: string[],
): ConfigWriteResult {
  return patchImcpEntry(io, mcpJsonPath, {
    directTools: tools.length > 0 ? tools : undefined,
  });
}
