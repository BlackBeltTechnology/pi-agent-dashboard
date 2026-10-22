## Why

`close-residual-audit-findings` (S3b) ships the strict nonce-based CSP, a
baseline report sink and a persisted violation counter, but keeps the CSP
default at `report`: both the baseline and the strict policy are report-only,
and `enforce` (strict policy enforced) is opt-in via `PI_DASHBOARD_CSP=enforce`.
Enforcing by default before real-world evidence could break inline bootstrap
code or plugin bundles. This change owns the measured soak and the default flip.

## What Changes

- **Soak gate (tasks, before any code change).** On released builds, all must
  hold, recorded as evidence in tasks.md:
  - zero `strict` `script-src*` violations on the persisted counter over ≥14
    consecutive days;
  - zero `dropped` reports (limiter or size cap) in the same window;
  - the window spans ≥1 release;
  - Playwright E2E green against the docker harness with
    `PI_DASHBOARD_CSP=enforce`.
  - Trusted Types reports (`require-trusted-types-for` bucket) never count
    toward this exit.
  - The operator reviews the per-directive / per-document breakdown (counter
    inflation can only delay the flip).
- **Default flip.** Unset or unrecognized `PI_DASHBOARD_CSP` resolves to
  `enforce` instead of `report` (`resolveCspMode`,
  `packages/server/src/auth/csp.ts:62-65`). Trusted Types mode resolution
  (`resolveTrustedTypesMode`, `csp.ts:70-73`) is unaffected: unset TT still
  follows `report` unless the CSP mode is `off`.
  Release notes name the rollback.
- **Rollback.** `PI_DASHBOARD_CSP=report` (strict back to report-only) or
  `off`, plus restart. No code revert.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `baseline-content-security-policy` — "Staged CSP mode resolution": the
  default for unset or unrecognized values changes from `report` to `enforce`.
  Explicit `off` / `report` / `enforce` are unchanged. Delta:
  `specs/baseline-content-security-policy/spec.md` (full baseline block, all
  scenarios kept, plus one for the new default).

## Impact

- Server: `packages/server/src/auth/csp.ts` (mode resolution default) and its
  tests.
- Users: the strict `script-src` (no `'unsafe-inline'` / `'unsafe-eval'`) is
  enforced by default; an unseen inline script stops running. Vite dev mode
  keeps its carve-out (defined by `close-residual-audit-findings`).
- Docs: release note and CSP mode docs state the new default and the rollback.
- Depends on `close-residual-audit-findings` (sink, counter, strict policy,
  `enforce` semantics). See `dependencies.yaml`.

## Discipline Skills

- `security-hardening` — enforcing the strict CSP closes the S3b XSS-mitigation
  gap.
- `doubt-driven-review` — the default flip is compatibility-affecting; review
  the soak evidence before it stands.
- `observability-instrumentation` — the soak exit is read from the persisted
  violation and `dropped` counters.
