## 1. Protocol extension

- [x] 1.1 Add optional `attachProposal?: string` to `SpawnSessionBrowserMessage` in `packages/shared/src/browser-protocol.ts`
- [x] 1.2 Add a unit test in `packages/shared/src/__tests__/` asserting the field is optional and old payloads still type-check / parse

## 2. Server: pending-attach intent store

- [x] 2.1 Create `packages/server/src/pending-attach-registry.ts` exporting a small registry: `enqueue(cwd, changeName)`, `consume(cwd) → string | null`, `size(cwd)`. Internally normalize cwd via `safeRealpathSync` + trailing-sep strip
- [x] 2.2 Implement FIFO queue per cwd with cap = 8 (silent drop + `console.warn` on overflow)
- [x] 2.3 Implement 60s staleness expiry: drop entries with `enqueuedAt < now - 60_000` on every `enqueue` and `consume` for the same cwd; log discarded names
- [x] 2.4 Unit tests in `packages/server/src/__tests__/pending-attach-registry.test.ts` covering: enqueue+consume FIFO, normalization equivalence (trailing slash, realpath), cap-at-8 drop, 60s expiry on read and on write, empty-queue consume returns null

## 3. Server: wire intent into spawn handler

- [x] 3.1 Extend `BrowserHandlerContext` (`packages/server/src/browser-handlers/handler-context.ts`) to include the pending-attach registry
- [x] 3.2 In `handleSpawnSession` (`packages/server/src/browser-handlers/session-action-handler.ts`), if `msg.attachProposal` is a non-empty string, call `pendingAttachRegistry.enqueue(msg.cwd, msg.attachProposal)` BEFORE `await spawnPiSession(...)` so a fast register cannot lose the intent
- [x] 3.3 Test: `session-action-handler.spawn-with-attach.test.ts` asserts the registry is enqueued exactly once with the right cwd+changeName when the field is set, and not at all when omitted

## 4. Server: consume intent on session_register

- [x] 4.1 In `pi-gateway.ts` after `sessionManager.register(...)` for a `session_register` message, fire new `onSessionRegistered(sessionId, cwd)` hook; `event-wiring.ts` consumes the queue and applies via `applyAttachProposal`
- [x] 4.2 Extract a shared helper `applyAttachProposal(sessionId, changeName, ctx)` in `session-meta-handler.ts` so the gateway path and the existing `handleAttachProposal` path call the SAME code (DRY)
- [x] 4.3 Test: `pi-gateway-consume-pending-attach.test.ts` covers: consume on register applies attachedProposal + rename + broadcast; no intent → no-op (regression); cwd normalization between enqueue and consume; idempotent re-apply

## 5. Client: clickable task counter on folder change row

- [x] 5.1 In `packages/client/src/components/FolderOpenSpecSection.tsx`, add `useState<string | null>` for `tasksOpenForChange`. Render the existing `{c.completedTasks}/{c.totalTasks} tasks` indicator as a `<button>` when `c.totalTasks > 0`, with `data-testid="folder-tasks-counter-${c.name}"`, click handler stops propagation and sets state
- [x] 5.2 Mount `<DialogPortal><TasksPopover cwd={cwd} change={tasksOpenForChange!} onClose={() => setTasksOpenForChange(null)} /></DialogPortal>` when state is set. Only one popover at a time; clicking another row's counter swaps the state
- [x] 5.3 Update existing test `packages/client/src/components/__tests__/FolderOpenSpecSection.test.tsx` and add new cases: counter renders as button when tasks > 0; not interactive when totalTasks === 0; click opens popover with right cwd+change; click stop-propagation does not toggle the section collapse; opening another counter swaps the popover

## 6. Client: spawn-with-attach button on folder change row

- [x] 6.1 Extend `FolderOpenSpecSection` props with `onSpawnAttached?: (cwd: string, changeName: string) => void`. Render an icon button (`mdiPlay`) immediately after `ArtifactLettersButton` when the prop is provided. `data-testid="spawn-attached-btn-${c.name}"`, tooltip `"Spawn session attached to this change"`, click stops propagation and invokes the callback
- [x] 6.2 Wired through `SessionList` → `FolderOpenSpecSection` so `onSpawnSession?(cwd, changeName)` (now optionally taking attachProposal in `useSessionActions.handleSpawnSession`) sends `spawn_session { cwd, attachProposal }`
- [x] 6.3 Tests in `FolderOpenSpecSection.test.tsx`: button is hidden when no callback, visible+clickable when callback present, click invokes callback exactly once with `(cwd, changeName)`, click does not toggle section collapse
- [x] 6.4 Confirm: the existing folder action-bar `+Session` button is unchanged — it calls `onSpawnSession(group.cwd)` without a second argument so `attachProposal` is undefined and the bare-spawn path is taken; covered by `useSessionActions` only conditionally spreading the field

## 7. End-to-end glue

- [x] 7.1 Manual smoke confirmed by user
- [x] 7.2 Manual smoke confirmed by user
- [x] 7.3 Manual smoke confirmed by user

## 8. Documentation

- [x] 8.1 Updated `AGENTS.md` `Key Files` rows for `FolderOpenSpecSection.tsx`, added a new row for `pending-attach-registry.ts`, and extended the `session-action-handler.ts` row with the `attachProposal` plumbing note
- [x] 8.2 Verified `docs/architecture.md` has no spawn-flow diagram — nothing to update
- [x] 8.3 Added two bullets under `## [Unreleased]` → `### Added` in `CHANGELOG.md`
