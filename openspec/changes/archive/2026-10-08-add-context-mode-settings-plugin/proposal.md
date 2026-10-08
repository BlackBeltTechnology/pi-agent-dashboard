## Why

context-mode (`npm:context-mode`) is tuned only through environment
variables; it has no settings file and the dashboard exposes none of them, so
users cannot see or change search throttling, data dir, locale, fetch
strictness, etc. without editing shell profiles. Investigating this surfaced a
live bug: the dashboard server can inherit context-mode's bridge-internal
`CONTEXT_MODE_BRIDGE_DEPTH=1` (when started from a context-mode sandbox) and
passes it to every spawned session, where context-mode's fork-bomb guard then
silently disables all `ctx_*` tools. Separately, the hermes-memory settings form
renders `llmModelOverride` as a free-text field, although a shared model
selector primitive exists.

## What Changes

- **New `packages/context-mode-settings-plugin`** (dashboard plugin, settings-section claim, `requires.piExtensions: ["context-mode"]`):
  - Persists settings to a fixed file `~/.pi/context-mode/settings.json`, keyed by **logical, engine-neutral keys** (e.g. `search.windowMs`), never by env-var names.
  - A single declarative descriptor table maps each logical key → kind, default, group, help, and context-mode env var. The table is the only context-mode-specific part, so the future unified context manager (`unify-context-manager`) can reuse keys, file and form with a different projection.
  - Server GET/PUT routes with validation before any write (hermes-memory-plugin pattern).
  - Settings form: grouped fields, DEFAULT badge, per-field reset, "applies to new sessions" and "exported env wins" notices.
  - **Bridge entry** (pi extension, auto-registered via the existing managed bridge registration): at extension load reads the file and sets the mapped *runtime-scope* env vars on `process.env` when not already set, before context-mode lazily spawns its MCP child — covers terminal-launched sessions. *Storage-scope* settings (data dir, session suffix) are delivered only via spawn env, because context-mode opens its stores at its own extension load.
- **New plugin spawn-env contributor hook**: `ServerPluginContext.registerSpawnEnvContributor(fn)` (trusted-gated, optional). `buildSpawnEnv` merges contributor output into every dashboard spawn (headless, tmux, wt, wsl-tmux). Name denylist (`NODE_*`, `LD_*`, `DYLD_*`, `PATH`, `CONTEXT_MODE_BRIDGE_*`, …); disabled plugins skipped at spawn time. The context-mode plugin registers one that injects all projected settings (read fresh at each spawn).
- **Fix: scrub context-mode bridge-internal env** — `buildSpawnEnv` always deletes (tmux panes: `env -u` prefix, true unset) `CONTEXT_MODE_BRIDGE_DEPTH` and `CONTEXT_MODE_BRIDGE_IDLE_MS` so a contaminated server never disables `ctx_*` tools in its sessions; the bridge's server auto-spawn (`buildBridgeEnvOverrides`) strips them too, preventing the contamination at its source.
- **hermes-memory settings**: `llmModelOverride` becomes a new field kind `model`, rendered with the shared `ui:model-selector` primitive plus a "clear / inherit session model" action. Stored value stays the `provider/id` string — no change to `pi-hermes-memory`.

## Capabilities

### New Capabilities
- `context-mode-settings`: settings file, logical-key descriptor table, read/write routes + validation, settings form, bridge-side env projection, precedence rules.
- `plugin-spawn-env-contributor`: server plugin hook letting trusted plugins contribute env vars to dashboard-spawned pi sessions.

### Modified Capabilities
- `headless-spawn`: the spawn-env shaping requirement's sanctioned-subtraction list SHALL include the context-mode bridge-internal variables.
- `server-launch`: bridge auto-spawn of the server SHALL also strip them (prevents the contamination at its source).
- `hermes-memory-settings`: the model-override field SHALL use the shared model selector.

## Discipline Skills

- `security-hardening` — new PUT route writing a file under `~/.pi`; new plugin hook that alters child-process env (trusted-gating, key allowlist, no `PATH`/`NODE_OPTIONS` override).
- `observability-instrumentation` — new synchronous file read on every spawn path; warning logs on read failure/invalid entries.
- `doubt-driven-review` — new public plugin-context API surface (`registerSpawnEnvContributor`) is hard to retract once third-party plugins use it.

## Impact

- New package `packages/context-mode-settings-plugin` (client + server + shared + bridge); registration per add-new-plugin checklist: `publish.yml`, `BUNDLED_PLUGINS`, client registry + `@source`, vitest/knip, `ROUTE_TIERS` + MCP-manifest classification for the GET/PUT routes, rate-limited fs route scope, zh-CN/hu i18n catalogs.
- `packages/dashboard-plugin-runtime/src/server/server-context.ts` (new optional hook type), `packages/server/src/server.ts` (wiring), `packages/server/src/spawn-process/process-manager.ts` (`buildSpawnEnv` scrub + contributor merge; tmux `-e` propagation).
- `packages/hermes-memory-plugin/src/shared/hermes-config.ts`, `src/client/HermesMemorySettings.tsx`, `src/client/settings-model.ts`.
- No migration: the settings file is new; absent file ⇒ context-mode behaves exactly as today. Rollback = disable/remove the plugin; the scrub is independently safe.
- Interplay with `unify-context-manager`: logical keys + file are designed for adoption by its context-manager plugin, but adoption is contingent on that change (to be proposed there); only the descriptor `env` mapping is throwaway.
