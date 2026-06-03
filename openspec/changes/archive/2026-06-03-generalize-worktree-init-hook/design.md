## Context

The worktree-bootstrap step (archived `harden-worktree-spawn`) solves one narrow problem: a fresh pi-dashboard worktree has no `node_modules`, so its local-source bridge can't load. The fix hardcoded three things — *what* runs (`npm ci` & friends), *when* (new-worktree-create only), and *why* (`detectBootstrapRequirement` = pi's bridge is local-source).

This change generalizes all three into a project-declared, gated **init hook**, while keeping pi-dashboard's behavior intact via a shipped hook.

This change is the foundation for the separate `project-init-skill-and-profiles` change: that change makes the "Initialize" button polymorphic (run the hook when present; run an interactive scaffolding skill when absent). This change only defines the hook + button-when-hook-present half.

## Goals / Non-Goals

**Goals:**
- A project can declare, in `.pi/settings.json`, how a fresh checkout of itself becomes runnable.
- The same mechanism serves a brand-new worktree AND the primary (main/develop) checkout in a clean state.
- Init is manual (a button) and idempotent (the gate decides visibility); never silent auto-run.
- A hook can be a bash script OR a detached headless-pi agent with a configured prompt + model.
- Running a hook requires first-use trust confirmation (TOFU).
- pi-dashboard keeps installing its own deps with zero behavior change, via a shipped hook.

**Non-Goals:**
- The interactive project-init skill, profiles, and the polymorphic "no hook → skill" button (separate change).
- Making the agent flavor a first-class, abortable dashboard session — it is explicitly detached.
- Auto-running the hook on server start, session spawn, or any non-button trigger.
- Multi-hook pipelines or ordering. One `worktreeInit` per project.

## Decisions

### Decision 1: The gate is a bash test; exit 0 = needs init

`worktreeInit.gate` is a bash command string. The server runs it via the shared `exec` spawn in the checkout's cwd. **Exit code 0 → needs init → show button.** Non-zero → no button.

```jsonc
// .pi/settings.json
{
  "worktreeInit": {
    "gate": "test ! -d node_modules",
    "run": { "type": "script", "command": "npm ci" }
  }
}
```

**Why exit-0-means-needs-init:** the gate literally answers the UI question "should I show the Initialize button?". `test ! -d node_modules` reads naturally as "needs init when node_modules is absent". Idempotency is intrinsic: after a successful run the gate flips non-zero and the button disappears. There is no sentinel file to manage; the project defines its own truth (a sentinel like `test ! -f .pi/.init-done` is equally valid).

**Alternative considered:** healthcheck convention (exit 0 = already healthy). Rejected — inverts the natural reading of the button predicate and forces every gate to be a negation of "needs work".

### Decision 2: "Replace" — the hook fully owns init; pi ships its own hook

When `worktreeInit` is declared, it is the sole init action. There is no implicit lockfile-install fallback. A project that wants `npm ci` declares it in `run`.

Consequence: pi-dashboard must ship a hook to preserve today's behavior. `detectBootstrapRequirement` and `pickInstallCommand` are NOT deleted wholesale — they become the *default data* of pi's shipped hook:

```jsonc
// pi-agent-dashboard .pi/settings.json
"worktreeInit": { "gate": "test ! -d node_modules", "run": { "type": "script", "command": "npm ci" } }
```

**Why replace over hook-as-default:** explicitness. "Hook-as-default" (run install when no hook) keeps hidden behavior and makes the project-init skill's job ambiguous. "Replace" makes every project's init fully visible in its own settings.

**Migration risk:** the shipped hook must reproduce `detectBootstrapRequirement`'s gate. Pi-dashboard's gate (`test ! -d node_modules`) is a faithful proxy — the old heuristic existed precisely because a worktree lacked `node_modules`.

### Decision 3: Gate evaluation is cached, invalidated on run

The gate is a spawned process — not free to run on every status poll. The server evaluates it lazily when a row's init-status is requested, caches the `{ needsInit, evaluatedAt }` per resolved checkout path, and invalidates the entry when a hook run starts/exits for that path. A short TTL bounds staleness from out-of-band changes.

**Why:** matches the existing `bootstrap-status` cadence (UI asks per row) without re-spawning bash on every render/poll.

