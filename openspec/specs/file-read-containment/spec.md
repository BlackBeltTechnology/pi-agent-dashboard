# file-read-containment Specification

## Purpose
Define how the localhost file routes contain resolved absolute paths: anchor at the git common root with a layered cwd fast path, fail closed to cwd-only when git resolution is degraded, resolve symlinks before the git-root compare, and preserve each route's anchor set and rejection strings.
## Requirements
### Requirement: File-read containment anchors at the git common root with a layered cwd fast path

The localhost file routes SHALL contain every resolved absolute path using a layered check evaluated in order (`GET /api/file` read/raw/preview and the `system-routes` file target):

1. If the resolved path is the session `cwd` or under `cwd + path.sep`, it SHALL
   be allowed without invoking git.
2. Otherwise, let `root` be the git common root of `cwd`
   (`dirname` of `git -C cwd rev-parse --path-format=absolute
   --git-common-dir`). If `root !== cwd` AND the **real** resolved path
   (`fs.realpath`) is the root or under `root + path.sep`, it SHALL be allowed.
3. Otherwise the request SHALL be rejected with HTTP 403 and body
   `{ success: false, error: "path outside working directory" }`.

The allowed set equals the git-common-root subtree; layer 1 is a performance
fast path and MUST NOT allow anything layer 2 would reject.

#### Scenario: file inside the session cwd

- **WHEN** the resolved path is under the session `cwd`
- **THEN** the read SHALL be allowed without spawning git

#### Scenario: worktree session reads a parent-tree file

- **GIVEN** `cwd` is a git worktree (`…/repo/.worktrees/x`) whose common root is `…/repo`
- **WHEN** the resolved path is `…/repo/node_modules/vitest/package.json` (above the worktree, under the common root)
- **THEN** the read SHALL be allowed (HTTP 200)

#### Scenario: repo-subdir session reads a root-level file

- **GIVEN** `cwd` is a strict subdirectory of a repo (e.g. `…/repo/packages/server`) whose common root is `…/repo`
- **WHEN** the resolved path is a root-level file `…/repo/.env` (above the cwd, under the common root)
- **THEN** the read SHALL be allowed (HTTP 200) — the widening is not limited to worktrees

#### Scenario: path outside the git root is rejected

- **WHEN** the resolved path is `/etc/passwd` (outside both `cwd` and the git common root)
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

### Requirement: git-root resolution fails closed to cwd-only containment

`gitRoot(cwd)` SHALL return `cwd` itself whenever the git common root cannot be
determined (cwd not in a repository, `git` unavailable, spawn failure, or
unexpected output). When `gitRoot(cwd) === cwd`, layer 2 SHALL be a no-op and
containment SHALL reduce to cwd-only. A degraded git environment SHALL NOT widen
the allowed set. The git-root value and the resolved path SHALL be normalized to
native path separators and canonical drive-letter case before the containment
compare, so a forward-slash git root cannot fail to match a native-separator
resolved path on Windows.

#### Scenario: cwd is not a git repository

- **GIVEN** `cwd` is a plain directory not under any `.git`
- **WHEN** a resolved path outside `cwd` is requested
- **THEN** the request SHALL be rejected exactly as cwd-only containment would

#### Scenario: git-root and resolved path differ only by separator style

- **GIVEN** the git common root is reported with forward slashes and the resolved path uses native separators (Windows)
- **WHEN** the resolved path is under the git root after normalization
- **THEN** containment SHALL match (the compare SHALL NOT fail on separator or drive-letter case)

### Requirement: layer 2 resolves symlinks before the containment compare

Before the git-root containment compare, the resolved path SHALL be passed
through `fs.realpath`, so a symlink whose real target escapes the git common
root SHALL be rejected even when its logical path appears contained.

#### Scenario: symlink escaping the git root is rejected

- **GIVEN** a symlink under the git root whose real target is outside the git root
- **WHEN** a read resolves through that symlink in layer 2
- **THEN** the request SHALL be rejected with HTTP 403

### Requirement: the git-root widening is unconditional and per-site anchors and error strings are preserved

The git common root SHALL be the containment trust boundary for every caller; the layer-2 widening SHALL NOT depend on the request source (loopback, trusted-network, and authenticated requests are treated identically). The shared helper SHALL be parameterized by the calling route's anchor set and rejection string so each route preserves its existing behavior: `GET /api/file`, `GET /api/file/raw`, `GET /api/file/render`, and the `system-routes` file target SHALL anchor on `cwd` and reject with `"path outside working directory"`; `GET /api/file/exists` SHALL anchor on `cwd` plus the pinned directories and reject with `"unknown cwd"` / `"path outside cwd"`. This change SHALL NOT extend the pinned-directory anchor to the read, raw, or render routes.

#### Scenario: authenticated remote request reads within the repo

- **GIVEN** an authenticated non-loopback request that has cleared `networkGuard`
- **WHEN** it requests a path under the session's git common root but outside the worktree `cwd`
- **THEN** the read SHALL be allowed (no loopback restriction on the widening)

#### Scenario: exists route keeps its pinned-directory anchor

- **GIVEN** a directory registered as a pinned directory but not equal to any session `cwd`
- **WHEN** `GET /api/file/exists` probes a path inside that pinned directory
- **THEN** the probe SHALL be permitted and a missing target SHALL return `"not found"`, while an out-of-anchor path SHALL be rejected with `"path outside cwd"`

#### Scenario: read route does not inherit the pinned-directory anchor

- **WHEN** `GET /api/file` requests a path inside a pinned directory that is outside every session `cwd` and its git root
- **THEN** the request SHALL be rejected with `"path outside working directory"`

