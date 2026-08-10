# session-diff-extraction — delta

## MODIFIED Requirements

### Requirement: Filter files outside cwd
The server SHALL exclude file paths that resolve to locations outside the session's cwd, and SHALL rewrite every retained path to be relative to the session cwd using posix separators. The absolute-under-cwd → relative-posix rule SHALL be the canonical path-normalization contract that clients mirror when materializing changed-file paths from raw tool-call `args.path`.

#### Scenario: Absolute path outside cwd
- **WHEN** a Write/Edit event references an absolute path outside the session cwd (e.g., `/tmp/scratch.ts` when cwd is `/home/user/project`)
- **THEN** that file SHALL NOT be included in the response

#### Scenario: Absolute path inside cwd
- **WHEN** a Write/Edit event references an absolute path inside the session cwd (e.g., `/home/user/project/src/foo.ts` when cwd is `/home/user/project`)
- **THEN** the path SHALL be included and rewritten to relative-posix (`src/foo.ts`)
- **AND** the response key for that file SHALL be the relative-posix form (never the absolute form)

#### Scenario: Relative path inside cwd
- **WHEN** a Write/Edit event references a relative path (e.g., `src/foo.ts`)
- **THEN** the path SHALL be included and kept relative to cwd
