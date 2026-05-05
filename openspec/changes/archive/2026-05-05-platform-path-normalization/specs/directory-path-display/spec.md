## MODIFIED Requirements

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
