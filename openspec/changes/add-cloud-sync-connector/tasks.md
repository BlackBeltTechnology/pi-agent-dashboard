# Tasks — add-cloud-sync-connector

New package `packages/cloud-sync/` (engine + adapters + CLI), following the
monorepo package pattern. The reconciliation engine is a pure function; provider
adapters are pluggable. Google Drive ships first. Test rows are folded from
`test-plan.md` (the manifest is the automated-vs-manual source of truth).

## 1. Ledger + marker foundation

- [ ] Define the marker schema `.sync.json` (provider, rootId, ignore-globs, conflictPolicy, derived access label)
- [ ] Define the SQLite ledger schema keyed by remote id (id, localPath, nodeKind, size, mimeType, remoteVersion, baselineLocalHash, inode/fileId, caps incl. canAddChildren, rowState ∈ {synced,conflict,tombstone}, delta cursor)
- [ ] Implement ledger open/create/migrate + single-instance lock (BEGIN IMMEDIATE / lockfile)
- [ ] Implement local content fingerprinting via the adapter-declared hashAlgo (baselineLocalHash stored; current hash computed at reconcile)

## 2. Reconciliation engine (pure `classify`)

- [ ] Implement the pure `classify(local, baselineRow, remote) → route` — the 3×3 content matrix + untracked cases, returning a route ∈ {noop,pull,push,stage-aside,report,skip+report,rebind} plus intended state mutation
- [ ] Implement the structural pre-pass (node kind + caps) that preempts the content matrix (symlink/type-flip/native-doc/locked/unwritable/canDownload)
- [ ] Implement held-conflict state machine (set rowState=conflict, no baseline advance, suppress auto push/pull while held)
- [ ] Implement rename inference (inode-preferred, hash best-effort) with rebind, multi-match → report, and tombstone matchable window (K=10 delta cycles or next full-list)
- [ ] Implement symmetric ignore-glob application (both sides) + retirement of newly-ignored tracked rows

## 3. Provider adapter interface + Google Drive adapter

- [ ] Define the `Provider` interface: list, download(stream), create, createFolder, update(expectVer)→ok|writeRejected{reason}, delta(cursor)→{changes,nextCursor,resetRequired,cursorScope}, caps, hashAlgo property
- [ ] Implement an in-memory fake `Provider` for engine tests
- [ ] Implement the Google Drive adapter (md5 remoteVersion, changes-API delta account-scoped, per-file caps inline, native-doc export-only detection)
- [ ] Map Google-native docs to export-only handling (no md5 remoteVersion → modifiedTime fallback; local export hashable for baselineLocalHash)

## 4. Commands + durability

- [ ] Implement `pull` / `push` / `sync` (+ `--plan` dry-run) driving the engine, with parent-before-child push ordering and child-before-parent delete-report ordering
- [ ] Implement the execute-phase pre-write re-check on every destructive write (pull local re-hash; create local existence+hash+name-collision; precondition-less adapters re-list) with the 3-failure hot-edit defer
- [ ] Implement `resolve <path>`: push merged→remote via update(expectVer), advance baselineLocalHash + remoteVersion, clear held → noop; with the re-divergence / local-deleted / remote-deleted failure branches
- [ ] Implement the intent journal (push+pull+stage-aside) with crash-restart reconcile; delta cursor advances only after full durable apply
- [ ] Implement the LLM file-search tool over the ledger (name LIKE / mimeType / path glob, no cloud round-trip)

## 5. Tests — reconciliation matrix + lifecycle (L1 vitest)

Home: `packages/cloud-sync/src/__tests__/*.test.ts`. Exemplar to copy harness glue from: `packages/goal-plugin/src/__tests__/manifest.test.ts` (pure-logic vitest). Fixtures: synthetic `{ledgerRow, localState, remoteState}` triples.

