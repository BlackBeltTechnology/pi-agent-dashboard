# manage-worktrees.spec.ts — index

L3 for the manage-worktrees surface (test-plan F4, F3, F7, X5, X11, X12, X13): menu gate is session-INdependent, session-less removal skips the `active_sessions` guard, list converges with no manual refresh, out-of-band-deleted dir reads as "already gone" (never a raw 400), prune is repo-global, escalation inherited from `CloseWorktreeDialog`, row text ≥ 4.5:1 in BOTH themes. Setup drives REST, assertions drive the DOM. See change: manage-worktrees-filter-cleanup.
