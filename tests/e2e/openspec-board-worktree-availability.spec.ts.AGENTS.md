# openspec-board-worktree-availability.spec.ts — index

L3 spec (test-plan #F6, change: fix-openspec-board-worktree-button-gating). Creates a per-run git repo `/fixtures/board-wt-<base36 ts>` (unique so the folder provably has ZERO prior sessions in the shared container) holding one OpenSpec change; asserts `card-new-worktree-*` is present + ENABLED with no session at all (the old `gitBranch` gate rendered nothing there), then spawns a session, ends it via `POST /api/session/:id/shutdown`, and re-asserts. `afterAll` removes the fixture.
