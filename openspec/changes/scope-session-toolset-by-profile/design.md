## Context

The dashboard spawns per-invoice sessions through the invoice plugin's
session-link layer (`spawnAndBind`), which calls the plugin `spawnSession` host
hook (`server.ts`), which calls `spawnPiSession` (`process-manager.ts`). That
spawn already threads a **guard** environment: `spawnPiSession` resolves a guard
policy for the cwd/origin, folds it into `opts.guardEnv`, and `buildSpawnEnv`
merges `guardEnv` last into the process env (`extraEnv` merge slot, added by
`constrain-agent-tool-surface`). Today `extraEnv` is fed **only** by the guard;
callers cannot inject their own env.

A session's tool profile is chosen from its process environment at start. Because
no caller env reaches the spawn, every per-invoice session boots with the same
(default, full) profile as the global "Ask" session, so the two cannot be
distinguished. The guard alone cannot separate them: both spawn paths share the
invoice workspace cwd, so cwd-keyed guarding covers both identically — a
per-session signal is required, which env is.

This design generalizes the guard's env path into a caller-supplied env, and has
the plugin set a per-invoice scope value on it.

## Goals / Non-Goals

**Goals:**
- A headless spawn can carry a caller-supplied env map into the spawned process.
- Caller env and guard env coexist in one spawn without either overwriting the other.
- Per-invoice sessions boot with `IB_TOOLSET=scoped-invoice` + `IB_INVOICE_ID=<id>`.
- The global "Ask" session is spawned unchanged and keeps the full surface.

**Non-Goals:**
- No new profiles, roles, or admin/user split (a later effort may add those).
- No REST contract change, no client change.
- No change to guard semantics (built-in tools stay disabled for guarded spawns).
- Reconfiguring which tools a profile maps to is out of scope here.

## Decisions

### D1 — Caller env merges INTO the guard env (single `extraEnv`), guard wins on conflict

`buildSpawnEnv` takes one `extraEnv` map and merges it last. Rather than add a
second env argument (which would force an ordering choice at four call sites and
risk one clobbering the other), `spawnPiSession` folds the caller-supplied env
and the resolved guard env into **one** `guardEnv`/`extraEnv` map before
`buildSpawnEnv` runs. Merge order: caller env first, then guard env, so the
**guard env wins** on any key collision — a caller can never weaken the guard by
supplying a conflicting key. The scope keys (`IB_TOOLSET`, `IB_INVOICE_ID`) do not
collide with guard keys, so in practice both survive; the ordering only fixes the
adversarial case.

*Alternative considered:* a separate `callerEnv` parameter threaded to
`buildSpawnEnv` alongside `extraEnv`. Rejected: duplicates the merge logic, adds a
second thing to keep in sync at every spawn call site, and makes the
guard-vs-caller precedence implicit instead of explicit.

### D2 — Scope env is set at the plugin's session-link layer, only when an invoice id is bound

`spawnAndBind` already knows the bound `invoiceId` (or `undefined`). It sets
`env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId }` **only when
`invoiceId` is present**. When absent, no scope env is sent, so the session keeps
the default profile. This keeps the "Ask" session (spawned without a per-invoice
binding) untouched with a single conditional, and localizes the policy to the one
layer that owns the invoice↔session correlation.

*Alternative considered:* set the env in the host hook based on `automationRun`.
Rejected: the host hook has no invoice id and no business encoding invoice policy;
the plugin owns that.

### D3 — The env field is optional and additive across all three layers

`SessionLinkDeps.spawnSession` opts, the plugin `spawnSession` hook opts, and
`SpawnOptions` each gain an **optional** `env?: Record<string, string>`. Absent ⇒
byte-identical to today. This keeps every non-invoice spawn path unchanged and
makes the feature opt-in per spawn.

## Risks / Trade-offs

- **Caller env weakening the guard** → Mitigated by D1 merge order: guard env is
  applied after caller env, so guard keys always win.
- **Scope leaking to the "Ask" session** → Mitigated by D2: env is set only when
  an invoice id is bound; the "Ask" spawn carries no invoice id, so no scope env.
- **Silent no-op if env never reaches the process** → The faux gate asserts the
  spawned process env carries the scope (profile resolves to `scoped-invoice`),
  and a regression asserts the unscoped spawn stays full-surface.
- **Empty/blank invoice id** → `IB_INVOICE_ID` is only set from a present
  `invoiceId`; the consumer already treats blank as unbound, so a blank value
  would be inert, but D2's presence check avoids sending one.

## Open Questions

None blocking. A future role/profile split (admin vs user) would extend the
profile set and the scope values, but is explicitly out of scope here.
