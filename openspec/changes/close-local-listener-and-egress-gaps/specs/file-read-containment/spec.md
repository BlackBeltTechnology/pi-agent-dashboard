## MODIFIED Requirements

### Requirement: File-read containment anchors at the git common root with a layered cwd fast path

The localhost file routes SHALL contain every resolved absolute path using a layered check evaluated in order, at each of the ten containment sites: seven in `file-routes.ts` (`GET /api/file` read, `GET /api/file/tree`, `GET /api/file/exists`, `GET /api/file/raw`, `GET /api/file/render`, and the two gate helpers `gateFilePath` / `gateOfficeFile` — `gateFilePath` gates the EML routes and the `POST /api/open-in-system` / `POST /api/reveal-in-file-manager` system-open endpoints, `gateOfficeFile` the office/render/sheet routes), the grep-result filter in `grep-routes.ts`, the file-mention resolver in `resolve-file-mention.ts`, and the session-directory check in `session-routes.ts` (which carries its own rejection string, `"path outside session directory"`). The local lexical cwd check in `openspec-routes.ts` is NOT a containment site and is out of scope. Each site passes its own set of **containment anchors** — the session `cwd`, plus any site-specific anchor: `homePiAnchor()` (`~/.pi`) for the read, raw, render, and mention sites, and the pinned directories for `exists`. Per-site anchor sets are unchanged by this requirement, except that a path inside the dashboard state directory, or that is a pi-agent credential file, is first decided by the "Dashboard state is never served to an unproven caller" requirement of `trust-and-credential-boundaries` (on the resolved real path, before containment, and at the session-directory site before containment, which has no lexical in-cwd shortcut): an always-refused path (`<dashboard dir>/local/**`, `identity.key` and the pi-agent credential files) is refused for every caller, and a trust-gated path is refused for a caller that is not locally trusted and holds no login session; a path that passes falls through to these anchors unchanged. For each containment anchor:

1. If the resolved path is the anchor or under `anchor + path.sep`, and its real
   path is the anchor's real path or under it ("Layer ① is decided on real
   paths"), it SHALL be allowed without invoking git.
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

