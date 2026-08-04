# local-install-name-resolution Specification

## ADDED Requirements

### Requirement: Recommended-extensions enrichment SHALL identify a local install by its package.json name

When enriching a recommended-extensions entry, the system SHALL treat a local candidate as referring to that entry when the candidate's directory contains a `package.json` whose `name` equals the recommended entry's parsed npm name (the `npm:<name>` source with the `npm:` prefix and any trailing `@<version>` removed). A local candidate is either an installed row's `installedPath` or an active-source string that denotes a local checkout path. This SHALL be evaluated in addition to — not instead of — the existing pure-string `sourcesMatch(candidate, entry.source)` predicate; a match by EITHER means SHALL count as installed. The name resolution applies only to npm-sourced entries (git-sourced entries have no npm `name`).

The name comparison SHALL be exact (including any `@scope/` prefix). The `package.json` name read reuses the existing `readPackageJsonName` reader and SHALL be memoized per path within a single request so a given path is read at most once. This is NOT a zero-IO change: an entry that fails the string match but resolves a local path incurs one `package.json` read it would not perform today (the current `version`/`pi.skills` read is gated behind an already-matched scope); the added reads are bounded by the number of distinct local paths touched by a failed string match.

The system SHALL tolerate a non-npm entry, a missing candidate path, a missing or unreadable `package.json`, invalid JSON, or a non-string `name` by falling back to the string `sourcesMatch` result only (returning false for the name predicate, never throwing).

#### Scenario: decoration-mismatched local checkout matches by package.json name

- **GIVEN** a recommended entry with source `"npm:@blackbelt-technology/pi-image-fit-extension"`
- **AND** an installed row with `source` `"/repo/packages/image-fit-extension"` and `installedPath` `"/repo/packages/image-fit-extension"`
- **AND** that directory's `package.json` `name` is `"@blackbelt-technology/pi-image-fit-extension"`
- **WHEN** the entry is enriched
- **THEN** the row SHALL be treated as installed for that entry (even though the path basename `image-fit-extension` does not equal the unscoped npm name `pi-image-fit-extension`)

#### Scenario: string match still applies when package.json is absent

- **GIVEN** a recommended entry with source `"npm:pi-web-access"`
- **AND** an installed row with `source` `"/home/dev/build/pi-web-access"` whose `installedPath` has no readable `package.json`
- **WHEN** the entry is enriched
- **THEN** the row SHALL still be treated as installed via the existing `sourcesMatch` basename rule

#### Scenario: unrelated local package does not match

- **GIVEN** a recommended entry with source `"npm:@blackbelt-technology/pi-image-fit-extension"`
- **AND** an installed row whose `installedPath` `package.json` `name` is `"@blackbelt-technology/some-other-tool"`
- **AND** whose `source` basename does not equal the entry's unscoped npm name
- **WHEN** the entry is enriched
- **THEN** the row SHALL NOT be treated as installed for that entry

#### Scenario: name mismatch does not override a valid string match

- **GIVEN** a recommended entry whose source string matches a row via `sourcesMatch`
- **AND** that row's `package.json` `name` differs from the entry's npm name
- **WHEN** the entry is enriched
- **THEN** the row SHALL still be treated as installed (EITHER-match semantics)
