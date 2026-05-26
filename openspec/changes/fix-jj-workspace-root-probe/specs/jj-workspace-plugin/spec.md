## MODIFIED Requirements

### Requirement: jj-aware bridge probe is gated by `.jj/` existence

The bridge's per-session 30 s cwd probe SHALL:

- Run a single `fs.access` check for `<cwd>/.jj/` before invoking any `jj` subprocess.
- Skip all jj probes if `.jj/` is absent (no subprocess spawn).
- Run `jj st --no-pager` and `jj workspace list --no-pager` in parallel only when `.jj/` exists.
- Update `Session.jjState` and broadcast via the existing `session_updated` message.

The probe SHALL populate `JjState.workspaceRoot` with the **parent repo root** — the directory shared by every workspace of the repo (which equals the working-copy directory for the default workspace and is the parent of `.shadow/<name>/` for any `jj workspace add`-created workspace). The probe SHALL derive this value by reading the `<cwd>/.jj/repo` filesystem entry: when it is a directory, cwd is the default workspace and `workspaceRoot` equals cwd; when it is a file containing a relative path to the shared storage `.jj/repo`, `workspaceRoot` equals the parent of the resolved storage directory. The probe SHALL NOT use `jj workspace root` (or its alias `jj root`) as the primary derivation, since both return the current workspace's own working-copy directory and would defeat the workspace-aware grouping rule documented in the "Workspace sessions group under their parent repo" requirement.

The probe SHALL canonicalize the derived `workspaceRoot` via the operating system's `realpath` before assigning it, so the value compares equal to canonicalized `cwd` values under symlinked filesystems (e.g. macOS `/tmp` → `/private/tmp`).

If reading `.jj/repo` fails (corruption, permission, transient I/O), the probe SHALL fall back to `jj workspace root` and record the error in `JjState.lastError`. The probe SHALL NOT return `undefined` for `workspaceRoot` solely because the filesystem read failed, since a non-empty `workspaceRoot` gates the badge and workspace-list UI.

#### Scenario: Non-jj cwd incurs no jj subprocess cost

- **GIVEN** a session cwd of `/home/user/plain-folder` with no `.jj/`
- **WHEN** the bridge probe tick fires
- **THEN** zero `jj` subprocesses SHALL be spawned
- **AND** `Session.jjState` SHALL remain undefined or `{ isJjRepo: false }`

#### Scenario: Default-workspace probe sets workspaceRoot to the repo root (== cwd)

- **GIVEN** a colocated repo at `/repo` (i.e. `/repo/.git/` and `/repo/.jj/` both exist) and no additional `jj workspace add`-created workspaces
- **AND** a session cwd of `/repo`
- **WHEN** the bridge probe tick fires
- **THEN** `Session.jjState.workspaceRoot` SHALL equal `/repo`
- **AND** `Session.jjState.workspaceName` SHALL equal `"default"`

#### Scenario: Non-default-workspace probe sets workspaceRoot to the parent repo root

- **GIVEN** a colocated repo at `/repo` with an added workspace at `/repo/.shadow/np-tp/` (`jj workspace add /repo/.shadow/np-tp`)
- **AND** a session cwd of `/repo/.shadow/np-tp/`
- **WHEN** the bridge probe tick fires
- **THEN** `Session.jjState.workspaceRoot` SHALL equal `/repo` (the parent repo root, NOT the workspace's own cwd)
- **AND** `Session.jjState.workspaceName` SHALL equal `"np-tp"`

#### Scenario: Repo-root derivation failure falls back gracefully

- **GIVEN** a jj repo where the `.jj/repo` filesystem read fails (corruption, permission, transient I/O)
- **WHEN** the bridge probe tick fires
- **THEN** `Session.jjState.workspaceRoot` SHALL still be populated (falling back to the `jj workspace root` subprocess value)
- **AND** `Session.jjState.lastError` SHALL describe the underlying failure
- **AND** the badge / workspace-list UI SHALL continue to render
