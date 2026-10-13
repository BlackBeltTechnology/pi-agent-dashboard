## ADDED Requirements

### Requirement: Source walk honours gitignore with the excluded-parent rule
When gitignore respect is enabled (the default), the indexer SHALL omit every file ignored by the repository's `.gitignore` files (`.git/info/exclude` and `core.excludesFile` are not consulted; tracked-file override, character classes, backslash escapes and case-folding remain unimplemented), evaluating `.gitignore` files from the repository root (or project boundary) down to the file, and SHALL treat a file as ignored whenever any ancestor directory of it is ignored — including ancestors above the source directory. A pattern that does not match a directory on the file's ancestor chain SHALL be tested against the file path itself only; a negation that matches only directories (e.g. `!*/`) SHALL NOT re-include a file matched by an earlier pattern. A negation pattern SHALL NOT re-include a file or directory whose parent directory is ignored, and `.gitignore` files located inside an ignored directory SHALL NOT contribute patterns. Paths previously indexed that become ignored SHALL be removed by orphan removal on the next walk.

#### Scenario: Ignored directory containing nested .gitignore files is pruned
- **GIVEN** the repository root `.gitignore` contains the anchored pattern `packages/electron/out`
- **AND** `packages/electron/out/app/plugins/p/.gitignore` exists
- **WHEN** the source `packages` is walked
- **THEN** no file under `packages/electron/out/` is selected

#### Scenario: Nested negation cannot re-include under an ignored parent
- **GIVEN** the root `.gitignore` contains `vendored/`
- **AND** `vendored/.gitignore` contains `!keep.md`
- **WHEN** the source is walked
- **THEN** neither `vendored/keep.md` nor `vendored/other.md` is selected

#### Scenario: Source directory inside an ignored directory
- **GIVEN** the root `.gitignore` contains the anchored pattern `packages/electron/out`
- **WHEN** a source whose directory is `packages/electron/out/app` is walked
- **THEN** no file is selected

#### Scenario: Directory-only negation does not re-include files
- **GIVEN** the root `.gitignore` contains `*` followed by `!*/`
- **WHEN** the source is walked
- **THEN** `docs/x.md` is not selected

#### Scenario: Negation of the directory itself keeps it
- **GIVEN** the root `.gitignore` contains `skills/openspec-*/**` and `!skills/openspec-shared/**` and `!skills/openspec-shared/`
- **WHEN** the source is walked
- **THEN** files under `skills/openspec-shared/` are selected
- **AND** files under `skills/openspec-alpha/` are not selected

#### Scenario: Newly ignored files leave the index
- **GIVEN** files under an ignored directory were stored by an earlier walk
- **WHEN** the source is walked again with gitignore respect enabled
- **THEN** those files' chunks, synthetic meta chunk, nodes, edges, property rows and file state are deleted and counted as deletions

#### Scenario: Opt-out still indexes ignored files
- **WHEN** gitignore respect is disabled
- **THEN** files under ignored directories are selected subject only to the built-in exclusion set and caller filters
