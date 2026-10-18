## ADDED Requirements

### Requirement: Dependency gate at ship-it entry

At entry, before any implementation step, ship-it SHALL obtain the change's dependency state from `GET /api/openspec/dependencies?cwd=<main checkout>&change=<name>`. When the dashboard is unreachable, ship-it SHALL parse `openspec/changes/<name>/dependencies.yaml` (if present) and resolve each name against `openspec/changes/` (open) and `openspec/changes/archive/*-<name>` (satisfied).

- Any `error` issue (`invalid-file`, `self-reference`, `cycle`) SHALL stop the run through the existing escape hatch (`SHIP_IT_BLOCKED.md`), naming the issue.
- Open blockers SHALL produce a warning listing them. Interactive runs SHALL confirm continuation via `ask_user`; headless runs SHALL continue and record the warning in the final report.
- Satisfied, related and overlap entries SHALL NOT interrupt.

#### Scenario: Cycle blocks the run

- **WHEN** the change is part of a dependency cycle
- **THEN** ship-it SHALL write `SHIP_IT_BLOCKED.md` naming the cycle and SHALL NOT start implementation

#### Scenario: Open blocker warns headless

- **GIVEN** a headless run and the change is blocked by the active `add-x`
- **WHEN** ship-it starts
- **THEN** it SHALL continue
- **AND** its final report SHALL list `add-x` as an unarchived blocker

#### Scenario: Dashboard unreachable

- **GIVEN** the dashboard API is down and `dependencies.yaml` lists an archived blocker
- **WHEN** ship-it starts
- **THEN** it SHALL resolve the blocker as satisfied from `archive/` and proceed without a warning
