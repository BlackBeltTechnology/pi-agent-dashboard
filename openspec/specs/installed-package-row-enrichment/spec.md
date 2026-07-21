# installed-package-row-enrichment Specification

## Purpose

Enrich the raw rows returned by pi's `listConfiguredPackages()` with the metadata the Settings Packages tab needs to render a friendly identity and badges without a second fetch. Raw rows carry only `source`, `scope`, `filtered`, and `installedPath`; enrichment adds `version`, `description`, `displayName`, `isRecommended`, and `isBundled` by reading each package's on-disk `package.json` and consulting the recommended-extensions manifest. A second, best-effort pass resolves the canonical published variant of local/git rows so the Settings tab can offer a "reset override to npm" action.

## Requirements

### Requirement: Read version and description from package.json

The system SHALL read `version` and `description` from the `package.json` located in a row's `installedPath` directory, and SHALL tolerate any read or parse failure by returning empty metadata.

#### Scenario: package.json present with string version and description
- **WHEN** the row's `installedPath` contains a `package.json` whose `version` and `description` are strings
- **THEN** the enriched row's `version` SHALL equal that `version`
- **AND** its `description` SHALL derive from that `description` when no recommended override applies

#### Scenario: installedPath is missing
- **WHEN** the row has no `installedPath`
- **THEN** metadata reading SHALL return empty metadata
- **AND** the enriched row's `version` SHALL be undefined

#### Scenario: package.json file does not exist
- **WHEN** the `installedPath` directory has no `package.json` file
- **THEN** metadata reading SHALL return empty metadata
- **AND** the enriched row's `version` SHALL be undefined

#### Scenario: package.json is unreadable or invalid JSON
- **WHEN** reading or parsing the `package.json` throws
- **THEN** metadata reading SHALL swallow the error and return empty metadata

#### Scenario: version or description is not a string
- **WHEN** `package.json` has a non-string `version` or `description`
- **THEN** the corresponding field SHALL be undefined rather than the raw value

### Requirement: Derive a friendly display name

The system SHALL set the enriched row's `displayName` from the matching recommended-extensions entry when one exists, otherwise from a basename extracted from the raw `source` string.

#### Scenario: recommended entry matches the source
- **WHEN** the row's `source` matches a recommended-extensions manifest entry
- **THEN** the `displayName` SHALL be the manifest entry's `displayName`

#### Scenario: npm source with no recommended match
- **WHEN** no recommended entry matches and the source has the form `npm:<name>` optionally followed by `@<version>`
- **THEN** the `displayName` SHALL be `<name>` without the version suffix

#### Scenario: git source with no recommended match
- **WHEN** no recommended entry matches and the source is a git URL
- **THEN** the `displayName` SHALL be the final path segment with any `.git` suffix and trailing slash removed

#### Scenario: local path source with no recommended match
- **WHEN** no recommended entry matches and the source is a local file path
- **THEN** the `displayName` SHALL be the final path segment

#### Scenario: unrecognized source shape
- **WHEN** no recommended entry matches and the source matches none of the npm, git, or local patterns
- **THEN** the `displayName` SHALL be the raw `source` string unchanged

### Requirement: Resolve description and recommended flag

The system SHALL prefer the recommended entry's fallback description over the package.json description, and SHALL mark whether the row corresponds to a recommended extension.

#### Scenario: recommended entry provides a fallback description
- **WHEN** a recommended entry matches and supplies a `fallbackDescription`
- **THEN** the enriched row's `description` SHALL be that fallback description
- **AND** `isRecommended` SHALL be true

#### Scenario: no recommended match
- **WHEN** no recommended entry matches the source
- **THEN** the enriched row's `description` SHALL be the package.json description (or undefined)
- **AND** `isRecommended` SHALL be false

### Requirement: Determine bundled status

The system SHALL compute `isBundled` only for recommended rows, requiring an Electron resources path, membership in the bundled-extension id list, and an existing bundled directory on disk.

#### Scenario: non-recommended row
- **WHEN** no recommended entry matches the source
- **THEN** `isBundled` SHALL be false

#### Scenario: no Electron resources path available
- **WHEN** a recommended entry matches but no resources path is provided (CLI mode)
- **THEN** `isBundled` SHALL be false

#### Scenario: recommended id not in the bundled list
- **WHEN** a recommended entry matches, a resources path exists, but the entry's id is not in the bundled-extension id list
- **THEN** `isBundled` SHALL be false

#### Scenario: bundled directory exists
- **WHEN** a recommended entry matches, a resources path exists, the entry's id is in the bundled-extension id list, and the directory `<resourcesPath>/bundled-extensions/<id>` exists
- **THEN** `isBundled` SHALL be true

#### Scenario: bundled directory missing
- **WHEN** all bundled preconditions hold except the `<resourcesPath>/bundled-extensions/<id>` directory does not exist
- **THEN** `isBundled` SHALL be false

### Requirement: Return the enriched row shape

