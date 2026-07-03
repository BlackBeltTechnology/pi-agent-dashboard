## Why

A freshly spawned worktree is missing two dev assets the team relies on: the generated `opsx` (`openspec-*`) skills and the `kb` markdown index (`.pi/dashboard/kb/index.db`). Both are gitignored / generated, so `git worktree add` never restores them; only the `worktreeInit` hook can.

Investigation surfaced two distinct problems:

1. **The `run` command does not build the kb index.** `worktreeInit.run.command` is `npm ci && npx openspec init --tools pi --force`. It restores `node_modules` and the opsx skills, but never runs `kb index`. The kb DB is only built lazily on the first `kb_search`, paying a cold full-index at the worst time (mid-investigation).

2. **The gate has a coverage blind spot.** The gate is `test ! -d node_modules`. It only detects a missing `node_modules`. If a worktree has `node_modules` but is missing the opsx skills or the kb index, the gate reports `needsInit: false` and the whole hook is silently skipped — the assets stay missing. This is a general engine-level defect: **a gate that under-detects what its `run` produces makes the run un-runnable.**

## What Changes

- Add a **kb index pre-warm** step to the project's `worktreeInit.run.command` so a fresh worktree ends init with a built `.pi/dashboard/kb/index.db`.
- **Broaden the project's `worktreeInit.gate`** so it reports `needsInit` when ANY restored asset is absent (`node_modules`, opsx skills, or the kb index), not just `node_modules`.
- Add a **gate/run coherence** requirement to the `worktree-init-hook` capability spec: a declared hook's `gate` SHOULD evaluate true whenever any asset its `run` produces is absent, so the run is never silently skipped while its outputs are missing.
- Update docs (`docs/faq.md`, `docs/file-index-server.md`) to note the kb-index step and the coherence guidance.

## Non-goals

- **No engine code change.** `readInitHook` / `evaluateGate` / `runInitHook` behavior is unchanged; the engine already runs whatever bash the project declares. This change edits the project's declared hook plus adds spec guidance.
- **Not addressing auto-init not firing.** The `autoInitWorktreeOnSpawn` preference defaulting off + one-time TOFU trust are working as specified (`worktree-auto-init` spec). Manually clicking `WorktreeInitButton` remains the trust-granting path. Out of scope here.
- No change to the TOFU trust model. Editing `worktreeInit` changes its hash and will re-prompt for trust on next run — expected, by design.

## Capabilities

### Modified Capabilities
- `worktree-init-hook`: Add a **gate/run coherence** requirement — a hook's `gate` SHOULD detect absence of every asset its `run` produces, so a partially-initialized checkout (e.g. `node_modules` present but generated skills / kb index missing) still reports `needsInit` and the run is not silently skipped.

## Impact

- **Config**: `.pi/settings.json#worktreeInit` — broaden `gate`, append `kb index` to `run.command`. Changing this rehashes the hook → next run re-prompts for TOFU trust (expected).
- **Docs**: `docs/faq.md` (worktree-init command + coherence note), `docs/file-index-server.md` (worktree-init.ts row annotation).
- **Runtime**: `npx kb index` runs after `npm ci` (kb bin linked at `node_modules/.bin/kb`); needs `NODE_OPTIONS=--experimental-sqlite`. Adds one-time index build to init duration; removes the cold-index penalty on first `kb_search`.
- **Backward compatible**: fresh worktrees gain the kb index; existing worktrees with `node_modules` but a missing kb index now correctly re-fire init instead of skipping.
