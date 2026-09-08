# Detach automation + goal session identity from core

> **STATUS: REQUEST FOR VALIDATION.** This proposal is deliberately incomplete.
> It records a verified problem statement and a candidate shape, and it ends in
> a list of **Open Questions** that need a second opinion before any code moves.
> Nothing here should be implemented until those questions are answered.

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
  keys land in `.meta.json` byte-identically — **no migration, no back-compat
  shim, no data loss.**
- Collapse the two near-clone pending registries into one generic token-keyed
  store.
- `automationRun` leaves the generic plugin API (`server-context.ts:144`).
- Per doctrine rule "built-ins are peers", `goalId` / `automationRun` stop being
  privileged core fields and become ordinary published contributions.

### Explicit non-goals

Batch fan-out run/lease lifecycle · grouped/queued parallel spawning · trusted
user identity · anything in `invoicebot-plugin` (named only as a future third
consumer needing no core change).

## Capabilities

### New Capabilities

None yet. The capability boundary is itself an open question (Q1: does this land
as one change or two?). Spec deltas are deliberately **not** written until Q1–Q8
are answered — writing them now would encode an unvalidated scope decision.
`.openspec.yaml` sets `skip_specs: true`, matching the precedent of
`archive/2026-08-31-investigate-bridge-cwd-asymmetric-immunity`.

### Modified Capabilities

None yet. Once answered, the likely touch set is `dashboard-plugin-loader`
(`ServerPluginContext` gains the ownership seam) and `spawn-correlation` (the ref
rides the existing token machinery) — but naming them now would presume Q1/Q2.

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

## A correction to the record

An earlier framing of this work claimed the automation token-claim fix
(`892e5d9d1`) had been "silently deleted by a merge" and that its tests "passed
while the feature was dead". **Both claims are false.** Verified:

- `git log -S'consume(cwd, spawnToken)' origin/private/invoicebot -- packages/server/src/event-wiring.ts`
  returns exactly one commit — the one that **added** it. There is no deletion commit.
- The fix is live and wired on `private/invoicebot` today:
  `event-wiring.ts:434  pendingAutomationRunRegistry.consume(cwd, spawnToken)`.
- Its tests assert the real property, e.g.
  *"never hands a token-bound stamp to a foreign or tokenless session"*.
- The two commits that looked like a revert (`ca03b8003`, `d2a2dcb46`, 21 seconds
  apart) touched only openspec doc artifacts, not code.

The actual situation is **branch divergence, not deletion**: `develop` still has
`consume(cwd)` (`:445`) while `private/invoicebot` has `consume(cwd, spawnToken)`
(`:434`). `private/invoicebot` is 114 ahead / 28 behind `develop`. Per project
doctrine the dashboard merges only to `private/invoicebot`, so this divergence is
the expected steady state and **not** a bug to fix here.

## Open Questions

These are the reason this document exists. Each needs a decision from someone
with more context than the author before implementation starts.

### Q1 — Scope: how much moves in one change?

- **(a)** Seam only. Add the generic ref axis; automation + goal adopt it; the
  ten `server/src/goal/*` files stay in core.
- **(b)** Seam + full goal detach (move the ten files into `goal-plugin`).
- **(c)** Two sequenced changes sharing this name: seam first, goal move second.

*Author's lean: (c) — `decouple-automation-action-registry` deliberately scoped
itself to "the wiring/ownership model" with no behaviour change, and that
discipline seems right here too. Not decided.*

### Q2 — Does the child process need to participate?

The spawn token is single-use and scrubbed on first register:

```ts
// packages/extension/src/session-sync.ts:147
const spawnToken = isFirstRegister ? consumeSpawnToken() : undefined;
```

Two paths produce a **new sessionId with no token**:
1. in-process `new`/`fork`/`resume` — `session-sync.ts:243-268` sends no
   `spawnToken` key at all, but carries the *same* `process.pid`;
2. keeper respawn — `spawn-correlation/spec.md:417` mandates the token be deleted
   from the child env on every relaunch after the first.

**Shape A** (host-side only: resolve via the existing token→pid/keeper entry) vs
**Shape B** (inject the ref as its own env var so the child echoes it).

*Author's lean: Shape A. Shape B requires a ref env var that is NOT scrubbed,
which means nested/subagent pi processes inherit it — re-opening the leak class
that `fix-spawn-token-env-leak` closed. But this needs a second opinion.*

### Q3 — Should ownership propagate across an in-process session change?

The two tokenless cases want **opposite** answers:

- **keeper respawn** — pi crashed, keeper relaunched: same logical run, ref
  **should** propagate (not propagating orphans the run — the zombie class
  `fix-automation-stop-zombie-runs` exists to kill).
- **in-process fork** — someone forked inside a run session: a different session;
  propagating would let a manual fork finalize someone else's run.

So: is continuity a **plugin policy** (needs an `onSessionContinued`-style hook,
larger API) or does core pick one blanket rule? Also unverified: can a headless
automation/goal session even reach the fork path in practice?

### Q4 — Does the legacy cwd-FIFO tier survive, and in what role?

`headless-pid-registry.ts:170-176` documents tier 3 as *"Race-prone for
concurrent same-cwd spawns"*. On `private/invoicebot` automation already
prefers the token (`consume(cwd, spawnToken)`) with cwd as fallback.

Should the generic seam permit a cwd match to **assign ownership** at all, or
must cwd be demoted to classification-only, with ownership strictly token-derived?

### Q5 — Should the ref be filed before the spawn await?

```ts
// packages/server/src/server.ts:1519-1541 (goal path)
const spawnToken = mintSpawnToken();              // ① token exists
const result = await spawnPiSession(cwd, {...});  // ② child may register HERE
headlessPidRegistry.register(..., goalId);        // ③ identity filed AFTER ②
```

A register landing between ② and ③ finds no identity on the token path. A wrong
match is impossible (the key is the token) but a **miss** is possible, and a miss
falls into Q4's fallback. Should the seam require filing `token → pluginRef`
*before* the spawn call? Note the goal path rolls back on failure
(`consume(cwd)` at `:1543`/`:1546`); the automation path has no equivalent —
is that a second latent bug or intentional?

### Q6 — Where does plugin lifecycle policy live?

`isRecoveryCandidate` (`session-meta.ts:211`) and `pi-gateway.ts:898` branch on
`kind === "automation"` to make **respawn** and **finalization** decisions. A ref
slot alone does not remove these — they need either a generic lifecycle
declaration on the contribution (e.g. `{ respawn: false, finalizeOnSocketClose:
true }`) or plugin hooks. Which?

### Q7 — What makes the wiring undeletable?

Registry-level unit tests can stay green while the *wiring* is severed. Is a
collision test the right guard — spawn two plugin-owned sessions into **one cwd**
and assert each resolves its own ref — or is there an existing pattern in this
repo that is preferred?

### Q8 — Is `develop` in scope at all?

`develop` lacks the token-claim fix entirely (`consume(cwd)` at `:445`). Since
the dashboard merges only to `private/invoicebot`, should this seam be designed
to be upstreamable to `develop` later, or is `private/invoicebot` the permanent
and only home?
