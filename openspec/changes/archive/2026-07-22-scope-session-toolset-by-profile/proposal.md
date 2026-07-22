## Why

Per-invoice sessions the dashboard spawns inherit the full InvoiceBot tool
surface — they can query and mutate every invoice, author rules, and reconfigure
intake, not just act on the one invoice they were opened for. The spawn path has
no way to hand a session a scoped tool profile, so the intended per-invoice
containment is switched off end to end. This closes that gap by letting a spawn
carry an explicit scope, and having the invoice plugin set it.

## What Changes

- The server spawn path gains a caller-supplied environment map that is forwarded
  into the spawned session's process environment, merged with (never clobbering)
  the existing guard environment.
- The plugin `spawnSession` host hook forwards this env to the underlying spawn.
- The invoice plugin's session-link layer sets a per-invoice scope on the sessions
  it spawns to run a flow: `IB_TOOLSET=scoped-invoice` plus `IB_INVOICE_ID=<id>`
  (only when an invoice id is bound).
- The global "Ask" (Kérdezz) session is left unchanged — no scope env — so it
  keeps the full tool surface.

## Capabilities

### New Capabilities
- `invoicebot-session-profile`: The invoice plugin scopes the tool surface of a
  per-invoice spawned session by setting spawn-time environment
  (`IB_TOOLSET=scoped-invoice`, `IB_INVOICE_ID=<id>`); the persistent global "Ask"
  session is spawned without a scope and retains the full surface.

### Modified Capabilities
- `headless-spawn`: A headless spawn SHALL accept an optional caller-supplied
  environment map and forward it into the spawned process's environment, merged
  with the guard environment so neither source overwrites the other.

## Impact

- `packages/server/src/process-manager.ts` — `SpawnOptions` gains a caller env;
  `buildSpawnEnv` merges caller env with guard env.
- `packages/server/src/server.ts` — the plugin `spawnSession` hook forwards
  `opts.env` into `spawnPiSession`.
- `packages/invoicebot-plugin/src/server/session-link.ts` — `SessionLinkDeps.spawnSession`
  opts gain `env`; `spawnAndBind` sets the per-invoice scope env.
- Behavior: per-invoice sessions boot scoped to their invoice; the "Ask" session
  is unaffected. No REST shape change, no client change.

## Discipline Skills

- `security-hardening` — this narrows a session's tool surface (a privilege /
  blast-radius boundary); verify the scope cannot be bypassed and the unscoped
  path stays intentional.
- `doubt-driven-review` — the caller-env vs guard-env merge is the one
  irreversible-shaped decision; stress-test the merge order before it stands.
