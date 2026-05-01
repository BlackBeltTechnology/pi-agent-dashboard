## Why

The folder card's OpenSpec section already shows a `completedTasks/totalTasks` indicator per change, but it is read-only — to tick off tasks the user has to either open an attached session card (via the `TasksPopover`) or hand-edit `tasks.md`. That is friction for the common workflow of glancing at folder-level progress and checking off a finished item.

Separately, the typical "start work on proposal X" flow requires two clicks: `+Session` (spawn) → wait for the bridge → open the new session → click attach in the popover and pick the proposal. Because the proposal context is already known when the user is looking at it inside the folder's change list, the spawn-and-attach pair can be collapsed into one action, removing a race-prone post-spawn step.

## What Changes

- **Folder OpenSpec section: clickable task count.** The `{completedTasks}/{totalTasks} tasks` indicator on each change row in `FolderOpenSpecSection` becomes a button that opens the existing `TasksPopover` with `cwd` + `change` of that row. Reuses the same component and API the session card already uses — no new server endpoint, no new toggle logic.
- **Folder OpenSpec section: spawn-with-attach action.** Each change row in the folder's expanded change list gains a small "spawn session attached to this change" button. Clicking it spawns a session in the folder's `cwd` with the change pre-attached, atomically — no flash of unattached state, no extra round-trip from the client.
- **Browser → server protocol: optional `attachProposal` on `spawn_session`.** `SpawnSessionBrowserMessage` gains an optional `attachProposal?: string`. The server records the intent in a new `pendingAttachByCwd: Map<cwd, string[]>` (FIFO, consume-once). When a `session_registered` broadcast fires for a matching cwd, the server pops one intent and applies the existing idempotent attach logic from `proposal-attach-naming.ts` (auto-rename if name empty/witness). The bare `+Session` button on the folder action bar keeps unattached semantics — implicit attach is rejected as a default.

## Capabilities

### New Capabilities

None — both features extend existing capabilities.

### Modified Capabilities

- `openspec-folder-section`: change row gains a clickable task-count button (opens existing `TasksPopover`) and a spawn-with-attach button.
- `openspec-attach-combo`: the attach side of the new flow extends the attach surface from "after-spawn" to "concurrent-with-spawn" — pending-attach intents are consumed at `session_registered` time using the same auto-rename rule.
- `folder-action-bar`: the bare `+Session` button's no-attach semantics are explicitly preserved (not modified) — documented to disambiguate from the new per-change spawn-with-attach button.

## Impact

- **Affected code (client):** `packages/client/src/components/FolderOpenSpecSection.tsx` (clickable count + new spawn button + `TasksPopover` host), `packages/client/src/components/__tests__/FolderOpenSpecSection.test.tsx` (new tests).
- **Affected code (shared):** `packages/shared/src/browser-protocol.ts` (`SpawnSessionBrowserMessage.attachProposal?`).
- **Affected code (server):** `packages/server/src/browser-handlers/session-action-handler.ts` (`handleSpawnSession` records attach intent), `packages/server/src/browser-handlers/handler-context.ts` (add `pendingAttachByCwd` map), session-registration site (consume one intent on register, call existing attach handler with the resolved `sessionId`).
- **APIs:** No new HTTP endpoints. No new WS message types. `spawn_session` gains one optional field — backward-compatible.
- **Migration / compatibility:** Old clients omitting `attachProposal` see no behaviour change. Old servers receiving the field from a new client ignore unknown keys (existing JSON-decode is permissive). No data migration.
- **Rollback:** Revert the change. No persisted state introduced. Pending-attach intents are in-memory only.
- **Tests:** Reuse existing `TasksPopover` tests (no change to the popover itself). Add: folder-section test for "click count opens popover" and "click spawn-attach sends spawn_session with attachProposal", server-handler test for "spawn intent is consumed on session_registered", protocol-shape unit test.
