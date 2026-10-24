## ADDED Requirements

### Requirement: Containment decisions are bound to the path they decided

`evaluateContainment` SHALL return, on every outcome (including the dashboard-secret refusal, the post-hold re-evaluation allow and a `quiet` refusal), the exact `resolved` string it was asked to decide, in addition to `allowed` and `viaGrant`. `@blackbelt-technology/pi-dashboard-shared` SHALL export `containmentAllows(decision, resolved)`, a synchronous predicate that returns true only when `decision.allowed` is true AND `decision.resolved` is exactly equal to `resolved`; its `decision` parameter SHALL be a branded type that only `containment-gate.ts` constructs. `containment-gate.ts` SHALL also export `decidePassive(resolved, anchors, { allowGrant })` for sites that consume grants without originating a denial: it decides on layers ①/② and, only with `allowGrant`, the grant layer, records no denial, holds nothing, and returns the same decision shape. Every containment site SHALL admit a path only when `containmentAllows(decision, resolved)` is true, and SHALL use the same `resolved` string for the read or serve that follows. A refusal keeps its existing form: a 403 body at body-bearing sites, a filtered-out match in `grep-routes.ts`, a `null` mention in `resolve-file-mention.ts`. Allowed paths, refused paths, refusal bodies, status codes, per-site anchors, the Layer-③ artifact-root order at the raw site, grant consumption and the suspend/hold flow SHALL be unchanged.

#### Scenario: A decision for one path does not admit another
- **WHEN** `containmentAllows` is called with a decision for `/p/a.txt` and the path `/p/b.txt`
- **THEN** it returns false

#### Scenario: An allowed decision for the same path admits it
- **WHEN** `evaluateContainment` allows `/p/a.txt` and the site calls `containmentAllows(decision, "/p/a.txt")`
- **THEN** it returns true and the read proceeds exactly as before

#### Scenario: A refused decision never admits
- **WHEN** the decision is refused (including the dashboard-secret refusal)
- **THEN** `containmentAllows` returns false for every path and the site answers its existing refusal

#### Scenario: Static analysis recognises the guard
- **WHEN** CodeQL analyses a handler that branches on `containmentAllows(decision, resolved)` before reading `resolved`
- **THEN** the guarded read is not reported as `js/path-injection`, while an unguarded read, a read of a different path, and a decision that is never branched on are still reported

#### Scenario: An operator-approved held read is still admitted
- **WHEN** a read is refused, suspended, the operator allows it, and the re-evaluation allows it
- **THEN** the returned decision carries the same `resolved` and `containmentAllows` is true, so the read is served as before

#### Scenario: Passive sites keep consuming grants
- **WHEN** a grep match or a file mention is outside the anchors but covered by a grant
- **THEN** `decidePassive(..., { allowGrant: true })` allows it, it is kept, and no denial is recorded
