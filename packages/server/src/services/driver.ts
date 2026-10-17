/**
 * Driver contract (D1). One manager, pluggable drivers; the manager branches
 * on what a driver can do (`canStart` / `canStop`), never on its id.
 * See change: add-service-registry-core.
 */
import type {
  DriverName,
  ServiceDefinition,
  UnavailableReason,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { VolumeOutcome } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";

/** A running (or adopted) instance as the manager tracks it. */
export interface DriverInstance {
  driver: DriverName;
  startedBy: "dashboard" | "external";
  endpoints: Record<string, string>;
  /** `pi.def-hash` the instance was created from (restartRequired check). */
  defHash?: string;
  /** Container id (oci). */
  containerId?: string;
  /** Process / group leader pid (native, attached-started). */
  pid?: number;
  /** podman-machine SSH forward owned by this instance. */
  tunnelPid?: number;
}

export type PresenceResult = { ok: true } | { ok: false; reason: UnavailableReason; hint?: string };

export type AdoptResult =
  | { kind: "none" }
  | { kind: "running"; instance: DriverInstance }
  | { kind: "stopped" }
  | { kind: "unavailable"; reason: UnavailableReason; hint?: string };

export interface StartContext {
  /** Resolved secret values, name → value. Delivered only via the driver's channel. */
  secrets: Record<string, string>;
  defHash: string;
  instanceId: string;
}

export type StopOutcome = "stopped" | "stop-failed";

/** What the logs route asks a driver for. `lines` = M (window incl. multi-line secret overlap). */
export interface LogsRequest {
  instanceId: string;
  lines: number;
  /** `start.json` `startedAt` — an OCI driver reads only the current run. */
  startedAt: string;
}

export type DriverLogs =
  | { ok: true; text: string }
  | { ok: false; reason: "no-output" | "runtime-error" | "duplicate-instances" };

/** Outcome of one runtime's share of a reset-data. */
export type ResetDataOutcome =
  | { kind: "na" }
  | { kind: "unreachable" }
  | { kind: "busy" }
  | { kind: "rm-failed" }
  | { kind: "ok"; volumes: VolumeOutcome[] };

export interface OwnedContainer {
  /** `pi.service` label. */
  serviceId: string;
  containerId: string;
  running: boolean;
}

export type OwnedListing = { state: "absent" } | { state: "unreachable" } | { state: "ok"; containers: OwnedContainer[] };

export interface ServiceDriver {
  readonly name: DriverName;
  /** Offline presence: runtime / image / package / runner. Never fetches. */
  presence(def: ServiceDefinition): Promise<PresenceResult>;
  canStart(def: ServiceDefinition): boolean;
  canStop(def: ServiceDefinition): boolean;
  start(def: ServiceDefinition, ctx: StartContext): Promise<DriverInstance>;
  /** Is the instance's process / container alive? `unknown` when unobservable. */
  isAlive(def: ServiceDefinition, inst: DriverInstance): Promise<boolean | "unknown">;
  /** Stop and CONFIRM by observation within `stopTimeoutMs`. */
  stop(
    def: ServiceDefinition,
    inst: DriverInstance | undefined,
    stopTimeoutMs: number,
    opts?: { force?: boolean; instanceId?: string },
  ): Promise<StopOutcome>;
  /** Find an existing instance (read-only). */
  adopt(def: ServiceDefinition, instanceId: string): Promise<AdoptResult>;
  /** Remove everything the driver created for `def` (containers, instance files, volumes on purge). */
  remove(
    def: ServiceDefinition,
    instanceId: string,
    opts: { purgeData: boolean; sharedVolumes?: ReadonlySet<string> },
  ): Promise<unknown>; // purge: `{ volumes?: VolumeOutcome[] }` — the per-volume outcome list
  /** OCI only: the image HEALTHCHECK status of a running container. */
  healthcheck?(def: ServiceDefinition, inst: DriverInstance): Promise<boolean>;
  /** OCI only: does the image declare a HEALTHCHECK (validated at add)? */
  imageHasHealthcheck?(def: ServiceDefinition): Promise<boolean | undefined>;
  /** Host probe failed: try a host-reachability fallback (podman-machine tunnel). */
  onProbeFailed?(def: ServiceDefinition, inst: DriverInstance): Promise<DriverInstance | null>;
  /** The captured output of the CURRENT run, `req.lines` lines at most. */
  logs?(def: ServiceDefinition, inst: DriverInstance | undefined, req: LogsRequest): Promise<DriverLogs>;
  /** OCI only: remove owned containers, then the declared volumes under the shared volume guard. */
  resetData?(def: ServiceDefinition, instanceId: string, sharedVolumes: ReadonlySet<string>): Promise<ResetDataOutcome>;
  /** OCI only: containers labelled with this installation's `pi.owner`. */
  listOwned?(instanceId: string): Promise<OwnedListing>;
  /** OCI only: plain (never forced) removal of stopped containers; true when all are gone. */
  removeContainers?(ids: string[]): Promise<boolean>;
}
