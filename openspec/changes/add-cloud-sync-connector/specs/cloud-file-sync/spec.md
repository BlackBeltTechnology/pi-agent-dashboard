# cloud-file-sync

The reconciliation completeness matrix for the bidirectional sync engine. Every
combination of local × baseline × remote state maps to exactly one safe route:
`noop | pull | push | stage-aside | report | skip+report | rebind`. Coverage is
total; automation is partial (undecidable cases route to `report`, never guess).
This spec is the checkable backbone referenced by design.md.

## ADDED Requirements

### Requirement: Structural pre-pass preempts content classification

The engine SHALL evaluate node kind and capabilities BEFORE comparing content, so
that unsupported or blocked nodes never reach the content matrix.

#### Scenario: non-regular local node
- **WHEN** the local path is a symlink, FIFO, socket, or device file
- **THEN** the engine routes to `skip+report` (non-regular node kind) and never uploads it

#### Scenario: type flip between file and directory
- **WHEN** the node kind on either side (local OR remote) differs from the baseline kind (file became a directory or vice versa)
- **THEN** the engine routes to `skip+report` (type flip) and treats it as a delete+create candidate for the human to resolve

#### Scenario: Google-native document change detection
- **WHEN** the tracked file is a Google-native doc (Docs/Sheets/Slides) with no md5
- **THEN** change detection falls back to `modifiedTime`/version (no `localHash` basis) and the file is treated as export-only

#### Scenario: Google-native document with a local edit never pushes
- **WHEN** a Google-native doc's local export was edited (would route `push` in the content matrix)
- **THEN** the engine routes to `skip+report` and NEVER pushes, because uploading would convert/overwrite the native doc on the remote (data loss); write-back is unsupported

#### Scenario: locked file with local edits
- **WHEN** the local file is modified but its cached capability `canEdit` is false
- **THEN** the engine stages the local edit as a fork in `.sync/conflicts/` and routes to `report` (cannot push a read-only file)

#### Scenario: undownloadable remote change
- **WHEN** the remote changed but `canDownload` is false
- **THEN** the engine routes to `skip+report` (unfetchable) and does not attempt a pull

### Requirement: Rename inference runs before any local-absent is treated as delete

The engine SHALL attempt to match a missing local file to a foundling before
classifying the identity as deleted, keying the ledger on remote id so that path
is an attribute, not the key.

#### Scenario: local rename detected
- **WHEN** a baseline row's `localPath` is missing AND a foundling file at a new path has a matching `localHash` or preserved inode/fileId
- **THEN** the engine routes to `rebind` (keep remote id, update path) and reclassifies the identity at its new path

#### Scenario: rename plus edit degrades safely
- **WHEN** a file was renamed AND its content changed, so no `localHash` match exists, AND the new path has no independent remote file
- **THEN** the engine treats it as delete(old)+create(new); because deletes are manual the old remote file survives as a reported orphan and the new file uploads — no data loss

#### Scenario: rename plus edit onto an occupied remote path
- **WHEN** a renamed+edited file's new path already holds an independent remote file
- **THEN** the engine routes to `stage-aside` (independent create collision) and holds the local edit — no overwrite, resolved manually

#### Scenario: ambiguous rename match
- **WHEN** a foundling's `localHash` matches multiple orphans (including two identical-content files)
- **THEN** the engine routes to `report` (ambiguous) rather than guessing a binding

### Requirement: Three-way reconciliation for tracked identities

For an identity with an existing baseline row, the engine SHALL apply the 3×3
content matrix (local vs baseline × remote vs baseline). Only clean pull and clean
push act automatically; conflicts stage; the entire local-absent row reports.

#### Scenario: in sync
- **WHEN** local equals baseline AND remote equals baseline
- **THEN** the engine routes to `noop`

#### Scenario: remote-only change
- **WHEN** local equals baseline AND remote differs from baseline
- **THEN** the engine routes to `pull` (download remote to local, advance baseline)

#### Scenario: local-only change
- **WHEN** local differs from baseline (by `localHash`) AND remote equals baseline (by `remoteVersion`) AND the row is not held
- **THEN** the engine routes to `push`, guarded by per-file caps and the write-time backstop, after a pre-write re-verify of the remote

#### Scenario: pull re-checks local before overwriting
- **WHEN** an identity is planned as `pull` but its current local hash changed from `baselineLocalHash` between scan and execute (the local file was edited in-window)
- **THEN** the engine demotes it to `stage-aside` and does NOT overwrite the local edit

