---
name: plugins-bridges
scope: Surface bridge registration (packages[] vs dashboardPluginBridges) + activation, and kb-extension presence for DOX doctrine injection.
symptoms:
  - flow wont show
  - bridge not registered
  - no sessions reporting
  - bridge misregistered
  - plugin not loading
  - bridge degraded
  - doctrine not injected
  - dox doctrine missing
  - first-contact nudge keeps firing
depends-on:
  - peers
derives-from:
  - ~/.pi/agent/settings.json#packages[] + #dashboardPluginBridges (live)
  - /api/health plugin bridgeLoadedFrom (server-enriched)
  - packages/shared/src/plugin-bridge-register.ts (registration model)
---

## SCOPE
Report each bridge's `bridgeLoadedFrom`, flag any bridge present only in
`dashboardPluginBridges` (invisible to pi's `packages[]` reader), and report
activation status.

## KNOWLEDGE
pi reads `packages[]`, NOT `dashboardPluginBridges`. A bridge listed ONLY in
`dashboardPluginBridges` is never invoked by pi → the "no sessions reporting"
bug. A correctly registered bridge appears in BOTH; `reconcilePluginBridgePackages`
(dashboard ≥ 0.5.4) writes both on restart.

The four dashboard bridges: `dashboard-flows`,
`dashboard-flows-anthropic-bridge`, `dashboard-goal`, `dashboard-automation`.

Activation: a bridge re-probes peers only on `session_start`. Status
`waiting_peers` names WHICH peer failed (see `peers` module); `degraded` means a
partial load. A disabled dashboard plugin auto-deregisters its bridge entirely.

## CHECKS
- Read `settings.json#packages[]` and `#dashboardPluginBridges`; a bridge in the
  latter but not the former → misregistered (flag it).
- `/api/health` (server-enriched): each plugin's `bridgeLoadedFrom` should be
  `packages[]`, not `dashboardPluginBridges`-only or missing.
- Anthropic bridge not active → report status + the per-peer probe result from
  the `peers` module.
- **doctrine configured but kb extension not loaded**: when the project's
  `.pi/dashboard/knowledge_base.json` supplies a `doctrine` key but
  `pi-dashboard-kb-extension` is ABSENT from `settings.json#packages[]`, report
  FAIL: "doctrine configured but kb extension not loaded" — the project recorded
  a doctrine choice, yet nothing injects the text. A pointer-only `AGENTS.md`
  (`<!-- dox-doctrine -->`, no `doctrine` key) is the supported opt-out — the
  project may never install the extension — so it is NOT a finding.

## FIX ROUTING
- misregistered (dashboardPluginBridges-only) → dashboard ≥ 0.5.4 writes both;
  `POST /api/restart` to run `reconcilePluginBridgePackages`.
- `waiting_peers` → fix the failed peer (peers module), then respawn the session
  (bridges wire hooks once per process).
- plugin disabled → enable it → the bridge auto-registers.
- doctrine configured but kb extension not loaded → add
  `@blackbelt-technology/pi-dashboard-kb-extension` to `settings.json#packages[]`
  (or `pi install` it), then reload the session.

## DERIVES-FROM
Live: `settings.json` packages[]/dashboardPluginBridges. Server-enriched:
`/api/health` `bridgeLoadedFrom`. Model:
`packages/shared/src/plugin-bridge-register.ts`. Hash sidecar:
`plugins-bridges.knowledge.hash`.
