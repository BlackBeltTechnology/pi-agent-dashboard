## Why

Three flaky / leaky unit tests are open: #1097 (`EditorSearchPanel` ArrowDown test fails on a loaded CI shard), #1070 (`ProviderAddDialog` AUTH-006 countdown), #1071 (`obs-studio-plugin` `real-serve` test orphans an EOF-ignoring process on every run). Root causes, verified at HEAD (see `design.md`):

- **#1097** — real race between a post-commit passive effect (`setActiveIndex(0)`) and the test's `ArrowDown`; not just a short timeout. Test-only.
- **#1070** — already fixed by `f93a27812` (2026-10-26); the issue is still open. Only verification + closure remain.
- **#1071** — the stub fixture spawns a non-detached grandchild nobody reaps; the test never records or kills it. Test hygiene fix; the product-side question (does `service exec` / `BridgeManager.dispose` leak a real child?) is decided in `design.md` (Decision 4) and split into follow-up issue #1103.

## What Changes

- `EditorSearchPanel.test.tsx`: make the ArrowDown/Enter test deterministic (fake timers + `act` so the debounce commit **and** its effects flush before `ArrowDown`; synchronous assertions replace `findByText`/`waitFor`). No component change.
- `real-serve.test.ts` + `fixtures/stub-exec.mjs`: stub records the grandchild pid (env-provided file); the test reaps the recorded pid in `afterEach` (shared `killProcess`) and asserts it is dead. No change to `BridgeManager`.
- `ProviderAddDialog.test.tsx`: no edit; verify `f93a27812` resolves the flake (stress run) and close #1070 manually with that evidence.
- Product hardening for #1071 (signal forwarding in `service exec` / process-group kill in `BridgeManager`) is **not** in this change — `design.md` Decision 4 (decided 2026-11-03 by owner). Because `Fixes #1071` auto-closes the issue, the `service exec` signal-forwarding question (option C) is tracked in follow-up issue #1103 and referenced in the commit trailer.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. Test-only; no capability behaviour changes, so no spec deltas (`skip_specs: true` in `.openspec.yaml`).

## Impact

- `packages/client/src/components/editor-pane/__tests__/EditorSearchPanel.test.tsx`
- `packages/obs-studio-plugin/src/server/__tests__/real-serve.test.ts`
- `packages/obs-studio-plugin/src/server/__tests__/fixtures/stub-exec.mjs`
- `packages/obs-studio-plugin/src/server/__tests__/fixtures/AGENTS.md` (row update)
- No production code, migration, or compatibility impact. Rollback: revert the commit.

## Discipline Skills

- `systematic-debugging` — each flake root-caused from code before any fix (tasks 1.x, 3.x).
- `review-code` — non-trivial test changes, tests green before commit.
- Others (security, performance, observability, doubt-driven-review): none apply.

Fixes #1097
Refs #1070 (closed manually, already fixed by `f93a27812`)
Fixes #1071 (test-hygiene part)
Refs #1103 (option C: `service exec` signal forwarding; follow-up of #1071)
