## Context

See proposal.md, section Why. The design relies on these facts, each verified against source. Reviewer corrections from doubt cycle 1 are folded in.

- **No config file.** context-mode reads only environment variables.
- **Two read times in the Pi adapter:**
  - **Factory time:** resolves the workspace and opens its SessionDB (`~/.pi/agent/npm/node_modules/context-mode/build/adapters/pi/extension.js:398-408`, `getOrCreateDB(projectDir)` at `:408`). Storage variables are read here.
  - **Lazy:** starts its MCP child inside `before_agent_start` (`extension.js:531-560`, `ensureMCPBridge`), with `options.env ?? process.env` read at call time (`build/adapters/pi/mcp-bridge.js:789`).
  - **Consequence:** a later extension can still affect child-only (runtime) variables, but not storage variables. Setting storage variables late would split the pi process and the child across two different stores.
- **Recursion guard:** `bootstrapMCPTools` refuses to spawn when `CONTEXT_MODE_BRIDGE_DEPTH > 0` (`mcp-bridge.js:796-800`).
  - The idle reaper treats any defined-but-unparsable `CONTEXT_MODE_BRIDGE_IDLE_MS` / `CONTEXT_MODE_BRIDGE_DEPTH`, including the empty string, as 0, which means disabled (`build/lifecycle.js:103-125`).
  - So emptying these variables is NOT a safe cancel. Only true unsetting is.
  - The foreground child is forced to `CONTEXT_MODE_BRIDGE_IDLE_MS=0` (`mcp-bridge.js:770-774`).
- **Spawn env today:** `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts:265-370`) strips the parent-identity markers but not the context-mode bridge variables. The headless-spawn spec lists which subtractions are allowed (`openspec/specs/headless-spawn/spec.md:142-146`).
- **tmux panes:** they take their env from the long-lived tmux SERVER. Per-window values ride `-e` (`process-manager.ts:515-547`).
- **Plugin trust:** decided by `(manifest.priority ?? 1000) <= 100` (`packages/server/src/server.ts:3084`). This is manifest-controlled, not a security boundary: server plugins are in-process code.
- **Plugin bridge entries:** mirrored into pi `packages[]` by the dashboard (`packages/shared/src/plugin-bridge-register.ts`; `openspec/specs/dashboard-plugin-loader/spec.md:170-181`).
- **Template package:** `packages/hermes-memory-plugin`, specifically `src/server/config-path.ts`, `src/server/index.ts:39`, `src/shared/hermes-config.ts:55`, and `src/client/HermesMemorySettings.tsx:346-412`.
- **Model list:** `GET /api/models` feeds `ui:model-selector`. The row mapping is at `packages/grammar-plugin/src/GrammarSettings.tsx:57-75`; the fetch and selector lookup are at `:98-109`.
- **Storage variables:**
  - `CONTEXT_MODE_DIR` must be absolute (no `~` expansion; `build/session/db.js:66-81`).
  - `CONTEXT_MODE_DATA_DIR` expands `~` (`build/adapters/base.js:50-58`).
  - Both are read in-process by the Pi adapter's session DB as well as by the child.
- **Split-store hazards:** the Pi adapter resolves its project from `PI_WORKSPACE_DIR`/`PI_PROJECT_DIR`/`PWD`/cwd (`extension.js:344-374`) and always uses `PiAdapter` (`:166-188`). The child honours `CONTEXT_MODE_PROJECT_DIR` (`build/util/project-dir.js`) and `CONTEXT_MODE_PLATFORM` (`build/adapters/detect.js`). Setting either one splits the stores even when it is delivered at spawn time.

## Goals / Non-Goals

**Goals:**
- One descriptor table drives storage keys, validation, the form, and env projection.
- Runtime settings reach context-mode in every session. Storage settings reach every dashboard-spawned session without splitting stores.
- Leaked bridge-internal variables can no longer disable `ctx_*` in dashboard-spawned sessions.
- Keys and the settings file are designed so `unify-context-manager` can adopt them. That adoption is contingent on that change; this change does not guarantee it.

**Non-Goals:**
- Live-applying settings to running sessions.
- Hand-editing pi `settings.json`. The plugin's bridge entry IS mirrored into `packages[]` by the existing managed bridge-registration mechanism. That is acknowledged and intended.
- Exposing context-mode constants that are not env-tunable.
- A force-override that beats an already-exported variable.
- Generalising hermes' form renderer into a shared library.

