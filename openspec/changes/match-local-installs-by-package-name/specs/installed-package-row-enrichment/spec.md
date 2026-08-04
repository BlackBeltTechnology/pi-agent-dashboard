# installed-package-row-enrichment Specification

## ADDED Requirements

### Requirement: Recommended entry install/active state SHALL account for local package.json name

The recommended-extensions enrichment SHALL compute an entry's `installed.scope` and `activeInPi` by considering a local candidate a match when either the pure-string `sourcesMatch(candidate, entry.source)` is true OR the candidate's `package.json` `name` equals the entry's parsed npm name. The either-match SHALL be applied at every site that decides install/active state: the `installed.scope` computation over installed rows (candidate = `installedPath`), the inner lookup that gates the `version`/`pi.skills` read (candidate = `installedPath`), AND the `activeInPi` computation over active sources (candidate = the active-source string as a local path). `installed.scope` SHALL be `"global"` when a matching row is found in the global (user) list, otherwise `"local"` when found in the project list, otherwise `null`. `activeInPi` SHALL be true when a matching active source is found by the same either-match rule.

This resolution SHALL NOT change the response shape of `GET /api/packages/recommended`.

#### Scenario: locally-installed recommended package reports Active

- **GIVEN** a recommended entry installed only from a local checkout whose `package.json` `name` equals the entry's npm name
- **WHEN** `GET /api/packages/recommended` is served
- **THEN** the entry's `activeInPi` SHALL be true
- **AND** its `installed.scope` SHALL reflect the scope of the matching row

#### Scenario: install-all-missing excludes matched local installs

- **GIVEN** every recommended entry is either active or matched via local `package.json` name
- **WHEN** the enrichment is computed
- **THEN** no matched entry SHALL be reported as missing (`activeInPi` true), so the bulk install action has nothing to enqueue for them