#### Scenario: pull re-check finds the local file deleted
- **WHEN** an identity is planned as `pull` but the local file is absent at the pre-write re-check
- **THEN** the engine treats it as local-deleted and routes to `report`, neither pulling nor overwriting

#### Scenario: create re-checks before writing
- **WHEN** an identity is planned as `push` via `create` but at the pre-write re-check the local file was further edited, was deleted, or a remote file now occupies the target name
- **THEN** the engine re-verifies local existence + unchanged hash and runs a remote name-collision check; a changed/edited local re-plans, a deleted local routes to `report`, and a name collision routes to `stage-aside` — no blind create

#### Scenario: hot-edited file is deferred, not live-locked
- **WHEN** an identity fails its pre-write re-check 3 times within one sync run because it is under active editing
- **THEN** the engine defers it to `skip+report` ("actively editing") for that run rather than spinning indefinitely

#### Scenario: both sides changed becomes a held conflict
- **WHEN** local differs from baseline AND remote differs from baseline
- **THEN** the engine routes to `stage-aside` (fetch remote into `.sync/conflicts/`, overwrite neither side) and sets `rowState=conflict`; it does NOT advance baseline and emits NO further auto push/pull for that identity until resolved

#### Scenario: held conflict blocks auto-sync until resolved
- **WHEN** an identity has `rowState=conflict` and a later sync runs without an explicit `resolve`
- **THEN** the engine keeps the identity held (no push, no pull) and re-reports it, so a re-run can never silently push stale local content over the remote

#### Scenario: explicit resolution pushes then advances (never leaves a pending push)
- **WHEN** a human or the LLM writes merged bytes to the local file and runs `resolve <path>` AND neither side diverged again
- **THEN** the engine pushes the merged content to the remote via `update(id, mergedStream, expectVer)`, sets BOTH `baselineLocalHash` and `remoteVersion` to the post-push values, clears the held state, and the identity is now `noop` (it does NOT leave a pending push that a later run could invert into a pull)

#### Scenario: resolution when the remote diverged again
- **WHEN** `resolve <path>` runs but the remote changed since the conflict was staged
- **THEN** the engine re-stages, keeps `rowState=conflict`, and re-reports — it does not push over the newer remote

#### Scenario: resolution when the local file was deleted
- **WHEN** `resolve <path>` runs but the local file no longer exists
- **THEN** `resolve` fails with an error (nothing to merge) and the identity stays held

#### Scenario: resolution when the remote was deleted
- **WHEN** `resolve <path>` runs but the remote file was deleted since staging
- **THEN** the engine routes to `report` (deleted-remote / re-create decision) and does not silently recreate

#### Scenario: remote deleted, local unchanged
- **WHEN** local equals baseline AND the remote file is absent
- **THEN** the engine routes to `report` ("gone on remote, still local") and does not auto-delete the local file

#### Scenario: remote deleted, local modified
- **WHEN** local differs from baseline AND the remote file is absent
- **THEN** the engine routes to `report` (edit/delete conflict), keeps the local file, and offers an explicit re-push

#### Scenario: local deleted, remote unchanged
- **WHEN** the local file is absent (after rename inference) AND remote equals baseline
- **THEN** the engine routes to `report` ("deleted locally, still on remote") and does not auto-delete the remote file

#### Scenario: local deleted, remote modified
- **WHEN** the local file is absent (after rename inference) AND remote differs from baseline
- **THEN** the engine routes to `report` (delete/edit conflict) and takes no automatic action

#### Scenario: both deleted keeps a matchable tombstone
- **WHEN** the local file is absent AND the remote file is absent for a tracked identity
- **THEN** the engine routes to `report` and converts the row to a `tombstone` that REMAINS in the rename-inference pool until the next full-list reconciliation OR after `K` delta cycles (default `K=10`), whichever comes first, so a half-scanned move re-binds instead of duplicating — it is not retired after a single report, and cannot accumulate unboundedly

### Requirement: Untracked identity handling

For an identity with no baseline row, the engine SHALL classify by presence on
each side, running rename inference first so a moved file is not mistaken for new.

