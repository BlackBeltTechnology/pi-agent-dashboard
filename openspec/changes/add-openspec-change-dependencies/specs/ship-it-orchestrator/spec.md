## ADDED Requirements

### Requirement: Dependency gate at ship-it entry

At entry, after the existing `SHIP_IT_BLOCKED.md` idempotency check and before any implementation step, ship-it SHALL run `npx tsx scripts/openspec-deps-gate.ts --change <name>` from its own cwd with a 60-second overall timeout and act on its JSON verdict `{ status: "ok" | "warn" | "blocked", mode: "online" | "offline", blockers: [{ change, state: "open" | "satisfied" | "unknown", source }], issues: [{ code, severity, message }], notes: string[] }`. A crash, a timeout or unparseable output SHALL be recorded as "dependencies not checked" and SHALL NOT stop the run.

The script SHALL:
- resolve the dashboard HTTP base the way the extension does (`resolveDashboardPorts` precedence: `PI_DASHBOARD_PORT` / `DASHBOARD_PORT`, then `~/.pi/dashboard/config.json`, then 8000, on `localhost`);
- call `GET /api/openspec/dependencies?cwd=<cwd>&change=<name>` with a 5-second timeout per request, retrying 503 `pending` at most 3 times, 2 seconds apart;
- on connection failure, timeout, exhausted retries or any other non-2xx (e.g. 403 `cwd-not-tracked` in CI or a remote dashboard) use the offline path: parse `openspec/changes/<name>/dependencies.yaml` with the shared parser (`packages/shared/src/openspec-dependencies.ts`, so the file rules are identical), drop names in `not_blocked_by`, resolve each remaining blocker `<b>` against `openspec/changes/<b>/` (open) and a directory named exactly `openspec/changes/archive/<YYYY-MM-DD>-<b>` (satisfied), and report unresolved names as unknown. The offline path detects `invalid-file` and `self-reference` only; the verdict SHALL say that cycles and inferred edges were not checked;
- because implementation runs before the step-2.5 `develop` merge, run `git fetch origin develop` with a 10-second timeout (using the existing ref on failure) and treat an open blocker as satisfied when an entry of `git ls-tree --name-only origin/develop openspec/changes/archive/` has the basename `<YYYY-MM-DD>-<b>`, noting that the merge is still pending.

- Any `error` issue (`invalid-file`, `self-reference`, and — online only — declared `cycle`) SHALL stop the run through the existing escape hatch (`SHIP_IT_BLOCKED.md`), naming the issue.
- Open blockers SHALL produce a warning listing them. Interactive runs SHALL confirm continuation via `ask_user`; declining SHALL write `SHIP_IT_BLOCKED.md` naming the open blockers and stop. Headless runs SHALL continue and record the warning in the final report.
- Warnings (including inferred-cycle warnings), satisfied, related and overlap entries SHALL NOT interrupt.

#### Scenario: Declared cycle blocks the run

- **GIVEN** the dashboard is reachable
- **WHEN** the change is part of a declared dependency cycle
- **THEN** ship-it SHALL write `SHIP_IT_BLOCKED.md` naming the cycle and SHALL NOT start implementation

#### Scenario: Open blocker warns headless

- **GIVEN** a headless run and the change is blocked by the active `add-x`
- **WHEN** ship-it starts
- **THEN** it SHALL continue
- **AND** its final report SHALL list `add-x` as an unarchived blocker

#### Scenario: Dashboard unreachable

- **GIVEN** the dashboard API does not answer within 5 seconds and `dependencies.yaml` lists a blocker archived in the worktree
- **WHEN** ship-it starts
- **THEN** it SHALL resolve the blocker as satisfied from `archive/` and proceed without a warning
- **AND** the report SHALL state that cycles were not checked

#### Scenario: Blocker archived on develop after branching

- **GIVEN** the worktree still has `openspec/changes/add-x/` active and `origin/develop` has `openspec/changes/archive/2026-10-20-add-x`
- **WHEN** ship-it starts
- **THEN** `add-x` SHALL count as satisfied, with a note that the develop merge is pending
- **AND** no `ask_user` SHALL be raised for it

#### Scenario: Cold dashboard cache

- **GIVEN** the dashboard answers 503 `{ pending: true }` twice, then 200
- **WHEN** ship-it starts
- **THEN** it SHALL use the 200 response, having waited no more than 3 retries
