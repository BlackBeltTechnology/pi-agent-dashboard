# sample-hook-ok

E2E fixture for `friendlier-worktree-init`. Declares a **slow, succeeding**
`.pi/settings.json#worktreeInit` hook:

- gate: `test ! -f .initialized` → `needsInit` until the run creates `.initialized`.
- run: prints progress, `sleep 5`, then `touch .initialized` (deterministic ~5s window
  so a `page.reload()` reliably lands mid-run to exercise boot rehydration).

Materialized as a real git repo by `docker/test-entrypoint.sh`. Untrusted on first load
so the manual Initialize control shows and the trust-confirm dialog gates the run.
