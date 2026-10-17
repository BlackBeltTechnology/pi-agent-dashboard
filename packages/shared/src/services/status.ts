/**
 * Client-visible shapes of the managed-services REST surface (`/api/services*`).
 * Server (`ServiceManager`) and the Settings → Services pages share these.
 * Never carries a secret value, a lease id or a container id.
 * See change: add-services-settings-ui.
 */
import type { TemplateDiffEntry } from "./offers.js";
import type { DriverName, EnsurePayload, EnsureState, Exposure, ManagedDriverId, ServiceDefinition, UnavailableReason } from "./schema.js";

/** One live lease as an observer sees it — never the `leaseId`. */
export interface LeaseHolder {
  holder?: string;
  /** ISO 8601. */
  expiresAt: string;
}

export interface ServiceStatus {
  id: string;
  mode?: ServiceDefinition["mode"];
  /** Declared drivers of a managed service (prefetch applies to `native`). */
  drivers?: ManagedDriverId[];
  state: EnsureState | "idle" | "stopped" | "stopping";
  reason?: UnavailableReason;
  hint?: string;
  driver?: DriverName;
  endpoints?: Record<string, string>;
  exposure?: Exposure;
  startedBy?: "dashboard" | "external";
  pinned: boolean;
  leases: number;
  /** Live leases, holder text + expiry only. */
  leaseHolders?: LeaseHolder[];
  retryAt?: string;
  restartRequired?: boolean;
  tried?: EnsurePayload["tried"];
  origin?: ServiceDefinition["origin"];
  updateAvailable?: boolean;
  diff?: TemplateDiffEntry[];
  secrets: Record<string, { configured: boolean }>;
  /** Declared secret → where it resolves from (`store:` / `env:` / `keychain:` ref text). */
  secretRefs?: Record<string, string>;
  /** Named volumes the definition declares (reset-data / purge targets). */
  volumes?: string[];
  errors?: string[];
}

export interface ServiceList {
  instanceId?: string;
  definitionsCorrupt?: boolean;
  backupPath?: string;
  secretsCorrupt?: boolean;
  secretsBackupPath?: string;
  /** May the caller use operate-gated routes (and read logs)? */
  canOperate?: boolean;
  services: ServiceStatus[];
}

// ── logs ────────────────────────────────────────────────────────────────────

export const LOGS_UNAVAILABLE_REASONS = [
  "external",
  "duplicate-instances",
  "secrets-changed",
  "no-output",
  "runtime-error",
  "secret-unavailable",
  "secret-too-short",
] as const;
export type LogsUnavailableReason = (typeof LOGS_UNAVAILABLE_REASONS)[number];

export type LogsResponse =
  | { available: true; driver: DriverName; lines: string[]; stale: boolean }
  | { available: false; reason: LogsUnavailableReason; secret?: string };

export const LOGS_DEFAULT_TAIL = 200;
export const LOGS_MAX_TAIL = 2000;
/** Response cap, in bytes of line text. */
export const LOGS_MAX_BYTES = 512 * 1024;
/** Redaction marker prefix/suffix: `«secret:<name>»`. */
export const SECRET_MARK_OPEN = "«secret:";
export const SECRET_MARK_CLOSE = "»";

// ── reset-data / purge ──────────────────────────────────────────────────────

export type VolumeKeepReason = "volume-shared" | "volume-in-use";

export interface VolumeOutcome {
  name: string;
  removed: boolean;
  reason?: VolumeKeepReason | "remove-failed";
}

export interface ResetDataResult {
  volumes: VolumeOutcome[];
}

export const RESET_DATA_ERROR_CODES = ["not-resettable", "no-data", "runtime-unreachable"] as const;

// ── prune ───────────────────────────────────────────────────────────────────

export interface PruneCandidate {
  /** `run-dir` = `services-run/<id>/`; `container` = an owned labelled container. */
  kind: "run-dir" | "container";
  id: string;
  /** Container id (kind `container`). */
  containerId?: string;
  runtime?: "docker" | "podman";
}

export interface PruneSkipped {
  id: string;
  kind: PruneCandidate["kind"];
  reason: string;
}

export type PruneRequest = { dryRun: true } | { dryRun: false; ids: string[] };

export type PruneResult =
  | { dryRun: true; candidates: PruneCandidate[]; skipped: PruneSkipped[]; unreachableRuntimes: Array<"docker" | "podman"> }
  | { dryRun: false; removed: string[]; skipped: PruneSkipped[] };

// ── add review / offers / runtimes ──────────────────────────────────────────

/** What `POST /api/services` (dry run) shows before anything is written. */
export interface AddReview {
  id: string;
  mode: ServiceDefinition["mode"];
  drivers?: ManagedDriverId[];
  image?: string;
  recipe?: { runner: string; package: string; bin?: string; args: string[] };
  ports: string[];
  volumes: string[];
  binds: string[];
  secrets: string[];
  /** Where each secret comes from (ref or store slot) — shown so a cross-reference cannot hide. */
  secretSources: Record<string, string>;
  templateHash?: string;
  diff?: TemplateDiffEntry[];
  /** Native packages are fetched only by an explicit prefetch. */
  needsPrefetch?: boolean;
}

export interface OfferSummary {
  ref: string;
  package: string;
  version: string;
  id: string;
  mode: string;
  templateHash: string;
  added: boolean;
}

export interface OffersResponse {
  offers: OfferSummary[];
  errors: string[];
}

export type RuntimeCapability = "ok" | "ok-destructive" | "cli-present" | "needs-secret" | "unavailable" | "unsupported";

export interface RuntimeReport {
  id: "docker" | "podman" | "qemu" | "virtualbox" | "vmware";
  kind: "container" | "hypervisor";
  installed: boolean;
  version?: string;
  /** Container runtimes only. */
  reachable?: boolean;
  hostVm?: "running" | "stopped" | "none" | "unknown";
  capabilities: Record<string, RuntimeCapability>;
}
