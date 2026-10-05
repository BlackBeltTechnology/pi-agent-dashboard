/**
 * Shared protocol types for the kb-plugin (client ⇄ server REST contract).
 *
 * Type-only import of KbConfig/SourceConfig from the Layer-1 engine
 * (`@blackbelt-technology/pi-dashboard-kb`) — no runtime coupling.
 * See change: add-kb-folder-slot.
 */
import type { KbConfig, ResolvedConfig, SourceConfig } from "@blackbelt-technology/pi-dashboard-kb";

export const KB_PLUGIN_ID = "kb";

/** Reindex job lifecycle state exposed to the client via `/stats`. */
export type KbJobStatus = "idle" | "running" | "error";

/** Response shape of `GET /api/kb/stats?cwd=`. */
export interface KbStats {
  files: number;
  chunks: number;
  /** `chunks > 0`. */
  indexed: boolean;
  /** Drifted source files from `dox-staleness.json` (source files only, NOT md). */
  staleCount: number;
  /** A reindex job is currently running for this cwd (`jobStatus === "running"`). */
  indexing: boolean;
  /** Last/current reindex job state; drives the row's error-vs-not-indexed split. */
  jobStatus: KbJobStatus;
  /** Error string from the last failed job (present iff `jobStatus === "error"`). */
  lastError?: string;
}

/** Result of a completed reindex walk — the registry's `done` record (from
 *  `reindexAll`), NOT the POST wire shape. `POST /api/kb/reindex` is now
 *  non-blocking and always returns {@link KbReindexRunning}; completion is read
 *  back via `GET /stats`. See change: fix-kb-index-feedback. */
export interface KbReindexResult {
  changed: number;
  chunks: number;
  /** Per-source outcome of the walk (server-internal; not on the /stats or /reindex wire). */
  outcomes?: KbSourceOutcome[];
}

/** Outcome of one source in a reindex walk. `untrusted` = skipped (no trust record); never fatal. */
export interface KbSourceOutcome {
  ref: string;
  status: "ok" | "untrusted" | "error";
  error?: string;
  revision?: string;
  /** Epoch ms the source settled. */
  at: number;
}

/** One configured source as shown on the settings page. `GET /api/kb/sources?cwd=`. */
export interface KbSourceStatus {
  ref: string;
  kind: "filesystem" | "npm" | "git" | "https";
  /** Indexed files under this source's root (0 when unindexed). */
  files: number;
  /** `null` for filesystem sources (no trust concept). */
  trusted: boolean | null;
  /** Filesystem ref resolving outside the folder. */
  outside: boolean;
  lastStatus?: KbSourceOutcome["status"];
  lastError?: string;
  revision?: string;
  lastAt?: number;
}

export interface KbSourcesResponse {
  sources: KbSourceStatus[];
}

export type KbSearchDocType = "doc" | "agents" | "source-md";

export interface KbSearchHit {
  root: string;
  path: string;
  headingPath: string;
  chunkId: string;
  snippet: string;
  score: number;
  docType: KbSearchDocType;
  suppressedSections?: number;
}

/** Response of `GET /api/kb/search?cwd=&q=&limit=&docType=` (saved index, read-only). */
export interface KbSearchResponse {
  hits: KbSearchHit[];
  tookMs: number;
  /** Index schema predates the engine; rebuild before searching. */
  needsReindex?: true;
}

/** Response of `POST /api/kb/source-trust?cwd=`. */
export interface KbTrustGrantResponse {
  hash: string;
  subject: string;
}

/** Response shape of `POST /api/kb/reindex?cwd=` — the job was registered
 *  (fresh start) or coalesced onto a running one; poll `/stats` for completion. */
export interface KbReindexRunning {
  status: "running";
  jobId: string;
}

/** Response shape of `GET /api/kb/config?cwd=`. `config` is the engine's
 *  `ResolvedConfig` (`loadConfig(cwd)` output — the server has always returned
 *  it, cast wide). `resolvedSources` composes the NARROW `config.ts`
 *  `ResolvedSource` (id/dir/priority), NOT the wide publicly-re-exported
 *  `sources.ts` one (identity/revision) — see change: fix-kb-settings-reindex-gate. */
export interface KbConfigResponse {
  config: ResolvedConfig;
  origin: "project" | "global" | "defaults";
  projectPath: string;
}

/** Body of `PUT /api/kb/config?cwd=` — the v1 editable path fields only. */
export interface KbConfigPatch {
  sources?: SourceConfig[];
  include?: string[];
  exclude?: string[];
  dbPath?: string;
  /** When true, kick a reindex after a successful write. */
  reindex?: boolean;
  /** Refs (of saved remote sources) to trust in the same write. Applied only after a valid write. */
  trustRefs?: string[];
}

/** Response of `PUT /api/kb/config` — `untrustedRefs` is additive. */
export interface KbConfigPutResponse extends KbConfigResponse {
  /** `trustRefs` entries that could not be granted (unmatched, ambiguous, filesystem, persist failure). */
  untrustedRefs?: string[];
}

export type { KbConfig, SourceConfig };
