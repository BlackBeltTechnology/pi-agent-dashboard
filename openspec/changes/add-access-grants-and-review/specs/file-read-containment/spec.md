## MODIFIED Requirements

### Requirement: File-read containment anchors at the git common root with a layered cwd fast path

The localhost file routes SHALL contain every resolved absolute path using a layered check evaluated in order, at each of the seven containment sites in `file-routes.ts` (`GET /api/file` read/raw/render/preview, `exists`, and the two office/EML gates):

1. If the resolved path is the session `cwd` or under `cwd + path.sep`, it SHALL
   be allowed without invoking git.
2. Otherwise, let `root` be the git common root of `cwd`
   (`dirname` of `git -C cwd rev-parse --path-format=absolute
   --git-common-dir`). If `root !== cwd` AND the **real** resolved path
   (`fs.realpath`) is the root or under `root + path.sep`, it SHALL be allowed.
3. Otherwise, if the **real** resolved path is a persisted grant directory or
   lies under one, it SHALL be allowed. This check SHALL resolve symlinks but
   SHALL perform no git-root resolution, so a grant never widens beyond the
   directory named in it and never admits a symlink escaping it.
4. Otherwise the request SHALL be rejected with HTTP 403 and body
   `{ success: false, error: "path outside working directory" }`, carrying the
   remedy fields described below.

Layers 1 and 2 and their per-site anchor sets SHALL be unchanged, including the `homePiAnchor()` (`~/.pi`) anchor used by the render and preview sites and the pinned-directory anchor used by `GET /api/file/exists`. Layer 1 is a performance fast path and MUST NOT allow anything layer 2 would reject.

With an empty grant store, the outcome of every check SHALL be identical to layers 1–2 alone.

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

- **WHEN** the resolved path is `/etc/passwd` (outside both `cwd` and the git common root) and no grant covers it
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

#### Scenario: granted directory admits an otherwise-outside path

- **GIVEN** `/other/repo` is a persisted grant
- **WHEN** the resolved path is `/other/repo/README.md`, outside both `cwd` and the git common root
- **THEN** the read SHALL be allowed at layer 3

#### Scenario: a grant does not widen to its git root

- **GIVEN** `/other/repo/sub` is a persisted grant and `/other/repo` is a git repository
- **WHEN** the resolved path is `/other/repo/elsewhere/secret.txt`
- **THEN** the read SHALL be refused — layer 3 SHALL NOT admit the repository root

#### Scenario: a symlink escaping a granted directory is refused at layer 3

- **GIVEN** `/other/repo/sub` is a persisted grant containing a symlink to `/etc`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be refused

#### Scenario: the ~/.pi anchor is preserved

- **GIVEN** the render and preview sites anchor on `cwd` plus `~/.pi`
- **WHEN** a path under `~/.pi` is read through one of those sites
- **THEN** it SHALL be allowed exactly as before this change

#### Scenario: the denial names its remedy

- **GIVEN** no grant covers the path
- **WHEN** the resolved path falls outside layers 1–3
- **THEN** the 403 SHALL carry the containing directory as the grantable subject, so a remedy surface can offer it
- **AND** the pre-existing `error` string SHALL be unchanged

#### Scenario: an ungranted outside path is refused exactly as today

- **GIVEN** no grant covers the path
- **WHEN** the resolved path falls outside layers 1–3
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`, unchanged from the pre-existing rejection body, and with no suspension of the request

#### Scenario: gate sites keep their own rejection shapes

- **GIVEN** the `gateFilePath` and `gateOfficeFile` sites reject with a `{ code, error }` body rather than `{ success, error }`
- **WHEN** a denial at one of those sites is refused
- **THEN** that site's existing body shape SHALL be preserved unchanged
