# Design — codeql-file-containment-barrier

## Context

`evaluateContainment(resolved, anchors, opts)` (`packages/server/src/access/containment-gate.ts:203`) is async: it refuses dashboard secrets, runs layers ①/② (`isAllowed`, `packages/server/src/lib/path-containment.ts:152`), then the grant layer, and returns `{ allowed, viaGrant, remedy? }` (`containment-gate.ts:67`). File routes then use `resolved = path.resolve(admitted.cwd, relPath)` (`file-routes.ts:392, 439, 549, 957, 1255, 1490`) and read from it. CodeQL models the cwd side (`admissionAllows`, `.github/codeql/extensions/cwd-guard.model.yml`) but sees no barrier for the request-derived `relPath`. `codeql.md` of `core-file-cwd-admission` records the residue.

Models-as-data match by package import path. The existing guards live in the shared package and are imported by name (`@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`); the new predicate follows that precedent (`admissionAllows`, `packages/shared/src/cwd-guard.ts:187`) instead of probing whether a server-package row would match. The shared package exports `"./*.js": "./src/*.ts"`, so `containment-guard.js` resolves like `cwd-guard.js`.

## Goals / Non-Goals

**Goals**
- G1: a guarded sink is silent in real CodeQL analysis; unguarded, wrong-path and never-branched twins are still reported.
- G2: no containment behaviour change: same allow/refuse/filter outcomes, strings, statuses, anchors, grant consumption, hold/suspend flow.
- G3: measured before/after table; residue that stays open is listed with the reason, not hidden.

**Non-Goals**: `browse.ts`; symlink TOCTOU; changing anchors or the grant layer; Actions language; dismissing alerts (that is `triage-codeql-alert-debt`).

## Decisions

### D1 — The decision carries the path it decided

Shared defines `PathDecision = { allowed: boolean; viaGrant: boolean; resolved: string } & { readonly [pathDecisionBrand]: true }` (a `unique symbol` brand, type-only). `ContainmentDecision` in `containment-gate.ts` becomes that type. A single private constructor `decision(resolved, allowed, viaGrant)` in `containment-gate.ts` is the only code that builds one (it casts once). Every return point of `evaluateContainment` uses it, and sets `resolved` to the function's own first argument:
1. the dashboard-secret refusal (`containment-gate.ts:238`);
2. the layer ①/② allow, the grant allow and the refusal (`:244, :246, :248`);
3. the post-hold re-evaluation allow (`:320`) — easy to miss: without `resolved` an operator-approved read would answer 403;
4. the `allowGrant: false` early return of the bare `decision` (`containment-gate.ts:~260`);
5. the `quiet` return and the final refusal `{ ...decision, remedy }` (spread keeps `resolved`).

*Alternative:* a minted token like `AdmissionToken`; rejected, nothing crosses a trust boundary: the decision is produced and consumed in one request handler.

### D2 — `containmentAllows(decision, resolved)`: sync, path-bound, fail-closed

New `packages/shared/src/containment-guard.ts`:

```ts
export function containmentAllows(decision: PathDecision, resolved: string): boolean {
  return decision.allowed === true && decision.resolved === resolved;
}
```

Exact string equality: a site that decided path A and then uses path B gets `false` and refuses. The parameter is the branded `PathDecision`, so a hand-written `{ allowed: true, resolved }` literal does not type-check. Plain `boolean` return (every site already holds a `string`; a type guard would narrow nothing).

### D3 — Model row

One `barrierGuardModel` row plus the dot-free alias, as the existing rows: `Member[containmentAllows].Argument[1]`, `true`, `path-injection`, type single-quoted (`codeql-model-contract.test.ts` enforces this).

### D4 — Sites branch on the predicate

