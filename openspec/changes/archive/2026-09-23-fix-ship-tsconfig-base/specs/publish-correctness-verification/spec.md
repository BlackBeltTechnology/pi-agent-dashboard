## ADDED Requirements

### Requirement: Shipped tsconfig extends references resolve inside the tarball

The publish check SHALL read every shipped `tsconfig*.json` in each checked package, and SHALL resolve each relative `extends` entry (string or array form) against the package's `npm pack --dry-run` file set, trying the entry verbatim and with a `.json` suffix. An unresolved entry SHALL be reported as an error finding `dangling-tsconfig-extends`. Non-relative `extends` entries SHALL NOT be reported by this rule. A shipped tsconfig that cannot be parsed SHALL be reported as a warning `unparseable-tsconfig`.

#### Scenario: Missing extends target fails the check
- **WHEN** a shipped `packages/server/tsconfig.json` has `extends: "../../tsconfig.base.json"` and `tsconfig.base.json` is not in the packed file set
- **THEN** the check reports `dangling-tsconfig-extends` for that file and exits non-zero

#### Scenario: Shipped extends target passes
- **WHEN** the `extends` target is in the packed file set
- **THEN** no `dangling-tsconfig-extends` finding is reported

#### Scenario: Array-form extends is checked per entry
- **WHEN** `extends` is an array and one relative entry has no target in the packed file set
- **THEN** exactly that entry is reported

#### Scenario: Extension-less extends resolves with .json
- **WHEN** `extends` is `"../base"` and `base.json` is shipped at the resolved location
- **THEN** no finding is reported

#### Scenario: Package-name extends is ignored
- **WHEN** `extends` is `"@tsconfig/node20/tsconfig.json"`
- **THEN** no `dangling-tsconfig-extends` finding is reported

#### Scenario: tsconfig with comments and trailing commas parses
- **WHEN** a shipped tsconfig contains `//` comments and trailing commas
- **THEN** its `extends` is evaluated normally and the check does not crash

### Requirement: The root package's shipped tsconfigs are checked

The publish check SHALL include the repository-root package when its `package.json` is not `"private": true`, and SHALL apply the tsconfig-extends rule to it. The root package SHALL NOT be subject to the import-declaration or relative-import rules in this capability. That is deferred to a follow-up change, because the root is a meta-package whose shipped sources resolve dependencies transitively.

#### Scenario: Non-private root tsconfigs are checked
- **WHEN** the root `package.json` has no `"private": true`
- **THEN** the root package's packed tsconfigs are verified for dangling `extends`

#### Scenario: Private root is skipped
- **WHEN** the root `package.json` has `"private": true`
- **THEN** the root package is not checked

### Requirement: A root-style pack payload is read, never treated as empty

The check SHALL accept the `npm pack --dry-run --json` payload in array form, in single-object form, and in the object-keyed-by-package-name form npm emits at a workspace root. A payload with no readable `files` list SHALL be reported as `pack-failed`, never as an empty file set.

#### Scenario: Keyed-object payload yields its files
- **WHEN** the payload is `{ "<name>": { "files": [{ "path": "a.js" }] } }`
- **THEN** the packed file set is `["a.js"]`

#### Scenario: Payload without a files list is a pack failure
- **WHEN** the payload has no `files` array in any accepted form
- **THEN** the package is reported `pack-failed`
