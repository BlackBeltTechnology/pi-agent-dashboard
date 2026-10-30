## Why

The flows plugin writes into the git working tree of every repo a user opens in the dashboard. Once flows is available for a session, the session-actions claim emits `flow:set-edit-mode { enabled: <global default> }`, and pi-flows persists it as `flows.editFlow` in `<repo>/.pi/settings.json` (and syncs `<repo>/.pi/skills/manage-flows/SKILL.md`). The default "off" also writes, because the reconcile emits on first availability whatever the value is. Flipping the global toggle dirties every repo touched afterwards. This repo shows it now: `git diff .pi/settings.json` shows `flows.editFlow: false → true` that nobody made on purpose.

The original reason no longer holds. `rework-flows-plugin-for-new-pi-flows` D4 rejected a global-only setting because "pi-flows can only honor the project setting". pi-flows now resolves `flows.editFlow` from the global `~/.pi/agent/settings.json` and lets the project file override it (`pi-flows/extensions/flow-engine/edit-flow-config.ts`, `isEditFlowEnabled`). A user-level default therefore needs no per-repo write. It also matches the rule other dashboard global settings already follow (`pi-retry-settings`: "Project settings are never written").

## What Changes

- **BREAKING (behaviour):** the dashboard SHALL NOT send `flow:set-edit-mode` on its own. The automatic reconcile from the session-actions claim is removed, so no dashboard-originated path writes `<repo>/.pi/settings.json` or the project-local skill. (pi-flows <= 0.8.0 itself still syncs `.pi/skills/manage-flows/SKILL.md` at every `session_start`; pi-flows 0.8.1 removes that, see Out of scope.)
- The **global Edit mode toggle** (Settings › Plugins › Flows) reads and writes `flows.editFlow` in the global file pi-flows reads, `<home>/.pi/agent/settings.json` (merge-preserving, under pi's settings lock), instead of dashboard plugin config. pi-flows picks it up at the next agent turn. A project value still overrides it.
- **New explicit per-project action:** the session actions menu offers "Turn on / Turn off edit mode for this project". Only this click sends `flow:set-edit-mode`, which pi-flows writes to that repo's `.pi/settings.json`. The hint names the file.
- **New/Edit… gating** moves from the dashboard's global config to the session's **effective** edit mode. The plugin server resolves it read-only from the project and global settings files, using the same rules as pi-flows, and pushes changes to every tab and to sibling sessions in the same cwd.
- The shared pi-settings lock primitive moves from `packages/server/src/pi-agent-settings.ts` into `pi-dashboard-shared` (boundary-tested to stay out of client code), so the flows plugin server reuses pi's lock instead of copying it. Server behaviour is unchanged.
- **One-time migration:** a legacy dashboard plugin-config `editFlow: true` is written once to the global file (when the global file has no value), and the legacy key is then removed. The key stays in the schema so stored configs still validate.
- **Existing repos:** `flows.editFlow` values already written by the old reconcile are left as they are. A CHANGELOG note explains that a leftover project value overrides the global one, and how to remove it.
- **Requires pi-flows >= 0.8.1 for a clean tree** (released: `2435833`, npm latest). It removes pi-flows' own skill-file sync and makes `setEditFlowFlag` a no-op when the value is unchanged. The floor is documented (CHANGELOG, the pi-flows comment in `recommended-extensions.ts`), not enforced: the dashboard has no extension version-floor mechanism, and its side is correct with older pi-flows too.
- **Out of scope (pi-flows):** pi-flows ignores `PI_CODING_AGENT_DIR` for the global settings file, so the dashboard writes `<home>/.pi/agent/settings.json` to match. pi-flows' `edit-mode` spec Purpose is still TBD.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flows-edit-mode-settings`: global default stored in pi's global settings instead of plugin config; the reconcile-to-session requirement and the per-session override toggle are removed; adds an explicit per-project action and a requirement that project settings are never written implicitly; New/Edit gating uses the session's effective edit mode; guarded routes; one-time legacy migration.
- `flows-plugin`: the "Flow actions and the FLOWS subcard are gated separately" requirement loses its edit-mode-reconcile paragraph and scenario; the New/Edit scenario uses effective edit mode.
- `session-card-subcards`: the FLOWS-subcard scenarios refer to the session's effective `flows.editFlow` instead of the dashboard plugin-config value.

## Impact

- `packages/flows-plugin/src/client/SessionFlowMenuClaim.tsx`: remove the reconcile effect; add the per-project item; gate New/Edit on effective state.
- `packages/flows-plugin/src/client/FlowsSettings.tsx`: bind the toggle to the new route; fix the hint (skill is `manage-flows`).
- `packages/flows-plugin/src/server/`: new `edit-mode.ts` (resolver + routes `GET`/`PUT /api/plugins/flows/edit-mode-default`, `GET /api/plugins/flows/edit-mode-state?sessionId`); `flow.set-edit-mode` plugin action in `index.ts`; legacy migration on register.
- `packages/flows-plugin/src/configSchema.json`: `editFlow` described as deprecated/ignored.
- `packages/flows-plugin/package.json`: `emits` gains `flow:set-edit-mode` (the host seam refuses unlisted types).
- `packages/shared/src/route-tiers.ts`: rows for the three new routes. The per-project action rides `plugin_action` (`operate` tier; today's `flow_management` is `control`).
- `packages/shared/src/recommended-extensions.ts`: pi-flows comment notes the >= 0.8.1 floor.
- `packages/shared/src/`: new node-only `pi-agent-settings-lock.ts` (+ `proper-lockfile` dependency); `packages/server/src/pi-agent-settings.ts` imports it; a boundary test keeps it out of client code.
- Docs: `packages/flows-plugin/**/AGENTS.md` rows, CHANGELOG `[Unreleased]`.

## Discipline Skills

- `doubt-driven-review`: removing an automatic behaviour is a user-visible contract change, and moving the settings lock touches a module that every pi settings write goes through.
- `security-hardening`: the new routes write a file in the user's home directory and read files under a session's cwd. They must sit behind `networkGuard` + a rate limit, accept only a boolean, write only `flows.editFlow`, and resolve the cwd only from the session registry.
