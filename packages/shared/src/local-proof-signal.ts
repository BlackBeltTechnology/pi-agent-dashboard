/**
 * `GET /api/health` carries `localProof: "required"` ONLY for a bare-loopback caller
 * that the strict default (`requireLocalProof`) refuses for want of local proof — the
 * remedy is `pi-dashboard open`. Absent for every other caller.
 *
 * Its own dependency-free module (not `rest-api.ts`) because the browser client reads it too,
 * and a client bundle must not value-import a node-only shared module.
 *
 * See change: close-container-loopback-impersonation (D3).
 */
export const LOCAL_PROOF_REQUIRED = "required" as const;

/** The additive `/api/health` field described by {@link LOCAL_PROOF_REQUIRED}. */
export interface HealthLocalProofField {
  localProof?: typeof LOCAL_PROOF_REQUIRED;
}
