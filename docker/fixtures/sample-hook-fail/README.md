# sample-hook-fail

E2E fixture for `friendlier-worktree-init`. Declares a **failing**
`.pi/settings.json#worktreeInit` hook:

- gate: `test ! -f .never-created` → always `needsInit` (`.never-created` never appears).
- run: prints to stderr, `exit 3` → the run fails on every attempt (feeds the
  failed-sticky + Retry assertions).

Materialized as a real git repo by `docker/test-entrypoint.sh`. Untrusted on first load.