### Decision 4: `run.type: "agent"` is a DETACHED headless pi

```jsonc
"run": {
  "type": "agent",
  "prompt": "Set up this worktree: install deps, copy .env from the parent checkout, run db migrations.",
  "model": "claude-sonnet-4",
  "settings": { /* optional model/session settings */ }
}
```

The server spawns a detached headless pi process in the checkout cwd. It is fire-and-forget:
- NOT registered as a dashboard session (no transcript in the session list, no abort button).
- "Done" is detected by re-evaluating the gate after the process exits (and on the next init-status fetch).
- Combined stdout/stderr is captured to a log (`<checkout>/.pi/worktree-init.log`) so a failure can be surfaced.

**Why detached:** a non-interactive setup agent shouldn't pollute the session list or require babysitting. The interactive, conversational scaffolder is a different tool (the project-init skill, separate change), and IS a first-class session.

**Failure surfacing:** if the agent process exits and the gate still says needs-init, the run is considered failed (or incomplete). The server emits an init-failed event carrying the log tail; the client renders it in a card (Decision 6).

### Decision 5: TOFU trust keyed by repoRoot + hash(def)

Before a hook runs for the first time, the client shows a trust-confirm dialog naming the gate + run command/prompt. On confirm, the server records trust keyed by `repoRoot + sha256(canonical(worktreeInit))`. Subsequent runs skip the prompt while the hash matches. Editing the gate, command, prompt, or model changes the hash → re-prompt.

**Why hash the def:** prevents a once-trusted repo from silently changing what auto-runs on a button click. This is the standard "trust on first use, re-verify on change" pattern for executing repo-provided code.

**Storage:** server-side JSON (alongside other dashboard persistence). Keyed by absolute repo root.

### Decision 6: Failures render in a card (reuse spawn-error pattern)

Both script and detached-agent failures produce a structured init-failed payload (`code`, `message`, `stderr`/log tail ≤ 4 KB). The client renders it in the existing spawn-error card surface. Success emits an init-done event; the client clears the card and re-fetches init-status (gate flips → button gone).

**Why reuse the card:** consistency with the existing spawn-error UX, and it gives even fire-and-forget agent runs an error surface (the original reason detached runs felt risky).

## Engine shape (server)

```
worktree-init.ts  (generalized from worktree-bootstrap.ts)
  readInitHook(repoRoot)          -> WorktreeInitHook | null   (parse .pi/settings.json#worktreeInit)
  evaluateGate(cwd, hook)         -> { needsInit: boolean }    (spawn bash gate, exit 0 => true)
  runInitHook(cwd, hook, onProg)  -> InitResult                (script: spawn cmd; agent: spawn detached pi)
  hookDefHash(hook)               -> sha256                     (trust key component)

worktree-init-trust.ts
  isTrusted(repoRoot, hash) / recordTrust(repoRoot, hash)

routes/git-routes.ts
  GET  /api/git/worktree/init-status  -> { needsInit, reason, trusted }   (cached gate eval)
  POST /api/git/worktree/init         -> runs hook, streams worktree_init_progress, returns init result
  POST /api/git/worktree              -> no auto-init (gate+button takes over)
```

## Migration

1. Add `worktreeInit` to pi-dashboard's `.pi/settings.json` reproducing the install (`gate: test ! -d node_modules`, `run: npm ci`).
2. Generalize `worktree-bootstrap.ts` → `worktree-init.ts` (keep file or rename; update imports).
3. Replace `/bootstrap` + `/bootstrap-status` routes with `/init` + `/init-status`.
4. Rename `worktree_bootstrap_*` browser events → `worktree_init_*`.
5. Update `WorktreeSpawnDialog` / folder-action-bar to the gated Initialize button + trust dialog + failure card.
6. Remove auto-run from `POST /api/git/worktree`.

## Open Questions

- Exact cache TTL for gate evaluation (start with a small value, e.g. 30 s, invalidate on run).
- Detached agent: how to resolve the pi binary + model flags portably (reuse existing headless-spawn resolution).
- Whether to keep the `worktree-bootstrap*` filenames (less churn) or rename to `worktree-init*` (clearer). Leaning rename with re-export shim if needed.