Layer 2 and the per-site anchor sets SHALL be unchanged by this change (layer 1's lexical test is kept and is now also required to hold on real paths), including the `homePiAnchor()` (`~/.pi`) anchor on the read, raw, render, and mention sites and the pinned-directory anchor on `GET /api/file/exists`. With an empty grant store, the outcome of every check SHALL be identical to layers 1–2 alone.

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
- **THEN** it SHALL be allowed exactly as before this change, unless the path is refused by the credential-and-state refusal of `trust-and-credential-boundaries` (the dashboard state directory `~/.pi/dashboard/` and the pi-agent credential files)

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

#### Scenario: symlinked cwd accepts both spellings

- **GIVEN** an admitted request `cwd` `/tmp/link` that is a symlink to `/real/proj` (not a git repository)
- **WHEN** `GET /api/file` requests the absolute path `/real/proj/a.txt`, and separately the absolute path `/tmp/link/a.txt`, and separately the relative path `a.txt`
- **THEN** each read SHALL be allowed
- **AND** a relative path `../outside.txt` SHALL be rejected with HTTP 403 `"path outside working directory"`

#### Scenario: the session-directory in-cwd shortcut is not exempt from the credential-and-state refusal

- **GIVEN** a session whose cwd is `$HOME`
- **WHEN** a path under `~/.pi/agent` naming a pi-agent credential file is requested at the session-directory site (`GET /api/session-file`) by a path lexically inside the cwd
- **THEN** the credential-and-state refusal SHALL run before containment (the site has no lexical in-cwd shortcut) and the request SHALL be refused with `"path outside session directory"`

### Requirement: Containment decisions are bound to the path they decided

`evaluateContainment` SHALL return, on every outcome (including the dashboard-secret refusal, the post-hold re-evaluation allow and a `quiet` refusal), the exact `resolved` string it was asked to decide, in addition to `allowed` and `viaGrant`. `@blackbelt-technology/pi-dashboard-shared` SHALL export `containmentAllows(decision, resolved)`, a synchronous predicate that returns true only when `decision.allowed` is true AND `decision.resolved` is exactly equal to `resolved`; its `decision` parameter SHALL be a branded type that only `containment-gate.ts` constructs. `containment-gate.ts` SHALL also export `decidePassive(resolved, anchors, { allowGrant })` for sites that consume grants without originating a denial: it decides on layers ①/② and, only with `allowGrant`, the grant layer, records no denial, holds nothing, and returns the same decision shape. Every containment site SHALL admit a path only when `containmentAllows(decision, resolved)` is true, and SHALL use the same `resolved` string for the read or serve that follows. A refusal keeps its existing form: a 403 body at body-bearing sites, a filtered-out match in `grep-routes.ts`, a `null` mention in `resolve-file-mention.ts`. Relative to the behaviour of the change that introduced this binding, allowed paths, refused paths, refusal bodies, status codes, per-site anchors, the Layer-③ artifact-root order at the raw site, grant consumption and the suspend/hold flow SHALL be unchanged; the only permitted differences are refusals added later by the credential-and-state refusal of `trust-and-credential-boundaries` (dashboard state and pi-agent credential files, including its opened-handle recheck), the grep identity filter that drops matches whose device and inode equal an always-refused file, and the real-path refusal of a lexically contained path whose real path escapes ("Layer ① is decided on real paths"). An admitting decision additionally carries the real path it decided.

#### Scenario: A decision for one path does not admit another
- **WHEN** `containmentAllows` is called with a decision for `/p/a.txt` and the path `/p/b.txt`
- **THEN** it returns false

#### Scenario: An allowed decision for the same path admits it
- **WHEN** `evaluateContainment` allows `/p/a.txt` and the site calls `containmentAllows(decision, "/p/a.txt")`
- **THEN** it returns true and the read proceeds exactly as before

#### Scenario: A refused decision never admits
- **WHEN** the decision is refused (including the dashboard-secret refusal)
- **THEN** `containmentAllows` returns false for every path and the site answers its existing refusal

#### Scenario: Static analysis recognises the guard
- **WHEN** CodeQL analyses a handler that branches on `containmentAllows(decision, resolved)` before reading `resolved`
- **THEN** the guarded read is not reported as `js/path-injection`, while an unguarded read, a read of a different path, and a decision that is never branched on are still reported

#### Scenario: An operator-approved held read is still admitted
- **WHEN** a read is refused, suspended, the operator allows it, and the re-evaluation allows it
- **THEN** the returned decision carries the same `resolved` and `containmentAllows` is true, so the read is served as before

#### Scenario: Passive sites keep consuming grants
- **WHEN** a grep match or a file mention is outside the anchors but covered by a grant
- **THEN** `decidePassive(..., { allowGrant: true })` allows it, it is kept, and no denial is recorded

#### Scenario: A credential-and-state refusal is not a containment regression
- **WHEN** a path that the layered containment would allow is refused because it is a pi-agent credential file or dashboard state
- **THEN** the refusal keeps the site's existing refusal form (403 body, filtered grep match, `null` mention)
- **AND** it is not a change to allowed paths, anchors or status codes for any other path

#### Scenario: The grep identity filter does not change which paths are allowed
- **WHEN** a grep match comes from a file whose device and inode equal an always-refused file
- **THEN** the match SHALL be dropped
- **AND** matches from every other contained path SHALL be kept as before

#### Scenario: A real-path refusal is not a containment regression
- **WHEN** a lexically contained path is refused because its real path escapes every anchor, checkout root and grant
- **THEN** the refusal keeps the site's existing refusal form
- **AND** it is not a change to allowed paths, anchors or status codes for any path whose real path is contained

## ADDED Requirements

### Requirement: Layer ① is decided on real paths

Layer ① SHALL admit a path only when it is lexically under the anchor and its real path (nearest existing ancestor when absent) is under the anchor's real path; a failing path SHALL be decided by layer ②, the grant layer and the remedy like any outside path. Every site deciding through `isAllowed`, including `GET /api/session-file`, SHALL apply this and SHALL NOT use a lexical in-cwd shortcut.

#### Scenario: an in-cwd symlink to an outside file is refused

- **GIVEN** `<cwd>/link` is a symlink to `/srv/other/secret.txt` and no grant covers `/srv/other`
- **WHEN** an `observe` caller requests `GET /api/file?cwd=<cwd>&path=link`
- **THEN** the response SHALL be HTTP 403 `{ success: false, error: "path outside working directory" }` carrying the remedy subject `/srv/other`
- **AND** no byte of the target SHALL be served

#### Scenario: an in-cwd symlink through a directory link is refused

- **GIVEN** `<cwd>/d` is a symlink to `/etc` and `/etc/hosts` exists
- **WHEN** `GET /api/file` requests `d/hosts`
- **THEN** the request SHALL be refused with HTTP 403

#### Scenario: a symlink that stays inside the anchor is admitted

- **GIVEN** `<cwd>/node_modules/a` is a symlink to `<cwd>/node_modules/.pnpm/a@1/node_modules/a`
- **WHEN** a file under it is read
- **THEN** the read SHALL be allowed without spawning git

#### Scenario: a symlink to a granted directory is admitted

- **GIVEN** `<cwd>/link` points into `/other/repo/sub` and `/other/repo/sub` is a persisted grant
- **WHEN** the link is read
- **THEN** the read SHALL be allowed at the grant layer

#### Scenario: a symlinked anchor is compared on its real path

- **GIVEN** `~/.pi` is a symlink to `/dotfiles/pi`
- **WHEN** a file under `~/.pi/agent/skills` is read through the `~/.pi` anchor
- **THEN** the read SHALL be allowed exactly as before

#### Scenario: passive sites drop an escaping link

- **WHEN** a grep match or a file mention resolves through a symlink whose real target is outside every anchor, root and grant
- **THEN** the match SHALL be dropped and the mention SHALL be null

#### Scenario: a link loop or dangling link keeps the site's not-found mapping

- **GIVEN** `<cwd>/a` is a symlink loop, or `<cwd>/l` is a symlink whose target does not exist
- **WHEN** `GET /api/file` requests it
- **THEN** the response SHALL be the site's existing not-found answer (HTTP 404 `"not found"`) and no byte SHALL be served

#### Scenario: the session-file route has no lexical shortcut

- **GIVEN** a session whose cwd contains a symlink to `/etc/hosts`
- **WHEN** `GET /api/session-file` requests the link by a path lexically inside the cwd
- **THEN** the response SHALL be HTTP 403 `"path outside session directory"`

### Requirement: An opened handle is the file containment decided

An admitting containment decision, including a grant or post-hold one, SHALL carry the real path it decided. Every content open that follows such a decision SHALL, after opening and before reading, require that `fs.realpath` of the opened path equals that real path and that the handle's device and inode equal those of that real path; otherwise it SHALL close the handle and refuse in the site's existing refusal form. Opens with no decision in scope are unchanged.

#### Scenario: a link swapped in after the decision serves nothing

- **GIVEN** a regular file `<cwd>/a` was admitted by a decision
- **WHEN** `<cwd>/a` is replaced by a symlink to an outside file before the open completes
- **THEN** the open SHALL be refused with the site's existing 403 shape and no byte SHALL be read

#### Scenario: a swapped intermediate directory is refused

- **GIVEN** `<cwd>/d/a` was admitted and `<cwd>/d` is then replaced by a symlink to an outside directory
- **WHEN** the open of `<cwd>/d/a` completes
- **THEN** the open SHALL be refused

#### Scenario: a link into a granted directory is opened bound to the grant's real path

- **GIVEN** `<cwd>/link` points to `/other/repo/sub/a`, `/other/repo/sub` is a grant, and the decision carries `/other/repo/sub/a`
- **WHEN** `/other/repo/sub/a` is replaced by a symlink to an outside file before the open completes
- **THEN** the open SHALL be refused with the site's existing 403 shape

#### Scenario: a read admitted after an operator hold is opened bound

- **GIVEN** a read was held, allowed once by the operator and re-evaluated as allowed
- **WHEN** the file is swapped for a symlink before the open completes
- **THEN** the open SHALL be refused

#### Scenario: an I/O error inside the binding check refuses

- **WHEN** the post-open `fs.realpath` or the handle's `stat` fails (for example `EACCES` or `EIO`)
- **THEN** the handle SHALL be closed and the open refused in the site's existing 403 shape, never as a 2xx or 500

#### Scenario: an unchanged file opens normally

- **WHEN** nothing changes between the decision and the open
- **THEN** the read SHALL be served exactly as before

### Requirement: A program handed a gated path receives the decided real path

A route that, after an admitting containment decision, hands a file path to an out-of-process program (the document converter, the OS opener) SHALL pass the decision's real path, not the lexical path; the docx HTML-fallback read SHALL open bound to it. After any conversion (`rendered-pdf`, `/api/file/render`) the real path's device and inode SHALL equal those taken before it; otherwise the output SHALL be deleted, no cache entry kept, and the request refused with the site's 403 shape.

#### Scenario: the converter is given the real path

- **GIVEN** `<cwd>/a.docx` is a regular file admitted by the gate
- **WHEN** `GET /api/file/rendered-pdf` converts it
- **THEN** the converter SHALL receive the decided real path of `<cwd>/a.docx`

#### Scenario: a file swapped during conversion is not streamed

- **GIVEN** a conversion of an admitted `.docx` is running
- **WHEN** the real path's device or inode differs after it finishes
- **THEN** the output SHALL be discarded and the response SHALL be HTTP 403 `"path outside working directory"`

#### Scenario: a docx swapped during the HTML fallback is refused

- **GIVEN** `GET /api/file/render` falls back to HTML for an admitted `<cwd>/a.docx`
- **WHEN** `<cwd>/a.docx` is replaced by a symlink to an outside file before the fallback read completes
- **THEN** the response SHALL be HTTP 403 `"path outside working directory"` and no byte of the target SHALL be rendered

#### Scenario: a swap during render conversion leaves no cache entry

- **GIVEN** `GET /api/file/render` converts an admitted `.docx` or `.pptx` to PDF
- **WHEN** the real path's device or inode differs after the conversion
- **THEN** the output SHALL be deleted, no cache entry SHALL remain, the response SHALL be HTTP 403, and a later `GET /api/file/rendered-pdf` SHALL re-convert or refuse

#### Scenario: the OS opener launches the decided real path

- **GIVEN** `<cwd>/l` is an in-anchor symlink to `<cwd>/real.txt`
- **WHEN** `POST /api/open-in-system` or its reveal twin names `l`
- **THEN** the opener SHALL be launched with the real path of `<cwd>/real.txt`
