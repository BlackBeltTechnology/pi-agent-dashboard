---
name: model-resolution
scope: Verify model:resolve handler, roles/preset, @role resolvability.
symptoms:
  - agent model fails at spawn
  - role wont resolve
  - model:resolve missing
  - flow agent model error
  - no models
  - preset not applied
depends-on:
  - pi-resolution
  - plugins-bridges
derives-from:
  - packages/extension/src/provider-register.ts (model:resolve handler, live)
  - ~/.pi/agent/providers.json roles + rolePresets + activePreset (live)
  - resolved pi-flows version (model-resolve-aware, live)
---

## SCOPE
Verify the `model:resolve` handler is registered, roles + preset are present,
every `@role` resolves, and the loaded pi-flows consumes `model:resolve`.

## KNOWLEDGE
- `provider-register.ts` registers `pi.events.on("model:resolve", …)` (plus the
  deprecated `role:resolve-model` alias). A loaded extension source lacking it
  → roles never resolve.
- `providers.json` must carry `roles`, `rolePresets`, and an `activePreset`. A
  flow agent whose model is an unresolvable `@role` fails at spawn.
- pi-flows must be a version that consumes `model:resolve` (the
  `consume-model-resolve-event` / `fix-flow-agent-model-resolution` line). A
  pre-fix pi-flows ignores the handler → agents fall back or fail.

## CHECKS
- Grep the loaded `provider-register.ts` for `model:resolve` registration.
- Read `providers.json`: `roles`, `rolePresets`, `activePreset` present?
- For each `@role` a flow/agent references, resolve it to a concrete
  `provider/model[:thinking]`; flag unresolvable roles.
- Confirm the resolved pi-flows version (from the `peers` module) is
  model-resolve-aware.
- Server-enriched: `/api/models` returns the expected catalogue for the active
  preset's provider.

## FIX ROUTING
- missing handler → load an extension source that registers `model:resolve`
  (dev local or released ≥ the fix); `npm run reload`.
- unresolvable `@role` → fix `providers.json` roles / activePreset.
- pre-fix pi-flows → upgrade pi-flows to a model-resolve-aware version (peers
  module remediation).

## DERIVES-FROM
Live: `provider-register.ts`, `providers.json`, resolved pi-flows version.
Server-enriched: `/api/models`. Hash sidecar: `model-resolution.knowledge.hash`.
