# Test Plan — add-cloud-sync-connector

Standalone scenario catalog (manifest) for the cloud-file sync connector. Each row
carries a `level` and a `disposition` (`automated` | `manual-only`). The
`plan-proposal` fold reads this manifest to route automated rows into `tasks.md`;
`ship-change` defers `manual-only` rows post-merge.

**Resolved gaps (scenario-design HARD gate):** N (hot-edit defer threshold) = **3**;
K (tombstone retention) = **10** delta cycles or next full-list; performance =
**functional-only** (no perf/latency scenarios this change).

**Levels (this repo):** L1 = vitest unit (`packages/*/**/__tests__/*.test.ts`);
L2 = process/CLI smoke (`qa/tests/*.sh|*.ps1`); L3 = Playwright e2e
(`tests/e2e/*.spec.ts`). The reconciliation engine is a **pure function**
`classify(local, baseline, remote) → route`, so the whole matrix is L1.

## Core insight — the matrix is a pure function

Every reconciliation scenario resolves to the same Triple shape:

```
   INPUT     a ledger row (or none) + a local node state + a remote node state
   TRIGGER   engine.classify() / a sync run
   OBSERVABLE the returned route ∈ {noop,pull,push,stage-aside,report,skip+report,rebind}
             (+ any state mutation: rowState, baseline advance, staged file)
```

That makes the safety claim directly unit-testable: feed the fixture triple,
assert the route. No cloud, no network — L1.

## Reconciliation matrix scenarios (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| R01 | edge | decision-table | L1 | automated | row + local==base + remote==base · classify · **noop** |
| R02 | edge | decision-table | L1 | automated | row + local==base + remote!=base · classify · **pull**, baseline advanced |
| R03 | edge | decision-table | L1 | automated | row + local!=base + remote==base + not-held · classify · **push** after remote re-verify |
| R04 | edge | state-transition | L1 | automated | row + local!=base + remote!=base · classify · **stage-aside**, rowState=conflict, baseline NOT advanced, no auto push/pull |
| R05 | edge | decision-table | L1 | automated | row + local==base + remote absent · classify · **report** (gone-remote), local not deleted |
| R06 | edge | decision-table | L1 | automated | row + local!=base + remote absent · classify · **report** (edit/delete), local kept |
| R07 | edge | decision-table | L1 | automated | row + local absent + remote==base · classify · **report** (deleted-local), remote not deleted |
| R08 | edge | decision-table | L1 | automated | row + local absent + remote!=base · classify · **report** (delete/edit), no auto action |
| R09 | edge | state-transition | L1 | automated | row + local absent + remote absent · classify · **report** + rowState=tombstone (matchable) |

## Held-conflict lifecycle (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| C01 | error | state-transition | L1 | automated | rowState=conflict + later sync, no resolve · classify · held (no push/pull), re-reported |
| C02 | error | state-transition | L1 | automated | resolve, no re-divergence · resolve() · update(expectVer) push, baselineLocalHash+remoteVersion advanced, held cleared → next classify **noop** |
| C03 | error | state-transition | L1 | automated | resolve + remote diverged again · resolve() · re-stage, stays conflict, no push-over |
| C04 | error | state-transition | L1 | automated | resolve + local file deleted · resolve() · fails with error, stays held |
| C05 | error | state-transition | L1 | automated | resolve + remote deleted · resolve() · **report** (re-create decision), no silent recreate |
| C06 | error | fault-injection | L1 | automated | resolve push succeeds then crash before advance · restart+journal · re-drive, expectVer miss → re-staged, no loss |

## Pre-write re-check / non-atomic scan (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| W01 | error | state-convergence | L1 | automated | plan=pull + local hash changed pre-write · execute · demote **stage-aside**, local edit preserved |
| W02 | error | state-convergence | L1 | automated | plan=pull + local absent pre-write · execute · **report** (deleted-local), no overwrite |
| W03 | error | state-convergence | L1 | automated | plan=create + local edited/deleted/name-collision pre-write · execute · re-plan / report / **stage-aside** resp., no blind create |
| W04 | edge | boundary | L1 | automated | identity fails re-check **3** times in one run · execute · deferred **skip+report** (N=3 boundary: 2 fails still retries, 3rd defers) |
| W05 | error | fault-injection | L1 | automated | stage-aside fetch fails/crashes mid-write · restart+journal · baseline NOT advanced, retried |

