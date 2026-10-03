/**
 * mcp-client-plugin · CORE types.
 *
 * Shared vocabulary for the config writer, effective-view reader, live-state
 * reader and the `mcp-client.config` service — all over pi's built-in MCP
 * config (`~/.pi/agent/mcp.json` + trusted `<cwd>/.pi/mcp.json`). `./core`
 * carries NO host, pi or React imports so the hostless `apple-tools`
 * installer can consume it.
 *
 * See change: migrate-mcp-to-pi-builtin (D3); earlier: extract-mcp-client-plugin.
 */

import type { AuthMode } from "./pi-rules.js";

export type { AuthMode };

/** pi's MCP server entry (1.0.0). Unknown keys are preserved, never dropped. */
export interface ServerEntry {
  type?: "stdio" | "http" | "streamable-http" | string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    callbackPort?: number;
    callbackUrl?: string;
    scope?: string;
    clientName?: string;
    authServerMetadataUrl?: string;
    [k: string]: unknown;
  };
  auth?: { provider: string; [k: string]: unknown };
  exposure?: string;
  toolExposure?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
  [k: string]: unknown;
}

/** Which Pi layer a read/write targets. */
export type Scope = { kind: "global" } | { kind: "project"; cwd: string };

/** Injected filesystem surface. `readFile` returns null when the file is absent. */
export interface ConfigIO {
  readFile: (path: string) => string | null;
  /**
   * Atomic, hardened write (exclusive random temp file mode 0600, fsync, rename).
   * Throws an Error whose `.code` may be EACCES / ENOSPC / ENOENT.
   */
  writeFileAtomic: (path: string, content: string) => void;
}

/** The closed refusal set shared by every write path AND by `checkConfigFiles`. */
export type ConfigRefusalCode =
  | "unparseable"
  | "entry-not-object"
  | "invalid-name"
  | "name-collision"
  | "transport-conflict"
  | "invalid-entry"
  | "write-failed";

export interface ConfigRefusal {
  code: ConfigRefusalCode;
  message: string;
  /** The offending file, when the refusal is file-scoped. */
  path?: string;
  /** For `write-failed`: the IO error code (EACCES / ENOSPC / ENOENT / ...). */
  ioCode?: string;
  /** For `transport-conflict`: the transport fields the resulting entry carries. */
  fields?: string[];
  /** For `name-collision`: the colliding server and where it is defined. */
  conflict?: { name: string; path: string };
}

export type ConfigWriteResult = { ok: true } | { ok: false; refusal: ConfigRefusal };

export type RemoveResult =
  | { ok: true; removed: ServerEntry | undefined }
  | { ok: false; refusal: ConfigRefusal };

/**
 * `written` — the layer now carries the requested state. `omitted` lists the
 * secret-bearing fields a folder-scope DISABLE copy left out.
 * `needs-choice` — an ENABLE of a folder copy that lacks the global entry's
 * secrets: nothing is written; the caller offers "remove the folder entry" or
 * "re-enter the omitted values".
 */
export type SetEnabledResult =
  | { ok: true; action: "written"; omitted?: string[] }
  | { ok: true; action: "needs-choice"; omitted: string[] }
  | { ok: false; refusal: ConfigRefusal };

/** Parse status of one config file (write-suppressed). */
export interface ParseStatus {
  path: string;
  ok: boolean;
  /** Present iff `ok` is false: the parser error message. */
  message?: string;
}

export type Provenance = "pi-global" | "pi-folder";

export type InactiveReason = "disabled" | "project-not-trusted" | "invalid-entry" | "name-collision" | "global-only-auth";

export interface EffectiveServerView {
  name: string;
  provenance: Provenance;
  /** A folder entry that replaces the global entry of the same name. */
  overridesGlobal?: boolean;
  /**
   * The entry as written. In a project view, a GLOBAL entry's secret values
   * (`headers`, `env` → `{redacted, keys}`; `oauth.clientSecret` →
   * `{redacted}`) are redacted server-side; own-layer entries are verbatim.
   */
  entry: Record<string, unknown>;
  transport: "stdio" | "http";
  enabled: boolean;
  /** Exposure for display (alias resolved, default `codemode`). */
  exposure: string;
  /** Whether pi loads this entry for the view's directory. */
  active: boolean;
  inactiveReason?: InactiveReason;
  /** pi's own message when it would reject or drop the entry. */
  piError?: string;
  /** Keys pi ignores on this entry (adapter leftovers, losing dual-transport key). */
  ignoredKeys: string[];
  /** The adapter-only subset of `ignoredKeys`; non-empty → "convert" is offered. */
  adapterLeftovers: string[];
  authMode?: AuthMode;
}

export interface LayerStatus {
  layer: Provenance;
  path: string;
  exists: boolean;
  ok: boolean;
  /** Present iff `ok` is false — pi skips the whole file. */
  message?: string;
}

export interface EffectiveView {
  scope: "global" | "project";
  cwd?: string;
  /** Project views only: pi's trust decision for `cwd` (predicate absent → false). */
  trusted?: boolean;
  servers: EffectiveServerView[];
  layers: LayerStatus[];
}

/** One server's live state as `pi mcp list --json` reports it. */
export interface LiveServerState {
  state: string;
  tools: number;
  error?: string;
}

export type LiveState =
  | { ok: true; servers: Record<string, LiveServerState>; errors: string[]; note?: string }
  | { ok: false; reason: "spawn-failed" | "timeout" | "unparseable"; message: string };

/**
 * Runs `pi mcp list --json` in `cwd`. Resolves with stdout + exit code
 * whatever the code; rejects only when the process cannot run. Must kill the
 * child when `signal` aborts.
 */
export type PiMcpListRunner = (cwd: string, signal: AbortSignal) => Promise<{ stdout: string; code: number | null }>;

/** The in-process service provided as `mcp-client.config`. */
export interface McpClientConfigService {
  /** The file a scope's write lands in. Throws `NotAllowedCwdError` for an unknown cwd. */
  targetPath(scope: Scope): string;
  /** The raw entry in the scope's layer (no merge), or undefined. */
  readServerEntry(name: string, scope: Scope): ServerEntry | undefined;
  getEffectiveView(scope: Scope): EffectiveView;
  /** Merge `fields` over the existing layer entry (or create it), then validate. */
  ensureServerEntry(name: string, fields: Partial<ServerEntry>, scope: Scope): ConfigWriteResult;
  /** Replace the whole entry. `previousName` renames (the old key is removed). */
  saveServer(name: string, entry: ServerEntry, scope: Scope, opts?: { previousName?: string }): ConfigWriteResult;
  removeServer(name: string, scope: Scope): RemoveResult;
  setEnabled(name: string, enabled: boolean, scope: Scope): SetEnabledResult;
  /** `disabled: true` → `enabled: false`; drop every adapter-only key. */
  convertAdapterLeftovers(name: string, scope: Scope): ConfigWriteResult;
  /** Write-suppressed parse + (optional) dry run of `ensureServerEntry` at global scope. */
  checkConfigFiles(opts?: { serverName?: string; fields?: Partial<ServerEntry> }): { mcpJson: ParseStatus };
}
