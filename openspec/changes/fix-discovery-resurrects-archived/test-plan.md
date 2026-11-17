# Test Plan — fix-discovery-resurrects-archived

Stage: design   Generated: 2026-11-17

Exemplars: L1 event-wiring → `packages/server/src/__tests__/archive-on-end-wiring.test.ts` (`wireEvents`);
L1 boot discovery → `packages/server/src/__tests__/directory-service-pending-emit.test.ts` (bootstrap deps, archive-sessions-lazy-load #E13);
L1 pin → `packages/server/src/__tests__/move-folder-handler.test.ts` (`pinDirectorySideEffects` via eject);
L1 resume placement → `packages/server/src/__tests__/session-order-reboot.test.ts`;
L3 → `tests/e2e/archive-fold.spec.ts` (archived sidecars seeded via `docker exec`, `Archive (N)` fold).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | spec: First session in a folder does not resurrect archived sessions | state-transition | L1 | automated | temp sessions dir for cwd `/w/a` with 3 `.jsonl` + sidecars `archived:true`, all 3 ids in the archive index, no resident session with cwd `/w/a` | `session_register` for new id `n1` with cwd `/w/a` through `wireEvents`, then flush the `onDirectoryAdded` promise | `sessionManager.get(<each archived id>)` undefined; zero `session_added` broadcasts for the 3 ids; `sessionArchive.countsByKey()["/w/a"] === 3`; each sidecar byte-identical to its pre-trigger bytes |
| E2 | spec: Pinning a folder does not resurrect archived sessions | state-transition | L1 | automated | same fixture as E1 (3 archived, none resident) | `pinDirectorySideEffects("/w/a", ctx)` with `ctx.sessionArchive` set, flush promise | no archived id resident; zero `session_added` for them; archived sidecars byte-identical; `openspec_update` for `/w/a` still broadcast once |
| E3 | spec: Discovery never rewrites a discovered session's sidecar (D3 sidecar guard) | decision-table (resident × in-index × sidecar-exists) | L1 | automated | 4 transcripts in `/w/b`: (a) resident, (b) in index + sidecar, (c) NOT in index + sidecar `archived:true` (index drift), (d) no sidecar, not in index | `seedDiscoveredHistory(discovered, deps)` | returns exactly `[d]`; (a) object identity unchanged in manager; (b),(c) not resident; all existing sidecars byte-identical; no `.meta.json` created for (d) |
| E4 | design D1/D3: seeded shape at on-demand site | EP (valid seed) | L1 | automated | `/w/c` with one sidecar-less transcript `t1` (header startedAt T0, file mtime T1), no resident session | first-session trigger as E1 | `sessionManager.get("t1")` has `status:"ended"`, `hidden:false`, `dataUnavailable:true`, `endedAt` derived from transcript evidence (≠ `Date.now()` at trigger); exactly one `session_added` for `t1` |
| E5 | spec MODIFIED: boot archived skip preserved (archive-sessions-lazy-load #E13) | regression | L1 | automated | pinned cwd, `.jsonl` id present in archive index | `discoverAndBroadcastSessions(deps)` via helper | `get(id)` undefined; no `session_added` for it |
| E6 | design D1: fail closed without archive index | EP (invalid dep) | L1 | automated | `/w/d` with one archived-on-disk transcript + one sidecar-less transcript; handler `ctx.sessionArchive` undefined | `pinDirectorySideEffects("/w/d", ctx)` | zero sessions seeded (both ids not resident); zero `session_added`; `openspec_update` still broadcast |
| E7 | contract: bridge registration of an archived id still wins | state-transition | L1 | automated | id `z1` archived (in index, not resident, sidecar `archived:true`) | real bridge `session_register` for `z1` through `wireEvents` | `z1` resident with status ≠ `ended`; `sessionArchive.has("z1") === false`; folder archived count decremented by 1; `session_added` for `z1` emitted once |
| E8 | design D2: seeding fires no lifecycle side effects | state-transition | L1 | automated | `/w/e` with one sidecar-less transcript; spies on `metaPersistence.setLiveness`, `metaPersistence.save`, and `dispatchPluginSessionEnded` | first-session trigger as E1 | the seeded id is resident; `setLiveness`, `save` and `dispatchPluginSessionEnded` called 0 times for it |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | design D4: resume placement for a seeded session | state-transition | L1 | automated | seeded ended id `s1` (via `restore()` after the `endedSessionIds` snapshot), `pendingResumeIntents.record("s1","front")`, `s1` not first in `sessionOrder[cwd]` | `register({id:"s1"})` → `onChange(…, {priorStatus:"ended"})` | `s1` moved to the front of `sessionOrder[cwd]`; one `sessions_reordered` broadcast; `pendingResumeIntents.consume("s1")` afterwards returns `null` |
| F2 | session-filtering: null-intent reattach of a seeded session does not reorder | state-transition | L1 | automated | seeded ended id `s2`, no recorded intent, no `registerReason` | `register({id:"s2"})` → `onChange(…, {priorStatus:"ended"})` | `sessionOrder[cwd]` unchanged; zero `sessions_reordered`; a later alive→ended `onChange` for `s2` re-fires the ended branch (id tracked again) |
| F3 | design D4: unarchived session resume gets Resume placement | state-transition | L1 | automated | id `u1` archived, then `sessionArchive.unarchiveSession("u1")` (restores ended), `pendingResumeIntents.record("u1","front")` | `register({id:"u1"})` | `u1` at front of `sessionOrder[cwd]`; one `sessions_reordered` |
| F4 | spec: archived sessions stay archived when a folder is pinned (user-visible) | state-convergence | L3 | automated | docker harness: unpinned folder `/root/proj-x` with 2 archived sidecars (`archived:true`, seeded via `docker exec`), no resident session there | pin `/root/proj-x` via the UI | after `pinned_dirs_updated` settles: folder shows `Archive (2)`; zero live session cards in the folder; `GET /api/sessions` has no id of the 2; `GET /api/sessions/archived?cwd=/root/proj-x` returns both |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design Risks: async gap — archived between listing and seeding | fault-injection (delay) | L1 | automated | `onDirectoryAdded` promise held open (deferred) after it listed transcript `g1` (sidecar-less, resident-free) | `sessionArchive.archiveSession` path adds `g1` to the index (or a sidecar for `g1` appears) before the deferred resolves, then resolve | `g1` not resident; zero `session_added` for `g1` |
| X2 | design D1: bridge registers during on-demand discovery | fault-injection (delay) | L1 | automated | `onDirectoryAdded` deferred after listing sidecar-less `h1` | bridge `session_register` for `h1` lands before the deferred resolves, then resolve | `h1` stays the live registered record (status ≠ `ended`, `source` from the register, not `"tui"`); no second `session_added` for `h1` from discovery |
| X3 | design D3: unreadable / corrupt sidecar is not overwritten by a seed | fault-injection (abort) | L1 | automated | transcript `k1` whose `.meta.json` is invalid JSON, not resident, not in index | pin trigger as E2 | `k1` not resident; `.meta.json` bytes unchanged |

---

## Coverage summary

- Requirements covered: 9/9 (spec MODIFIED requirement + its 3 new scenarios, design D1–D4 invariants, contract bridge-wins, session-filtering null-intent)
- Scenarios by class: edge 8 · perf 0 · frontend 4 · error 3
- Scenarios by level: L1 14 · L2 0 · L3 1
- Scenarios by disposition: automated 15 · manual-only 0

## New infra needed

- none (L3 F4 reuses the `archive-fold.spec.ts` docker-exec sidecar seeding)
