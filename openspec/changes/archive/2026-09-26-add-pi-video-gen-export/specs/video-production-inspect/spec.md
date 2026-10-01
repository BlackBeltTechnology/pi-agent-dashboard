## ADDED Requirements

### Requirement: Sidecar reporting

For a sidecar-enabled package the inspector SHALL report sidecar state: a `sidecars` object `{ enabled: true, timeline: boolean, problems: { scope, message }[] }` in the structured report, a per-shot `sidecar` field with value `ok`, `missing` or `invalid`, and the sidecar problems in the human-readable output. The existing `problems` list SHALL keep containing only names of shots missing a Full Veo prompt. For a package without `film.json` the report SHALL be identical to the pre-change report (no `sidecars` object, no per-shot `sidecar` field, no extra human-readable lines).

#### Scenario: Package without sidecars

- **WHEN** a package without `film.json` is inspected
- **THEN** the human and JSON reports are identical to those produced before this change

#### Scenario: Sidecar problem surfaces in parse

- **WHEN** a sidecar-enabled package has a shot sidecar missing `prompt.action`
- **THEN** the problem appears in `sidecars.problems` and in the human-readable output, the `problems` list is unchanged, and `parse` exits with code 1

#### Scenario: Placement of sidecar lines

- **WHEN** a sidecar-enabled package with clean prompts but one sidecar problem is formatted
- **THEN** a `Sidecars:` block listing the problem appears after the shot rows and before the terminal line, and the terminal line is unchanged (`✓ All shots have a Full Veo prompt block.`)

#### Scenario: Per-shot sidecar state in JSON report

- **WHEN** `parse --json` inspects a sidecar-enabled package where `shot_02.json` is missing
- **THEN** `shot_02` has `sidecar: "missing"`, the other shots have `sidecar: "ok"`, and `sidecars.enabled` is `true`