## Structural pre-pass — node kind (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| K01 | edge | decision-table | L1 | automated | local symlink/FIFO/device · pre-pass · **skip+report** (non-regular), never uploaded |
| K02 | edge | state-transition | L1 | automated | node kind flip file↔dir (either side) · pre-pass · **skip+report** (type flip) |
| K03 | edge | decision-table | L1 | automated | native-doc, remote change · pre-pass · detect via modifiedTime, localHash from export computable |
| K04 | edge | decision-table | L1 | automated | native-doc + local edit (would push) · pre-pass · **skip+report**, NEVER push |
| K05 | edge | decision-table | L1 | automated | canEdit=false + local edit · pre-pass · stage fork + **report** |
| K06 | edge | decision-table | L1 | automated | canDownload=false + remote change · pre-pass · **skip+report** (unfetchable) |
| K07 | edge | decision-table | L1 | automated | OS-unwritable local (chmod/flock) + remote change · pre-pass · **skip+report**, no mid-batch write fail |

## Directories (L1 logic + L2 provider) 

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| D01 | edge | state-transition | L1 | automated | new local dir (incl. empty) · classify · **push** via createFolder, nodeKind=dir row, parent-before-child |
| D02 | edge | state-transition | L1 | automated | new remote dir (incl. empty) · classify · **pull** mkdir + nodeKind=dir row before children |
| D03 | error | fault-injection | L1 | automated | createFolder writeRejected · execute · **skip+report** folder + whole subtree, no child create vs missing parent, no infinite retry |

## Rename inference (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| M01 | edge | state-transition | L1 | automated | orphan + foundling, inode match · infer · **rebind** id→newPath |
| M02 | edge | state-transition | L1 | automated | orphan + foundling, hash match (no inode) · infer · **rebind** (best-effort, non-destructive) |
| M03 | edge | decision-table | L1 | automated | rename+edit, no match, new path free · infer · delete(old) surviving orphan + create(new), no loss |
| M04 | edge | decision-table | L1 | automated | rename+edit, new path occupied remotely · infer · **stage-aside**, local held |
| M05 | edge | decision-table | L1 | automated | foundling hash matches multiple orphans · infer · **report** (ambiguous), no guess |
| M06 | edge | boundary | L1 | automated | both-deleted tombstone re-matched within K=10 cycles vs after · infer · rebind before K, new-file after (K boundary) |

## Untracked identities + overlays (L1, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| U01 | edge | decision-table | L1 | automated | local file, no row, no remote, no match · classify · **push** via create + canAddChildren, else skip+report |
| U02 | edge | decision-table | L1 | automated | remote file, no row, no local · classify · **pull** + new row |
| U03 | edge | decision-table | L1 | automated | file both sides, no shared baseline · classify · **stage-aside** (create/create), no assume-same |
| O01 | edge | decision-table | L1 | automated | two local names → one remote slot (case/NFC-NFD/invalid) · classify · **skip+report** both, no merge |
| O02 | error | decision-table | L1 | automated | writeRejected reason ∈ {precondition,403,quota,429,unexpected} · execute · precondition→stage-aside, others→skip+report, unexpected catch-all routed |
| O03 | edge | decision-table | L1 | automated | ignore-glob matches remote file OR newly-ignored tracked path · scan · excluded both sides, tracked row retired |
| O04 | perf-adjacent | state-convergence | L1 | automated | file edited during scan · sync · state reported converging (not consistent), correct route next run |

## Provider adapter + engine integration (L2, automated)

| id | class | technique | level | disp | input · trigger · observable |
|----|-------|-----------|-------|------|------------------------------|
| P01 | integration | contract | L2 | automated | Google Drive adapter implements 7 verbs · call each · list/download/create/createFolder/update/delta/caps + hashAlgo behave per contract |
| P02 | integration | state-transition | L2 | automated | delta cursor returns resetRequired · sync · full re-list fallback, no dropped change |
| P03 | error | concurrency | L2 | automated | two sync processes on one marker · start both · single-instance lock blocks the second, ledger uncorrupted |
| P04 | integration | fault-injection | L2 | automated | crash mid-batch (journal replay) · restart · at-least-once, no lost/overwritten file |
| P05 | integration | end-to-end | L2 | automated | bind local dir via marker → push → edit remote → pull → conflict → resolve · full command cycle · each command's route matches the matrix |

## Manual-only (deferred post-merge)

| id | class | level | disp | input · trigger · observable |
|----|-------|-------|------|------------------------------|
| Z01 | ux | — | manual-only | conflict report readability — does the `report` output clearly point a human/LLM at the staged copy and next action (human judgment) |
| Z02 | ux | — | manual-only | end-user marker-file ergonomics — is `.sync.json` obvious to hand-author / commit (subjective) |

## New infra needed

- **L1**: a fixtures harness for `classify()` — synthetic `{ledgerRow, localState,
  remoteState}` triples. Pure, no new tooling beyond vitest.
- **L2**: a fake/in-memory `Provider` adapter to drive engine integration without a
  live Google account; plus a thin real-Google smoke behind a credential guard.
- No L3 (Playwright) rows — this change ships no rendered-dashboard UI; it is an
  engine + adapter + CLI-shaped tool. Revisit if a settings-panel surface is added.
