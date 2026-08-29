/**
 * Server-derived OpenSpec readiness fold.
 *
 * Folds every input the server already holds — global enablement, per-cwd
 * opt-out, poll phase, directory presence, authoritative-data availability,
 * pi-skills presence, and update-signature staleness — into one
 * `{ state, reason }` value broadcast on `OpenSpecData`. Clients render it;
 * they never re-derive it from the raw signals.
 *
 * Precedence (first match wins) — see change: add-openspec-init-affordances:
 *   1. GLOBAL_OFF  — openspec.enabled === false
 *   2. OPTED_OUT   — cwd listed in openspec.optOutDirectories
 *   3. PENDING     — a poll is in flight
 *   4. ABSENT      — <cwd>/openspec/ does not exist
 *   5. BROKEN      — `openspec list` did not yield authoritative data
 *   6. STALE       — skills missing, or a recorded signature differs from the
 *                    current global signature (missing-skills wins over
 *                    profile-stale)
 *   7. READY       — otherwise
 */

import type {
  OpenSpecData,
  OpenSpecReadiness,
  OpenSpecReadinessReason,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Everything `deriveOpenSpecReadiness` needs beyond the polled data itself. */
export interface ReadinessInputs {
  /** `openspec.enabled` — the master gate. */
  enabled: boolean;
  /** cwd is listed in `openspec.optOutDirectories`. */
  optedOut: boolean;
  /** Transitional poll-in-flight flag. */
  pending: boolean;
  /** `<cwd>/openspec/` exists. */
  hasOpenspecDir: boolean;
  /** `openspec list` yielded authoritative data. */
  initialized: boolean;
  /** `.pi/skills/openspec-explore/` exists at the resolved config root. `undefined` = unknown. */
  hasOpenSpecSkills?: boolean;
  /** Signature recorded for this cwd by a prior init/update. `undefined` = never measured. */
  recordedSignature?: string;
  /**
   * Current global workflow-set signature. `undefined` = unknown / provider
   * failed this tick — the signature-staleness check is skipped so no cwd is
   * ever falsely marked STALE. See change: add-openspec-init-affordances.
   */
  currentSignature?: string;
}

/**
 * Why a BROKEN cwd is broken. Both causes surface as `initialized: false` in
 * `directory-service`; only `missing-changes-dir` is remediable by re-running
 * init. Exported for the poll pass that observes which branch fired.
 */
export type BrokeReason = Extract<OpenSpecReadinessReason, "missing-changes-dir" | "cli-failed">;

/**
 * Derive the readiness fold. `extra.breakReason` records which
 * `initialized: false` branch the poll observed; it only shapes the BROKEN
 * reason and never overrides a higher-precedence state.
 */
export function deriveOpenSpecReadiness(
  inputs: ReadinessInputs,
  // The polled payload rides along so future fold inputs can come off it
  // without a call-site change; today the fold reads only `inputs`.
  _data: OpenSpecData,
  extra: { breakReason?: BrokeReason } = {},
): OpenSpecReadiness {
  if (!inputs.enabled) return { state: "GLOBAL_OFF" };
  if (inputs.optedOut) return { state: "OPTED_OUT" };
  if (inputs.pending) return { state: "PENDING" };
  if (!inputs.hasOpenspecDir) return { state: "ABSENT" };
  if (!inputs.initialized) return { state: "BROKEN", reason: extra.breakReason ?? "cli-failed" };
  if (inputs.hasOpenSpecSkills === false) return { state: "STALE", reason: "missing-skills" };
  if (
    inputs.recordedSignature !== undefined &&
    inputs.currentSignature !== undefined &&
    inputs.recordedSignature !== inputs.currentSignature
  ) {
    return { state: "STALE", reason: "profile-stale" };
  }
  return { state: "READY" };
}
