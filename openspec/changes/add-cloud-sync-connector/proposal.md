# Add a cloud-file bidirectional sync connector (local folder ⇄ Drive/Dropbox/OneDrive)

## Why

An LLM works best editing real files in a local folder. But the source-of-truth
documents often live in a cloud file service (Google Drive, Dropbox, OneDrive/
SharePoint). Today there is no way to: mark a local directory as bound to a cloud
folder, pull remote changes down, let the LLM edit locally, and push the result
back — while *safely* detecting the case where the same file changed on both sides.

The user's concrete ask: drop a marker file into `Documents/Project/Zenit/`
recording the cloud link, then run `pull` / `push` / `sync` commands. Offline is
explicitly **not** a goal (the local folder is the working state). Concurrent
modification of the same file **must** be detected, never silently overwritten.
Scale is 10–10,000 files with full hierarchy; rate limits are a non-concern.

This is a distinct capability from the existing `add-connector-layer` change.
That change is a **stateless** HTTP/OpenAPI invoke gateway (request → response,
Google Drive appears there only as an OpenAPI request/response surface). This
change is a **stateful bidirectional sync engine**: it maintains a local baseline
ledger, detects three-way divergence, stages conflicts, and infers renames. The
two can compose — the sync connector may reuse the connector layer's credential
store / OAuth machinery for auth — but the sync engine, baseline ledger, and
conflict model are new and do not exist anywhere in the codebase.

## What Changes

Introduce a **cloud-file sync connector**: a provider-agnostic sync engine driven
by a local baseline ledger, with pluggable provider adapters and an LLM-facing
search/sync tool surface.

- **Marker file** (`.sync.json` in the bound directory) — human-owned identity +
  config: `provider`, `rootId`, ignore-globs, `conflictPolicy` (default `manual`),
  and a derived `access` label. Portable; committable.
- **Baseline ledger** (SQLite, `.sync.db`) — machine-owned, rebuildable. Keyed by
  **remote id** (not path). Per-file: `id`, `localPath`, `size`, `mimeType`,
  opaque `remoteVersion` + `baselineVersion`, inode/fileId hint, per-file
  capabilities, row state, and a delta cursor. This ledger is the load-bearing
  core — its job is conflict detection, not caching. Search speed is a free
  side-effect.
- **Sync engine** (provider-agnostic) — the four-line diff: `local` vs `baseline`
  vs `remote` → `noop | push | pull | conflict`. Baseline is authoritative for
  planning; provider preconditions (rev/eTag) are an optional write-time backstop.
- **Provider adapter interface** — seven verbs (`list`, `download`, `create`,
  `createFolder`, `update`, `delta`, `caps`, plus a `hashAlgo` property) that each
  provider implements. Ship **Google Drive**
  first; design so **Dropbox** is a follow-on adapter that proves the seam. Also
  a degenerate **localdir** adapter (covers iCloud Drive via its CloudDocs mount,
  which has no public API).
- **Commands** — `pull`, `push`, `sync` (+ dry-run). Read-only shares degrade
  `push`/`sync` to pull-only, preserving un-pushable local edits in staging.
- **LLM tool surface** — a file-search tool over the ledger (`name LIKE`,
  `mimeType`, path glob — no cloud round-trip) plus the three sync commands.

## Safety posture (the heart of this change)

The design target is **Lossless + Faithful**, sacrificing full automation. Three
rounds of adversarial pressure-testing established that lossless, fully-automated,
faithful sync across a permissive local namespace and a restrictive shared remote
is **impossible** (an impossibility triangle — pick two). Therefore every hard
case routes to one of two safe behaviors — **skip-and-report** or **stage-aside** —
and undecidable cases **report/defer to a human or the LLM** rather than guess.

Pinned decisions:
- Conflicts: `manual` default. Remote copy staged **out of tree** in
  `.sync/conflicts/`, never overwriting either side. Per-folder opt-in
  `prefer-local`/`prefer-remote` override.
- Deletes: **never auto-propagated** (either direction). Report only.
- Capabilities: **per-file** where the provider offers it (Google inline-free;
  OneDrive per-file but queried; Dropbox folder-level). Engine trusts per-file
  caps; the marker `access` is a label, not a gate. `create` needs the parent
  folder's `canAddChildren` — folder caps cached too.
- Renames: **inferred** (git-style) by content-hash/inode after keying the ledger
  on remote id. Detection failure degrades safely to new-file + surviving orphan.
- Conflicts are **held** (`rowState=conflict`): the engine suppresses auto
  push/pull for a conflicted identity and never advances baseline until an
  explicit `resolve`, so a re-run can never silently push stale local over the
  remote winner. A pre-write re-check guards every destructive write.
- Google-native docs (Docs/Sheets/Slides): **export-only**, no md5; comparison
  falls back to `modifiedTime`/version. Dropbox/OneDrive store real files — the
  native-doc pain is Google-only.

## Scope

- **In scope (this change):** the sync engine, baseline ledger, marker file, the
  Google Drive adapter, the `pull`/`push`/`sync` commands, the LLM search tool,
  and the failure-mode catalog + three engine invariants (durability/recovery,
  path-as-translated-boundary, total funnel) as first-class spec.
- **Follow-ups:** Dropbox adapter (proves the seam); OneDrive/SharePoint adapter;
  localdir/iCloud adapter; OAuth credential flows (reuse connector-layer + LLM
  provider OAuth machinery); cross-machine coordination beyond per-op preconditions.
- **Explicitly out of scope:** offline operation; exactly-once delivery
  (at-least-once is the chosen posture — tolerate harmless duplicates/orphans,
  never lose data); Google-native doc round-trip editing.

## Discipline Skills

- `security-hardening` — credential storage, OAuth tokens, path-traversal on the
  marker-bound directory, untrusted remote filenames.
- `systematic-debugging` — the crash-atomicity / cursor-ordering recovery paths.
- `doubt-driven-review` — the irreversible sync operations and conflict policy
  before they stand.
