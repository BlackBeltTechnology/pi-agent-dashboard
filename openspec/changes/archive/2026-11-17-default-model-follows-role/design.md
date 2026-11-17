# Design

## Context

See proposal.md — Why. Current state that shapes the approach:

- The Default model callout renders `ModelSelector` without `allowRoles` (`packages/client/src/components/settings/SettingsPanel.tsx:2086`). The paired `ThinkingLevelSelector` is bound to `defaultThinkingLevel`, derives levels from the selected concrete model and is locked to `off` when no model is set (`SettingsPanel.tsx:2098-2108`).
- `ModelSelector` already supports role refs: `allowRoles` adds Models | Roles tabs fed by `GET /api/roles`, fetched on mount and on every open (`ModelSelector.tsx:477-498,963`); rows are private to the component. A role pick calls `onSelect("@<role>")` (`ModelSelector.tsx:1045-1052`); a `current` of the form `@role[:level]` renders through the shared `RoleRef` with the live-group resolution (`ModelSelector.tsx:530-544`).
- The bridge applies the default in `applyDefaultModel`, re-reading config every call and splitting `defaultModel` on the first `/` (`packages/extension/src/bridge.ts:220-244`); no `/` → `null` (`bridge.ts:224`). A non-empty `defaultThinkingLevel` is applied right after `setModel` (`bridge.ts:236-237`). The gate (`packages/extension/src/bridge-default-model-gate.ts`) limits this to brand-new startup sessions without an explicit `--model`.
- Spawn roads: `resolveSpawnChoice` (`packages/server/src/browser-handlers/spawn-choice.ts:143`) resolves an `@role` model through `resolveRoleChoice` (`spawn-choice.ts:176-207`) with precedence explicit level > suffix > role level. A thinking-only choice is paired with `ctx.defaultModel` through `validateSpawnChoice` (`spawn-choice.ts:169-172`; plugin road `packages/server/src/spawn-process/plugin-spawn-choice.ts:41-44`), which rejects an `@role` value without a warning. The REST road turns any resolver warning into a 400 (`packages/server/src/session/session-api.ts:353-357`).
- Client spawn surfaces take the Settings defaults through `spawn-choice-memory.ts:47-52` (empty values omitted) and send them as explicit choices (`DirectoryHomeView.tsx:166-179`, `SpawnChoiceChip.tsx`).
- The pi mirror derives pi keys by splitting on `/` (`packages/server/src/pi-agent-settings.ts:370-390`), only adds keys and writes only changed ones (`pi-agent-settings.ts:406-410`); the level key is considered only when `keys` includes it (`pi-agent-settings.ts:387`), and `keys` comes from the fields in the save partial (`packages/server/src/routes/system-routes.ts:159-165`). `PiMirrorResult.skipped` is typed `"no-provider-separator"` (`packages/shared/src/rest-api.ts:220`). The pi settings page gets the dashboard defaults from the Settings panel's loaded config (`SettingsPanel.tsx:2444`) and computes drift synchronously (`PiSettingsPage.tsx:66-82,141-149`).
- pi itself persists `defaultProvider`/`defaultModel` when the user changes model interactively, so pi's settings file is a moving target.
- Shared resolver: `parseModelRef` / `resolveModelRef` (`packages/shared/src/role-schema.ts:170,207`) read `cfg.roles` (the live map); `readRoleConfigFromDisk` (`packages/shared/src/role-config-disk.ts:17`).
- `GET /api/roles` returns the live group (`preset: null`) plus one group per named preset; exactly one group is `active` — a named preset, or the live group when the stored active preset does not resolve (`packages/roles-plugin/src/server/roles-routes.ts:146-159`). The roles watcher fires `onChange` only when the effective-role hash changes (`packages/roles-plugin/src/server/index.ts:38-49`, `role-watcher.ts`).
- Host → plugin services: `pluginServiceRegistry.set("host.*")` (`packages/server/src/server.ts:1669-1812`), plugins `ctx.consume`. Kind A consumers report use via `roles.bindings.registerUsage` (`packages/automation-plugin/src/server/index.ts:435-445`).

## Goals / Non-Goals

**Goals:**
- One persisted value (`defaultModel`) that may be a role ref; readers that need a concrete model resolve `@`-prefixed values with the shared resolver.
- A preset switch changes the next brand-new session's model with zero Settings edits, on every spawn road.
- Thinking level uses the precedence the spawn roads already ship; no new invariant to enforce.

**Non-Goals:**
- Changing running or resumed sessions on a preset switch (bridge gate unchanged).
- Auto-converting an existing concrete `defaultModel` into a role ref.
- Changing how concrete values are read: a value not starting with `@` keeps today's verbatim handling everywhere.
- The model-proxy's and the automation plugin's own `defaultModel` fields.
- A level-suffix editor: the Settings UI never writes `@role:level` (a hand-written suffix is still honoured).
- Spawn-chip level filtering for a role default (see Risks).
- Honouring `$PI_CODING_AGENT_DIR` in the role reader (pre-existing gap).

