/**
 * `/api/health` counters for access-grant prompting (design D11; task 9.3).
 *
 * The transition log says what happened to one denial; these counters say what
 * the feature is doing overall, so an operator can tell "prompting is off", "the
 * Host gate is in report mode", "a requester is being rate-limited" and "YOLO
 * is answering" apart without reading logs. Every degrade and flood reason is
 * counted separately, so starvation by one requester is distinguishable from a
 * global cap (test-plan #E23).
 *
 * See change: add-access-grant-dialog.
 */
import type { GrantCoordinator } from "./grant-coordinator.js";
import type { GrantRegistryStats } from "./pending-grant-registry.js";
import type { HostGateMode } from "./prompt-channel.js";
import type { YoloController } from "./yolo-session.js";

export interface AccessGrantHealth {
  prompting: {
    /** `accessGrants.promptEnabled`, live. */
    enabled: boolean;
    /** `PI_DASHBOARD_DISABLE_GRANT_PROMPT=1`. */
    killSwitch: boolean;
    /** Live Host-admission mode; `report` means no prompt on any plane. */
    hostGateMode: HostGateMode;
    /** Capability-holding operator sockets connected now. */
    operatorChannels: number;
  };
  /** Pending entries now, and cumulative transition counters. */
  registry: GrantRegistryStats & { pending: number };
  yolo: {
    active: boolean;
    source: "operator" | "env" | null;
    unscoped: boolean;
    roots: number;
    /** Epoch ms; `null` when inactive or for the process-lifetime env session. */
    expiresAt: number | null;
    autoAllowed: number;
    refusedByPriorRefusal: number;
  };
  /** Remembered explicit refusals (the durable ledger). */
  refusals: number;
}

export interface AccessGrantHealthDeps {
  coordinator: Pick<GrantCoordinator, "registry">;
  yolo: Pick<YoloController, "status" | "counters">;
  refusalCount(): number;
  promptEnabled(): boolean;
  killSwitch(): boolean;
  hostGateMode(): HostGateMode;
  operatorChannels(): number;
}

export function snapshotAccessGrantHealth(deps: AccessGrantHealthDeps): AccessGrantHealth {
  const session = deps.yolo.status();
  const totals = deps.yolo.counters();
  return {
    prompting: {
      enabled: deps.promptEnabled(),
      killSwitch: deps.killSwitch(),
      hostGateMode: deps.hostGateMode(),
      operatorChannels: deps.operatorChannels(),
    },
    registry: { ...deps.coordinator.registry.snapshotStats(), pending: deps.coordinator.registry.size },
    yolo: {
      active: session !== null,
      source: session?.source ?? null,
      unscoped: session?.unscoped ?? false,
      roots: session?.roots.length ?? 0,
      expiresAt: session?.expiresAt ?? null,
      autoAllowed: totals.autoAllowed,
      refusedByPriorRefusal: totals.refusedByPriorRefusal,
    },
    refusals: deps.refusalCount(),
  };
}
