/**
 * Path-bound containment guard for static analysis.
 *
 * `evaluateContainment` (packages/server/src/access/containment-gate.ts) is async and
 * returns a decision CodeQL cannot see through. File routes therefore branch on this
 * sync predicate right after the `await`; it is modelled as a `js/path-injection`
 * barrier guard in `.github/codeql/extensions/cwd-guard.model.yml`.
 *
 * The decision carries the exact string it decided (`resolved`) and the predicate
 * compares it by strict equality, so a decision for path A can never bless path B.
 * `PathDecision` is branded (type-only): only `containment-gate.ts` casts to it.
 *
 * See change: codeql-file-containment-barrier.
 */

/** Type-only brand: no runtime value exists, so no module can forge a `PathDecision` without a cast. */
export declare const pathDecisionBrand: unique symbol;

/** A containment verdict bound to the path it was made for. Built only by `containment-gate.ts`. */
export interface PathDecision {
  readonly allowed: boolean;
  /** True when the grant layer (not layers ①/②) admitted the path. */
  readonly viaGrant: boolean;
  /** The exact string passed to the decision function. */
  readonly resolved: string;
  readonly [pathDecisionBrand]: true;
}

/**
 * True only when `decision` allowed AND was made for exactly `resolved`. Sync, so
 * static analysis treats a branch on it as a guard for `resolved`.
 */
export function containmentAllows(decision: PathDecision, resolved: string): boolean {
  return decision.allowed === true && decision.resolved === resolved;
}
