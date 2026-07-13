## 1. Regression test: reproduce the resurrection (TDD, red first)

- [ ] 1.1 Test (server): create a real worktree, open a SQLite WAL handle on
      `<wt>/.pi/dashboard/kb/index.db`, run `removeWorktree`, then trigger one more write on
      the open handle → assert the dir reappears (reproduces the husk). Write it failing.
- [ ] 1.2 Test: after the fix, `removeWorktree` on a clean worktree leaves **no** directory
      at the worktree path (no `.pi/` residue, no `-wal`/`-shm`).

## 2. Release kb DB handle on cwd removal

- [ ] 2.1 `packages/kb-extension/src/extension.ts`: subscribe to the session/cwd-removed
      signal (the same `cwdMissing` the server broadcasts) and call `closeKb(state)` for the
      affected cwd, releasing the WAL connection (checkpoint + close).
- [ ] 2.2 Ensure `closeKb` (`reindex.ts`) fully closes the store (WAL checkpointed, fds
      released) so no `-wal`/`-shm` linger and no write can recreate the file.
- [ ] 2.3 Ordering: the server SHALL signal handle-close **before or atomically with** the
      `git worktree remove`, not after, so the close wins the race (git-routes.ts).
- [ ] 2.4 Tests: on cwd-removed, the extension closes the store; a subsequent reindex tick
      for that cwd is a no-op (store gone, not reopened).

## 3. Residual-dir sweep in removeWorktree

- [ ] 3.1 `packages/server/src/git-operations.ts::removeWorktree`: after `git worktree
      remove` returns success, if the worktree path still exists on disk, `rm -rf` it —
      **guarded**: resolved realpath MUST be inside `<mainPath>/.worktrees/`, MUST NOT equal
      the main checkout, and only runs on git-confirmed removal.
- [ ] 3.2 Never sweep on git failure (dirty/unmerged/active-sessions) — the dir is still a
      live worktree; only a successful/forced removal earns the sweep.
- [ ] 3.3 Tests: sweep runs only inside `.worktrees/`; a crafted `cwd` resolving outside the
      subtree is refused; main checkout is never swept; sweep skipped on git failure.

## 4. ship-change skill sweep step

- [ ] 4.1 `.pi/skills/ship-change/SKILL.md` §10: after `git worktree remove` + `git worktree
      prune`, add a guarded `rm -rf .worktrees/<name>` if the physical dir survives (the CLI
      path bypasses `removeWorktree`). Keep the parent-repo-only guard explicit.

## 5. One-shot orphan prune utility

- [ ] 5.1 `scripts/prune-orphan-worktrees.ts`: list `.worktrees/*` dirs absent from `git
      worktree list` and `rm -rf` them (dry-run default, `--write` to apply). Idempotent;
      never touches registered worktrees or the main checkout.
- [ ] 5.2 Run it to clear the 113 existing husks; verify `git worktree list` unchanged and
      only registered worktrees remain on disk.

## 6. Docs + verification

- [ ] 6.1 Delegate to a docs subagent (caveman style): update per-file rows for
      `git-operations.ts`, `git-routes.ts`, kb-extension `extension.ts`/`reindex.ts`, and
      the new `scripts/prune-orphan-worktrees.ts` in their directory `AGENTS.md`, each with a
      `See change:` line.
- [ ] 6.2 `security-hardening`: audit the sweep path guard against path-escape / symlink
      inputs; confirm it cannot delete outside `.worktrees/`.
- [ ] 6.3 `doubt-driven-review`: walk the close↔remove↔sweep ordering (live handle, ended vs
      active session, forced removal) before commit.
- [ ] 6.4 Run full suite (`npm test 2>&1 | tee /tmp/pi-test.log`), fix failures.