The system SHALL return each enriched row carrying the original raw fields plus the derived metadata fields, and SHALL leave the optional published-variant fields absent until a separate variant pass populates them.

#### Scenario: enriching a raw row
- **WHEN** a raw row is enriched
- **THEN** the result SHALL preserve `source`, `scope`, `filtered`, and `installedPath` from the raw row
- **AND** SHALL add `version`, `description`, `displayName`, `isRecommended`, and `isBundled`

#### Scenario: published-variant fields carried on the row shape
- **WHEN** an enriched row is produced
- **THEN** the row shape SHALL also be able to carry `publishedVariantSource` and `publishedVariantVersion`
- **AND** those fields SHALL be populated only by the published-variant pass, not by row enrichment

#### Scenario: enriching a list of rows
- **WHEN** a list of raw rows is enriched
- **THEN** each row SHALL be enriched independently using the runtime Electron resources path (or undefined in CLI mode)

#### Scenario: resources path defaults from the runtime
- **WHEN** enriching a list of rows without an explicit resources path argument
- **THEN** the resources path SHALL default to `process.resourcesPath` read at runtime (undefined in CLI mode)

### Requirement: Read package name from package.json

The system SHALL read `name` from the `package.json` located in a directory, and SHALL tolerate any read or parse failure by returning undefined.

#### Scenario: package.json present with a string name
- **WHEN** the directory contains a `package.json` whose `name` is a string
- **THEN** the helper SHALL return that name

#### Scenario: installedPath is missing
- **WHEN** no directory path is given
- **THEN** the helper SHALL return undefined

#### Scenario: package.json absent, unreadable, invalid, or non-string name
- **WHEN** the `package.json` file does not exist, cannot be read/parsed, or has a non-string `name`
- **THEN** the helper SHALL swallow any error and return undefined

### Requirement: Resolve the canonical published variant

The system SHALL resolve the canonical published variant (`{ source, version? }`) for a local or git installed row, or return undefined when there is nothing distinct to reset to. Resolution is pure with injected IO (name reader, npm lookup) and SHALL never throw.

#### Scenario: plain npm row
- **WHEN** the row's source parses to the `npm` kind
- **THEN** resolution SHALL return undefined (a plain npm row has no override to reset)

#### Scenario: recommended row resolves to the manifest source
- **WHEN** the row matches a recommended-extensions manifest entry and the manifest source is not identity-equal to the installed source
- **THEN** resolution SHALL return the manifest entry's `source` as the variant source
- **AND** SHALL attach the latest npm `version` via a best-effort registry lookup on the source's npm name when a lookup function is provided

#### Scenario: recommended row identity-equal to the installed source
- **WHEN** the row matches a recommended entry whose source is identity-equal to the installed source
- **THEN** resolution SHALL return undefined (no distinct target)

#### Scenario: recommended lookup fails or is unavailable
- **WHEN** a recommended row resolves to a distinct manifest source but the npm lookup throws or no lookup function is provided
- **THEN** resolution SHALL still return the manifest `source` with `version` omitted

#### Scenario: non-recommended local or git row resolves by package name
- **WHEN** the row is not recommended, a lookup function is provided, and the row's `installedPath` `package.json` yields a `name` that the npm registry resolves
- **THEN** resolution SHALL return `npm:<name>` as the variant source with the looked-up `version`, matching by package name alone with no repository-URL cross-check

#### Scenario: non-recommended row with no lookup, no name, or no npm match
- **WHEN** the row is not recommended and either no lookup function is provided, the `package.json` name cannot be read, or the npm lookup returns no match
- **THEN** resolution SHALL return undefined

#### Scenario: non-recommended lookup throws (offline)
- **WHEN** the npm lookup throws while resolving a non-recommended row
- **THEN** resolution SHALL swallow the error and return undefined

#### Scenario: non-recommended row identity-equal to the resolved variant
- **WHEN** a non-recommended row resolves to `npm:<name>` that is identity-equal to the installed source
- **THEN** resolution SHALL return undefined

### Requirement: Attach published variants to enriched rows

The system SHALL fill `publishedVariantSource` and `publishedVariantVersion` on each enriched row that has a resolvable published variant, resolving all rows in parallel, mutating and returning the same array, and never throwing.

#### Scenario: rows resolved in parallel and mutated in place
- **WHEN** a list of enriched rows is passed to the variant pass
- **THEN** each row SHALL be resolved via the published-variant resolution concurrently
- **AND** the same array SHALL be returned

#### Scenario: resolvable row is populated
- **WHEN** a row resolves to a published variant
- **THEN** the row's `publishedVariantSource` SHALL be set to the variant source
- **AND** its `publishedVariantVersion` SHALL be set to the variant version (which may be undefined)

#### Scenario: unresolved row left unchanged
- **WHEN** a row resolves to undefined
- **THEN** the row SHALL be left unchanged with its published-variant fields absent

#### Scenario: resolution failures never propagate
- **WHEN** resolving any row fails internally
- **THEN** the variant pass SHALL not throw and SHALL leave that row unchanged
