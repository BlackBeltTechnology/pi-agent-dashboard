/**
 * Pure peer-presence probe.
 *
 * Extracted as a standalone module so the bridge entry's activation logic is
 * unit-testable without a running pi runtime. The probe is sync, side-effect
 * free, and deterministic given a `resolve` function.
 *
 * Two-tier resolution (see change: add-shared-pi-package-resolver):
 *   - Tier 1: `deps.resolve(spec)` — Node's `createRequire(cwd).resolve`,
 *     finds peers in `node_modules` reachable from cwd.
 *   - Tier 2 (optional): `deps.resolvePiPackage(spec)` — walks pi's own
 *     `settings.json#packages[]` entries (npm/git/local install kinds),
 *     returns an absolute entry path. Used when tier 1 throws
 *     `MODULE_NOT_FOUND` for peers installed exclusively via pi.
 *
 * The caller decides what to do with `via` / `entryPath`:
 *   - `via === "node"`     → `await import("@pi/...")` (bare specifier)
 *   - `via === "pi-packages"` → `await import(entryPath!)` (absolute path)
 */

import { PEER_AM_LEGACY } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/anthropic-peer-names.js";

export const PEER_AM = "@blackbelt-technology/pi-anthropic-messages";
/** Legacy pre-rescope module name, still probed for back-compat. Defined in shared; re-exported. */
export { PEER_AM_LEGACY };
/** All anthropic-messages specifiers to probe, new name first. */
export const PEER_AM_NAMES = [PEER_AM, PEER_AM_LEGACY] as const;
export const PEER_FLOWS = "pi-flows";

export interface PeerProbe {
  ok: boolean;
  reason?: string;
  /** Which tier produced the hit when `ok === true`. */
  via?: "node" | "pi-packages";
  /** Absolute entry path when `via === "pi-packages"`. */
  entryPath?: string;
}

export interface ProbeResult {
  am: PeerProbe;
  flows: PeerProbe;
  bothPresent: boolean;
}

export interface ProbeDeps {
  /** Synchronous module-spec resolver (typically `createRequire(...).resolve`). */
  resolve: (spec: string) => string;
  /**
   * Optional tier-2 fallback: walks pi's settings.json and returns an
   * absolute entry path when a peer is installed via pi but not reachable
   * from Node's cwd-anchored module resolution. See
   * `@blackbelt-technology/pi-dashboard-shared/pi-package-resolver`.
   */
  resolvePiPackage?: (spec: string) => { entryPath: string } | null;
  /** Optional pi-flows event-listener counter as a backup signal. */
  flowsListenerCount?: () => number;
}

function probePeer(spec: string, deps: ProbeDeps): PeerProbe {
  // Tier 1: Node's resolver (synchronous, throws on miss).
  try {
    deps.resolve(spec);
    return { ok: true, via: "node" };
  } catch (e) {
    var tier1Reason = (e as Error).message;
  }
  // Tier 2: pi-packages fallback (returns null on miss, never throws).
  const hit = deps.resolvePiPackage?.(spec);
  if (hit && typeof hit.entryPath === "string" && hit.entryPath.length > 0) {
    return { ok: true, via: "pi-packages", entryPath: hit.entryPath };
  }
  return { ok: false, reason: tier1Reason };
}

/**
 * Probe both peers. pi-flows is considered present if EITHER its module
 * resolves (tier 1 or tier 2) OR there is at least one active listener for
 * the `flow:register-agent-extension` event (covers cases where pi-flows is
 * loaded under a different module spec than the canonical "pi-flows").
 */
export function probeAll(deps: ProbeDeps): ProbeResult {
  // Probe the current name first, then the legacy pre-rescope name. Keep
  // the last probe result so the failure reason surfaces when neither hits.
  let am: PeerProbe = { ok: false, reason: "not probed" };
  for (const name of PEER_AM_NAMES) {
    am = probePeer(name, deps);
    if (am.ok) break;
  }
  const flowsModule = probePeer(PEER_FLOWS, deps);
  const flowsListener = (deps.flowsListenerCount?.() ?? 0) > 0;
  const flows: PeerProbe = flowsModule.ok
    ? flowsModule
    : flowsListener
    ? { ok: true, via: "node", reason: "via flow:register-agent-extension listener" }
    : { ok: false, reason: flowsModule.reason ?? "pi-flows event listeners absent" };
  return { am, flows, bothPresent: am.ok && flows.ok };
}