## Decisions

### D1: Logical keys + projection table
`src/shared/settings-descriptors.ts` exports `CONTEXT_SETTINGS`. Each entry is shaped `{ key, kind, default, group, scope: "storage" | "runtime", label, help, env }`.

`projectEnv(settings, { scopes })` returns a `Record<string,string>`:
- It validates each entry with the same validator the PUT route uses. Invalid entries are dropped and logged, because the file can be edited outside the dashboard.
- Booleans become `"1"`; `false` or unset emits nothing.
- `CONTEXT_MODE_DIR` has `~` expanded to an absolute path.

The file stores only `key → value`. A future context-manager plugin can reuse keys, file, and form, and replace `env` / `projectEnv`.

Alternative considered: storing env-var names in the file. Rejected because it couples user data to context-mode's private names.

### D2: Fixed file `~/.pi/context-mode/settings.json`
- **Fixed path:** never taken from input or from settings. A `storage.dir` value cannot relocate the file.
- **Atomic writes:** temp file + rename, the same as hermes `config-io.ts`.
- **Concurrency:** last writer wins; there is no merge. This is acceptable because the form PUTs the whole object.

### D3: Precedence — an already-present variable wins
Neither delivery path overwrites a variable that is already present. As a consequence, the dashboard cannot disable a variable the operator exported; the form says so.

For tmux, "present" means present in the dashboard server's env. A value that exists only in the tmux server's global env is overridden by the per-window `-e`. This trade-off is accepted and documented in the help text.

### D4: Two delivery paths, split by scope
| Path | Scopes | When |
|---|---|---|
| Spawn-env contributor (server) | storage + runtime; nothing for wsl-tmux (the guest has its own home and settings file, so the guest-side bridge handles runtime scope) | every dashboard spawn; the file is read at spawn time (small, no cache, so external edits are picked up); a slow or failed read logs a warning and contributes nothing |
| Bridge extension (`src/bridge/index.ts`) | runtime only | every pi session that loads it, at factory time; synchronous read, never throws |

Storage scope is spawn-only because the context-mode factory may run before the bridge (Context). Terminal sessions that want custom storage must export the variable in the shell; the form shows this.

**Provenance marker.** Values the bridge writes into a pi process leak into a dashboard server that pi process auto-starts. Later spawns would then mistake those values for operator exports and refuse to update them. To prevent this:
- The bridge records the names it projected in `PI_CONTEXT_MODE_SETTINGS_PROJECTED` (comma-separated).
- `buildSpawnEnv` deletes those names and the marker before applying contributors, so the current file decides them. Only names in the descriptor table's runtime-scope env allowlist are honoured; any other listed name, including `PATH`, is ignored, so a forged or corrupted marker cannot erase unrelated variables.
- Genuine operator exports are never listed in the marker, so they keep winning.

### D5: `registerSpawnEnvContributor` host hook
- **Signature:** an optional `ServerPluginContext.registerSpawnEnvContributor?: (fn: (ctx: { mechanism: "headless" | "tmux" | "wt" | "wsl-tmux" }) => Record<string,string>, opts?: { supersede?: { marker: string; names: readonly string[] } }) => unregister`.
  - The mechanism lets a contributor opt out per strategy.
  - `supersede` tells the host which marker variable to read and which names it may delete when they are listed there. The context-mode plugin passes `PI_CONTEXT_MODE_SETTINGS_PROJECTED` and its runtime-scope env names.
  - The marker name itself must pass the contributor name rules and denylist.
- **Trust:** the same test as `spawnSession`. It is documented as policy, not a sandbox: a trusted plugin is already in-process code.
- **Registry:** contributors live in `process-manager.ts`, keyed by plugin id.
- **Disabled plugins:** at each spawn the host filters out contributors of plugins that are disabled in config. This avoids relying on loader teardown, which has no hook today (`packages/dashboard-plugin-runtime/src/server/loader.ts:427-449`).
- **Validation:** name regex, no NUL in values, and a hard denylist (see the plugin-spawn-env-contributor spec). The denylist includes `NODE_*`, `LD_*`, `DYLD_*`, and `CONTEXT_MODE_BRIDGE_*`, so contributors can never reintroduce what D6 removes.
- **Pipeline order in `buildSpawnEnv`:** host shaping including the D6 scrub → provenance-marker removal (D4) → contributor validation → apply to absent names. tmux emits `-e NAME=value` per applied entry.
- **Sync:** `buildSpawnEnv` is synchronous on every path, so contributors must be cheap. The context-mode contributor's synchronous read of a sub-1-KB file is the only file I/O added, and it logs a warning on failure (observability-instrumentation).

