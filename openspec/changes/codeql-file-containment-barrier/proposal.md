## Why

After `core-file-cwd-admission`, file-route `cwd` values pass the modelled `admissionAllows` barrier, but the request `path` stays tainted. Sinks consume `path.resolve(cwd, relPath)` after an async containment decision (`evaluateContainment`, `packages/server/src/access/containment-gate.ts:203`) that CodeQL does not model: it only sees a `{ allowed, viaGrant }` object (`containment-gate.ts:67`) that is not tied to any path. As a result, 14 `operator-authz` `js/path-injection` results on `packages/server/src/routes/file-routes.ts`, and one each in `lib/resolve-file-mention.ts`, `lib/office-preview.ts`, `lib/eml.ts` and `lib/writable-handler-target.ts`, stay open (the residue list is `openspec/changes/archive/2026-10-22-core-file-cwd-admission/evidence/codeql.md`). `triage-codeql-alert-debt` waits on this change: it must not dismiss alerts a code barrier can still close.

## What Changes

- `ContainmentDecision` carries the exact string it decided, `{ allowed, viaGrant, resolved }`, and is a branded type only `containment-gate.ts` can construct, on every return point of `evaluateContainment` (including the post-hold allow).
- A sync, path-bound predicate `containmentAllows(decision, resolved): boolean` in a new `packages/shared/src/containment-guard.ts`. It is true only when the decision allowed AND `decision.resolved === resolved`, so a decision for one path cannot bless another.
- A `barrierGuardModel` row for it in `.github/codeql/extensions/cwd-guard.model.yml` (dotted type single-quoted, per the existing contract test).
- `decidePassive(resolved, anchors, { allowGrant })` in `containment-gate.ts` gives the three sites that call `isAllowed`/`isGrantAdmitted` themselves (`resolve-file-mention.ts`, `grep-routes.ts`, the `file-routes.ts` raw pre-check) the same path-bound decision with unchanged semantics (grants consumed, no denial recorded).
- Every containment site that reads or serves a path branches on `containmentAllows(decision, resolved)` instead of `decision.allowed` / a bare `isAllowed` boolean. Error strings, status codes, anchors and grant behaviour do not change.
- A real-analysis probe (`scripts/__tests__/codeql-local-real.test.mjs`) that proves the model before any route edit: guarded sink silent; unguarded, wrong-path and never-branched twins still reported; the filter, cross-function and raw `||` shapes measured.
- A before/after CodeQL table in `evidence/codeql.md`; `--prune` drops the entries that close.

Out of scope: `browse.ts` (cwd-less folder browser; its 6 results go to `triage-codeql-alert-debt`), symlink TOCTOU between decision and use (pre-existing, unchanged), the Actions language.

## Capabilities

### Modified Capabilities
- `file-read-containment`: containment decisions are bound to the evaluated path and every site branches on the path-bound predicate.

## Impact

- `packages/server/src/access/containment-gate.ts`, `packages/server/src/routes/file-routes.ts`, `packages/server/src/routes/session-routes.ts`, `packages/server/src/routes/grep-routes.ts`, `packages/server/src/lib/resolve-file-mention.ts` (call sites only, plus the new `decidePassive`).
- New `packages/shared/src/containment-guard.ts`; `.github/codeql/extensions/cwd-guard.model.yml`.
- Migration/rollback: no data or protocol change; behaviour is identical for allowed and refused paths. Rollback = revert the commit (the model row is inert without the predicate). Compatibility: `ContainmentDecision` gains a field; callers that only read `allowed` keep compiling.

## Discipline Skills

- `security-hardening`: a barrier model that is wrong hides real path-injection; the predicate must fail closed on a path mismatch.
- `doubt-driven-review`: soundness of the predicate versus the async decision it summarises, before the model is trusted.
- `review-code`: before commit.
