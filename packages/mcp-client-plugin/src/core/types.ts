/**
 * mcp-client-plugin · CORE types.
 *
 * Shared vocabulary for the config writer, effective-view reader, adapter
 * verdict probe, and the `mcp-client.config` service. `./core` carries NO host
 * or React imports so the hostless `apple-tools` installer can consume it.
 * See change: extract-mcp-client-plugin (design D1-D4).
 */

import type { ConfigDiscoveryPath } from "pi-mcp-adapter/config";
import type {
  McpConfig,
  McpSettings,
  ServerEntry,
  ServerProvenance,
} from "pi-mcp-adapter/types";

export type { ConfigDiscoveryPath, McpConfig, McpSettings, ServerEntry, ServerProvenance };

/** Which Pi-owned layer a write targets. */
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
  | "transport-conflict"
  | "write-failed"
  /** Admission refusal for a project scope outside the known-folder set. */
  | "not-allowed";

export interface ConfigRefusal {
  code: ConfigRefusalCode;
  message: string;
  /** The offending file, when the refusal is file-scoped. */
  path?: string;
  /** For `write-failed`: the IO error code (EACCES / ENOSPC / ENOENT / ...). */
  ioCode?: string;
  /** For `transport-conflict`: the transport fields the resulting entry carries. */
  fields?: string[];
}

export type ConfigWriteResult =
  | { ok: true }
  | { ok: false; refusal: ConfigRefusal };

export type ReadResult =
  | { ok: true; entry: ServerEntry | undefined }
  | { ok: false; refusal: ConfigRefusal };

export type RemoveResult =
  | { ok: true; removed: ServerEntry | undefined }
  | { ok: false; refusal: ConfigRefusal };

/** Parse status of one config file (write-suppressed). */
export interface ParseStatus {
  path: string;
  ok: boolean;
  /** Present iff `ok` is false: the parser error message. */
  message?: string;
}

/** Adapter load deadline, in ms. */
export interface LoadOptions {
  timeoutMs: number;
}

/** Adapter version verdict — `unknown` is used by consumers when the service is absent. */
export interface AdapterVerdict {
  kind: "ok" | "absent" | "below-floor" | "unparseable" | "unknown";
  installed?: string;
  floor: string;
  message?: string;
}

/**
 * The adapter's config surface, injected so unit tests run hermetically and the
 * real implementation can execute its synchronous loaders in a worker thread.
 *
 * Loading functions are async and take a deadline; the pure path helpers are
 * synchronous and never spawn the worker.
 */
export interface AdapterPort {
  loadMcpConfig(
    overridePath: string | undefined,
    cwd: string,
    opts: LoadOptions,
  ): Promise<McpConfig>;
  getServerProvenance(
    overridePath: string | undefined,
    cwd: string,
    opts: LoadOptions,
  ): Promise<Map<string, ServerProvenance>>;
  getConfigDiscoveryPaths(
    overridePath: string | undefined,
    cwd: string,
  ): ConfigDiscoveryPath[];
  /** `<PI_CODING_AGENT_DIR>/mcp.json` (or `~/.pi/agent/mcp.json`). */
  getPiGlobalConfigPath(): string;
  /** `<cwd>/.pi/mcp.json`. */
  getProjectPiConfigPath(cwd: string): string;
}

/** The in-process service provided as `mcp-client.config`. */
export interface McpClientConfigService {
  adapterVerdict(opts?: { fresh?: boolean }): AdapterVerdict;
  readServerEntry(name: string, scope: Scope): ServerEntry | undefined;
  ensureServerEntry(
    name: string,
    fields: Partial<ServerEntry>,
    scope: Scope,
  ): ConfigWriteResult;
  setServerDisabled(
    name: string,
    disabled: boolean,
    scope: Scope,
    opts?: { timeoutMs?: number },
  ): Promise<ConfigWriteResult>;
  setDirectTools(
    name: string,
    tools: string[] | undefined,
    scope: Scope,
  ): ConfigWriteResult;
  removeServer(name: string, scope: Scope): RemoveResult;
  ensureAdapterPackage(): ConfigWriteResult;
  checkConfigFiles(opts?: {
    serverName?: string;
    fields?: Partial<ServerEntry>;
  }): { mcpJson: ParseStatus; settingsJson: ParseStatus };
}
