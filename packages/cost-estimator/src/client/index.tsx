/**
 * cost-estimator · CLIENT entry (intentionally empty).
 *
 * Both claims (`CostView` command-route, `CostSettings` settings-section) load
 * lazily from `./CostEstimator.tsx` via the manifest `module` field. Do NOT
 * re-export them here: the registry generator rejects a main entry that also
 * exports a lazy component.
 *
 * See change: lazy-plugin-claim-modules.
 */
export {};
