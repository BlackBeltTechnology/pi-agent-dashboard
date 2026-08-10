# session-reap.spec.ts — index

L3 gate on the reap fixture itself, driven headless over `BusClient` (no browser page); port from `DASHBOARD_PORT`. Covers test-plan #E2/#E3/#E8/#X1/#X7/#F1/#F3/#F4 — sessions do not outlive their spec (handoff via module state, safe under `workers:1`), already-gone session tolerated, empty-container start, harness `source:"tui"` session never reaped, reaped session is not a recovery candidate after `POST /api/restart`, a spec's own `afterEach` still sees its session live, and reap survives a mid-suite socket drop. See change: fix-e2e-harness-memory-exhaustion.
