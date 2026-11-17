# Proposal

## Why

The Settings → Sessions **Default model** only accepts a concrete `provider/id`. Users who switch role presets (e.g. Anthropic → Proxy → Free) must also re-pick the default model by hand, or new sessions keep starting on a model from the old preset. Every other model setting (composer, spawn chip, grammar, blackhole, automation) already accepts `@role` refs; the default model is the gap.

## What Changes

- The Default model picker opts into the existing Model | Roles tabs (`ModelSelector` `allowRoles`). Picking a role persists `defaultModel: "@<role>"` instead of the role's current model.
- Thinking level follows the precedence spawn roads already ship (explicit > ref suffix > role level), with the Settings `defaultThinkingLevel` as the explicit tier. A role pick saves `defaultThinkingLevel: ""` (adopt the role's level, shown tagged `role`); choosing a level in the paired control overrides it as today.
- The callout shows a follow hint naming the active preset and the model the role resolves to, or a warning when the role has no model in the active preset.
- The bridge resolves an `@role` default at brand-new-session start against the current role map (resolve-at-use). Loading another preset therefore changes the model of the next new session with no Settings edit. Running and resumed sessions are untouched.
- Spawn roads: a thinking-only spawn choice pairs with the RESOLVED role default (unresolved → no `--model`, no error).
- The Roles page "used by" list includes the default model when it is a role ref.
- The pi default mirror (`~/.pi/agent/settings.json` `defaultProvider`/`defaultModel`/`defaultThinkingLevel`) writes the RESOLVED model of an `@role` default on save, and again when a role-map change actually moves the role default's resolution (never on restart or unrelated role edits, so a model picked interactively in pi is not clobbered). Drift repair on the pi settings page compares against the resolved value.
- An `@role` that is unassigned in the active preset is not an error: new sessions fall back to pi's own default, the bridge logs one line, and the mirror leaves pi untouched.
- No migration: existing concrete `defaultModel` values keep working unchanged.
- Mockup: mockups/2026-11-17-default-model-role (in this change)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-panel`: Default model control accepts role refs (Roles tab, role-derived thinking level with suffix override, follow / dangling hint); the save-time pi mirror resolves `@role` defaults and re-mirrors when the effective role map changes.
- `bridge-extension`: new requirement — an `@role` default resolves against the current role map at application time; unresolved role → no `setModel`, logged.
- `bridge-default-model-gate`: with an empty `defaultThinkingLevel`, a role-ref default applies the ref suffix, else the role's level.
- `spawn-model-choice`: the thinking-only pairing resolves a role-ref default.
- `role-model-bindings`: the Model roles page lists a role-ref default model as a usage.
- `pi-agent-settings-editor`: "Explicit drift repair for the default model" derives pi values from the resolved role ref.

## Impact

- Client: `packages/client/src/components/settings/SettingsPanel.tsx` (Default model callout), `packages/client/src/components/settings/PiSettingsPage.tsx` (`deriveMirror` / drift check).
- Extension: `packages/extension/src/bridge.ts` `applyDefaultModel` (resolve via shared `resolveModelRef` + `readRoleConfigFromDisk`).
- Server: `packages/server/src/pi-agent-settings.ts` `deriveMirrorWanted` / `mirrorDefaultsToPi`; `packages/server/src/browser-handlers/spawn-choice.ts` + `spawn-process/plugin-spawn-choice.ts` thinking-only pairing; `host.remirrorPiDefaults` + `host.defaultModelRef` services in `packages/server/src/server.ts`.
- Roles plugin: `packages/roles-plugin/src/server/index.ts` calls the host re-mirror service on each watcher change and registers the default-model usage, when the host services are present.
- Shared: `PiMirrorResult.skipped` gains `"unresolved-role"` (`packages/shared/src/rest-api.ts`). No new grammar; reuses `parseModelRef` / `resolveModelRef` / `readRoleConfigFromDisk` (`packages/shared/src/role-schema.ts`, `role-config-disk.ts`).
- Config format: `defaultModel` may now hold `@role` / `@role:level` (string field, no schema change).

## Discipline Skills

- `doubt-driven-review`: a role-ref value in `defaultModel` becomes persisted, user-visible config semantics (hard to walk back); review before it stands.
- `observability-instrumentation`: the bridge's unresolved-role fallback and the role-change re-mirror are new background paths; each needs one structured log line so "why did my new session get model X" is answerable.
