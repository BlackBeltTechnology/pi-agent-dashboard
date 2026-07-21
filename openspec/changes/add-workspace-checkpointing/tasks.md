# Tasks — add-workspace-checkpointing

## 1. Snapshot/restore git helper (bridge)
- [ ] 1.1 `captureSnapshot(cwd, sessionId, turn)` — temp-index `add -A` → `write-tree` →
      `commit-tree` → `update-ref refs/pi-checkpoints/<sid>/<turn>`; never touches HEAD/index/
      stash. → verify: unit test in a temp git repo — HEAD/index/stash unchanged; ref points at
      a commit whose tree matches the working tree (tracked + untracked, ignored excluded).
- [ ] 1.2 Skip capture when the tree oid equals the previous snapshot's tree oid. → verify:
      test — no new ref on an unchanged tree.
- [ ] 1.3 `diffSnapshots(cwd, refA, refB)` → `git diff` output. → verify: test asserts a known
      edit shows in the diff.
- [ ] 1.4 `revertToSnapshot(cwd, sid, targetTurn)` — (a) capture pre-revert safety snapshot,
      (b) restore working tree to target tree, (c) delete added-after files. → verify: test —
      after revert the working tree exactly equals target snapshot; a pre-revert ref exists;
      reverting to the pre-revert ref restores the later state (redo).
- [ ] 1.5 Non-git cwd ⇒ helper no-ops and reports disabled. → verify: test in a non-git dir.

## 2. Turn-end capture wiring (bridge)
- [ ] 2.1 In the existing `pi.on("turn_end", …)` path, fire `captureSnapshot` **async, off the
      critical path**; a failure degrades to no-checkpoint, never blocks the turn. → verify:
      test — a throwing capture does not reject/aborts the turn_end handler.
- [ ] 2.2 Report `checkpointRef` + `filesChanged` for the turn (extend the existing `turn_end`
      enrichment). → verify: test asserts the forwarded turn_end carries the ref.
- [ ] 2.3 Gate capture on a per-session checkpointing-enabled flag + git-repo detection.
      → verify: test — flag off or non-git ⇒ no capture.

## 3. Revert control path (client → server → bridge)
- [ ] 3.1 Add `checkpoint_revert { sessionId, ref }` control message (shape family of
      worktree-lifecycle actions); server relays to the owning bridge; bridge runs
      `revertToSnapshot` and emits the result. → verify: integration test round-trips a revert
      and returns success + the pre-revert ref.
- [ ] 3.2 Gate revert behind the existing auth (bearer-auth/pairing) + reject when unauthorized.
      → verify: test — unauthenticated revert rejected.

## 4. Checkpoint timeline UI (client)
- [ ] 4.1 Per-session timeline: one entry per turn (turn #, timestamp, changed-file count,
      ref), sourced from turn summaries + reported refs. → verify: component test renders N
      entries for N turns.
- [ ] 4.2 "Diff vs previous / current" per entry, rendered via existing `DiffViewer`. → verify:
      component test opens a diff for an entry.
- [ ] 4.3 "Revert to here" with an explicit confirm; on success show the new pre-revert entry
      and a "revert done (redo available)" affordance. → verify: component test — confirm
      required; success updates the timeline.
- [ ] 4.4 Non-git / disabled session ⇒ timeline shows a "needs a git repo" empty state.
      → verify: component test.

## 5. Retention (bridge/server)
- [ ] 5.1 Keep last N snapshots per session (configurable); prune older refs. → verify: test —
      N+2 turns leaves N refs.
- [ ] 5.2 Delete `refs/pi-checkpoints/<sid>/*` on session archive/removal. → verify: test — ref
      namespace gone after archive.

## 6. Observability
- [ ] 6.1 Log capture (turn, ref, tree oid, duration) and revert (target, pre-revert ref,
      outcome). → verify: test asserts log lines.

## 7. Docs
- [ ] 7.1 Delegate a `docs/` note (caveman style) covering the snapshot model (private ref +
      temp index), the non-destructive revert contract, git-only scope, and the auth gate.
      → verify: note exists; `ctx_index` it.

## 8. End-to-end
- [ ] 8.1 E2E (docker harness): run two turns that edit files → timeline shows two checkpoints
      → revert to turn 1 restores the tree → redo returns to turn 2. → verify: Playwright spec
      in `tests/e2e/`.

## 9. Performance
- [ ] 9.1 Measure `write-tree`/`commit-tree` on a large repo; confirm turn-end latency is
      unaffected (capture is async). → verify: a timing assertion / documented benchmark.
