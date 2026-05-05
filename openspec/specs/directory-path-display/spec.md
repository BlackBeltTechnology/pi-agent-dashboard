## ADDED Requirements

### Requirement: Full path display in group headers
Directory group headers SHALL display the full absolute path instead of only the basename. The displayed path SHALL be the original form as reported by pi (preserving case and separators as the filesystem sees them). For grouping and equality decisions (matching a session's `cwd` to a pinned directory entry), the dashboard SHALL use `platform/paths.samePath` — NOT exact string equality — so that sessions group correctly under their pinned folder even when the stored path and the session's reported `cwd` differ in trailing separator, separator style, or case (per the OS's filesystem semantics).

#### Scenario: Short path fits available space
- **WHEN** the full path is `/Users/robson/judo-ng`
- **THEN** the group header SHALL display `/Users/robson/judo-ng`

#### Scenario: Long path exceeds available space
- **WHEN** the full path is longer than the display threshold
- **THEN** the group header SHALL display the path with the middle replaced by `…`, preserving the leading prefix and the final directory name (e.g., `/Users/robson/Project…/judo-meta-esm`)

#### Scenario: Windows path displayed with native separators
- **WHEN** the full path is `B:\Dev\BB\pi-agent-dashboard` on Windows
- **THEN** the group header SHALL display `B:\Dev\BB\pi-agent-dashboard` (original separators preserved — NO conversion to forward slashes for display)

#### Scenario: Sessions group under pinned directory despite trailing separator drift
- **WHEN** a pinned directory is stored as `B:\Dev\BB\pi-agent-dashboard` and a session reports `cwd: "B:\\Dev\\BB\\pi-agent-dashboard\\"` (trailing separator)
- **THEN** the session SHALL appear under the pinned group, not as a separate unpinned group
- **AND** the grouping logic SHALL use `paths.samePath` for the match

#### Scenario: Sessions group under pinned directory despite drive-letter case drift on Windows
- **WHEN** a pinned directory is stored as `B:\Dev\BB\pi-agent-dashboard` and a session reports `cwd: "b:\\Dev\\BB\\pi-agent-dashboard"` (lowercase drive letter)
- **THEN** the session SHALL appear under the pinned group (Windows filesystem treats these as the same path)

#### Scenario: Sessions do NOT collapse case drift on Linux
- **WHEN** a pinned directory is stored as `/home/user/Project` and a session reports `cwd: "/home/user/project"` on Linux
- **THEN** the session SHALL appear as a separate unpinned group (Linux filesystem treats these as different paths)

#### Scenario: Sessions across different Windows drives never merge
- **WHEN** a pinned directory is stored as `B:\Dev\BB` and a session reports `cwd: "A:\\Dev\\BB"` on Windows
- **THEN** the session SHALL NOT appear under the pinned group (different drives = different filesystems)
- **AND** it SHALL appear as a separate unpinned group for `A:\Dev\BB`

#### Scenario: Sessions on the same drive with different drive-letter case group together
- **WHEN** a pinned directory is stored as `B:\Dev\BB` and a session reports `cwd: "b:\\Dev\\BB"` on Windows
- **THEN** the session SHALL appear under the pinned group (drive letter is case-insensitive on Windows)

### Requirement: Middle truncation preserves boundaries
The middle-truncation function SHALL always preserve the last path segment (directory name) and as many leading segments as fit within the maximum length.

#### Scenario: Path within limit
- **WHEN** `truncatePathMiddle("/a/b/c", 20)` is called
- **THEN** it SHALL return `/a/b/c` unchanged

#### Scenario: Path exceeds limit
- **WHEN** `truncatePathMiddle("/Users/robson/Project/some/deep/judo-meta-esm", 35)` is called
- **THEN** it SHALL return a string no longer than 35 characters, ending with `/judo-meta-esm`, with `…` replacing omitted middle segments

#### Scenario: Path with only root and name
- **WHEN** the path has only two segments (e.g., `/judo-ng`)
- **THEN** it SHALL return the path unchanged regardless of max length

### Requirement: Symlink resolution on pin
The server SHALL resolve symlinks when storing pinned directory paths, using `fs.realpathSync()`.

#### Scenario: Pinning a symlink path
- **WHEN** a user pins `/Project/judo-ng` and `/Project` is a symlink to `/Users/robson/Project`
- **THEN** the server SHALL store `/Users/robson/Project/judo-ng` as the pinned path

#### Scenario: Reordering with symlink paths
- **WHEN** a `reorder_pinned_dirs` message contains symlink paths
- **THEN** the server SHALL resolve each path before storing

#### Scenario: Path does not exist on disk
- **WHEN** `realpathSync` fails because the path does not exist
- **THEN** the server SHALL fall back to storing the original unresolved path
