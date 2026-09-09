# Detach automation + goal session identity from core

## Why

The dashboard already has a proven doctrine for decoupling a feature from a
plugin: **publish/collect inversion of control** over the host service board
(`provide` / `consume` / `consumeAll`), established by
`archive/2026-07-01-decouple-automation-action-registry`:

> The right model is **publish/collect (inversion of control)**: automation owns
> the *slots* (contract, collection, descriptor-building, dispatch); any plugin
> *publishes* its own immutable contribution under a namespaced key; automation
> *collects* lazily … after every plugin has loaded, so order is irrelevant.
> … **neither plugin references the other.**
>
> Automation registers its own `core.prompt`/`core.skill` the same way
> (self-published), so **built-ins are peers, not privileged**.

**Session ownership is the one axis that never adopted this doctrine.** Two
first-party features are wired into core by name.

### 1. Core spells plugin-specific words

`packages/shared/src/types.ts` — core's session model names two plugins:

```ts
kind?: "automation";                                                   // :425
automationRun?: { name: string; runId: string; visibility?: ... };     // :435
goalId?: string;                                                       // :442
```

Mirrored and persisted in `packages/shared/src/session-meta.ts` (`:128`, `:153`,
`:160`), read back in `packages/server/src/session/session-scanner.ts`
(`:128`, `:132`), and — the headline — leaked onto the **generic plugin API**:

```ts
// packages/dashboard-plugin-runtime/src/server/server-context.ts:144
automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
```

Every plugin that wants a spawned session to carry its own identity must either
be one of these two, or go without.

### 2. Core makes lifecycle decisions from a plugin's vocabulary

```ts
// packages/shared/src/session-meta.ts:202-213
export function isRecoveryCandidate(meta: SessionMeta | undefined): boolean {
  return (
    meta?.live === true &&
    meta.status !== "ended" &&
    meta.closedReason !== "manual" &&
    meta.kind !== "automation"        // ← plugin policy living in shared code
  );
}
```

```ts
// packages/server/src/pi/pi-gateway.ts:898
if (session?.kind === "automation" && session.status !== "ended") {
```