- [ ] classify: in-sync → noop — Triple: row+local==base+remote==base · classify · noop (test-plan #R01) — see packages/goal-plugin/src/__tests__/manifest.test.ts
- [ ] classify: remote-only change → pull — Triple: row+local==base+remote!=base · classify · pull, baseline advanced (test-plan #R02)
- [ ] classify: local-only change → push after remote re-verify — Triple: row+local!=base+remote==base+not-held · classify · push (test-plan #R03)
- [ ] classify: both changed → held conflict — Triple: row+local!=base+remote!=base · classify · stage-aside, rowState=conflict, baseline NOT advanced (test-plan #R04)
- [ ] classify: remote deleted, local unchanged → report — Triple: row+local==base+remote absent · classify · report, local kept (test-plan #R05)
- [ ] classify: remote deleted, local modified → report — Triple: row+local!=base+remote absent · classify · report (edit/delete) (test-plan #R06)
- [ ] classify: local deleted, remote unchanged → report — Triple: row+local absent+remote==base · classify · report, remote kept (test-plan #R07)
- [ ] classify: local deleted, remote modified → report — Triple: row+local absent+remote!=base · classify · report (test-plan #R08)
- [ ] classify: both deleted → report + tombstone — Triple: row+local absent+remote absent · classify · report, rowState=tombstone (test-plan #R09)
- [ ] held: later sync without resolve stays held — Triple: rowState=conflict+sync no resolve · classify · held, re-reported (test-plan #C01)
- [ ] resolve: push-then-advance ends noop — Triple: resolve no re-divergence · resolve · update(expectVer) push, both hashes advanced, held cleared → noop (test-plan #C02)
- [ ] resolve: remote diverged again → re-stage held — Triple: resolve+remote changed · resolve · re-stage, no push-over (test-plan #C03)
- [ ] resolve: local deleted → fail, stays held — Triple: resolve+local absent · resolve · error, held (test-plan #C04)
- [ ] resolve: remote deleted → report — Triple: resolve+remote absent · resolve · report, no silent recreate (test-plan #C05)
- [ ] resolve: crash after push before advance → re-drive, no loss — Triple: push ok then crash · restart+journal · expectVer miss → re-staged (test-plan #C06)
- [ ] re-check: pull demotes on in-window local edit — Triple: plan=pull+local hash changed · execute · stage-aside, edit preserved (test-plan #W01)
- [ ] re-check: pull finds local deleted → report — Triple: plan=pull+local absent · execute · report, no overwrite (test-plan #W02)
- [ ] re-check: create guards edited/deleted/collision — Triple: plan=create+edited|deleted|name-collision · execute · re-plan|report|stage-aside (test-plan #W03)
- [ ] re-check: hot-edit defers at N=3 — Triple: fails re-check 3× in one run · execute · skip+report; 2 fails still retries (boundary) (test-plan #W04)
- [ ] re-check: stage-aside fetch crash keeps baseline — Triple: fetch fails mid-write · restart+journal · baseline NOT advanced, retried (test-plan #W05)

## 6. Tests — pre-pass, dirs, rename, overlays, adapter (L1 + L2)

L1 home + exemplar as in §5. L2 home: `qa/tests/*.sh`; exemplar: `qa/tests/03-websocket.sh`.

- [ ] pre-pass: non-regular local → skip+report — Triple: symlink/FIFO/device · pre-pass · skip+report (test-plan #K01)
- [ ] pre-pass: type flip either side → skip+report — Triple: file↔dir kind flip · pre-pass · skip+report (test-plan #K02)
- [ ] pre-pass: native-doc detection via modifiedTime, localHash from export — Triple: native-doc remote change · pre-pass · modifiedTime detect, localHash computable (test-plan #K03)
- [ ] pre-pass: native-doc + local edit NEVER pushes — Triple: native-doc local edit · pre-pass · skip+report, no push (test-plan #K04)
- [ ] pre-pass: canEdit=false + local edit → fork+report — Triple: locked+local edit · pre-pass · stage fork+report (test-plan #K05)
- [ ] pre-pass: canDownload=false + remote change → skip+report — Triple: unfetchable+remote change · pre-pass · skip+report (test-plan #K06)
- [ ] pre-pass: OS-unwritable local + remote change → skip+report — Triple: chmod/flock+remote change · pre-pass · skip+report (test-plan #K07)
- [ ] dirs: new local dir (incl empty) → createFolder parent-first — Triple: new local dir · classify · push via createFolder, nodeKind=dir, parent-before-child (test-plan #D01)
- [ ] dirs: new remote dir (incl empty) → mkdir before children — Triple: new remote dir · classify · pull mkdir + row before children (test-plan #D02)
- [ ] dirs: createFolder failure skips subtree, no infinite retry — Triple: createFolder writeRejected · execute · skip+report folder+subtree, no child-vs-missing-parent (test-plan #D03)
- [ ] rename: inode match → rebind — Triple: orphan+foundling inode match · infer · rebind id→newPath (test-plan #M01)
- [ ] rename: hash match (no inode) → best-effort rebind — Triple: orphan+foundling hash match · infer · rebind, non-destructive (test-plan #M02)
- [ ] rename: rename+edit, path free → orphan+new, no loss — Triple: rename+edit no match, path free · infer · delete(old) orphan + create(new) (test-plan #M03)
- [ ] rename: rename+edit onto occupied path → stage-aside — Triple: rename+edit, path occupied · infer · stage-aside, local held (test-plan #M04)
- [ ] rename: multi-orphan hash match → report — Triple: foundling matches ≥2 orphans · infer · report, no guess (test-plan #M05)
- [ ] rename: tombstone re-match K=10 boundary — Triple: both-deleted re-match within vs after K=10 · infer · rebind before, new-file after (test-plan #M06)
- [ ] untracked: new local file → push via create — Triple: local file, no row, no remote, no match · classify · push via create + canAddChildren else skip+report (test-plan #U01)
- [ ] untracked: new remote file → pull — Triple: remote file, no row, no local · classify · pull + new row (test-plan #U02)
- [ ] untracked: create/create collision → stage-aside — Triple: file both sides no baseline · classify · stage-aside, no assume-same (test-plan #U03)
- [ ] overlay: name collision → skip+report both — Triple: two local names → one remote slot · classify · skip+report both, no merge (test-plan #O01)
- [ ] overlay: writeRejected routing incl unexpected catch-all — Triple: reason ∈ {precondition,403,quota,429,unexpected} · execute · precondition→stage-aside, others→skip+report (test-plan #O02)
- [ ] overlay: symmetric ignore-globs + row retirement — Triple: ignore matches remote OR newly-ignored tracked path · scan · excluded both sides, row retired (test-plan #O03)
- [ ] overlay: non-atomic scan reports converging — Triple: file edited during scan · sync · reported converging, correct route next run (test-plan #O04)
- [ ] adapter: Google Drive implements 7 verbs to contract — Triple: call each verb · adapter · list/download/create/createFolder/update/delta/caps + hashAlgo per contract (test-plan #P01) — L2, see qa/tests/03-websocket.sh
- [ ] adapter: delta resetRequired → full re-list, no dropped change — Triple: cursor resetRequired · sync · full re-list fallback (test-plan #P02) — L2
- [ ] engine: two sync processes → single-instance lock — Triple: two syncs one marker · start both · second blocked, ledger uncorrupted (test-plan #P03) — L2
- [ ] engine: crash mid-batch journal replay → at-least-once — Triple: crash mid-batch · restart · no lost/overwritten file (test-plan #P04) — L2
- [ ] engine: full bind→push→edit-remote→pull→conflict→resolve cycle — Triple: full command cycle · each command · routes match the matrix (test-plan #P05) — L2

## 7. Validate (manual-only, deferred post-merge)

- [ ] Manually verify conflict report readability points a human/LLM at the staged copy + next action (test-plan: manual-only)
- [ ] Manually verify `.sync.json` marker ergonomics for hand-authoring / commit (test-plan: manual-only)
