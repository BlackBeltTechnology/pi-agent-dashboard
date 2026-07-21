## Why

The dashboard's **Directory Initialize** runs this repo's `worktreeInit.run.command`
(`.pi/settings.json`), whose first step is `corepack enable`. That command runs
under the dashboard's *bundled, stripped* Node (`~/.pi-dashboard/node`), which
deliberately removes corepack (`packages/electron/scripts/download-node.sh` →
`rm -rf .../lib/node_modules/corepack`). Result: `bash: corepack: command not
found` → the whole hook fails with `script_nonzero_exit` **before `pnpm install`
ever runs**, and the gate stays open so it retries forever.

`corepack enable` is also *unnecessary* on machines where the pinned pnpm is
already on PATH (e.g. a standalone `pnpm@11.15.1` install matching the root
`packageManager` field). Its only job is to activate that pinned pnpm; when pnpm
is already resolvable, the step is pure overhead that now hard-fails.

## What Changes

- Make `corepack enable` **best-effort** in this repo's
  `.pi/settings.json#worktreeInit.run.command`: run it only when `corepack` is on
  PATH, otherwise fall through to the pnpm already on PATH. New leading segment:
  `command -v corepack >/dev/null 2>&1 && corepack enable; pnpm install && …`
  (the `corepack enable` failure no longer aborts the `&&` chain).
- No engine behavior changes. Per the `worktree-init-hook` spec's own philosophy
  ("the engine still runs whatever bash the project declares. Projects MUST
  author the `gate`/`run`" coherently), this is a **project-declared-hook
  coherence fix**, not an engine requirement change.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `worktree-init-hook`: ADD a project-hook **coherence requirement** — a `run`
  command SHALL NOT hard-depend on a package-manager *activator* (e.g.
  `corepack`) absent under the runtime Node; guard it best-effort so the run
  falls through to the on-PATH package manager. No engine code changes; this
  codifies the same project-authoring obligation the spec already places on
  `gate`/`run` coherence.

## Impact

- **`.pi/settings.json`** — `worktreeInit.run.command` string (the only functional change).
- **Behavior**: Directory Initialize succeeds under the stripped bundled Node
  (falls through to on-PATH pnpm); unchanged in Docker/CI where `corepack` is
  present (it still runs). Clears the retry loop caused by the open gate.
- **Docs**: add a one-line known-issue note to `docs/faq.md` (corepack-missing →
  best-effort) so future readers understand the guard.
- No source code, no dependencies, no API surface touched.