These are not stored values — they are **plugin policy** ("don't auto-respawn
me", "finalize me on socket close") encoded as a core branch.

### 3. The two features are detached to wildly different degrees

`automation-plugin` already uses the doctrine on **three** contribution axes:

```ts
ctx.provide(CORE_ACTION_KEY, coreActionContributions());                     // self-publish
collectActionRegistry(ctx.consumeAll("automation.action."));
collectFolderScopeBases(ctx.consumeAll("automation.folderscope."));
workSources.addProvider(ctx.consumeAll("automation.worksource."));
```

`goal-plugin` uses it on **zero**. It has no `ctx.provide` / `ctx.consume` call
anywhere, and its server entry is a 138-line shell, while the actual product
lives in core:

```
packages/server/src/goal/goal-store.ts
packages/server/src/goal/goal-supervisor.ts
packages/server/src/goal/goal-session-primer.ts
packages/server/src/goal/goal-budget-guard.ts
packages/server/src/goal/goal-status-projector.ts
packages/server/src/goal/goal-verdict-accumulator.ts
packages/server/src/goal/decorate-goals-spend.ts
packages/server/src/routes/goal-routes.ts
packages/server/src/pending/pending-goal-link-registry.ts
packages/server/src/event-wiring.ts:526   linkGoalDriver(...)
```

### 4. Two near-clone registries exist because the mechanism was never shared

`pending-automation-run-registry.ts` and `pending-goal-link-registry.ts` are
byte-similar (same `60_000` TTL, same cap `8`, same enqueue/consume shape),
differing only in the payload type and what `consume` returns. Each feature
re-derived the same mechanism because there was no shared one to reuse.

## What Changes

**The emitted keys do not change.** `.meta.json`, the wire protocol, and
`DashboardSession` keep the exact same field names and values. This is a
*wiring/ownership* change, mirroring the scope discipline of
`decouple-automation-action-registry` ("no behavior change to what an action
*does*").

- Add a **generic session-ownership seam** to the plugin runtime: a plugin hands
  an opaque `pluginRef` at spawn; the host files it against the spawn token it
  already mints; on `session_register` the host resolves the ref and notifies the
  owning plugin. Core carries the blob and never parses it.
- `automation` publishes `{ kind: "automation", automationRun: {...} }` as its
  ref; `goal` publishes `{ goalId }`. Core merges what it was handed, so the same
  identity keys land in `.meta.json` byte-identically — **no migration, no
  back-compat shim, no data loss** (the one additive byte is a core-owned
  `recover: false` on opted-out owned sessions; see Behavior deltas).
- Collapse the two near-clone pending registries into one generic token-keyed
  store.
- `automationRun` leaves the generic plugin API (`server-context.ts:144`).
- Per doctrine rule "built-ins are peers", `goalId` / `automationRun` stop being
  privileged core fields and become ordinary published contributions.

### Explicit non-goals

Batch fan-out run/lease lifecycle · grouped/queued parallel spawning · trusted
user identity · any future third-party plugin consumer (named only as a possible
future consumer needing no core change) · **relocating the ten
`packages/server/src/goal/*.ts` product files into `goal-plugin`** (a separate
follow-up change; this one adds the seam and adopts it, keeping the goal product
in core — matching the wiring-only discipline of
`decouple-automation-action-registry`).

## Capabilities

### Modified Capabilities

- **`dashboard-plugin-loader`** — `ServerPluginContext` gains a generic
  session-ownership seam: a plugin files an opaque `pluginRef` (plus an optional
  lifecycle declaration `{ respawn?, finalizeOnSocketClose? }`) at spawn, and is
  notified on register when its session resolves. Core reads the declaration,
  never the plugin name. `automationRun` leaves the generic plugin API surface.
- **`spawn-correlation`** — the `pluginRef` rides the existing spawn-token
  machinery: filed under `token → pluginRef` **before** the spawn await (closes
  the register-in-the-gap miss), resolved on first register alongside the
  sessionId link. Cwd is demoted to **classification-only** — it never assigns
  ownership. Automation migrates off its cwd-FIFO stamp tier onto the generic
  token seam (closing its documented tier-3 same-cwd race).

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` — new seam;
  `automationRun` removed from the generic surface.
- `packages/server/src/spawn-process/headless-pid-registry.ts` — `goalId?` →
  generic ref on both the live entry and `PersistedEntry`.
- `packages/server/src/event-wiring.ts` — the automation arm (`:438-475`) and
  `linkGoalDriver` (`:526`) move behind the seam.
- `packages/server/src/pending/` — two registries → one.
- `packages/shared/src/types.ts`, `session-meta.ts` — field ownership changes;
  **emitted keys unchanged**.
- `packages/automation-plugin`, `packages/goal-plugin` — become the owners of
  their own identity payload + register-time behaviour.

## Current correlation state on `develop`

On `develop`, automation stamp delivery is **cwd-FIFO only**:
`event-wiring.ts:445  pendingAutomationRunRegistry.consume(cwd)` — no spawn-token
tier. Goal, by contrast, **already rides the spawn-token machinery**
(`headlessPidRegistry.getGoalId(sessionId)`, `event-wiring.ts:1379`) with
cwd-FIFO only as a fallback. So the seam's "reuse the existing token machinery"
premise is proven by goal today; automation is the laggard that would migrate
off cwd-FIFO onto the generic token tier as part of this work (closing its
tier-3 race as a bonus).

## Decisions

The eight questions this document opened with are resolved as follows (spike
evidence + a scoping review). They are recorded here so the spec deltas trace to
an explicit decision, not an inference.

| # | Question | Decision |
|---|---|---|
| Q1 | Scope | **Seam only.** Automation + goal adopt the generic `pluginRef`; the ten `server/src/goal/*` files stay in core; relocation is a separate follow-up change. Matches the wiring-only discipline of `decouple-automation-action-registry`. |
| Q2 | Child participation | **Shape A (host-side only).** The ref resolves via the existing token→pid/keeper entry; the child echoes nothing new. Shape B would need an un-scrubbed ref env var that nested pi processes inherit — re-opening the leak class `fix-spawn-token-env-leak` closed. |
| Q3 | Continuity across in-process change | Keeper respawn deletes the token on relaunch (child registers with a new sessionId, **no token**), so continuity rides the **persisted keeper-mediated entry** (stable `keeperPid`, ref persisted on the entry as `goalId` is today) — NOT the consumed token. An in-process fork mints a tokenless sessionId with no keeper entry and does NOT inherit the ref (cwd never assigns ownership — Q4). |
| Q4 | Legacy cwd-FIFO tier | **Cwd demoted to classification-only.** A cwd match never assigns `pluginRef` ownership; ownership is strictly token-derived. The cwd tier survives solely for its existing non-ownership classification role. |
| Q5 | File ref before the await | **Yes.** The seam files `token → pluginRef` **before** the `spawnPiSession` await, closing the register-in-the-gap miss. The automation path's missing failure-rollback (vs goal's) is confirmed a latent asymmetry and is fixed as part of the migration. |
| Q6 | Where lifecycle policy lives | **Generic declaration on the contribution:** `{ recover?: boolean; finalizeOnSocketClose?: boolean }`. Core reads a single core-owned `recover` boolean (default `true`); the hardcoded `kind === "automation"` branches in `isRecoveryCandidate` and `pi-gateway.ts:898` are removed. Both `automation` and `goal` declare `recover: false` symmetrically — core names neither, and never reads the owner ref to decide. |
| Q7 | Undeletable-wiring guard | A **same-cwd collision test**: spawn two plugin-owned sessions into one cwd and assert each resolves its own `pluginRef`. This fails if the wiring degrades to cwd-based ownership. |
| Q8 | Automation cwd-FIFO migration | **Migrate in this change.** Automation moves off its cwd-FIFO stamp tier onto the generic token seam, closing its documented tier-3 same-cwd race. |

## Behavior deltas (honest scope)

This is a wiring/ownership change, but two spots are **not** pure wiring — recorded
here so the "byte-identical, no migration" claim is not overstated:

1. **Cold-start recovery generalizes via one additive core-owned boolean.** Today
   `isRecoveryCandidate` reads `meta.kind !== "automation"`. It becomes
   `meta.recover !== false` — a core-owned flag defaulting to `true`, so core
   never reads the plugin name, the owner ref, or owner-key presence. A
   plugin-owned session is closed normally by its owning plugin (→ not live /
   `ended` → excluded for free); the persisted `recover: false` only governs the
   crash window where an owned session is still `live && !ended`. User sessions
   never carry the field (absent ⇒ recoverable) and stay byte-identical; only an
   owned session that opts out gains the single additive `recover: false` byte.
   Both `automation` and `goal` opt out through the same flag. Unowned sessions
   recover exactly as before.
2. **Goal's legacy tokenless cwd-FIFO ownership fallback is dropped.** On
   `develop` goal always spawns with a token; ownership becomes strictly
   token-derived (Q4). A tokenless register no longer acquires goal ownership by
   cwd. This is a deliberate behavior change for that one legacy path, taken to
   close the same-cwd race — flagged rather than hidden under "no behavior
   change."

## Discipline Skills

- **`doubt-driven-review`** — the seam is an irreversible ownership-API decision
  carried by core for every spawned session; reviewed before the spec stands.
- **`security-hardening`** — Q2 (Shape A) is a security boundary call: rejecting
  an un-scrubbed ref env var keeps nested pi processes from inheriting a plugin
  identity, preserving the `fix-spawn-token-env-leak` invariant.
- **`review-code`** — non-trivial cross-package wiring change (runtime seam +
  correlation tier migration + two-registry collapse) reviewed before commit.
