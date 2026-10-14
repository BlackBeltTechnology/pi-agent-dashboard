## Context

- `PluginSpawnOptions.mode` exists; the host hook ignores `worktree`
  (documented fallback to `local`). The mapper `pluginSpawnToSessionOptions` is
  total and sanitizing (spec `plugin-spawn-scope`).
- Worktree creation lives behind `POST /api/git/worktree` (`control` tier) with
  helpers in `packages/server/src/git-worktree/` (`slugifyBranch`,
  `resolveDefaultBase`, `ensureWorktreeExcludeLine`, `parsePorcelainWorktrees`).
- The browser spawn path already handles attach (`attachProposal`), base
  registration (`pending-worktree-base-registry`) and auto-init
  (`auto-init-worktree.ts`, TOFU trust in `worktree-init-hook`).
- `automation.yaml` documents `mode: worktree` and examples use it; today those
  runs execute locally.

## Goals / Non-Goals

**Goals:** one server function for create-or-reuse used by both the REST route
and the plugin hook; typed failures; per-repo serialization.

**Non-Goals:** worktree removal or merge after a run (owned by ship-change /
worktree-lifecycle); making automation's bare `mode: worktree` create worktrees
(separate decision, would change every existing automation); new trust grants.

## Decisions

**D1 — Extract `ensureWorktree({ repoCwd, branch, base?, ifExists })` from the
REST handler.** The route and the plugin hook call the same function, so path
rules, exclude handling and branch validation cannot diverge. Returns
`{ ok: true, path, branch, created } | { ok: false, code }`.

**D2 — Opt-in by block, not by mode.** Only `worktree: {…}` triggers creation.
Keeps the bare `mode: "worktree"` fallback for back-compat (automation).
*Alternative:* honour bare mode with an auto branch name — rejected: silently
changes existing automations and floods `.worktrees/`.

**D3 — Validation before git.** `git check-ref-format --branch` plus a slug path
containment check (`path.resolve` result must stay under the repo's worktree
dir) before any mutating git call. Branch passed as argv, never via a shell.

**D4 — Per-repo async mutex** keyed by resolved repo root, held across
list → create → register base. Re-list inside the lock implements `reuse`.

**D5 — Reuse the browser spawn's post-create wiring** (base registry enqueue,
attach intent, auto-init gate) via a shared server helper rather than
duplicating it in the plugin hook.

## Risks / Trade-offs

- **SDK surface growth** on `PluginSpawnOptions` — additive, optional field.
- **Disk growth** from workflow-created worktrees — `ifExists: reuse` default in
  workflows; cleanup stays with ship-change.
- **Rollback:** remove the block handling; callers get the legacy local fallback
  — workflows must then treat worktree steps as unavailable (they check the
  result type, not assume).
