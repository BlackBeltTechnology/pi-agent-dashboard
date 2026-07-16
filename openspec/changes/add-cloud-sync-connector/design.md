# Design — cloud-file bidirectional sync connector

This document captures an exploration that started at "is SQLite worth it for a
Drive connector?" and, through three rounds of adversarial pressure-testing,
arrived at a complete, data-loss-safe, multi-provider bidirectional sync
architecture. The most important output is not the mechanism (baseline ledger +
four-line engine) but the **failure-mode catalog** and the **impossibility
triangle** that explains *why* the tool reports instead of guessing.

## Context

- The LLM edits real files in a local folder; the source of truth lives in a
  cloud file service. We need safe two-way sync, not a cache.
- A local directory is bound to a cloud folder by a marker file. Commands:
  `pull`, `push`, `sync`.
- Offline is a non-goal. Concurrent same-file modification **must** be detected.
  Scale 10–10k files; rate limits irrelevant.
- The user picked, when asked: conflict remote copies staged **out of tree**;
  deletes **always manual**.

## Goals / Non-Goals

**Goals**
- Bidirectional sync with three-way conflict detection.
- Provider-agnostic engine; Google Drive adapter first, Dropbox as the seam-prover.
- Never lose data. Every hard case routes to a named safe behavior.
- LLM-facing file search over local state (no cloud round-trip).

**Non-Goals**
- Offline operation.
- Exactly-once semantics (impossible; at-least-once chosen).
- Google-native doc round-trip editing (export-only).
- Full automation of undecidable cases (they report/defer by design).

## The impossibility triangle (frame everything with this)

```
                    LOSSLESS
                   (never lose data)
                      /     \
                     /       \
       FULLY-AUTOMATED ───── FAITHFUL ACROSS
       (no human in loop)    permissive-local ↔ restrictive-shared-remote

   Pick any TWO:
   • Lossless + Automated  → give up faithfulness (mangle names,
                             auto-pick a winner) → silent surprises
   • Automated + Faithful  → give up lossless (silent overwrite) → BANNED
   • Lossless + Faithful   → give up full automation (report/stage/ask) ← CHOSEN
```