#### Scenario: new local file
- **WHEN** a file exists locally with no baseline row and no rename match, and no remote counterpart exists
- **THEN** the engine routes to `push` (resolved by the adapter's `create` verb, record returned id), requiring the parent folder's `canAddChildren`, else `skip+report`

#### Scenario: new remote file
- **WHEN** a file exists remotely with no baseline row and no local counterpart
- **THEN** the engine routes to `pull` (download new file, create baseline row)

#### Scenario: new local directory
- **WHEN** a directory exists locally with no baseline row (including an EMPTY directory with no children)
- **THEN** the engine routes to `push`, creating the remote folder via `createFolder` and a `nodeKind=dir` baseline row, **parent-before-child** so a child file's `create` never targets a missing parent

#### Scenario: createFolder failure skips the subtree
- **WHEN** `createFolder` for a new local directory returns `writeRejected` (permission, name collision, quota)
- **THEN** the engine routes the folder AND its whole child subtree to `skip+report`, attempting no child `create` against a missing parent id, and re-reports each run rather than silently retrying

#### Scenario: new remote directory
- **WHEN** a directory entity exists remotely with no baseline row (including an empty one)
- **THEN** the engine routes to `pull`, creating the local directory (mkdir) and a `nodeKind=dir` baseline row, before its children are reconciled

#### Scenario: independent create collision
- **WHEN** a file exists both locally and remotely with no shared baseline
- **THEN** the engine routes to `stage-aside` (create/create collision) and reports, never assuming the two are the same file; because there is no baseline row it stays held/reported each run rather than advancing baseline

### Requirement: Cross-identity and runtime overlays

The engine SHALL enforce constraints that span identities or arise at write time,
outside the per-identity matrix.

#### Scenario: name collision into one remote slot
- **WHEN** two local identities map to a single remote name (case-fold, NFC/NFD, or invalid-character normalization)
- **THEN** the engine routes both to `skip+report` and syncs neither until the collision is resolved, never silently merging

#### Scenario: any write rejection demotes a planned push
- **WHEN** an identity was planned as `push` but `update`/`create` returns `writeRejected{reason}` — precondition miss, stale-capability 403, quota, rate-limit (429), or an `unexpected` provider error
- **THEN** the engine demotes a precondition/concurrent reason to `stage-aside` and a permission/quota/rate-limit/`unexpected` reason to `skip+report`; the mandatory `unexpected` catch-all guarantees no rejection reason is left unrouted or crashes the batch

#### Scenario: symmetric ignore-globs
- **WHEN** a remote file matches an ignore-glob, OR a previously-tracked local path later matches an ignore-glob
- **THEN** the engine excludes the remote file from the scan (so it never re-pulls) and retires the now-ignored tracked row, applying ignore rules to BOTH sides

#### Scenario: OS-unwritable local file with a remote change
- **WHEN** the remote changed but the local file is OS-unwritable (chmod/flock), distinct from a provider `canEdit=false`
- **THEN** the engine routes to `skip+report` rather than failing the write mid-batch

#### Scenario: non-atomic scan is honest about convergence
- **WHEN** a local file is edited during the tree scan, so its captured state is stale
- **THEN** the engine reports sync state as converging (not consistent) and re-derives the correct route on the next run, never claiming a false "consistent"

### Requirement: Total coverage of the state space

The engine SHALL guarantee that every reachable (local, baseline, remote) state
resolves to exactly one route, with undecidable cells routing to `report`.

#### Scenario: node kind is resolved by the pre-pass before content
- **WHEN** an identity's node kind is dir, symlink, native-doc, locked, unwritable-local, or type-flipped
- **THEN** the structural pre-pass assigns its route (per the pre-pass and directory requirements) BEFORE the content matrix runs, so kind is a first-class axis and only regular writable files reach the 3×3 content matrix

#### Scenario: no undefined behavior
- **WHEN** any regular-writable-file combination of local ∈ {absent, same, modified} × remote ∈ {absent, same, modified} × baseline ∈ {present, absent} is evaluated, after the pre-pass has resolved all non-regular kinds
- **THEN** the engine resolves it to exactly one of `noop | pull | push | stage-aside | report | skip+report | rebind`, and no combination is left undefined or dual-routed

#### Scenario: undecidable defers rather than guesses
- **WHEN** the available evidence cannot disambiguate intent (e.g. both-absent-tracked, or independent create collision)
- **THEN** the engine routes to `report` (a defined but non-automated route) and defers to a human or the LLM
