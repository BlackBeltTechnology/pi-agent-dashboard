# Design

## Context

See proposal.md (Why). Current code paths:

- **Reconcile:** `packages/flows-plugin/src/client/SessionFlowMenuClaim.tsx:71-81`. `reconciledRef` starts `null`, so the first availability always dispatches `flow_management { action: "set-edit-mode", enabled: config.editFlow ?? false }`, including when the value is `false`. It runs once per mounted client (each tab).
- **pi-flows handling** (external repo `pi-flows/extensions/flow-engine/`). Released v0.8.0 (`6ad941d`): `applyEditMode` → `setEditFlowFlag` (project file only, `edit-flow-config.ts`) + `syncEditFlowSkill` (project-local `.pi/skills/manage-flows/SKILL.md`), and `session_start` also re-syncs that skill file. **Released v0.8.1** (`2435833`, npm latest): `edit-flow-skill.ts` is deleted, `applyEditMode` only calls `setEditFlowFlag` + `reconcileEditFlowTools`, `session_start` "never writes under projectRoot", and `setEditFlowFlag` is a no-op when the value is unchanged. This change targets pi-flows >= 0.8.1. The dashboard has no extension version-floor mechanism, so the floor is documented (CHANGELOG, the `recommended-extensions.ts` pi-flows comment), not enforced. The dashboard side is correct with either version.
- **pi-flows resolution:** `isEditFlowEnabled` (`edit-flow-config.ts:46-58`) is project ?? global ?? `false`. Each file accepts `flows.editFlow` or the legacy top-level `flowsEditFlow` (`readEditFlowFlag`, `:20-30`). An unparseable file counts as unset. The global path is `join(homedir(), ".pi", "agent", "settings.json")` and does **not** honour `PI_CODING_AGENT_DIR`. Tools are re-reconciled at every `before_agent_start` (`index.ts:417-423`).
- **Global toggle today:** `packages/flows-plugin/src/client/FlowsSettings.tsx` writes dashboard plugin config via `plugin_config_write`. Schema: `packages/flows-plugin/src/configSchema.json` (`additionalProperties: false`).
- **New/Edit gate today:** `SessionFlowMenuClaim.tsx:55,112`, gated on `config.editFlow` (dashboard global config).
- **Plugin action precedent:** `packages/flows-plugin/src/server/index.ts:126-164`, where `flow.run` / `flow.new` arrive as `plugin_action` and go to the session via `emitEventToSession`. Session cwd lookup precedent: `server/index.ts:29-36` (`sessionManager.listActive()`).
- **Settings lock:** `packages/server/src/pi-agent-settings.ts`: `withPiSettingsLock` (`:321`), private `acquireLock` (`:266`, pi's `proper-lockfile` on `<settings.json>.lock`), `replaceAtomically` (`:297`), `piSettingsPath` (`:97`, resolves via `resolvePiAgentDir`, which honours `PI_CODING_AGENT_DIR`; test seams `FsDeps.home`/`agentDirEnv` at `:87-94`). Plugins cannot import server internals (`decouple-plugins-from-core`).
- **Editor status convention:** `openspec/specs/pi-agent-settings-editor`: unparseable → 400 + `parseError`, lock busy → 503.

## Goals / Non-Goals

**Goals:**
- No dashboard-originated path writes a repo's working tree unless the user acts on that repo.
- The user-level default lives in the exact file pi-flows reads.
- The menu shows the session's effective edit mode (project override included). It is correct for idle sessions, sibling sessions and after a server restart.

**Non-Goals:**
- Changing pi-flows. With pi-flows <= 0.8.0, its own `session_start` skill sync still writes into repos until users upgrade to 0.8.1. Its `homedir`-only global path is accepted as-is.
- Enforcing an extension version floor (no such mechanism exists; documented only).
- Cleaning up `flows.editFlow` values already written into repos.
- A general "plugins may write pi global settings" host API.

## Decisions

### D1: Delete the reconcile; do not just skip the `false` emit

Remove the effect entirely. *Alternative:* emit only when `true`. Rejected: it still writes into every repo once the default is on, and the global file already delivers the value.

### D2: The global toggle writes pi-flows' global file through a flows-plugin route

`GET /api/plugins/flows/edit-mode-default` returns `{ enabled, parseError? }`. `PUT` with body `{ enabled: boolean }` does a locked read-merge-write of `flows.editFlow` only. The path is `<os.homedir()>/.pi/agent/settings.json`, with `PI_CODING_AGENT_DIR` deliberately ignored to match pi-flows. Status codes follow the pi settings editor: 400 for a bad body or an unparseable file (+ `parseError`, file untouched), 503 for a busy lock. Both routes are mounted in an encapsulated scope with `ctx.networkGuard` + `@fastify/rate-limit`, the same pattern as `flow-files.ts`. The client draft commit (`useSettingsDraftSource`) calls PUT and surfaces errors in the section. No session reload is needed: pi-flows reconciles tools at the next `before_agent_start`.

*Alternatives:* (A) keep plugin config and mirror it on change. Rejected as two sources of truth. (B) add the key to `PI_SETTINGS_SCHEMA`. Rejected: that schema mirrors upstream pi keys and has a parity test. (C) a host server-context seam. Rejected: new host-API surface for one caller. (D) honour `PI_CODING_AGENT_DIR`. Rejected: pi-flows would never read the write. The handoff asks pi-flows to honour the variable; once it does, this path switches to `resolvePiAgentDir`.

### D3: Move the lock primitive into `pi-dashboard-shared`, guarded by a boundary test

New node-only module `packages/shared/src/pi-agent-settings-lock.ts` with `withPiSettingsLock`, `PiSettingsState`, `LockedStep`/`LockedResult`, `formatJson`, `FsDeps`, and the private helpers they need (`acquireLock`, `readCurrent`, `replaceAtomically`, `buildState`, etag). `FsDeps` gains an explicit `settingsPath` override. Today the target and lock path always come from `piSettingsPath` → `resolvePiAgentDir`, which reads `PI_CODING_AGENT_DIR` (`pi-agent-settings.ts:97-99`). The flows routes pass `settingsPath: <homedir>/.pi/agent/settings.json`, so the lock file and the write both land on the file pi-flows reads. `packages/server/src/pi-agent-settings.ts` re-exports and imports them, with exported names and behaviour unchanged. `proper-lockfile` and `@types/proper-lockfile` move into `pi-dashboard-shared`. The boundary is a vitest case that fails when any `packages/client/src/**` or `packages/*-plugin/src/client/**` file imports `pi-agent-settings-lock`, plus the module not appearing in any barrel. *Alternative:* the plugin calls `proper-lockfile` itself. Rejected: copying the lock contract (`realpath:false`, `stale:10_000`, tmp+rename, mode preservation) invites silent divergence from pi's lock.

### D4: Effective edit mode is resolved by the plugin server from the settings files

New `packages/flows-plugin/src/server/edit-mode.ts`: `resolveEditMode(cwd, { home })` mirrors `isEditFlowEnabled` (project ?? global ?? false; `flows.editFlow` or `flowsEditFlow`; unparseable = unset). `GET /api/plugins/flows/edit-mode-state?sessionId` maps the session id to its cwd via `sessionManager.listActive()` (404 before any file read when not active) and returns `{ enabled }`. The cwd is the string pi reported for the session, the same `process.cwd()` pi-flows uses as `projectRoot`, so no extra normalization is needed. After a global PUT, the server reads once per distinct active cwd. It is read-only and behind the same guard.

**Push frame:** `{ type: "flows_edit_mode_state", sessionId, enabled, error? }`, sent via `broadcastToSubscribers`, **one frame per active session** in each affected cwd. Because `sessionId` is set, it takes the host's plain session-frame road, not the domain-event policy fan-out (`packages/server/src/server.ts`, the `m.sessionId == null` branch in the plugin broadcast wiring). It is sent after (a) a global PUT, for every active session, (b) the per-project action (D5), and (c) the migration (D6). The client hook (`usePluginMessage("flows_edit_mode_state")`, filtered by `sessionId`) fetches on mount **and again whenever the session actions menu opens**. This picks up out-of-band changes the server never sees (`/flows:edit-mode` typed in pi, hand edits), so sibling sessions, late tabs and external edits converge.

Why files, not tools: New/Edit sends a prompt, which starts a turn, and pi-flows reconciles `flow_write`/`flow_agents` from the same files at that turn's `before_agent_start`. The resolved flag is therefore exactly what the launched skill will see. It needs no bridge sampling, has no handler-order race, survives a server restart, and is correct for idle sessions. *Alternative:* a bridge reporter of `getActiveTools()` (cycle-1 design). Rejected after review: stale on idle sessions, raced pi-flows' handlers, lost on restart, and diverged across sibling sessions. *Trade-off:* the resolver duplicates about 15 lines of pi-flows logic. Unit tests pin it to pi-flows' documented rules (`edit-flow-config.ts` header).

### D5: Per-project action is a plugin action

The menu item sends `plugin_action { pluginId: "flows", action: "flow.set-edit-mode", sessionId, payload: { enabled } }`, the same `payload` shape the existing handler reads (`server/index.ts:124`). `enabled` is the **desired** value, the one the label the user clicked showed. The handler (alongside `flow.run`, `server/index.ts:126`) validates a boolean, then re-resolves `resolveEditMode(cwd)`. If that already equals `enabled` (stale label, or two tabs racing), it emits nothing and just broadcasts the current state. Otherwise it calls `emitEventToSession(sessionId, "flow:set-edit-mode", { enabled })`. If that returns `false` (session disconnected, or refused by the seam), it broadcasts the current state with `error: "not-delivered"`, which the client shows as a notification. Otherwise it polls `resolveEditMode(cwd)` (≤ 10 × 200 ms) until it matches and broadcasts to every session in that cwd. On timeout it broadcasts the actual value with `error: "timeout"`. The client no longer dispatches `flow_management set-edit-mode`.

**Manifest:** `flow:set-edit-mode` is added to `packages/flows-plugin/package.json` `emits` (today `["flow:run", "dashboard-flows:report-files"]`). The host emit seam refuses any type the manifest does not list (`packages/server/src/plugin-event-seam.ts:119-137`).

**Tier:** `plugin_action` is `operate` in `packages/shared/src/ws-message-tiers.ts:117`, while today's `flow_management` is `control`. Writing a repo's settings file at `operate` is the intended tightening. The new REST routes get `packages/shared/src/route-tiers.ts` rows: both GETs `observe`, the PUT `operate`. The extension path (`flow-event-bridge` spec) stays as it is, unused by the plugin.

### D6: One-time legacy migration, then ignore

On `registerPlugin`, read the scoped plugin config (`editFlow`). If it is `true`, run one `withPiSettingsLock` step that checks for an existing global value (`flows.editFlow` or `flowsEditFlow`) and writes `flows.editFlow: true` only when there is none. Doing the check inside the lock makes two concurrently starting servers safe. On success (or when the value is not `true`), call the scoped single-argument `ctx.updatePluginConfig({ editFlow: undefined })` (`server-context.ts:1529`). The host merges by spread and serializes to JSON, so the `undefined` key is dropped from `config.json`. A test pins that the key is absent after migration. On failure, keep the key so the next start retries. `configSchema.json` keeps `editFlow` with a `description` starting "DEPRECATED, ignored" (not the 2019-09 `deprecated` keyword, since the schema is draft-07), so stored configs still validate (`additionalProperties: false`). The migration writes the **global** file, which also affects terminal pi sessions in every repo, not just dashboard-opened ones. The CHANGELOG states this.

## Risks / Trade-offs

- [Users on pi-flows <= v0.8.0 still get `.pi/skills/manage-flows/SKILL.md` written by pi-flows itself, on `session_start` and on the per-project action] → the in-progress pi-flows release removes it. The CHANGELOG says to upgrade pi-flows. The hint names only `.pi/settings.json`, which is accurate for the targeted pi-flows.
- [Lock module in a package whose `exports` is a `./*` wildcard] → a source-import boundary test. It uses `createRequire("proper-lockfile")`, which also fails loudly if a client bundle ever pulls it in.
- [`PI_CODING_AGENT_DIR` users: the dashboard writes `~/.pi/agent/settings.json`, not their agent dir] → matches what pi-flows reads today. A scenario pins it. Switch to `resolvePiAgentDir` when pi-flows honours the variable.
- ["Turn off for this project" writes a permanent project `false` that overrides the global default] → the hint says so. Removing the key is a hand edit, also in the CHANGELOG. "Follow global" needs pi-flows support.
- [Resolver drifts from pi-flows] → unit tests encode pi-flows' rules. The pi-flows handoff asks for a changelog note on any resolution change.
- [Lock module move regresses server settings writes] → existing `pi-agent-settings` tests must pass unchanged before any flows code lands.
- [Route writes a file in `$HOME`] → guard + rate limit, boolean-only body, one fixed key, no caller path. The session read resolves cwd only from the session registry.

## Migration Plan

Ship in one release. On first start, D6 migrates a legacy `true` to the global file. Nothing in any repo is migrated. Rollback = revert. The global `flows.editFlow` stays, and pi-flows keeps honouring it.

## Open Questions

- Should the per-project item ask for confirmation before writing the repo files? Current lean: no, because the label and hint are explicit.
