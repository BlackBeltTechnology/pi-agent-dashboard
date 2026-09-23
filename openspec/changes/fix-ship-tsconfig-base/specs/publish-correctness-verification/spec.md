## ADDED Requirements

### Requirement: Shipped tsconfig extends references resolve inside the tarball

The publish check SHALL read every shipped `tsconfig*.json` in each checked package. It SHALL resolve each relative `extends` entry (string or array form) against the package's `npm pack --dry-run` file set. An unresolved entry SHALL be reported as an error finding `dangling-tsconfig-extends`. Non-relative `extends` entries SHALL NOT be reported by this rule.

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

### Requirement: The root package is a checked package

The publish check SHALL include the repository-root package in its checked set when the root `package.json` is not `"private": true`, and SHALL apply every rule to it, including the relative-import, dependency-declaration, and tsconfig-extends rules.

#### Scenario: Non-private root is checked
- **WHEN** the root `package.json` has no `"private": true`
- **THEN** the root package's packed files are verified alongside `packages/*` workspaces

#### Scenario: Private root is skipped
- **WHEN** the root `package.json` has `"private": true`
- **THEN** the root package is not checked