For an autonomous LLM editing files, **Lossless + Faithful** is the only
acceptable corner. Every "hole" the pressure tests found is this sacrifice showing
up concretely: at undecidable cells the tool **reports and defers**, and it accepts
**at-least-once** (harmless duplicates/orphans) and **eventual** ("converging, not
consistent") semantics. This is a posture, not a bug.

## Decisions

### D1 — SQLite is a baseline *ledger*, not a cache

The hard part of bidirectional sync is having a **common ancestor** to compare
against. Without a baseline you cannot distinguish "only I edited" from "only they
edited" from "both edited". The four-line engine:

```
   local==base && remote==base   →  noop
   local!=base && remote==base   →  push   (if writable, else fork)
   local==base && remote!=base   →  pull   (if downloadable, else skip)
   local!=base && remote!=base   →  CONFLICT → stage aside + set rowState=CONFLICT
```

`local==base` is decided by a **content fingerprint** (`localHash`, see D2), not by
the opaque `remoteVersion`; `remote==base` is decided by comparing the opaque
`remoteVersion` token by **equality** (allowed — equality is not structural
inspection). Two distinct comparators: one for each side.

Speed/search is a free side-effect; conflict detection is the reason the ledger
exists. *Alternative considered:* no cache, diff both sides live every run — cannot
detect three-way divergence, rejected.

### D2 — Marker (identity/config) vs ledger (machine state)

- `.sync.json` — `provider`, `rootId`, ignore-globs, `conflictPolicy=manual`,
  derived `access` label. Human-owned, portable.
- `.sync.db` (SQLite) — keyed by **remote id**, per file: `id`, `localPath`,
  `nodeKind` (file|dir), `size`, `mimeType`, opaque `remoteVersion`, `localHash`
  (content fingerprint of the baseline bytes — the ONLY basis for `local==base`),
  inode/fileId hint, `caps{canEdit,canDownload,canDelete,canAddChildren}`,
  `rowState ∈ {synced, conflict, tombstone}`, delta cursor. Rebuildable.
- `baselineLocalHash` is the fingerprint of the local bytes **as of the last
  sync** (stored). `local==base` ⇺ `hash(current local bytes) == baselineLocalHash`,
  both computed with the adapter's `hashAlgo`. Native docs are exported to a real
  local file, so it is hashable like any file — "no md5" is only a `remoteVersion`
  concern (the *remote* native doc has no checksum, so remote-change detection
  falls back to `modifiedTime`); `local==base` stays computable.
- `rowState=conflict` is **held**: the engine suppresses auto push/pull for that
  identity until an explicit `resolve` clears it (see D3). `rowState=tombstone`
  stays matchable by rename inference until it is retired — retirement fires on the
  **next full-list reconciliation** OR after `K` delta cycles (default `K=10`,
  whichever first), a defined bounded window, not "one report".

Keying on **remote id, not path** is load-bearing (see D6). `remoteVersion` is
used only for the remote-vs-baseline equality test.

### D3 — Conflict policy: manual + stage out-of-tree

On conflict, neither side is overwritten. Remote copy is fetched into
`.sync/conflicts/<path>` (a staging dir, in ignore-globs — **not** in the tree the
LLM walks) and the row is set `rowState=conflict` (**held**). While held, the
engine emits **no** auto push/pull for that identity — this is the fix for the
otherwise-fatal path where advancing baseline to remote would let the *next* sync
silently push stale local bytes over the remote winner. Baseline does **not**
advance on conflict.

Resolution is explicit and **atomic push-then-advance** (not "advance and let the
next sync push" — that path pulls the old remote back over the merge). A human/LLM
writes merged bytes to the local file and runs `resolve <path>`, which:
1. re-reads local + remote. If the **remote diverged again** since staging →
   re-stage, stay `conflict`, re-report (do not push over it). If the **local
   file was deleted** → `resolve` fails with an error (nothing to merge). If the
   **remote was deleted** → route to `report` (deleted-remote / re-create decision).
2. otherwise pushes merged local → remote via `update(id, mergedStream, expectVer)`.
3. on success sets **both** `baselineLocalHash = hash(merged)` **and**
   `remoteVersion = <new remote token>`, then clears the held state — the identity
   is now `noop`, not a pending push.

Per-folder opt-in `prefer-local`/`prefer-remote` auto-resolves scratch dirs.
*Never* last-writer-wins as default (silent loss + autonomous agent = catastrophe).
Because staging is out-of-tree, the command **report** must actively point at the
staged copy.

**Execute-phase re-check (load-bearing).** Scan → plan → execute is not atomic; the
LLM can edit a file between plan and execute. Immediately before **any** destructive
write the engine **re-reads** the target:
- `pull` re-checks the current local hash. Changed since scan → demote to conflict.
  Local now **absent** → treat as local-deleted → `report` (do not overwrite/pull).
- `push`/`create` on a precondition-capable adapter uses `expectVer`; on a
  precondition-less adapter (localdir/iCloud) re-lists the remote just before write
  (remote appeared/changed → demote to conflict). `create` also re-verifies the
  local file still exists with an unchanged hash and runs a remote name-collision
  check first.
- An identity that fails its re-check **3 times within one run** (a file under
  active LLM editing) is **deferred** to `skip+report` ("actively editing") for
  that run — a bound that prevents a hot-edited file from live-locking the sync.
No plan destroys unre-verified bytes.

### D4 — Deletes never auto-propagate

Local-gone-remote-present and remote-gone-local-present both **report only**. An
explicit purge command is required to act. Safest default for an autonomous agent.

### D5 — Per-file capabilities; folder caps for create

Capability granularity is provider-dependent: Google inline-free per-file;
OneDrive per-file but queried; Dropbox folder-level via the sharing API. Engine
trusts per-file caps; marker `access` is a *label*. `create` needs the **parent
folder's `canAddChildren`**, a folder property — so folder caps are cached too.
`caps` stays a **separate verb** (its cost/granularity varies per provider) rather
than folded into `list` (an earlier "caps are free in list" assumption was
Google-parochial and false elsewhere).

### D6 — Renames inferred (git-style), ledger keyed on remote id

Remote rename is free: id stable across move on Google/Dropbox/OneDrive → update
path. Local rename is hard: the filesystem has no portable stable id. Infer:

```
   orphan   = baseline row whose localPath is now missing
   foundling= local file at a new path with no baseline row
   prefer   stored inode/fileId equal → certain rename (skip hashing)
   else     foundling.hash == orphan.baselineLocalHash → best-effort rename rebind
```

Inode/fileId is preferred; a pure content-hash match on a single orphan↔foundling
pair is **best-effort** (git-parity: content-identical unrelated files may bind).
Accepted trade-off — `rebind` is **non-destructive** (it only relinks id→path; no
bytes are lost), and multi-match still routes to `report`.

Detection failure degrades **safely**: rename+edit (hash changed) looks like
delete(A)+create(B) → old remote survives (deletes manual) + B uploads new →
orphan, never loss. Edge: if the new path B already holds an independent remote
file, B is not a clean push but an independent create/create → `stage-aside`
(still no overwrite; the local edit is held until the user disentangles it).
Two-identical-files and cross-side-rename → report.

### D7 — Provider adapter interface (pressure-tested v2)

Seven verbs (the proposal's "five" was a miscount — `create`/`update` are distinct
signatures, and folders need their own creator):

```
   list()                          → [{id, path, nodeKind, size, remoteVersion, mtime, ...}]
   download(id)                    → stream          (not bytes; redirects/chunking)
   create(parentId, name, stream)  → newId           (new files have NO id)
   createFolder(parentId, name)    → newFolderId     (dirs are first-class entities)
   update(id, stream, expectVer)   → ok | writeRejected{reason}   (TOCTOU + perm backstop)
   delta(cursor)                   → {changes, nextCursor, resetRequired, cursorScope}
   caps(id)                        → {canEdit, canDownload, canDelete, canAddChildren}
   hashAlgo                        → (property) the content-fingerprint algorithm
                                     the engine uses to compute localHash
```

`update`/`create` return a **structured `writeRejected{reason}`** (not just
`preconditionFailed`) so a precondition miss, a stale-cap 403, a quota error, a
rate-limit (429), and any `unexpected` provider error all route uniformly (see I3)
rather than only the precondition case. `unexpected` is the mandatory catch-all so
an unknown provider response never crashes the batch.

Key refinements from pressure-testing Dropbox + OneDrive:
- **`remoteVersion` is opaque** (Google md5 / OneDrive cTag / Dropbox rev). The
  engine never **parses its structure** — but compares it by **equality** for the
  remote-vs-baseline test. The provider must guarantee token-equality ⟺
  content-equality; where it cannot (Dropbox `rev`/OneDrive `eTag` bump on
  metadata-only changes), the adapter picks the content-only token (cTag over
  eTag) to avoid spurious conflicts. The separate `localHash` (via `hashAlgo`) is
  what makes the local-vs-baseline test computable at all.
- **`upload` split into `create` + `update`** — collapsing them was wrong; new
  files have no id.
- **`expectVer` on `update`** uses native optimistic concurrency (Dropbox
  `mode=update,rev`; OneDrive `if-match: eTag`) to close the write-time TOCTOU
  race the pure-local baseline can't see.
- **`delta` cursor scope differs** (Google account-wide vs Dropbox/OneDrive
  per-root) and can expire → `resetRequired` forces a full re-list.

### D8 — Baseline authoritative; server precondition is a backstop

Pure server-authoritative fails: preconditions only guard the push path (pull's
"did local also change?" has no server primitive); the localdir/iCloud adapter has
no precondition at all; dry-run needs local knowledge. So: **baseline plans,
precondition guards writes** — and the guard is a capability the adapter advertises,
not a hard dependency.

## Provider capability table

```
  ┌───────────┬────────┬──────────┬──────────────┬───────────┬─────────────┐
  │ PROVIDER  │ REST   │ CHANGE   │ VERSION TOKEN │ CAPS      │ NATIVE-DOC  │
  │           │ API    │ FEED     │ (remoteVer)   │ GRANULAR. │ PROBLEM     │
  ├───────────┼────────┼──────────┼──────────────┼───────────┼─────────────┤
  │ Google    │ yes    │ changes  │ md5*          │ per-file  │ Docs/Sheets │
  │           │        │ (acct)   │               │ free      │ export-only │
  │ Dropbox   │ yes    │ cursor   │ rev/content_  │ folder    │ none        │
  │           │        │ (root)   │ hash          │ (sharing) │ (Paper=edge)│
  │ OneDrive  │ Graph  │ delta    │ cTag/quickXor │ per-file  │ none        │
  │ SharePoint│        │ (root)   │               │ (queried) │             │
  │ iCloud    │  NONE  │  —       │  fs mtime     │ fs perms  │ N/A         │
  │           │ (local │          │               │           │ (localdir   │
  │           │ mount) │          │               │           │  adapter)   │
  └───────────┴────────┴──────────┴──────────────┴───────────┴─────────────┘
   * md5 absent on Google-native docs → fall back to modifiedTime/version
```

iCloud has **no public file API**; support it only as a degenerate "local mirror"
adapter pointed at `~/Library/Mobile Documents/com~apple~CloudDocs/…`, where
Apple's own daemon does the cloud sync and our `download`/`upload` are fs copies.
Question whether it earns its keep.

## Three engine invariants (must be designed, not tuned)

Pressure-testing the "everything routes to a safe behavior" claim found paths that
**escape** the funnel. Closing them requires three named invariants:

### I1 — Durability / recovery
- **Intent journal**: write the intent *before* the network op for **every**
  destructive route — `push`, `pull`, and `stage-aside` (not push alone) — and
  reconcile on restart. A crash mid-`pull` or mid-`stage-aside` must re-drive the
  fetch+write and only then advance state; a half-fetched staged copy never
  advances baseline. (Cannot achieve exactly-once — journaling only lets us
  *choose* at-least-once. We choose it: tolerate duplicate/orphan, never lose.)
- **Cursor ordering**: the delta cursor advances **only after every change in the
  batch is durably applied** — else a crash silently drops remote changes forever.
  Re-apply on retry must **re-run conflict detection**, not blind-write (a blind
  re-pull would overwrite an LLM edit made between crash and retry).
- **Single-instance lock**: lockfile / `BEGIN IMMEDIATE` stops two local
  processes corrupting the ledger. (Guards one machine only — cross-machine
  concurrency relies on per-op preconditions, which `create` lacks.)

### I2 — Path is a translated boundary, not a key
The local and remote worlds disagree on what a path *is*:
- **Unicode**: macOS stores NFD, others NFC — same name, different bytes → the
  classic "mirror" bug (duplicate up, then duplicate down). Normalize to NFC for
  comparison — but normalization is itself lossy (can collapse two legitimately
  distinct Linux names), so collisions **report**, never silently merge.
- **Case**: Linux `Report.md` + `report.md` collide on case-insensitive remotes.
- **Validity**: `report:v2.md` legal locally, forbidden on OneDrive/SharePoint.
- **Pigeonhole**: a permissive local namespace cannot inject into a restrictive
  shared remote. Collisions/invalid names are **detected and reported**, not fixed.

### I3 — The funnel must be total (coverage, not automation)
Coverage runs in two stages so node **kind** is an axis, not an afterthought: a
**structural pre-pass** classifies kind/caps first (dir, symlink, native-doc,
locked, unwritable-local, type-flip), and only regular writable files reach the
3×3 content matrix. Every (local × baseline × remote) state resolves to exactly
one route. Undecidable cells (e.g. `local=absent, remote=absent, baseline=present`
— both deleted? a half-scanned move?) route to **report** — a defined but
non-automated route. "Total" = total *coverage*, not total *automation*.

Explicit routes the pre-pass/overlays must add (all in the spec):
- non-regular local node (symlink/FIFO/device) → `skip+report`.
- `nodeKind` flip file↔dir (local or remote) → `skip+report` (delete+create candidate).
- **directories are first-class**: each dir gets a `nodeKind=dir` baseline row and
  is reconciled independently of its children, so **empty** dirs are visible too.
  A new remote dir → create the local dir; a new local dir → `createFolder` on the
  remote. Push is **parent-before-child** ordered (a file's remote parent must
  exist before `create`; a missing intermediate parent triggers `createFolder`
  first, not a failed `create`). Deletes report **child-before-parent**. A failed
  `createFolder` → `skip+report` the folder **and its whole subtree** (children
  are not attempted with a missing parent id, and are re-reported each run — never
  silently retried into a create against a nonexistent parent).
- native-doc (no md5) with a **local edit** → `skip+report`, **never push**
  (a push would convert/overwrite the native doc → data loss). Detection uses
  `modifiedTime`; write-back is unsupported.
- OS-**unwritable** local file (chmod/flock) with a remote change → `skip+report`
  (distinct from the provider `canEdit=false` case, which stages a fork).
- any `writeRejected{reason}` → demote by reason: precondition/concurrent →
  `stage-aside`; permission (403)/quota/rate-limit (429)/`unexpected` →
  `skip+report`. The `unexpected` catch-all guarantees no reason is unrouted.
- **ignore-globs are symmetric**: a remote file matching an ignore-glob is
  excluded from the scan (else it re-pulls forever); a previously-tracked path
  that becomes ignored has its baseline row retired.
- **tombstones stay matchable**: a both-deleted row becomes a `tombstone` kept in
  the rename-inference pool for a bounded window (until the next clean full sync),
  so a half-scanned move re-binds instead of duplicating.

The completeness matrix (node-kind × lifecycle → route) is the artifact that makes
the safety claim *checkable* rather than asserted. It is formalized as the spec
backbone in `specs/cloud-file-sync/spec.md` — every cell is a `#### Scenario:`
under a reconciliation requirement, so "the funnel is total" is a testable
property, not a claim.

## Risks / Trade-offs

- [Exactly-once impossible] → choose at-least-once; duplicates/orphans are
  harmless and reported; deletes manual so orphans never surprise-delete.
- [Cross-machine create race — no distributed lock] → accept; per-op preconditions
  cover update, create races produce reported duplicates, not loss.
- [Mid-scan LLM edit — no atomic snapshot] → "synced" means "converging"; under
  continuous editing the window may never fully close. Accept + surface state
  honestly (never claim "consistent").
- [Wrong version token (eTag bumps on rename/metadata)] → pick the content-only
  token (cTag over eTag) so renames don't masquerade as content conflicts.
- [Name pigeonhole] → report collisions; never auto-mangle silently.
- [Google-native docs] → export-only; declared read-only, no fake push.

## Migration Plan

Greenfield connector; no migration. Rollout by adapter:
1. Google Drive adapter + engine + ledger + commands + LLM search (this change).
2. Dropbox adapter (proves the seam — real hashes, cursor delta, no native-doc mess).
3. OneDrive/SharePoint, then localdir/iCloud.
Rebuild the ledger anytime by re-walking both sides (everything "needs check"),
losing only conflict history until the next clean sync.

## Open Questions

- Auth/scope per provider (`drive.file` vs `drive`; Dropbox app-folder vs full;
  Graph consent) — and whether to reuse `add-connector-layer`'s credential store /
  OAuth machinery vs. a dedicated one.
- LLM search tool's exact query surface (`name LIKE`, `mimeType`, path glob) and
  whether it exposes content search (needs indexing, out of MVP?).
- Chunked-transfer thresholds per provider (Dropbox 150MB upload_session;
  OneDrive 4MB PUT vs createUploadSession).
- Whether the localdir/iCloud adapter earns its keep given Apple already syncs the
  mount.
- Rename detection cost: brute-force re-hash every run (fine at 10k) vs
  mtime+size fast-path with hash only on suspects.
