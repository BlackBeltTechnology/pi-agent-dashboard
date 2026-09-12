# Relocate the goal product from core into goal-plugin

> **Status: planned — ready to build.** `design.md`, `tasks.md`, and
> `test-plan.md` are drafted; requirement deltas are carried by `design.md`
> rather than `specs/**` (`skip_specs: true`). This is the deferred **Change B**
> follow-up explicitly
> carved out of `detach-automation-goal-from-core` (Change A), whose non-goals
> read: *"relocating the ten `packages/server/src/goal/*.ts` product files into
> `goal-plugin` (a separate follow-up change)."* This document is that change.

## Why

Two first-party features — automation and goal — are detached from core to
**wildly different degrees**. `automation-plugin` is fully self-contained: its
entire product (24 server modules, ~4,476 LoC — `run-store`, `scheduler`,
`engine`, `runner`, `routes`, trigger/work-source registries) lives **inside the
plugin**. `goal-plugin` is the inverse: a **138-line server shell**, while the
actual goal product lives in **core**:

```
packages/server/src/goal/goal-store.ts               530  per-cwd GoalRecord persistence
packages/server/src/goal/goal-supervisor.ts          447  pursuit policy, respawn, budget
packages/server/src/goal/goal-status-projector.ts    121  goal_status consumer
packages/server/src/goal/goal-verdict-accumulator.ts 101  goal_status accumulator
packages/server/src/goal/goal-session-primer.ts       99  /goal kickoff commands
packages/server/src/goal/decorate-goals-spend.ts      47  read-time spend decoration
packages/server/src/goal/goal-budget-guard.ts         42  pure budget-halt decision
packages/server/src/routes/goal-routes.ts             —   the goal REST surface
packages/server/src/pending/pending-goal-link-registry.ts   —  goal spawn correlation
```

Core `server.ts` imports seven `./goal/*` modules directly (`:61-67`), plus the
goal routes (`:111`) and the goal pending registry (`:87`). `goal-routes.ts`
itself reaches back into `../goal/` (`:20-21`). The goal product is **stitched
into the composition root**, not owned by its plugin.

### Why now, and why this is a follow-up (not part of Change A)

Change A (`detach-automation-goal-from-core`) adds the missing enabler: a
**generic session-ownership seam** on `ServerPluginContext` (opaque `pluginRef`
+ a core-owned `recover` / `finalizeOnSocketClose` lifecycle declaration) and a
unified token-keyed correlation store. That seam is what lets a plugin own its
spawned sessions **from outside core** without core naming it.

Change A deliberately stopped at *adopting* the seam (goal files stay in core,
byte-identical keys) to keep that change wiring-only — matching the discipline
of `archive/2026-07-01-decouple-automation-action-registry` ("no behavior change
to what an action *does*"). **This change spends the seam Change A built**: it
moves the goal product across the boundary so `goal-plugin` becomes the owner of
its own store, routes, supervisor, and register-time behaviour — reaching parity
with `automation-plugin`.

## What Changes

**No behavior change to what goal *does*.** `.meta.json`, the wire protocol,
`DashboardSession`, and the goal REST paths keep identical shapes and values.
This is a **relocation / ownership** change: the same code runs, hosted by the
plugin instead of the composition root.

- **Move the seven `server/src/goal/*.ts` product modules** into
  `packages/goal-plugin/src/server/`, mirroring `automation-plugin`'s layout.
- **Move `routes/goal-routes.ts`** into the plugin; `goal-plugin` registers its
  own REST surface via the plugin runtime, as `automation-plugin` does with its
  own `routes.ts`.
- **Retire core's goal wiring in `server.ts`** — the seven `./goal/*` imports,
  the `registerGoalRoutes` call, and the goal pending-registry construction move
  behind plugin registration.
- **Consume host services through `ServerPluginContext`** instead of direct core
  imports: the supervisor's death-fanout hook, session lookup, spend lookup, and
  the pluginRef ownership seam (from Change A) are reached via the plugin
  runtime, not by importing core modules.
- **`pending-goal-link-registry`**: Change A collapses the two per-feature
  pending registries into one generic token-keyed store owned by core; this
  change removes the last goal-specific consumer wiring left in core.

### The load-bearing design question (for the design phase)

The real work is **not** file movement — it is proving `goal-plugin` can reach
every host service the goal product uses today **through the plugin runtime
surface**, without a back-reference into core. Concretely, the design phase must
enumerate, for each of the seven modules, what it imports from core today
(session manager, goal store persistence path, cost/spend lookup, death fanout,
the primer/verdict `goal_status` channel) and map each to an existing
`ServerPluginContext` capability — or name the seam that must be added. If any
dependency has **no** plugin-runtime path, that is a blocking sub-decision, not a
detail.

### Explicit non-goals

- **No new goal features / behavior changes** — pure relocation. Same commands,
  same persistence format, same REST responses.
- **Not touching automation** — it is already self-contained; this change only
  brings goal to parity.
- **Not re-deriving the ownership seam** — that is Change A's deliverable; this
  change *consumes* it and hard-depends on it landing first.
- **No client relocation** — `goal-plugin/src/client/*` already lives in the
  plugin; only the server product moves.

## Dependencies

- **Hard-depends on `detach-automation-goal-from-core` (Change A).** The generic
  `pluginRef` ownership seam and the core-owned `recover` flag are the mechanism
  that lets `goal-plugin` own its sessions from outside core. This change must
  not merge before Change A.

## Impact

- `packages/goal-plugin/src/server/` — gains the seven product modules + routes
  (grows from a 138-line shell toward `automation-plugin`-style self-containment).
- `packages/server/src/goal/` — **removed** (directory + its `AGENTS.md` tree).
- `packages/server/src/routes/goal-routes.ts` — removed / relocated.
- `packages/server/src/server.ts` — seven `./goal/*` imports, `registerGoalRoutes`,
  and goal pending-registry construction removed.
- `packages/server/src/pending/pending-goal-link-registry.ts` — removed (folds
  into Change A's unified store).
- Tests that import `../goal/*` from core (`__tests__/goal-routes.test.ts`, goal
  supervisor/store tests) move with their modules into the plugin's test tree.

## Open Questions

| # | Question |
|---|---|
| Q1 | For each of the seven modules, does a `ServerPluginContext` capability already expose the host service it needs, or must the seam be widened? (Blocking — drives whether this is truly pure relocation.) |
| Q2 | `goal-store` persistence: does the plugin write to the same on-disk path/format core uses today, or does relocation change where goal records live? (Must stay byte-identical per non-goals.) |
| Q3 | Route ownership: does moving `goal-routes.ts` into the plugin keep the exact same REST paths + response shapes, and does the plugin runtime's route registration support them 1:1? |
| Q4 | Death-fanout / supervisor: the goal supervisor rides `dispatchPluginSessionEnded` today — is that reachable from the plugin, or does it require a new host hook? |
| Q5 | Load order: goal product now initializes at plugin-load time rather than composition-root time — any ordering dependency (e.g. registries that must exist before first spawn) that this exposes? |

## Discipline Skills

- **`doubt-driven-review`** — relocating a persistence-owning product across the
  core/plugin boundary is an architecture decision that is expensive to reverse;
  stress-tested before the spec stands (esp. Q1/Q2 host-service reachability).
- **`review-code`** — large cross-package move (seven modules + routes + wiring
  removal) with a hard "byte-identical behaviour" contract; reviewed before commit.
- **`systematic-debugging`** — if any relocated module loses a host service it
  silently relied on via a core import, the failure will surface at runtime
  (plugin load or first goal spawn), not at compile time.
