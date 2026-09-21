## MODIFIED Requirements

### Requirement: File-read containment anchors at the git common root with a layered cwd fast path

The localhost file routes SHALL contain every resolved absolute path using a layered check evaluated in order, at each of the ten containment sites: seven in `file-routes.ts` (`GET /api/file` read, `GET /api/file/tree`, `GET /api/file/exists`, `GET /api/file/raw`, `GET /api/file/render`, and the two gate helpers `gateFilePath` / `gateOfficeFile` — `gateFilePath` gates the EML routes and the `POST /api/open-in-system` / `POST /api/reveal-in-file-manager` system-open endpoints, `gateOfficeFile` the office/render/sheet routes), the grep-result filter in `grep-routes.ts`, the file-mention resolver in `resolve-file-mention.ts`, and the session-directory check in `session-routes.ts` (which carries its own rejection string, `"path outside session directory"`). The local lexical cwd check in `openspec-routes.ts` is NOT a containment site and is out of scope. Each site passes its own set of **containment anchors** — the session `cwd`, plus any site-specific anchor: `homePiAnchor()` (`~/.pi`) for the read, raw, render, and mention sites, and the pinned directories for `exists`. Per-site anchor sets are unchanged by this requirement. For each containment anchor:

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
3. When no anchor allows the path at layers 1–2, and no pre-existing site-local
   admission applies (the image-only artifact-root admission at
   `file-routes.ts:746`, labelled "Layer ③" in source, is evaluated first and is
   unchanged), the **grant layer** SHALL allow the path when its **real**
   resolved path is a grant directory or lies under one. This check SHALL
   resolve symlinks on the requested path, SHALL compare against the stored
   subject without re-resolving it, and SHALL perform no checkout-root
   resolution — so a grant never widens beyond the directory named in it and
   never admits a symlink escaping it.
4. Otherwise the request SHALL be rejected with HTTP 403, carrying the remedy
   fields described below. Each site SHALL keep its own rejection string: the
   read, tree, raw, render and gate sites reject with
   `{ success: false, error: "path outside working directory" }`, while
   `GET /api/file/exists` rejects with `"unknown cwd"` / `"path outside cwd"`
   exactly as it does today.

Layer 1 is a performance fast path and MUST NOT allow anything layer 2 would reject. The checkout roots SHALL be derived from the checkout-root resolver, NOT from the parent of `--git-common-dir`: the parent derivation names a real checkout only when the git dir happens to sit inside it, so a submodule or `--separate-git-dir` session was previously confined to `cwd` alone even though its own checkout is the natural boundary.

No checkout root SHALL reach beyond the checkouts the anchor's repository owns. In particular a submodule session SHALL NOT gain reach into its superproject, a worktree of a bare hub SHALL NOT gain reach into the directory holding the hub, and a `--separate-git-dir` session SHALL NOT gain reach into the directory holding its git dir.

Layers 1 and 2 and their per-site anchor sets SHALL be unchanged by this change, including the `homePiAnchor()` (`~/.pi`) anchor on the read, raw, render, and mention sites and the pinned-directory anchor on `GET /api/file/exists`. With an empty grant store, the outcome of every check SHALL be identical to layers 1–2 alone.

Two of the ten sites have no response body in which to carry remedy fields: `grep-routes.ts` filters non-contained matches out of its result set, and `resolve-file-mention.ts` returns no mention. They SHALL consume grants and SHALL NOT be changed to emit a denial body.

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

- **WHEN** the resolved path is `/etc/passwd` (outside both `cwd` and every checkout anchor) and no grant covers it
- **THEN** the response SHALL be HTTP 403 with `{ success: false, error: "path outside working directory" }`

#### Scenario: an unbound core.worktree does not widen containment

- **GIVEN** a repository whose repository-local `core.worktree` points at a path outside the repository (`/`, the user's home directory, or an unrelated checkout), so the resolver reports that path as a checkout root
- **WHEN** a session in that repository requests a resolved path under that configured directory but outside the repository's real checkouts
- **THEN** the request SHALL be rejected with HTTP 403
- **AND** the configured path SHALL NOT be used as a containment anchor, because it does not resolve back to the same repository

#### Scenario: granted directory admits an otherwise-outside path

- **GIVEN** `/other/repo` is a persisted grant
- **WHEN** the resolved path is `/other/repo/README.md`, outside every anchor and its bound checkout roots
- **THEN** the read SHALL be allowed at layer 3

#### Scenario: a grant does not widen to its checkout root

- **GIVEN** `/other/repo/sub` is a persisted grant and `/other/repo` is a git repository
- **WHEN** the resolved path is `/other/repo/elsewhere/secret.txt`
- **THEN** the read SHALL be refused — layer 3 SHALL NOT admit the repository's checkout root

#### Scenario: a symlink escaping a granted directory is refused at layer 3

- **GIVEN** `/other/repo/sub` is a persisted grant containing a symlink to `/etc`
- **WHEN** a read resolves through that symlink
- **THEN** it SHALL be refused

#### Scenario: the ~/.pi anchor is preserved

- **GIVEN** the read, raw, render, and mention sites anchor on `cwd` plus `~/.pi`
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

#### Scenario: the exists site keeps its own rejection strings

- **GIVEN** `GET /api/file/exists` rejects with `"unknown cwd"` and `"path outside cwd"`
- **WHEN** a probe is refused at that site
- **THEN** those strings SHALL be unchanged, and SHALL NOT be replaced by `"path outside working directory"`

#### Scenario: the artifact-root admission is evaluated before the grant layer

- **GIVEN** `GET /api/file/raw` admits images under an artifact root independently of containment
- **WHEN** such an image is requested with an empty grant store
- **THEN** it SHALL be admitted exactly as before this change, without consulting the grant layer

#### Scenario: containment outcomes are unchanged, though body assertions widen

- **GIVEN** the pre-existing containment suite asserts denial bodies by strict equality
- **WHEN** the additive remedy fields ship
- **THEN** every allow SHALL remain an allow and every refusal SHALL remain a refusal with the same status code and the same `error` string
- **AND** the only permitted test change SHALL be widening those body assertions — no status code and no `error` string SHALL be edited

#### Scenario: the body-less sites carry no remedy fields

- **WHEN** a grep match or a file mention is dropped by containment
- **THEN** no denial body SHALL be introduced at that site

#### Scenario: gate sites keep their existing wire shape

- **GIVEN** `gateFilePath` and `gateOfficeFile` return `{ code, error }` to their callers, and every caller converts it to `{ success: false, error }` before replying
- **WHEN** a denial at one of those sites is refused
- **THEN** the wire body SHALL remain `{ success, error }` with the same status code
- **AND** the internal `{ code, error }` return SHALL NOT be emitted on the wire, because doing so would change the response rather than extend it

#### Scenario: the session-directory site is covered

- **GIVEN** `session-routes.ts` refuses a path outside the session directory with the string `"path outside session directory"`
- **WHEN** a grant covers that path
- **THEN** the grant layer SHALL admit it at that site as at the others
- **AND** when no grant covers it, the refusal string SHALL be unchanged