### D6: Scrub bridge-internal variables — true unset, never empty
- **`buildSpawnEnv`** deletes `CONTEXT_MODE_BRIDGE_DEPTH` and `CONTEXT_MODE_BRIDGE_IDLE_MS` (headless, wt, and the client env for tmux). This is a MODIFIED headless-spawn requirement that extends the allowed-subtraction list.
- **tmux / wsl-tmux pane command:** prefixed with `env -u CONTEXT_MODE_BRIDGE_DEPTH -u CONTEXT_MODE_BRIDGE_IDLE_MS`. This truly unsets inherited tmux-server values. Empty `-e` values are not used, because they would disable the idle reaper (Context).
- **Source-side twin:** `buildBridgeEnvOverrides` (`packages/extension/src/server-launcher.ts:99-122`) maps both keys to `undefined` (MODIFIED server-launch requirement), so a bridge-auto-spawned server never inherits them. A server started by CLI from a sandbox shell bypasses that path, which is why the spawn-side scrub is still needed.
- **Settings:** `CONTEXT_MODE_BRIDGE_IDLE_MS` is not a user setting. The adapter forces it for foreground sessions, so exposing it would mislead.

### D7: hermes `model` field kind
- **Descriptor:** add `{ kind: "model" }` and map `llmModelOverride` to it.
- **Server validation:** identical to `string`.
- **Client:** renders `ui:model-selector` fed from `/api/models`, plus an "Inherit session model" reset.
- **Unknown values:** a stored value missing from the list is passed as `current`, so it stays visible and round-trips.
- **Save behaviour:** reset or save follows the plugin's existing write path unchanged.

## Risks / Trade-offs

- [tmux global env] A value present only in a long-lived tmux server's global env is overridden by a per-window contribution. A stale value there also survives a reset, because a reset emits no `-e`. → Accepted and documented in the form's precedence notice. Restarting the tmux server clears it. Fully provenance-aware tmux handling is out of scope.
- [`requires.piExtensions` is status-only] The loader keeps a plugin loaded when its requirement is missing (`openspec/specs/dashboard-plugin-loader/spec.md:1233-1234`). → Projection happens only when the settings file exists, and the variables are inert without context-mode. No hard gate is needed.
- [Host Save Bar ignores plugin validity] The unified Save Bar disable condition covers only core flags (`packages/client/src/components/settings/SettingsPanel.tsx:2559-2564`). → Invalid fields show inline errors, and a save attempt is rejected by the server without writing.

- [Manifest-priority trust is self-asserted] → Same policy as the existing `spawnSession`, plus a name denylist that limits blast radius. A real first-party allowlist is out of scope and would apply to all trusted hooks.
- [A future context-mode version changes when env is read] → A bridge test pins "runtime keys land in `process.env` before `before_agent_start`". Storage settings are already confined to spawn env.
- [The tmux `env -u` prefix needs a POSIX `env`] → tmux and wsl-tmux exist only on POSIX hosts and the WSL guest, where `env -u` is available (coreutils and BSD).
- [A user sets an unwritable `storage.dir`] → Path-shape validation plus help text. Writability is not checked.
- [`unify-context-manager` retires context-mode] → Only `env` / `projectEnv` are throwaway. Adoption of keys and file is to be proposed into that change; it is not guaranteed here.
- [Bridge entry stays registered after disable until the next restart reconciles] → The bridge only reads the file. Rollback also deletes the file.

## Migration Plan

- No data migration. An absent file means today's behaviour.
- Deploy: `/api/restart` for server/shared changes; build + restart for client changes; `npm run reload` for the extension and bridge.
- Rollback: disable the plugin and delete `~/.pi/context-mode/settings.json`. The scrubs (D6) are independently safe to keep.
