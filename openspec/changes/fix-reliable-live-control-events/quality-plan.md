# Quality Plan

## Selected Checks

- TDD regression coverage: required, including the captured source-switch mixed-entry CLI crash.
- Performance/back-pressure bound: required.
- Observability health evidence: required.
- Dependency review: no new dependency; verify lockfile unchanged except intended install metadata, if any.
- Security/auth review: not selected; no trust boundary or credential behavior changes. Worktree TOFU remains enforced and becomes checkout-local.
- API contract review: additive health field only; validate response tests and types.
- UI evidence: required for live ask_user recovery in the Tailscale dashboard.
- Maintainability review: required after implementation.

## Commands

- Focused server/client Vitest commands recorded in `tasks.md` after test files are selected.
- `npm run quality:changed`
- `npm test`
- `npm run lint`
- `npm run lint:e2e`
- `npm run build`
- OpenSpec strict validation and repository convention checks.

## Acceptance Evidence

- Red then green output for each regression slice.
- `/api/health` before/after dropped-frame and resynchronization counters.
- Live prompt request and cancel/dismiss convergence without refresh under stress.
- Runtime version convergence and single bridge source in health.
- Disposable fresh Pi marker within 30 seconds after global mutations.
- Fresh reviewer reports with no unresolved validated critical/high findings.
- Source-switch `status` completes against the real mixed string/object `packages[]` configuration, and the revised skill passes the skill validator.
- Debug first moves run through `pnpm exec` TypeScript scripts with no Bash, `curl`, or `jq` dependency; `health-probe.ts` proves `PI_DASHBOARD_BASE`/`PI_DASHBOARD_PORT` precedence against port 8147.
