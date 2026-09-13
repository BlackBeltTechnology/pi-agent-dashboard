/**
 * mcp-client-plugin · CORE merge-only config writer.
 *
 * Writes only the two Pi-owned layers, resolved through the adapter port's path
 * helpers: `getPiGlobalConfigPath()` (global) and `getProjectPiConfigPath(cwd)`
 * (project). Every write is a patch (`set` + `unset`) that preserves sibling
 * servers and unrecognised keys. Parses JSONC exactly as `pi-mcp-adapter` does
 * (`strip-json-comments` with `trailingCommas: true`) and writes back under
 * whichever of `mcpServers` / `mcp-servers` the file already uses, never both.
 *
 * Refusals are the closed {@link ConfigRefusalCode} set and come from the same
 * validation function `checkConfigFiles` uses, so check mode can never report a
 * healthy file that write mode would refuse.
 *
 * See change: extract-mcp-client-plugin (design D1).
 */

import { dirname } from "node:path";
import { isAllowedCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import stripJsonComments from "strip-json-comments";
import { isPlainObject } from "./path-utils.js";
import type {
  AdapterPort,
  ConfigIO,
  ConfigRefusal,
  ConfigWriteResult,
  McpSettings,
  ParseStatus,
  ReadResult,
  RemoveResult,
  Scope,
  ServerEntry,
} from "./types.js";

/** Thrown when a project-scope write names a cwd outside the known-folder set. */
export class NotAllowedCwdError extends Error {
  constructor(public readonly cwd: string) {
    super(`cwd not allowed: ${cwd}`);
    this.name = "NotAllowedCwdError";
  }
}

/** The npm source string appended to settings.json `packages[]` for the adapter. */
export const ADAPTER_PACKAGE_SOURCE = "npm:pi-mcp-adapter";

/** The three mutually exclusive transport fields. */
export const TRANSPORT_FIELDS = ["command", "url", "socket"] as const;

/** Server names that must never be used as object keys (prototype pollution). */
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

/** 1–128 chars, no `/`, `\` or control chars, not `.`/`..`, not a prototype key. */
export function isValidServerName(name: string): boolean {
  if (name.length < 1 || name.length > 128) return false;
  if (name === "." || name === "..") return false;
  if (FORBIDDEN_NAMES.has(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

/** Parse a JSONC config file exactly as the adapter does. Throws on failure. */
export function parseJsonc(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw, { trailingCommas: true }));
}

/** A null-prototype shallow copy, so a `__proto__` own key can never pollute. */
function nullProto<T extends object>(obj: T): T {
  return Object.assign(Object.create(null), obj) as T;
}

function ok(): ConfigWriteResult {
  return { ok: true };
}

/**
 * The one validation function shared by every write path and by
 * `checkConfigFiles`: given the layer entry a write would leave in the target
 * file, enforce transport exclusivity (at most one of command/url/socket).
 * The ">= 1 transport when nothing lower defines the server" rule needs the
 * adapter merge and is enforced by the HTTP layer.
 */
export function validateResultingEntry(entry: Record<string, unknown>): ConfigRefusal | null {
  const present = TRANSPORT_FIELDS.filter((f) => entry[f] !== undefined);
  if (present.length > 1) {
    return {
      code: "transport-conflict",
      message: `entry carries more than one transport: ${present.join(", ")}`,
      fields: [...present],
    };
  }
  return null;
}

export interface ConfigWriter {
  /** Resolve the Pi-owned target path for a scope (enforces admission). */
  targetPath(scope: Scope): string;
  readServerEntry(name: string, scope: Scope): ReadResult;
  ensureServerEntry(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): ConfigWriteResult;
  /** A patch of `set` fields + `unset` keys over one server entry. */
  applyServerPatch(
    name: string,
    set: Partial<ServerEntry>,
    unset: string[],
    scope: Scope,
  ): ConfigWriteResult;
  removeServer(name: string, scope: Scope): RemoveResult;
  setDirectTools(name: string, tools: string[] | undefined, scope: Scope): ConfigWriteResult;
  setServerDisabled(
    name: string,
    disabled: boolean,
    scope: Scope,
    opts?: { timeoutMs?: number },
  ): Promise<ConfigWriteResult>;
  patchSettings(set: Partial<McpSettings>, unset: string[]): ConfigWriteResult;
  ensureAdapterPackage(): ConfigWriteResult;
  /** Dry run: the refusal `ensureServerEntry` would return, or null when it would write. */
  previewEnsure(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): ConfigRefusal | null;
  /** Dry run of `ensureAdapterPackage` — refuses a non-array `packages`, no write. */
  previewAdapterPackage(): ConfigRefusal | null;
  readParseStatus(path: string): ParseStatus;
  /** The settings.json path that sits beside the Pi-global mcp.json. */
  settingsJsonPath(): string;
}

export interface ConfigWriterDeps {
  configIO: ConfigIO;
  adapter: AdapterPort;
  knownCwds: () => string[];
  /** Always-empty scratch dir used for global-scope adapter merges. */
  scratchCwd: string;
  defaultTimeoutMs?: number;
}

type ReadConfig =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; refusal: ConfigRefusal };

/** Read + parse a config file. A missing/blank file reads as `{}`. */
function readConfigFile(io: ConfigIO, path: string): ReadConfig {
  const raw = io.readFile(path);
  if (raw === null || raw.trim() === "") return { ok: true, config: nullProto({}) };
  try {
    const parsed = parseJsonc(raw);
    if (!isPlainObject(parsed)) {
      return { ok: false, refusal: { code: "unparseable", message: `${path} is not a JSON object`, path } };
    }
    return { ok: true, config: nullProto(parsed) };
  } catch (e) {
    return {
      ok: false,
      refusal: {
        code: "unparseable",
        message: `${path} contains invalid JSON: ${(e as Error).message}`,
        path,
      },
    };
  }
}

/** The servers key the adapter reads first, and the map it holds (null if mistyped). */
function resolveServersKey(config: Record<string, unknown>): {
  key: "mcpServers" | "mcp-servers";
  servers: Record<string, unknown> | null;
} {
  if (config.mcpServers !== undefined) {
    return {
      key: "mcpServers",
      servers: isPlainObject(config.mcpServers) ? nullProto(config.mcpServers) : null,
    };
  }
  if (config["mcp-servers"] !== undefined) {
    return {
      key: "mcp-servers",
      servers: isPlainObject(config["mcp-servers"]) ? nullProto(config["mcp-servers"]) : null,
    };
  }
  return { key: "mcpServers", servers: nullProto({}) };
}

function writeOrRefuse(io: ConfigIO, path: string, obj: unknown): ConfigWriteResult {
  try {
    io.writeFileAtomic(path, `${JSON.stringify(obj, null, 2)}\n`);
    return ok();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    return {
      ok: false,
      refusal: {
        code: "write-failed",
        message: `failed to write ${path}: ${err.message}`,
        path,
        ...(err.code ? { ioCode: err.code } : {}),
      },
    };
  }
}

export function createConfigWriter(deps: ConfigWriterDeps): ConfigWriter {
  const { configIO, adapter, knownCwds, scratchCwd, defaultTimeoutMs = 10_000 } = deps;

  function targetPath(scope: Scope): string {
    if (scope.kind === "global") return adapter.getPiGlobalConfigPath();
    if (!isAllowedCwd(scope.cwd, knownCwds)) throw new NotAllowedCwdError(scope.cwd);
    return adapter.getProjectPiConfigPath(scope.cwd);
  }

  function settingsJsonPath(): string {
    return `${dirname(adapter.getPiGlobalConfigPath())}/settings.json`;
  }

  function checkName(name: string): ConfigRefusal | null {
    if (!isValidServerName(name)) {
      return { code: "invalid-name", message: `invalid server name: ${JSON.stringify(name)}` };
    }
    return null;
  }

  function resolveTarget(scope: Scope): { ok: true; path: string } | { ok: false; refusal: ConfigRefusal } {
    try {
      return { ok: true, path: targetPath(scope) };
    } catch (e) {
      if (e instanceof NotAllowedCwdError) {
        return { ok: false, refusal: { code: "not-allowed", message: e.message } };
      }
      throw e;
    }
  }

  function readServerEntry(name: string, scope: Scope): ReadResult {
    const nameRefusal = checkName(name);
    if (nameRefusal) return { ok: false, refusal: nameRefusal };
    const target = resolveTarget(scope);
    if (!target.ok) return target;
    const read = readConfigFile(configIO, target.path);
    if (!read.ok) return { ok: false, refusal: read.refusal };
    const { servers } = resolveServersKey(read.config);
    if (servers === null) {
      return { ok: false, refusal: { code: "unparseable", message: `${target.path}: servers value must be an object`, path: target.path } };
    }
    return { ok: true, entry: servers[name] as ServerEntry | undefined };
  }

  interface PatchOpts {
    /** Always delete the key, regardless of the resulting entry content. */
    deleteEntry?: boolean;
    /** Delete the key when the patched entry has no remaining keys. */
    deleteWhenEmpty?: boolean;
  }

  type PatchResult =
    | { ok: true; entry: Record<string, unknown> | undefined; removed: Record<string, unknown> | undefined }
    | { ok: false; refusal: ConfigRefusal };

  type Prepared =
    | {
        ok: true;
        path: string;
        config: Record<string, unknown>;
        key: "mcpServers" | "mcp-servers";
        servers: Record<string, unknown>;
      }
    | { ok: false; refusal: ConfigRefusal };

  /** Name + target + parse + servers map, or the refusal that stops the write. */
  function prepareWrite(name: string, scope: Scope): Prepared {
    const nameRefusal = checkName(name);
    if (nameRefusal) return { ok: false, refusal: nameRefusal };
    const target = resolveTarget(scope);
    if (!target.ok) return target;
    const read = readConfigFile(configIO, target.path);
    if (!read.ok) return { ok: false, refusal: read.refusal };
    const resolved = resolveServersKey(read.config);
    if (resolved.servers === null) {
      return {
        ok: false,
        refusal: { code: "unparseable", message: `${target.path}: servers value must be an object`, path: target.path },
      };
    }
    return { ok: true, path: target.path, config: read.config, key: resolved.key, servers: resolved.servers };
  }

  function buildEntry(
    existing: Record<string, unknown>,
    set: Record<string, unknown>,
    unset: string[],
  ): Record<string, unknown> {
    const next = nullProto({ ...existing });
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    for (const k of unset) delete next[k];
    return next;
  }

  function applyEntry(
    servers: Record<string, unknown>,
    name: string,
    next: Record<string, unknown>,
    opts: PatchOpts,
  ): Record<string, unknown> {
    const nextServers = nullProto({ ...servers });
    if (opts.deleteEntry || (opts.deleteWhenEmpty && Object.keys(next).length === 0)) {
      delete nextServers[name];
    } else {
      nextServers[name] = next;
    }
    return nextServers;
  }

  /** The existing entry (object) or the `entry-not-object` refusal. */
  function resolveExistingEntry(
    servers: Record<string, unknown>,
    name: string,
    path: string,
  ):
    | { ok: true; entry: Record<string, unknown>; raw: Record<string, unknown> | undefined }
    | { ok: false; refusal: ConfigRefusal } {
    const raw = servers[name];
    if (raw !== undefined && !isPlainObject(raw)) {
      return {
        ok: false,
        refusal: { code: "entry-not-object", message: `${path}: server "${name}" is not an object`, path },
      };
    }
    return {
      ok: true,
      entry: raw === undefined ? nullProto<Record<string, unknown>>({}) : nullProto(raw),
      raw: raw === undefined ? undefined : raw,
    };
  }

  /** Skip the write when the patch is a semantic no-op (leaves mtime intact). */
  function writeIfChanged(
    path: string,
    nextConfig: Record<string, unknown>,
    config: Record<string, unknown>,
  ): ConfigWriteResult {
    if (JSON.stringify(nextConfig) === JSON.stringify(config)) return ok();
    return writeOrRefuse(configIO, path, nextConfig);
  }

  function patchEntry(
    name: string,
    set: Record<string, unknown>,
    unset: string[],
    scope: Scope,
    opts: PatchOpts = {},
  ): PatchResult {
    const prepared = prepareWrite(name, scope);
    if (!prepared.ok) return prepared;
    const { path, config, key, servers } = prepared;
    const existing = resolveExistingEntry(servers, name, path);
    if (!existing.ok) return existing;
    const next = buildEntry(existing.entry, set, unset);

    const refusal = validateResultingEntry(next);
    if (refusal) return { ok: false, refusal };

    const nextServers = applyEntry(servers, name, next, opts);
    const nextConfig = nullProto({ ...config });
    nextConfig[key] = nextServers;
    const write = writeIfChanged(path, nextConfig, config);
    if (!write.ok) return write;

    const stored = nextServers[name];
    return {
      ok: true,
      entry: isPlainObject(stored) ? stored : undefined,
      removed: existing.raw,
    };
  }

  async function setServerDisabled(
    name: string,
    disabled: boolean,
    scope: Scope,
    opts?: { timeoutMs?: number },
  ): Promise<ConfigWriteResult> {
    const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
    if (disabled) {
      const patch = patchEntry(name, { disabled: true }, [], scope);
      return patch.ok ? ok() : patch;
    }
    // Enable: remove `disabled`; delete the entry if it empties. The removal
    // write has landed before the merge is evaluated, so a merge timeout leaves
    // the removal in place and the caller sees the adapter-timeout error.
    const patch = patchEntry(name, {}, ["disabled"], scope, { deleteWhenEmpty: true });
    if (!patch.ok) return patch;

    // Re-evaluate the adapter's full merge EXCLUDING this Pi-owned layer:
    //   - project: the just-written `<cwd>/.pi/mcp.json` no longer disables it.
    //   - global: `overridePath` replaces the Pi-global file — pass a path in the
    //     empty scratch dir (nonexistent) to read every source below it.
    const lowerMerge =
      scope.kind === "project"
        ? await adapter.loadMcpConfig(undefined, scope.cwd, { timeoutMs })
        : await adapter.loadMcpConfig(`${scratchCwd}/mcp.json`, scratchCwd, { timeoutMs });
    const merged = lowerMerge.mcpServers?.[name] as { disabled?: boolean } | undefined;
    if (merged?.disabled === true) {
      const second = patchEntry(name, { disabled: false }, [], scope);
      if (!second.ok) return second;
    }
    return ok();
  }

  function ensureServerEntry(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): ConfigWriteResult {
    const result = patchEntry(name, fields as Record<string, unknown>, [], scope);
    return result.ok ? ok() : result;
  }

  function applyServerPatch(
    name: string,
    set: Partial<ServerEntry>,
    unset: string[],
    scope: Scope,
  ): ConfigWriteResult {
    const result = patchEntry(name, set as Record<string, unknown>, unset, scope);
    return result.ok ? ok() : result;
  }

  function removeServer(name: string, scope: Scope): RemoveResult {
    const result = patchEntry(name, {}, [], scope, { deleteEntry: true });
    if (!result.ok) return result;
    return { ok: true, removed: result.removed as ServerEntry | undefined };
  }

  function setDirectTools(name: string, tools: string[] | undefined, scope: Scope): ConfigWriteResult {
    const hasTools = tools !== undefined && tools.length > 0;
    const result = patchEntry(name, hasTools ? { directTools: tools } : {}, hasTools ? [] : ["directTools"], scope);
    return result.ok ? ok() : result;
  }

  function patchSettings(set: Partial<McpSettings>, unset: string[]): ConfigWriteResult {
    const path = adapter.getPiGlobalConfigPath();
    const read = readConfigFile(configIO, path);
    if (!read.ok) return { ok: false, refusal: read.refusal };
    const config = read.config;
    if (config.settings !== undefined && !isPlainObject(config.settings)) {
      return { ok: false, refusal: { code: "unparseable", message: `${path}: "settings" must be an object`, path } };
    }
    const settings = config.settings === undefined ? nullProto<Record<string, unknown>>({}) : nullProto(config.settings);
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) delete settings[k];
      else settings[k] = v;
    }
    for (const k of unset) delete settings[k];
    const nextConfig = nullProto({ ...config });
    nextConfig.settings = settings;
    if (JSON.stringify(nextConfig) === JSON.stringify(config)) return ok();
    return writeOrRefuse(configIO, path, nextConfig);
  }

  function ensureAdapterPackage(): ConfigWriteResult {
    const path = settingsJsonPath();
    const read = readConfigFile(configIO, path);
    if (!read.ok) return { ok: false, refusal: read.refusal };
    const config = read.config;
    if (config.packages !== undefined && !Array.isArray(config.packages)) {
      return { ok: false, refusal: { code: "unparseable", message: `${path}: "packages" must be an array`, path } };
    }
    const packages = Array.isArray(config.packages) ? (config.packages as unknown[]) : [];
    const already = packages.some((p) => typeof p === "string" && sourcesMatch(p, ADAPTER_PACKAGE_SOURCE));
    if (already) return ok();
    const nextConfig = nullProto({ ...config });
    nextConfig.packages = [...packages, ADAPTER_PACKAGE_SOURCE];
    return writeOrRefuse(configIO, path, nextConfig);
  }

  function previewAdapterPackage(): ConfigRefusal | null {
    const path = settingsJsonPath();
    const read = readConfigFile(configIO, path);
    if (!read.ok) return read.refusal;
    if (read.config.packages !== undefined && !Array.isArray(read.config.packages)) {
      return { code: "unparseable", message: `${path}: "packages" must be an array`, path };
    }
    return null;
  }

  function readParseStatus(path: string): ParseStatus {
    const raw = configIO.readFile(path);
    if (raw === null || raw.trim() === "") return { path, ok: true };
    try {
      const parsed = parseJsonc(raw);
      if (!isPlainObject(parsed)) return { path, ok: false, message: `${path} is not a JSON object` };
      return { path, ok: true };
    } catch (e) {
      return { path, ok: false, message: (e as Error).message };
    }
  }

  function previewEnsure(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): ConfigRefusal | null {
    const prepared = prepareWrite(name, scope);
    if (!prepared.ok) return prepared.refusal;
    const existing = resolveExistingEntry(prepared.servers, name, prepared.path);
    if (!existing.ok) return existing.refusal;
    const next = buildEntry(existing.entry, fields as Record<string, unknown>, []);
    return validateResultingEntry(next);
  }

  return {
    targetPath,
    readServerEntry,
    ensureServerEntry,
    applyServerPatch,
    removeServer,
    setDirectTools,
    setServerDisabled,
    patchSettings,
    ensureAdapterPackage,
    previewEnsure,
    previewAdapterPackage,
    readParseStatus,
    settingsJsonPath,
  };
}
