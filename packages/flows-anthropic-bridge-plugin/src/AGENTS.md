# DOX — packages/flows-anthropic-bridge-plugin/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `client.tsx` | Dashboard client entry for flows-anthropic-bridge plugin. Exports `FlowsAnthropicBridgeSettings`. Uses `usePluginConfig`/`usePluginSend` from dashboard-plugin-runtime context. GETs `/api/flows-anthropic-bridge/status`, renders per-PID peer-probe table (`@pi/anthropic-messages`, `pi-flows`), exposes gate-override checkboxes mapping env-var toggles `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL` / `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL`. Defines `FlowsAnthropicBridgeConfig`, `BridgeStatus` types. |
| `peer-probe.ts` | Pure peer-probe (testable without runtime). Two-tier per-peer resolution for `@pi/anthropic-messages` + `pi-flows`: tier 1 = `createRequire(cwd).resolve(spec)`; tier 2 = optional `deps.resolvePiPackage(spec)` over `~/.pi/agent/settings.json#packages[]` + `<cwd>/.pi/settings.json` (covers npm / git / local installs invisible to Node). Per-peer result shape `PeerProbe { found, via: "node" \| "pi-packages", entryPath? }` (`entryPath` populated only on tier-2 hit). Returns `{ anthropicMessages, piFlows }` driving bridge state machine `probing | waiting_peers | active | degraded`. Falls back to `pi.events.listenerCount("flow:register-agent-extension")` when both peers still absent (legacy bridge already wired). 12 unit tests at `src/__tests__/peer-probe.test.ts` (was 6). See change: add-shared-pi-package-resolver. |
