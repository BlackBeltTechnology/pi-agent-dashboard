## Why

Today the only "initialize a checkout" mechanism is the **worktree-bootstrap** step (`harden-worktree-spawn`). It is hardcoded and narrow:

- **What it runs is fixed.** Only a package-manager `install` (`npm ci` / `pnpm` / `yarn` / `bun`), picked by lockfile sniff. A project cannot run migrations, copy a `.env`, generate code, or do anything else.
- **When it runs is fixed.** Only on *new worktree creation*. The primary checkout (main / develop) is never initialized, even when it sits in a clean, deps-missing state.
- **Why it runs is fixed.** Gated solely by `detectBootstrapRequirement` — true only when pi's own bridge extension is local-source. It is not a general "this project wants setup" signal.

Projects other than pi-dashboard get nothing. There is no project-owned, declarative way to say "here is how a fresh checkout of me becomes runnable."

## What Changes

- **Introduce a project-declared worktree-init hook** in `.pi/settings.json` (`worktreeInit`). The hook carries a **gate** (a bash test) and a **run** spec that is either a `script` (bash command) or an `agent` (detached headless pi with a fixed prompt + model).
- **The gate is the single source of truth for "needs init".** `gate` is a bash command; **exit 0 = needs init**. The server evaluates it in the target checkout's cwd and **caches** the result, invalidating on hook run/exit. This replaces both `detectBootstrapRequirement` and the `bootstrap-status` probe.
- **A manual "Initialize" button** appears on a directory/worktree row **iff** the gate says needs-init. No auto-run. Clicking runs the hook.
- **The hook applies to the main/develop checkout too**, not just new worktrees — same gate, same code path. This gives clean-state init for the primary checkout when it was never initialized before.
- **`run.type: "agent"` spawns a DETACHED headless pi** (cwd = checkout) with the configured prompt + model. It is fire-and-forget: completion is detected by re-evaluating the gate. It is NOT a first-class dashboard session.
- **Failures surface in a card**, reusing the existing spawn-error card pattern (stderr / log tail). Success is silent (gate flips, button disappears).
- **First-run trust gate (TOFU).** Before a hook runs for the first time, the user must confirm. Trust is keyed by `repoRoot + sha256(hook def)`; editing the gate/command/prompt re-prompts.
- **"Replace" semantics — the hook fully owns init.** When a `worktreeInit` hook is declared, it is the only thing that runs; there is no implicit install fallback. pi-dashboard therefore ships its OWN hook (`gate: test ! -d node_modules`, `run: npm ci`). The existing install heuristics demote from hardcoded logic to *the default contents of pi's hook*.

## Capabilities

### New Capabilities

- `worktree-init-hook`: A project-declared, gated initialization hook (`.pi/settings.json#worktreeInit`) with a bash `gate` (exit 0 = needs init), a `run` spec (`script` | detached `agent`), a TOFU trust model keyed by `repoRoot + hash(def)`, and cached gate evaluation. The hook applies uniformly to new worktrees and the primary checkout.

### Modified Capabilities

- `git-operations-api`: Replace the bootstrap endpoints (`/api/git/worktree/bootstrap`, `/api/git/worktree/bootstrap-status`) with hook-oriented endpoints: gate evaluation (`/api/git/worktree/init-status`) and hook run (`/api/git/worktree/init`). `POST /api/git/worktree` no longer auto-runs an install; it leaves init to the gated, manually-triggered hook.
- `folder-action-bar`: A directory/worktree row gains an "Initialize" button shown iff the cached gate result is needs-init. Replaces the implicit install-then-spawn degraded action.

## Impact

**Code touched:**
- `packages/server/src/worktree-bootstrap.ts` → generalize into a hook engine: read `worktreeInit` from `.pi/settings.json`, evaluate the gate, run `script` or detached `agent`. `runBootstrap`'s ring-buffer / throttle / timeout becomes the script-flavor executor.
- `packages/server/src/routes/git-routes.ts` → swap bootstrap endpoints for `init-status` (gate eval, cached) + `init` (run hook). Remove auto-run from `POST /api/git/worktree`.
- `packages/server/src/worktree-bootstrap-registry.ts` → reused for init progress streaming (rename optional).
- New `packages/server/src/worktree-init-trust.ts` → TOFU store keyed by `repoRoot + sha256(def)`.
- `packages/shared/src/browser-protocol.ts` → `worktree_init_*` events (rename of `worktree_bootstrap_*`), trust-confirm message.
- `packages/client/src/components/WorktreeSpawnDialog.tsx` + `folder-action-bar` → Initialize button gated on cached `init-status`; trust-confirm dialog; failure card.
- `.pi/settings.json` (this repo) → add `worktreeInit` hook so pi-dashboard keeps installing deps under the new engine.

**Not touched:**
- Bridge protocol, `register_session`, pi extension loader, spawn-register-watchdog.
- The project-init skill / profile system (separate change `project-init-skill-and-profiles`, which depends on this one).

**End-user impact:** Behavior parity for pi-dashboard (its shipped hook reproduces today's install). Other projects gain an opt-in init mechanism. Auto-run becomes manual + gated — a fresh worktree no longer silently installs; the user clicks Initialize.

**Risk:** Migration must keep pi-dashboard working — the shipped hook must reproduce `detectBootstrapRequirement`'s effect. Running arbitrary bash / spawning an LLM from a UI click is gated behind TOFU trust. Gate evaluation spawns a bash process per checkout; caching bounds the cost.
