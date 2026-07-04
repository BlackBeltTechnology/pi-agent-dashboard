/**
 * Shared protocol types for the kb-plugin (client ⇄ server REST contract).
 *
 * Type-only import of KbConfig/SourceConfig from the Layer-1 engine
 * (`@blackbelt-technology/pi-dashboard-kb`) — no runtime coupling.
 * See change: add-kb-folder-slot.
 */
import type { KbConfig, SourceConfig } from "@blackbelt-technology/pi-dashboard-kb";

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
}

/** Response shape of `POST /api/kb/reindex?cwd=` — the job was registered
 *  (fresh start) or coalesced onto a running one; poll `/stats` for completion. */
export interface KbReindexRunning {
  status: "running";
  jobId: string;
}

/** Response shape of `GET /api/kb/config?cwd=`. */
export interface KbConfigResponse {
  config: KbConfig;
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
}

export type { KbConfig, SourceConfig };
