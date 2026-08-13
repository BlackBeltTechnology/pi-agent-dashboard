## Context

The automation engine fires an automation, resolves one `RunDispatch` from the
action, and spawns one run session. Two facts about the current pipeline drive
this design:

- **Central interpolation** (`interpolate.ts`) resolves `${{trigger}}` over the
  whole payload before the action's `buildEvent`/`buildPrompt` runs, so no action
  carries its own substitution logic.
- **One fire → one run.** The scheduler calls `onFire(automation, ctx)`, which
  calls `runner.fire(...)`. The runner applies the automation's `concurrency`
  policy against the automation key and calls `startRunFor`, which spawns the
  session and resolves the dispatch.

Per-invoice fan-out needs two new capabilities: resolve a per-invoice
`${invoice_id}` token, and turn one fire into N runs (one per queued invoice),
each scoped by env — without leaking invoice knowledge into the generic engine.

## Decisions

### Decision 1 — Named-variable interpolation, additive to `${{trigger}}`

Extend `interpolate(value, triggerValue, vars?)` with an optional `vars` map.
A single-brace `${name}` token resolves to `vars[name]` when present, else is
left intact. `${{trigger}}` handling is unchanged and runs first; the
double-brace form never collides with the single-brace `${name}` matcher.

Rationale: keeps ALL substitution central. The flows action's `buildEvent` still
forwards `payload.inputs` verbatim — by the time it runs, `inputs.invoice_id` is
already the resolved id. No action-specific token logic.

### Decision 2 — Fan-out at the fire boundary, not in the dispatch

The engine wraps `onFire` with a fan-out dispatcher. When
`action.payload.scope === "per-invoice"`:

1. Resolve the run workspace (`scopeBaseFor(automation)` — the repo root).
2. Call the injected `enumerateQueued(cwd)` → `string[]` of queued invoice ids.
3. For each id, call `runner.fire(automation, { ...ctx, vars: { invoice_id: id },
   invoiceId: id })`.

An empty list fires nothing. A missing enumerator skips the fire (a single
literal-token run is exactly the bug). Firing through the runner means the
automation's `concurrency` policy is honoured unchanged: `queue` serialises the
per-invoice runs under one automation key; `parallel` runs them concurrently.

Rationale: the runner already owns concurrency + queueing. Fanning out into N
`runner.fire` calls reuses that machine verbatim — no new serialization code.

### Decision 3 — Enumerator injected via the cross-plugin service seam

The generic automation engine must not import invoicebot. The invoicebot plugin
`provide`s a `(cwd) => Promise<string[]>` enumerator under
`invoicebot:queuedInvoices`; the automation plugin `consume`s it lazily at fire
time (so load order is irrelevant and a config edit is picked up live). The
enumerator runs `engine.query(cwd, { view: "list", state: "queued" })` and maps
`details.items[].id`.

Rationale: mirrors the existing `automation.action.flows` publish/collect and
`invoicebot:resumeScopeEnv` provide patterns — no compile dependency either way.

### Decision 4 — Env passthrough on the scoped spawn

`startRunFor` resolves the action payload (trigger + vars) and, for a per-invoice
fire, extracts `payload.env` (a string→string map) and forwards it as
`spawnSession({ ..., env })`. `SpawnLike` is widened with `env?`; the host spawn
hook already accepts `env` (used by the invoicebot per-invoice scoped session).

Rationale: env scopes the run session's tool surface (`IB_TOOLSET` /
`IB_INVOICE_ID`). It is a spawn-process concern, not a flow input, so it travels
via `spawnSession`, not `buildEvent`.

## Non-goals

- No change to `folder`/`global` scope scanning or the manual-run scope param.
- No new trigger kind; fan-out is an action-payload concern, scheduler-agnostic.
- The invoicebot engine's queued-state view already exists; this change consumes
  it, it does not add engine views.
