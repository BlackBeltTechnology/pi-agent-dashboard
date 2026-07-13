## Why

The folder-level OpenSpec section needs a "New Spec" button that spawns a new pi agent with `/opsx:explore` as the initial prompt. This enables creating new change proposals directly from the dashboard UI without needing an existing session. The spawned agent enters explore mode, thinks through the problem, and when a proposal is created, auto-attaches it to that session.

Depends on: `openspec-folder-card-ui` (provides the folder-level UI where the button lives).

## Drift reconciliation — 2026-07-13

The spawn-with-prompt transport this proposal described was already shipped by archived change `project-init-skill-and-profiles`, but via a **pending-initial-prompt registry** (`packages/server/src/pending-initial-prompt-registry.ts`), NOT the positional-CLI-arg approach described here.

Already shipped:
- `packages/shared/src/browser-protocol.ts` — `initialPrompt?: string` on `SpawnSessionBrowserMessage`.
- `packages/server/src/pending-initial-prompt-registry.ts` — registry enqueues prompt by cwd; dispatches after session registers.
- `packages/server/src/browser-handlers/session-action-handler.ts` — `handleSpawnSession` wires `initialPrompt` to the registry.
- `packages/shared/src/openspec-activity-detector.ts` — `CLI_NEW_CHANGE_RE` added by `fix-openspec-activity-detection` archive.

Sole remaining deliverable: the "New Spec" button in `FolderOpenSpecSection` that calls `spawn_session { cwd, initialPrompt: "/opsx:explore" }`.

## What Changes

- "New Spec" button on folder card's OpenSpec section spawns a new pi session with `/opsx:explore` as the initial prompt.
- Spawn mechanism extended to support an initial prompt via pending-initial-prompt registry (shipped by `project-init-skill-and-profiles`).
- ~~Fix: add regex for `openspec new change "name"` pattern in activity detector~~ *(Already implemented — `CLI_NEW_CHANGE_RE` exists in `openspec-activity-detector.ts` lines 38-39, added by `fix-openspec-activity-detection` archive.)*
- Auto-attach: when a proposal is created during the explore session, the activity detector catches the change name, and the existing server-side auto-attach logic attaches it to the creating session.

## Capabilities

### New Capabilities
- `new-spec-spawn`: "New Spec" button on folder card spawns a pi agent with `/opsx:explore`, auto-attaching the first created proposal.

### Modified Capabilities
- `process-manager`: Not modified — prompt routed via pending-initial-prompt registry (shipped by `project-init-skill-and-profiles`).
- `proposal-attachment`: *(Already done)* — activity detector `CLI_NEW_CHANGE_RE` regex was added by `fix-openspec-activity-detection` archive.

## Impact

- **Server** (`packages/server/src/`): No changes needed — `initialPrompt` routing via pending-initial-prompt registry already shipped by `project-init-skill-and-profiles`. `session-action-handler.ts` already wires `initialPrompt` to the registry.
- **Extension** (`packages/extension/src/`): *(Already done)* `openspec-activity-detector.ts` already has `CLI_NEW_CHANGE_RE` regex (in `packages/shared/src/openspec-activity-detector.ts`).
- **Client** (`packages/client/src/`): "New Spec" button in folder OpenSpec section triggers spawn with prompt.
- **Protocol** (`packages/shared/src/`): Already done by `project-init-skill-and-profiles` — `SpawnSessionBrowserMessage` already carries `initialPrompt?: string`.
