## MODIFIED Requirements

### Requirement: Configuration validation
The KB SHALL validate the merged configuration shape and throw a precise error when a constraint is violated. The validated constraints SHALL be: `sources` is an array; each source has a string `ref`; each source `kind` is one of `filesystem`, `npm`, `git`, `https` (defaulting to `filesystem` when omitted); `maxFileCount` is a number or null; `dbPath` is a non-empty string; `queryExpansion.mode` is one of `off`, `prf`, `synonym`, `agent`; `doctrine.inject` is one of `kb`, `off`; `doctrine.write` is a boolean; `seedFromMainWorktree` is a boolean (default `true`); and, within the `git` group, `enabled` and `forge.enabled` are booleans, `remote` and `forge.gitea.tokenEnv` are non-empty strings, every count, interval, cap and wait (`searchWaitMs`, `commits.maxInitial`, `commits.maxPathsPerCommit`, `forge.minSyncIntervalSeconds`, `forge.hintedMinSyncIntervalSeconds`, `forge.firstSyncWindowDays`, `forge.firstSyncMaxItems`, `forge.pagesPerSync`, `forge.leaseSeconds`) is a positive number, `forge.rateFloorPercent` is between 0 and 100 inclusive, and every `forge.hosts` value is one of `github`, `gitlab`, `gitea`, and `forge.hintedMinSyncIntervalSeconds` does not exceed `forge.minSyncIntervalSeconds`. A git-group violation SHALL name the offending key.

#### Scenario: Source missing ref
- **WHEN** a source entry lacks a string `ref`
- **THEN** validation throws an error indicating each source needs a string `ref`

#### Scenario: Unknown source kind
- **WHEN** a source declares a `kind` outside the allowed set
- **THEN** validation throws an error naming the unknown kind

#### Scenario: Unknown query-expansion mode
- **WHEN** `queryExpansion.mode` is a value outside `off`/`prf`/`synonym`/`agent`
- **THEN** validation throws an error naming the unknown mode

#### Scenario: Malformed JSON in a config file
- **WHEN** a config file exists but contains invalid JSON
- **THEN** loading throws an error identifying the offending file path

#### Scenario: Unknown doctrine inject mode
- **WHEN** `doctrine.inject` is a value outside `kb`/`off`
- **THEN** validation throws an error naming the unknown mode

#### Scenario: Non-positive git cap
- **WHEN** `git.forge.pagesPerSync` is `0`
- **THEN** validation throws an error naming `git.forge.pagesPerSync`

#### Scenario: Non-boolean seedFromMainWorktree
- **WHEN** `seedFromMainWorktree` is set to a non-boolean value such as `"yes"`
- **THEN** validation throws an error naming `seedFromMainWorktree`
