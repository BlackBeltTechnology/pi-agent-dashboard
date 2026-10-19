/**
 * Network trust mode: does a peer-IP match against `trustedNetworks` /
 * `auth.bypassHosts` authenticate a request (`legacy`), or does it only make the
 * peer eligible to ask for access (`pair`)?
 *
 * One live source for every admission site: {@link admissionTrustedNetworks}
 * yields the configured list under `legacy` and `[]` under `pair`, read per
 * request through the mtime-gated config snapshot, so an operator change (and a
 * list edit) applies without a restart and no site can hold a stale copy.
 *
 * `decideBootTrustMode` (`trust-mode-boot.ts`, kept apart so this read-only module
 * stays free of the config writer's import graph) runs ONCE before the server listens: when no mode
 * is stored it picks `pair` iff every listed entry is loopback-only, else
 * `legacy`, and persists it with origin `upgrade`. The mode is never re-derived
 * from the list afterwards, so adding a range can never widen admission.
 *
 * See change: retire-trusted-networks-bypass (design D1, D2).
 */
import {
  type DashboardConfig,
  resolveTrustMode,
  type TrustMode,
  type TrustModeOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { getConfigSnapshot } from "../config-snapshot.js";

/**
 * Process-level fallback: the decided mode when it could not be persisted, or
 * `legacy` when the config file is unparseable. Consulted ONLY while the stored
 * configuration holds no recognised `network.trustMode` (a stored value always
 * wins, so a later successful operator save applies live).
 */
let bootFallback: TrustMode | null = null;
/** Unrecognised stored values already warned about (once per process per value). */
const warnedUnrecognised = new Set<string>();

/** Record the process-level fallback (boot decision only). */
export function setBootTrustFallback(mode: TrustMode | null): void {
  bootFallback = mode;
}

/** Test seam: forget the boot fallback and the warned set. */
export function resetTrustModeForTests(): void {
  bootFallback = null;
  warnedUnrecognised.clear();
}

export interface EffectiveTrustMode {
  mode: TrustMode;
  /** `null` for an unrecognised stored value, or when only the fallback applies. */
  origin: TrustModeOrigin | null;
}

/** Effective mode from an already-read config (shared by the single-snapshot paths). */
function trustModeOf(config: DashboardConfig): EffectiveTrustMode {
  const resolved = resolveTrustMode(config);
  if (resolved.unrecognised !== null && !warnedUnrecognised.has(resolved.unrecognised)) {
    warnedUnrecognised.add(resolved.unrecognised);
    console.warn(
      `[trusted-networks] unrecognised network.trustMode ${JSON.stringify(resolved.unrecognised)} — treating as "pair" (fail closed); fix it from Settings → Security`,
    );
  }
  if (resolved.mode !== null) return { mode: resolved.mode, origin: resolved.origin };
  // Nothing stored. Before the boot decision has run (or with no server at all)
  // this is today's behaviour — `legacy` — never a lockout.
  return { mode: bootFallback ?? "legacy", origin: null };
}

/** The effective trust mode as of this request (live, no restart). */
export function effectiveTrustMode(): EffectiveTrustMode {
  return trustModeOf(getConfigSnapshot());
}

/**
 * The ONE list every admission site matches a peer against: the configured
 * trusted networks in `legacy`, `[]` in `pair`. `fallback` is the boot list for
 * callers that hold one; the snapshot wins whenever it parsed.
 */
export function admissionTrustedNetworks(fallback: string[] = []): string[] {
  const snapshot = getConfigSnapshot();
  if (trustModeOf(snapshot).mode === "pair") return [];
  return snapshot.resolvedTrustedNetworks ?? fallback;
}
