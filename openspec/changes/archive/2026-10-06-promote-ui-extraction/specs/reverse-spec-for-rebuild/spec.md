## ADDED Requirements

### Requirement: Frontend UI-model extraction

The skill SHALL ship dependency-free programs that turn a legacy frontend into a gated UI model inside the rebuild package: a behavioural inventory with `file:line`, effective per-variant configuration, form records, screen records written by a subagent from a shipped prompt and accepted only when the gate passes, flows from code, a style kit extracted from the application's own stylesheets, and screen plans that keep the original layout and link every control to an action, a field, a recorded unmapped reason or the application shell. Stack specifics SHALL live in an adapter loaded by built-in name or file path; the screen-plan toolbar convention SHALL be an optional adapter hook.

#### Scenario: Project adapter by path
- **WHEN** `style-kit.mjs` or `screen-plan.mjs` is given a path to an adapter file instead of a built-in name
- **THEN** it loads that adapter and produces the same outputs as for a built-in adapter

#### Scenario: No toolbar hook
- **WHEN** the adapter declares no `toolbar` hook
- **THEN** the screen plan keeps every toolbar control and filters none by toolbar key

#### Scenario: Unlinked control refused
- **WHEN** a plan control links to no action, field, unmapped reason or shell
- **THEN** `screen-plan.mjs` exits 1 naming the control's number, cite and label
