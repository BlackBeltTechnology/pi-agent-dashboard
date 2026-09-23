# worktree-grouping-survives-remove.spec.ts — index

L3 (change: fix-worktree-grouping-lost-on-remove, test-plan #F1, #F2, #X2, #X3). Seeds a parentage-less `.meta.json` → restart → asserts load-time inference heals it under the parent repo, and that a live session's parentage survives `git worktree remove` + a mid-window server restart. Drives one turn so the transcript exists (an idle spawn has no `.jsonl`). Seeded `docker exec` meta, `/api/restart` + `waitForRestart`, `folder-home-row-*` reader.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 fix-worktree-grouping-lost-on-remove.
