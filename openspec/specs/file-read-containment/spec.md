# file-read-containment Specification

## Purpose
Define how the localhost file routes contain resolved absolute paths: anchor at the git common root with a layered cwd fast path, fail closed to cwd-only when git resolution is degraded, resolve symlinks before the git-root compare, and preserve each route's anchor set and rejection strings.

## Requirements

### Requirement: File-read containment anchors at the git common root with a layered cwd fast path

The localhost file routes SHALL contain every resolved absolute path using a layered check evaluated in order, at each of the nine containment sites: seven in `file-routes.ts` (`GET /api/file` read, `GET /api/file/tree`, `GET /api/file/exists`, `GET /api/file/raw`, `GET /api/file/render`, and the two gate helpers `gateFilePath` / `gateOfficeFile` — `gateFilePath` gates the EML routes and the `POST /api/open-in-system` / `POST /api/reveal-in-file-manager` system-open endpoints, `gateOfficeFile` the office/render/sheet routes), the grep-result filter in `grep-routes.ts`, and the file-mention resolver in `resolve-file-mention.ts`. Each site passes its own set of **containment anchors** — the session `cwd`, plus any site-specific anchor: `homePiAnchor()` (`~/.pi`) for the read, raw, render, and mention sites, and the pinned directories for `exists`. Per-site anchor sets are unchanged by this requirement. For each containment anchor:

1. If the resolved path is the anchor or under `anchor + path.sep`, it SHALL
   be allowed without invoking git.
