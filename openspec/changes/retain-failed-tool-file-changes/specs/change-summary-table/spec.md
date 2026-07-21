## ADDED Requirements

### Requirement: Changes view surfaces correlated file-operation failures

The shared Changes view SHALL render `fileOperationFailures` as a distinct `Failed operations` section and SHALL mark every affected file row. It SHALL derive the many-to-many file/failure relation from normalized `affectedPaths` without creating pseudo-files.

#### Scenario: Affected file receives failure status

- **WHEN** a file path appears in one or more `fileOperationFailures[].affectedPaths`
- **THEN** its Changes row SHALL display a visible failure badge
- **AND** the badge SHALL expose an accessible label describing the failed-operation count

#### Scenario: Failed operations section explains the error

- **WHEN** the session-diff response contains correlated failures
- **THEN** the Changes view SHALL show the failure count, tool name, concise message, timestamp, and affected paths in a `Failed operations` section

#### Scenario: Failure path opens existing diff viewer

- **WHEN** the user activates an affected path in the failure section
- **THEN** the existing diff viewer SHALL open that normalized file path
- **AND** no new route or viewer kind SHALL be required

#### Scenario: Multiple files share one operation

- **WHEN** one failed operation references multiple changed files
- **THEN** the failure section SHALL render one operation entry containing all affected paths
- **AND** every corresponding file row SHALL display failure status

#### Scenario: No correlated failure

- **WHEN** `fileOperationFailures` is absent or empty
- **THEN** the Changes view SHALL omit the Failed operations section and failure badges
- **AND** existing file and other-working-tree groups SHALL retain their behavior

### Requirement: Mutation results refresh shared session-diff data

The client SHALL schedule the existing serialized session-diff refresh after completion of any classified mutation tool, including failed results. The refresh filter SHALL use the shared mutation classifier and SHALL continue to exclude non-mutating Read/search results.

#### Scenario: Codex patch result refreshes Changes

- **WHEN** an `apply_patch` tool result completes successfully, partially, or with `isError: true`
- **THEN** the client SHALL schedule a session-diff refresh

#### Scenario: Grok alias result refreshes Changes

- **WHEN** a `Shell` or `StrReplace` tool result completes
- **THEN** the client SHALL schedule a session-diff refresh

#### Scenario: Read result does not trigger git work

- **WHEN** a Read or search tool result completes
- **THEN** that result SHALL NOT increment the session-diff mutation refresh signal

#### Scenario: Bursted mutation results remain bounded

- **WHEN** multiple mutation results arrive while a session-diff request is in flight
- **THEN** the client SHALL retain the existing one-in-flight request and collapse intermediate signals into one trailing refresh