## Decisions

### D1 — Resolve at use, not projection

```mermaid
flowchart LR
  CFG[(config.json defaultModel = "@planning")] --> BR[bridge applyDefaultModel]
  CFG --> SP[spawn roads: role choice + thinking-only pairing]
  CFG --> MI[pi mirror]
  PJ[(providers.json roles)] --> BR
  PJ --> SP
  PJ --> MI
  W[roles-plugin watcher onChange] -->|host.remirrorPiDefaults| MI
  MI --> PS[(~/.pi/agent/settings.json)]
```

`defaultModel` keeps the ref. Bridge, spawn roads, mirror and client go through one new shared helper `resolveDefaultModel(value, cfg)` (next to `resolveModelRef` in `role-schema.ts`; a thin wrapper that calls `resolveModelRef` and adds only the `provider/` check — not a second resolver, per `role-model-bindings` "one shared resolver") only for a value starting with `@`, when they need a concrete model. It returns `{ provider, id, level? }` or `{ unresolved: reason }`; a role that is unknown, unassigned, or assigned a value without `provider/` is unresolved (`resolveModelRef` alone reports the last case as resolved, `role-schema.ts:194-215`). Resolution happens at the moment of use — for the bridge that is startup or the pending retry, whichever applies the model. Because `applyDefaultModel` re-reads config per call and spawn roads resolve per request, the next brand-new session after a preset Load gets the new model with no trigger.

Alternative — a `roles.bindings` projector rewriting a concrete value on preset change: rejected. Into the dashboard config it loses the ref (the UI could no longer show `@planning`); into pi's `settings.json` it would go `detached` the first time pi persists an interactive model change, silently ending the follow. Resolve-at-use also works without the roles plugin (archived `add-role-aware-model-refs` D9).

### D2 — Thinking level: the shipped spawn precedence

For a role-ref default the effective level is `defaultThinkingLevel` when non-empty, else the ref suffix, else the role-assigned level, else none. This is `spawn-model-choice` "explicit field > suffix > role level" with the Settings field as the explicit field — exactly what spawn surfaces already send (`spawn-choice-memory.ts` sends a non-empty `defaultThinkingLevel` as `thinkingLevel`, omits an empty one). The bridge keeps its current rule for a non-empty `defaultThinkingLevel` and falls through to suffix > role level only when it is empty, so bridge and spawn roads agree for every stored combination with a valid level (an invalid hand-edited level is passed to pi by the bridge but dropped with a warning on spawn roads — pre-existing).

Settings UI: a role pick on the Roles tab saves `@role` and `defaultThinkingLevel: ""` ("adopt the role's level"); the level control writes `defaultThinkingLevel` as today (an override). While `defaultThinkingLevel` is empty the control shows the role-derived level with a `role` tag.

Alternative (cycle 1) — clear `defaultThinkingLevel` and store overrides as a ref suffix: rejected after review. It created an invariant only the UI enforced; a stale field (hand edit, REST save) outranked the role level on spawn roads while the bridge ignored it, and it conflicted with the mirror's "clearing leaves pi untouched" rule.

Relation to archived D10 (no level override in the Role tab): unchanged — the Role tab still offers none; the override lives in the callout's existing level control.

### D3 — Settings UI reuses the shipped primitives

- `ModelSelector` gets `allowRoles`; the trigger keeps rendering through `RoleRef`.
- The Settings panel reads the full `/api/roles` envelope through a new small client hook `useRolesSnapshot()` (`packages/client/src/lib/roles/`) returning `{ liveRows, activePreset, refetch }`, called on mount and after each Default model pick. The picker's private `useRoleRows` is untouched; the two reads can differ only between a preset switch and the next read.
- Level control for a role default is never locked by role state. While `defaultThinkingLevel` is empty it shows the role-derived level (suffix, else role level) with a `role` tag, or the placeholder `role` with no level when that is unknown (roles API absent, unresolved, or the role has no level) — it never claims `off` for a level the bridge would not set. Levels come from the resolved model's `supportedThinkingLevels` when it is in the catalogue, else all levels (same as a concrete default today). A pick writes `defaultThinkingLevel`.
- Follow hint (`data-testid="default-model-follows"`): the role ref through the shared `RoleRef` (role + live-group model), plus the active preset name when a named preset is active. Dangling (`data-testid="default-model-dangling"`): warning tone, `RoleRef` with its unassigned pill, preset name. The dangling notice replaces the mirror's `unresolved-role` skip notice (one notice per condition). Roles API absent → no Roles tab, token still renders, no hint.
- The panel passes the resolved default (model + effective level) to `PiSettingsPage` with the raw config, so drift compares resolved values. Unresolved → no drift for the model.

