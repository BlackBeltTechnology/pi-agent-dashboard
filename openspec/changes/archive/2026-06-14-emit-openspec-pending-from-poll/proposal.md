# Emit OpenSpec pending spinner from the poll path

## Why

When a new worktree (or any new cwd) appears, the OpenSpec section "pops in"
several seconds later with no loading indicator. The three-state loading model
and the folder-card spinner already exist and work — the gap is **which code
path emits the transitional `pending: true` signal**.

```
OpenSpecData three-state model (packages/shared/src/types.ts:613)
  { initialized:false, pending:false }  → not openspec        → render nothing
  { initialized:false, pending:true  }  → dir found, polling   → SPINNER (already built)
  { initialized:true                  }  → poll done           → "OpenSpec (N)"
```

Today `pending: true` is emitted in exactly **one** place:
`buildOpenSpecConnectSnapshot` (`browser-gateway.ts:52`), on browser cold-boot
connect. Every other path that produces an `openspec_update` — new-directory
registration (`event-wiring.ts:732`), the periodic poll tick
(`directory-service.ts:626`), and the watcher-fired re-poll
(`directory-service.ts:544`) — broadcasts **only the final poll result**. None
emit the transitional `pending` state before the slow `openspec list` CLI
spawn.

Two worktree scenarios expose the gap:

```
SCENARIO 1 — parent repo has openspec/ committed (common)
  git worktree add → openspec/ on disk instantly
  event-wiring registers cwd → onDirectoryAdded → awaits slow `openspec list`
  → single openspec_update(initialized:true) after several seconds
  ✗ no spinner during the gap

SCENARIO 2 — openspec init runs as a delayed init-hook
  cwd registered → openspec/ does NOT exist yet
  ...seconds pass, init creates openspec/changes/...
  periodic tick / watcher reconcile discovers it → openspec_update(initialized:true)
  ✗ jumps straight from nothing to initialized — spinner skipped entirely
```

A registration-time one-shot probe (broadcast `pending` only when the dir
exists at the instant the cwd registers) fixes Scenario 1 but **not** Scenario
2: at probe time the dir is absent, so nothing is broadcast, and the later poll
that discovers the dir has no transitional emit.

## What changes

Make `pending: true` a property of the **poll**, not of cold-boot connect:
emit it at the start of any poll where `<cwd>/openspec/changes/` exists but the
cache does not yet hold `initialized: true` data — i.e. immediately before the
slow `openspec list` CLI spawn inside the poll path. The final `initialized`
broadcast follows when the CLI returns and replaces the spinner.

This covers every path that can surface a new openspec directory:
- new-cwd registration (worktree create, TUI spawn, resume) — Scenario 1
- periodic tick / watcher reconcile discovering a late-created dir — Scenario 2
- manual `openspec init` mid-session

The existing cold-boot `pending` emit (`buildOpenSpecConnectSnapshot`) is
unchanged.

## Safety: non-openspec projects never spin

The emit is gated on the same cheap `statSync` of `<cwd>/openspec/changes/`
that the existing model uses. A project without that directory yields
`pending: false` and the folder card renders nothing — no spinner, no timer,
no false positive. The gate is dir-existence, not elapsed time, so this holds
regardless of how slow the CLI is.

## Out of scope

- Surfacing openspec loading inside the `WorktreeSpawnDialog` progress stream
  (`worktree_init_*`). That stream is requestId-scoped to one browser and
  describes the dependency-install hook, a subsystem independent of openspec
  polling. Coupling them was evaluated and rejected: it is narrower (dialog
  path only, one browser) and larger than reusing the folder-global spinner.
