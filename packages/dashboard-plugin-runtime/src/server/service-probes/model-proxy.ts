/**
 * Service probe for `model-proxy` — the dashboard's built-in model proxy.
 *
 * Plugins declare `requires.services: ["model-proxy"]`. The probe answers
 * "were the dashboard's `/v1/*` routes mounted at this boot" — nothing more.
 * It performs no HTTP: the dashboard's own `/v1/models` sits behind
 * `createModelProxyAuthGate` (every `/v1/*` request needs a `pi-proxy-*`
 * key), so a self-fetch would 401. Route registration is boot-frozen, so the
 * host hands in `isModelProxyEnabled` mirroring the boot-time
 * `modelProxy.enabled`.
 *
 * See change: remove-pi-model-proxy-upstream-references (D1, D3).
 */

export interface ModelProxyProbeDeps {
  /**
   * The dashboard's boot-time `modelProxy.enabled`. Absent when the host did
   * not wire the dep — reported as `probe not wired`, never a silent pass.
   */
  isModelProxyEnabled?: () => boolean;
}

/**
 * Boolean availability probe consumed by `requirement-probes.ts`. Satisfied
 * iff the host wired the dep AND the `/v1/*` routes were mounted at boot.
 */
export function probeModelProxy(deps: ModelProxyProbeDeps): {
  satisfied: boolean;
  error?: string;
} {
  if (!deps.isModelProxyEnabled) return { satisfied: false, error: "probe not wired" };
  if (!deps.isModelProxyEnabled()) return { satisfied: false, error: "model proxy disabled" };
  return { satisfied: true };
}