### D4 — Mirror resolves the ref; re-mirror only when the role default's resolution changes

`deriveMirrorWanted` resolves an `@`-prefixed value before splitting; unresolved → non-failing `skipped: "unresolved-role"` (shared `PiMirrorResult` type widened). For a role-ref default the level to mirror is the D2 effective level, and a save carrying either `defaultModel` or `defaultThinkingLevel` derives both keys; an empty result leaves pi's level untouched.

The host registers `host.remirrorPiDefaults`. The mirror module keeps, in memory, the last role-default resolution (`provider/id` + effective level) it mirrored or observed: every mirror write (Settings save, drift repair, re-mirror) updates it, and server start seeds it from the current resolution without writing. When called, the service re-resolves and mirrors only if the resolution differs from that value. The roles plugin calls it on every watcher `onChange` (absent → no-op). Consequences: editing an unrelated role, a no-op preset Load, or a server restart never rewrites pi's file, so a model the user picked interactively in pi survives until the role default's own resolution moves. A role change made while the server is down is not mirrored at the next start (seeded, not written); the pi settings page shows it as drift with the repair action.

Relation to archived D1 (role semantics are a roles-plugin concern): the binding engine stays in the plugin; the host only uses the shared resolver (allowed for Kind A consumers by archived D3/D9) and exposes a narrow re-run signal. Alternative — a second `fs.watch` in the core server: rejected, duplicates the watcher's debounce + hash.

### D5 — "Used by" reporting from the roles plugin

The host registers `host.defaultModelRef` (returns the persisted `defaultModel` when it starts with `@`, else `undefined`). The roles plugin registers usage for owner `dashboard.defaultModel` with its own engine during registration, reading the ref lazily through that getter, so the Roles page lists `Default model (new sessions)` under the role. The registration's lifecycle is the roles plugin's own; no host-side lookup of a plugin service is needed.

### D6 — Failure modes

- Bridge, unresolved role default → no `setModel`, no pending retry, one log line `[default-model] unresolved role @<role>; using pi default`. Resolved model not in the registry yet → existing pending path with the resolved `provider/id`.
- Spawn thinking-only pairing (the request carries only a level), unresolved role default → spawn without `--model`, one log line, no `choiceWarning` / no REST 400 (today's silent-drop behaviour for an unusable default; the request itself carried no model).
- A spawn surface that promotes the role default into the request's `model` (folder home, spawn chip) hits the shipped explicit-role rule: an unresolvable role is ignored and `spawn_result` carries a `choiceWarning`. Kept: the user sees why the session started on pi's default.

## Risks / Trade-offs

- [Unassigned role → "pi's own default model"] → that is whatever pi's settings hold, possibly the model last mirrored from the previous preset or picked interactively in pi. The dangling notice says "pi's own default model" without naming it. Accepted.
- [Role default with no level anywhere] → bridge sets no level, so pi's own default level applies, which may be a value mirrored earlier; the mirror never clears pi keys. Accepted; matches today's empty-`defaultThinkingLevel` behaviour.
- [Roles plugin absent] → no re-mirror and no client resolution (no drift action for a role default); the role map can still change through the extension's role manager. Bridge and spawn roads still resolve at use, so dashboard-started sessions are correct; a Settings save re-mirrors.
- [Spawn chip with a role default] → the chip renders the ref through `RoleRef` (it passes `allowRoles`), but derives `supportedLevels` by a literal `provider/id` compare (`SpawnChoiceChip.tsx:79`), so for `@planning` it offers all levels; pi clamps an unsupported pick. Accepted for this change.
- [A role pick discards an explicit `defaultThinkingLevel`] → intended ("adopt the role's level"); the level control shows the new state immediately.
- [Hint names the active preset while the live map diverges after a hand edit] → the model shown is the live one (what sessions get); the preset name is a label. Accepted.
- [`allowRoles` makes the Sessions page fetch `/api/roles` on mount] → existing SettingsPanel test fetch mocks must answer it; a 2xx with an unexpected body means "tab present, zero roles".

## Migration Plan

No data migration; concrete values are untouched. Rollout order: shared type → bridge resolve → spawn pairing → server mirror + host services → roles plugin wiring → client UI. Rollback: revert. A persisted `@role` then stops working in the bridge, mirror and thinking-only pairing, while explicit spawns from the folder home and spawn chip (which send `@role` as the model) keep resolving through the already-shipped `resolveRoleChoice`. Users should re-pick a concrete default after rollback (CHANGELOG entry, task 8.1).
