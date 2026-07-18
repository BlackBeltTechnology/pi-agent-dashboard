## ADDED Requirements

### Requirement: Headless spawn sets session name at creation via --name

`sessionFlagsToArgv(flags)` — defined in `packages/shared/src/platform/spawn-mechanism.ts` — SHALL accept an optional `name` field on `SessionFlags` and SHALL emit `["--name", flags.name]` when it is a non-empty string (pi 0.78.0+, verified present in the pinned pi CLI). The `--name` argv SHALL compose with the existing `--session` / `--fork` / `--model` flags. When `flags.name` is absent the argv SHALL be unchanged and post-hoc auto-naming SHALL still apply.

#### Scenario: Named spawn passes --name
- **WHEN** `sessionFlagsToArgv({ name: "review-worktree" })` is called
- **THEN** the result SHALL include `"--name"` followed by `"review-worktree"`
- **AND** the flag SHALL be forwarded through `buildHeadlessArgs` to the keeper spawn argv

#### Scenario: --name composes with fork and model flags
- **WHEN** `sessionFlagsToArgv({ name: "x", sessionFile: "/s.jsonl", fork: true, model: "m" })` is called (the fork+model return path)
- **THEN** the result SHALL include `--name x` alongside `--fork /s.jsonl` and `--model m`
- **AND** `--name` SHALL be present in the continue/`--session` return path as well

#### Scenario: Unnamed spawn unchanged
- **WHEN** `sessionFlagsToArgv({})` is called with no `name`
- **THEN** the result SHALL NOT include `--name`
- **AND** post-hoc auto-naming SHALL proceed as today
