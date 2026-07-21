# cwd-session-containment Specification

## Purpose

Provide pure, path-boundary-correct helpers that determine which dashboard sessions live at or beneath a target directory path. Callers (the worktree lifecycle endpoints) use `activeSessionsUnder` to gate destructive worktree removal behind an active-session confirmation and `sessionsUnder` to stamp affected sessions; this capability owns only the containment computation, not the removal or stamping behavior.

## Requirements

### Requirement: Path containment detection

The system SHALL determine whether one path is at or beneath another using directory-boundary-correct matching, treating a path as contained when it is the parent itself or a descendant, and never matching a sibling that merely shares a leading name prefix. Matching operates on normalised paths (`parent`, `child`); the boundary holds when `child` equals `parent` OR `child` starts with `parent` plus the platform separator.

#### Scenario: Exact match

- WHEN a child path equals the parent path
- THEN the child SHALL be reported as inside the parent

#### Scenario: Descendant match

- WHEN a child path is a directory below the parent path (parent + separator + more segments)
- THEN the child SHALL be reported as inside the parent

#### Scenario: Sibling prefix not matched

- WHEN a child path shares a leading string prefix with the parent but is not separated by a directory boundary (for example `/repo-other` against parent `/repo`)
- THEN the child SHALL NOT be reported as inside the parent

#### Scenario: Trailing separator on parent tolerated

- WHEN the parent path carries a trailing separator and the child equals the parent without it
- THEN the trailing separator SHALL be trimmed only when the normalised parent length is greater than 1 (root `/` is never stripped)
- AND the child SHALL still be reported as inside the parent

#### Scenario: Empty or missing path

- WHEN either the parent or child path is empty or normalises to empty
- THEN the result SHALL be not-inside

#### Scenario: Platform case and separator folding

- WHEN comparing paths on a case-insensitive platform (win32 or darwin)
- THEN matching SHALL be case-insensitive AND separator drift between `\` and `/` SHALL be tolerated
- AND on linux matching SHALL be case-sensitive

### Requirement: Sessions under a target path

The system SHALL collect the IDs of sessions whose working directory is at or beneath a target path, distinguishing an active-only query (`activeSessionsUnder`) used to block destructive actions from an all-sessions query (`sessionsUnder`) used to stamp affected sessions. Both are pure — no I/O.

#### Scenario: Active sessions under target exclude ended sessions

- WHEN collecting active sessions under a target path
- THEN a session SHALL be included only when its `cwd` is at or beneath the target
- AND a session with `status` equal to `ended` SHALL be excluded
- AND a session with no `cwd` SHALL be excluded

#### Scenario: All sessions under target include ended sessions

- WHEN collecting every session under a target path
- THEN a session SHALL be included whenever its `cwd` is at or beneath the target regardless of status
- AND a session with no `cwd` SHALL be excluded

#### Scenario: Empty target path

- WHEN the target path is empty
- THEN the result SHALL be an empty list of IDs
