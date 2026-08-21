## Why

The browser gateway silently drops every server-to-browser message once a client send buffer exceeds 4 MiB. High-volume ordinary updates can therefore discard `prompt_request`, `prompt_cancel`, `prompt_dismiss`, and session state, leaving the live dashboard stale until a refresh triggers replay. The current local stack also resolves worktree initialization and pi runtime sources inconsistently, which makes recovery and diagnosis unreliable.

## What Changes

- Replace silent browser-gateway loss with bounded, explicit resynchronization. Ordinary high-volume frames may still be shed, but a client that misses state is forced through a deterministic reconnect/replay path before it can remain silently stale.
- Cover `prompt_request`, `prompt_cancel`, `prompt_dismiss`, viewed-session recovery, and health counters with deterministic back-pressure tests.
- Make worktree initialization resolve `.pi/settings.json` from the created/current checkout rather than a stale primary checkout, use the declared package manager and lockfile, and invoke the built workspace KB CLI directly instead of bare `npx kb`.
- Align the local dashboard service, pi runtime selection, and bridge/plugin source configuration to one current checkout/version through supported settings and rebuild paths.
- Correct the repository `debug-dashboard` skill so its first-response commands exist and are verified.
- Correct the repository source-switch skill so its status check handles pi's supported structured `packages[]` entries and can verify one-source extension alignment.
- Preserve bounded memory and existing low-value stream shedding; do not increase `MAX_WS_BUFFER`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `browser-gateway-decomposition`: back-pressure shedding must explicitly invalidate and resynchronize an affected browser connection instead of leaving it silently stale.
- `incremental-event-sync`: dropped-frame diagnostics must distinguish resynchronizing drops and prove eventual control-state recovery.
- `worktree-init-hook`: hook discovery and execution must use the target checkout's declared settings and package-manager/workspace CLI commands.
- `pi-runtime-selection`: local consumers and bridge loading must converge on one selected current runtime/source and expose divergence or conflicts in health.
- `debugging-skills`: documented dashboard health, log, and session checks must reference commands that exist and are validated; source-switch diagnostics must accept supported package-entry shapes.

## Impact

- Server browser WebSocket gateway, subscription/replay behavior, health diagnostics, and focused load tests.
- Worktree init hook resolution, `.pi/settings.json`, workspace KB build/index invocation, and regression tests.
- Repository debug and source-switch skill guidance, scripts, and validation.
- Local systemd dashboard service on ports 8147/10099, pi runtime overrides, plugin/bridge sources, full rebuild/restart/reload, and live Tailscale UI verification.
- No new dependency and no increase to the WebSocket buffer ceiling.

## Discipline Skills

- `performance-optimization` — back-pressure behavior and bounded memory are explicit acceptance constraints.
- `observability-instrumentation` — recovery and divergence must be visible in `/api/health`.
- `systematic-debugging` — the change starts from a deterministic frame-loss reproduction.
- `review-code` — the implementation changes cross server, configuration, and operational surfaces.
