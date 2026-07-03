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

/** Response shape of `POST /api/kb/reindex?cwd=` — sync completion. */
export interface KbReindexResult {
  changed: number;
  chunks: number;
}

/** Response shape of `POST /api/kb/reindex?cwd=` — coalesced onto a running job. */
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
