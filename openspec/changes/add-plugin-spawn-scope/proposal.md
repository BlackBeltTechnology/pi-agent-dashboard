## Why

Plugins that spawn pi sessions have no typed way to constrain the spawned session's tool / skill / extension surface. Today the only conceivable channel is the raw `env` bag, which pi does not read for capability selection — so a plugin cannot say "spawn a session that only has `read` and `grep`, no skills, and one specific extension." pi's CLI already exposes native scoping flags (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `--skill`, `--no-skills`, `-e`) that the dashboard spawn chain never wires through.

## What Changes

- Add one optional `scope` block to `PluginSpawnOptions` (`dashboard-plugin-runtime`), mapping tool/skill/extension fields to pi CLI capability flags (argv) and per-extension config to namespaced env.
- Thread each `scope.*` field through the spawn chain: `PluginSpawnOptions` → new **total** `pluginSpawnToSessionOptions` mapper → `SessionOptions` (`process-manager`) → `SessionFlags` → `sessionFlagsToArgv` (`pi-dashboard-shared`) → argv (with `extensionConfig` routed to env instead).
- Extract the currently inline `PluginSpawnOptions → SessionOptions` object literal (in the `spawnSession` hook, `server.ts`) into a named, unit-testable `pluginSpawnToSessionOptions` function.
- Add capability-scope fields to `SessionFlags` + emit their flags from `sessionFlagsToArgv` (comma-joined allowlists, repeatable `--skill` / `-e`, boolean toggles).
- Project `scope.extensionConfig[name][key]` into namespaced env (`PI_EXT_<NAME>_<KEY>`) via `buildSpawnEnv` on the headless plugin-spawn mechanism, sanitizing name/key to valid env-var characters (uppercase, non-alphanumeric → `_`). This makes raw `env` an internal transport detail rather than a plugin-facing knob.
- Preserve a control-channel invariant: `scope` deliberately exposes **no** `--no-extensions` toggle, because disabling extension discovery would stop the dashboard bridge from loading and make the spawned session uncontrollable. The `extensions` allowlist is additive (discovery still runs). The mapper is total (never throws) and sanitizes untrusted plugin input.

Non-breaking: every `scope.*` field is optional and, when absent, the produced argv + env are byte-identical to today.

## Capabilities

### New Capabilities
- `plugin-spawn-scope`: A first-class `scope` block on `PluginSpawnOptions` that maps plugin-declared tool / skill / extension constraints to pi CLI capability flags (and per-extension config to namespaced env) on the spawned session, with an absent-field ⇒ byte-identical-argv guarantee.

### Modified Capabilities
<!-- No existing capability's REQUIREMENTS change; the spawn chain gains new optional inputs only. -->

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts` — `PluginSpawnOptions` gains `scope`; new exported `pluginSpawnToSessionOptions` mapper.
- `packages/shared/src/platform/spawn-mechanism.ts` — `SessionFlags` gains scope fields; `sessionFlagsToArgv` emits the corresponding pi flags.
- `packages/server/src/spawn-process/process-manager.ts` — `SessionOptions` gains scope fields; `buildSpawnEnv` projects `extensionConfig` → `PI_EXT_*` env (headless mechanism).
- `packages/server/src/server.ts` — `spawnSession` hook delegates mapping to `pluginSpawnToSessionOptions` (replacing the inline literal) and calls it **before** enqueuing any `automationRun` stamp (avoids stranding a stale stamp on malformed input).
- Consumers: first-party trusted plugins (automation-plugin, flows) may opt into scoping; no change required for plugins that omit `scope`.

## Discipline Skills

Tasks in this change trigger these `eng-disciplines` skills (rationale in `design.md`):

- **`security-hardening`** — plugin-supplied strings flow into spawn argv (`-e`, `--skill`, `--tools`) and process env (`PI_EXT_*`). Validate env-name normalization, the total-mapper input sanitization (NUL / non-string / malformed-container dropping), and the forgeable-`priority<=100`-gate escalation; confirm no shell interpretation is introduced.
- **`review-code`** — non-trivial change to the shared argv builder + server spawn hook; run the inline review once tests pass, before commit.

No latency/throughput budget, new endpoint, migration, or opaque-runtime-state work applies, so `performance-optimization`, `observability-instrumentation`, and `node-inspect-debugger` do not. `doubt-driven-review` already ran in the planning phase (cross-model, `@propose-review-1` + `@propose-review-2`).
