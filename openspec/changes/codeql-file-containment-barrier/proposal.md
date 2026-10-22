> **STUB — not yet planned.** Split out of `core-file-cwd-admission` during its planning (operator decision 2026-10-22, option C). Run `plan-proposal` before implementation. Blocked by `core-file-cwd-admission` (`dependencies.yaml`). `triage-codeql-alert-debt` waits on this change.

## Why

After `core-file-cwd-admission`, file-route `cwd` values pass the modelled `admissionAllows` barrier, but the request `path` stays tainted: sinks consume `path.resolve(cwd, relPath)` after an async containment decision (`evaluateContainment` / `isAllowed`, `packages/server/src/access/containment-gate.ts`, `packages/server/src/lib/path-containment.ts`) that CodeQL does not model. Most `js/path-injection` entries on `packages/server/src/routes/file-routes.ts` and the office / md / mention lib sinks therefore stay open. The residue list is `openspec/changes/core-file-cwd-admission/evidence/codeql.md` (written at ship time).

## What Changes

- A sync predicate over the decided containment result (shape like `admissionAllows(admission, cwd)`, e.g. `containmentAllows(decision, resolved)`) that file-route sinks branch on, modelled as a `barrierGuardModel` row in `.github/codeql/extensions/cwd-guard.model.yml`.
- A D0-style real-analysis probe (`scripts/__tests__/codeql-local-real.test.mjs`) before route work: guarded sinks silent, unguarded twins reported.

## Capabilities

### Modified Capabilities
- TBD at planning (`file-read-containment`, the CodeQL model contract).

## Impact

TBD at planning.

## Discipline Skills

- `security-hardening`: a barrier model that is wrong hides real path-injection.
- `doubt-driven-review`: the predicate's soundness vs the async decision it summarises.
- `review-code`: before commit.