2. Otherwise, let the **checkout roots** of the anchor be the resolved checkout
   roots of that anchor (`git-checkout-root-resolution`) that are BOUND to the
   anchor's repository: `thisCheckout` (the checkout containing the anchor)
   and `mainCheckout` (the repository's primary working tree), each included
   only when it is non-null and passes the repository-binding check of
   `git-checkout-root-resolution`, deduplicated when equal. If the **real**
   resolved path (`fs.realpath`) is one of those roots or under
   `root + path.sep`, and that root is not the anchor itself, it SHALL be
   allowed.
3. When no anchor allows the path, the request SHALL be rejected with HTTP 403
   and body `{ success: false, error: "path outside working directory" }`.

For a site whose only anchor is the session `cwd`, the allowed set equals the
union of the session's own checkout subtree and, for a linked worktree, the
main checkout subtree. Layer 1 is a performance fast path and MUST NOT allow
anything layer 2 would reject. The checkout roots SHALL be derived from the
checkout-root resolver, NOT from the parent of `--git-common-dir`: the parent
derivation names a real checkout only when the git dir happens to sit inside
it, so a submodule or `--separate-git-dir` session was previously confined to
`cwd` alone even though its own checkout is the natural boundary.

No checkout root SHALL reach beyond the checkouts the anchor's repository owns. In particular a
submodule session SHALL NOT gain reach into its superproject, a worktree of a
bare hub SHALL NOT gain reach into the directory holding the hub, and a
`--separate-git-dir` session SHALL NOT gain reach into the directory holding
its git dir.

#### Scenario: file inside the session cwd

- **WHEN** the resolved path is under the session `cwd`
- **THEN** the read SHALL be allowed without spawning git

#### Scenario: worktree session reads a parent-tree file

- **GIVEN** `cwd` is a git worktree (`…/repo/.worktrees/x`) whose main checkout is `…/repo`
- **WHEN** the resolved path is `…/repo/node_modules/vitest/package.json` (above the worktree, under the main checkout)
- **THEN** the read SHALL be allowed (HTTP 200)

#### Scenario: repo-subdir session reads a root-level file

- **GIVEN** `cwd` is a strict subdirectory of a repo (e.g. `…/repo/packages/server`) whose checkout root is `…/repo`
- **WHEN** the resolved path is a root-level file `…/repo/.env` (above the cwd, under the checkout root)
- **THEN** the read SHALL be allowed (HTTP 200) — the widening is not limited to worktrees

#### Scenario: submodule session reads its own checkout but not the superproject

- **GIVEN** `cwd` is a subdirectory of a submodule checkout `/super/models/sub`
- **WHEN** the resolved path is `/super/models/sub/README.md` (above the cwd, inside the submodule checkout)
- **THEN** the read SHALL be allowed
- **AND** a resolved path of `/super/.env` (inside the superproject, outside the submodule checkout) SHALL be rejected with HTTP 403

#### Scenario: worktree of a submodule reads the submodule checkout

- **GIVEN** `cwd` is a worktree created from inside a submodule at `/super/models/sub`, whose common dir is `/super/.git/modules/models/sub`
- **WHEN** the resolved path is a file under `/super/models/sub`
- **THEN** the read SHALL be allowed
- **AND** a resolved path under `/super/.git/modules/models` SHALL be rejected

#### Scenario: separate-git-dir session reads its own checkout only

- **GIVEN** `cwd` is a subdirectory of a checkout `/work/app` created with `--separate-git-dir=/elsewhere/app.git`
- **WHEN** the resolved path is `/work/app/README.md`
- **THEN** the read SHALL be allowed
- **AND** a resolved path under `/elsewhere` SHALL be rejected with HTTP 403

#### Scenario: worktree of a bare hub reads its own checkout only

- **GIVEN** `cwd` is a subdirectory of a worktree created from a bare hub at `/hubs/proj.git`
- **WHEN** the resolved path is a file at that worktree's root
- **THEN** the read SHALL be allowed
- **AND** a resolved path under `/hubs` SHALL be rejected with HTTP 403

#### Scenario: path outside the git root is rejected

- **WHEN** the resolved path is `/etc/passwd` (outside both `cwd` and every checkout anchor)
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

#### Scenario: an unbound core.worktree does not widen containment

- **GIVEN** a repository whose repository-local `core.worktree` points at a path outside the repository (`/`, the user's home directory, or an unrelated checkout), so the resolver reports that path as a checkout root
- **WHEN** a session in that repository requests a resolved path under that configured directory but outside the repository's real checkouts
- **THEN** the request SHALL be rejected with HTTP 403
- **AND** the configured path SHALL NOT be used as a containment anchor, because it does not resolve back to the same repository

### Requirement: git-root resolution fails closed to cwd-only containment

Checkout-root resolution for an anchor SHALL yield NO roots whenever the
checkout roots cannot be determined (anchor not in a repository, `git`
unavailable, spawn failure, probe timeout, or unexpected output), and SHALL
drop any individual root that fails the repository-binding check. When no root
remains, layer 2 SHALL be a no-op for that anchor and containment SHALL reduce
to the anchor subtree alone (cwd-only for the session anchor). A degraded git environment SHALL
NOT widen the allowed set. A bare-repository `cwd` (which resolves with no
checkout) SHALL likewise reduce to cwd-only. Each anchor and the resolved path
SHALL be normalized to native path separators and canonical drive-letter case
before the containment compare, so a forward-slash git path cannot fail to
match a native-separator resolved path on Windows. Resolution SHALL NOT block
the request's event loop: every git probe SHALL be issued asynchronously with a
bounded timeout, and a timed-out probe SHALL degrade to "no anchor", never to
a derived path.

#### Scenario: cwd is not a git repository

- **GIVEN** `cwd` is a plain directory not under any `.git`
- **WHEN** a resolved path outside `cwd` is requested
- **THEN** the request SHALL be rejected exactly as cwd-only containment would

#### Scenario: cwd is a bare repository

- **GIVEN** `cwd` is a bare repository directory (no working tree)
- **WHEN** a resolved path outside `cwd` is requested
- **THEN** the request SHALL be rejected exactly as cwd-only containment would

#### Scenario: a probe timeout fails closed

- **GIVEN** a git probe that exceeds its timeout
- **WHEN** a resolved path outside `cwd` is requested
- **THEN** the request SHALL be rejected as cwd-only containment would
- **AND** the route SHALL remain responsive to other requests while the probe is pending

#### Scenario: git-root and resolved path differ only by separator style

- **GIVEN** a checkout anchor is reported with forward slashes and the resolved path uses native separators (Windows)
- **WHEN** the resolved path is under the anchor after normalization
- **THEN** containment SHALL match (the compare SHALL NOT fail on separator or drive-letter case)

### Requirement: layer 2 resolves symlinks before the containment compare

Before the layer-2 checkout-root containment compare, the resolved path SHALL be
passed through `fs.realpath`, so a symlink whose real target escapes every
bound checkout root SHALL be rejected even when its logical path appears
contained.

#### Scenario: symlink escaping the git root is rejected

- **GIVEN** a symlink under a bound checkout root whose real target is outside every bound checkout root
- **WHEN** a read resolves through that symlink in layer 2
- **THEN** the request SHALL be rejected with HTTP 403

### Requirement: the git-root widening is unconditional and per-site anchors and error strings are preserved

The bound checkout roots of each containment anchor SHALL be the containment trust boundary for every caller; the layer-2 widening SHALL NOT depend on the request source (loopback, trusted-network, and authenticated requests are treated identically). The shared helper SHALL be parameterized by the calling route's anchor set and rejection string so each route preserves its existing behavior: `GET /api/file`, `GET /api/file/raw`, and `GET /api/file/render` SHALL anchor on `cwd` plus `~/.pi` and reject with `"path outside working directory"`; `GET /api/file/tree` and the office/EML gate helpers SHALL anchor on `cwd` alone with the same rejection string; `GET /api/file/exists` SHALL anchor on `cwd` plus the pinned directories and reject with `"unknown cwd"` / `"path outside cwd"`. There is no containment site in `system-routes`. This change SHALL NOT extend the pinned-directory anchor to the read, raw, or render routes.

#### Scenario: authenticated remote request reads within the repo

- **GIVEN** an authenticated non-loopback request that has cleared `networkGuard`
- **WHEN** it requests a path under a bound checkout root of the session but outside the worktree `cwd`
- **THEN** the read SHALL be allowed (no loopback restriction on the widening)

#### Scenario: exists route keeps its pinned-directory anchor

- **GIVEN** a directory registered as a pinned directory but not equal to any session `cwd`
- **WHEN** `GET /api/file/exists` probes a path inside that pinned directory
- **THEN** the probe SHALL be permitted and a missing target SHALL return `"not found"`, while an out-of-anchor path SHALL be rejected with `"path outside cwd"`

#### Scenario: read route does not inherit the pinned-directory anchor

- **WHEN** `GET /api/file` requests a path inside a pinned directory that is outside every session `cwd` and its bound checkout roots
- **THEN** the request SHALL be rejected with `"path outside working directory"`