Sites (grep of `packages/server/src`, non-test; lines at planning time):
- `evaluateContainment` callers: `file-routes.ts:393, 442, 550, 958, 1172, 1268, 1491` (`gateFilePath` wraps 393, `gateOfficeFile` wraps 550) and `session-routes.ts:544`. Each `if (!decision.allowed)` becomes `if (!containmentAllows(decision, resolved))`; the denial body, hold and remedy code are untouched.
- Passive callers that today call `isAllowed` (and `isGrantAdmitted`) themselves and never record a denial: `resolve-file-mention.ts:83-84`, `grep-routes.ts:77-78`, and the raw pre-check `file-routes.ts:1266`. They move to a new `decidePassive(resolved, anchors, { allowGrant, grantSubjects? })` exported from `containment-gate.ts`: `isAllowed` first; then, only with `allowGrant: true`, `isGrantAdmitted(resolved, grantSubjects ?? grantedSubjects())`. `grep-routes.ts` keeps its hoisted `const grantSubjects = grantedSubjects()` (`:73`, design D16: no N × store read per match) and passes it in; no dashboard-state check, no denial record, no hold. `grep-routes` and `resolve-file-mention` pass `allowGrant: true` (they consume grants today); the raw pre-check passes `false`. Outcomes are identical to today (grep still filters, the mention still returns `null`).
- The raw site (`file-routes.ts:1266-1278`) is ONE site with a load-bearing order (`:1260-1264`): layers ①/② → image-only artifact-root admission → grant layer via `evaluateContainment`. The order is kept. The artifact-root branch admits through a different predicate, so a sink reached only through it is not covered by the barrier; whether CodeQL accepts the combined `||` shape is decided by probe (D5), and any residue is named in D6.

The comment at `file-routes.ts:911` ("`isAllowed`-only decision") describes `gateFilePath` with `allowGrant: false`, already covered by the `evaluateContainment` sites. `child-env.ts:32` and `live-egress.ts:312` use a different `isAllowed` (env keys, runtime ids) and are not containment sites.

### D5 — Real-analysis probe first (the gate)

Before any route edit, extend `scripts/__tests__/codeql-local-real.test.mjs` with a mini monorepo using the repo's model file:
- (a) guarded sink silent;
- (b) unguarded twin reported;
- (c) decision and predicate for path A, sink on path B: reported;
- (d) decision never branched on: reported;
- (e) the production shape: `path.resolve(cwd, rel)` → `await evaluateContainment` → `if (!containmentAllows(...)) return` → `fs.readFile`;
- (f) the filter shape (`if (containmentAllows(...)) return m`) as in `grep-routes.ts`;
- (g) cross-function: the guarded `resolved` returned from a gate helper (`gateOfficeFile`-like) and read in another module (`office-preview.ts`, `eml.ts` shape);
- (h) the raw shape: `a || b` where `b` is a non-modelled admission, then sink.
Cases that CodeQL cannot recognise are recorded as expected residue (not hidden, not fixed by weakening a probe). Same skip behaviour as the existing real tests (no CodeQL on CI).

A source-shape / runtime unit test also covers: held-then-allowed read still passes `containmentAllows` (the post-hold return carries `resolved`), quiet and secret-refusal decisions carry `resolved`.

### D6 — Verification and residue

After migration run `npm run codeql`, record per-file before/after in `evidence/codeql.md`, then `--prune`. Targets: `file-routes.ts` 14 `operator-authz`, `resolve-file-mention.ts` 1. `office-preview.ts` 1 (`operator-authz`), `eml.ts` and `writable-handler-target.ts` (`github-dismissed`) take the path as a parameter from a gate helper, so they close only if probe (g) shows the barrier propagates; otherwise they stay and are listed with that reason for `triage-codeql-alert-debt`. The baseline may only shrink: `--check-baseline-diff` rejects growth.

### D7 — Soundness limits (stated, not hidden)

The model trusts that `containmentAllows` is only called with a decision for the same path. Enforced by: (i) the brand, so no code can pass a hand-built decision without a cast; (ii) a source-shape contract test that `containment-gate.ts` is the only non-test module that casts to `PathDecision`; (iii) exact string equality in the predicate. CodeQL still trusts any call to the predicate; that residual trust is the price of a sync barrier and is owned here, not by the triage change. Passive sites do not run the dashboard-secret refusal today (`evaluateContainment:238` does); `decidePassive` preserves that gap rather than closing it. The lexical-vs-realpath gap and symlink swaps are the pre-existing containment behaviour, not widened.

## Risks / Trade-offs

- A wrong model hides a real bug → probes (c), (d), (h), the branded type, the equality predicate, `security-hardening` review.
- `resolved` equality is string-exact: a site that normalises between decision and use must pass the same string; the migration keeps one `resolved` variable per site.
- Rollback: revert; no persisted state.
