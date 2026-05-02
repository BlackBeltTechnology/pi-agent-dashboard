## Why

`packages/client/src/App.tsx::wrappedHandleSend` hard-codes two slash-command interceptors (`/flows`, `/flows:new`) that open dashboard-side rich dialogs (`SearchableSelectDialog`, `FlowLaunchDialog`) before the slash text reaches the bridge. The same file declares ~7 pieces of flow-dialog state (`flowPickerOpen`, `flowNewOpen`, `flowEditPickerOpen`, `flowEditFlowName`, `flowDeletePickerOpen`, `flowDeleteFlowName`, `flowLaunchTarget`) and renders ~120 lines of dialog JSX gated on those flags.

This was useful before pi-flows became self-sufficient. Today it is duplication:

- The pi-flows extension's own command handlers (`extensions/flow-context/index.ts:284, 380, 460, 505` and `extensions/role-manager.ts:279`) already drive the same workflow via `ctx.ui.select / input / confirm / notify`. In dashboard sessions those calls route through PromptBus → `DashboardDefaultAdapter` and render as generic interactive dialogs — the universal extension dialog surface that already works for every other extension.
- `packages/flows-plugin/src/client/SessionFlowActions.tsx` (mounted via the `session-card-action-bar` slot) has its own rich picker for flows on the session card, with the same `+New / ✎Edit / ×Delete` affordances. The plugin keeps owning that surface.
- The dashboard shell hard-coding knowledge of one extension's commands blocks symmetry: every other extension uses ctx.ui and renders fine; pi-flows is special-cased only by the App-shell code that predates the universal path.

The user-visible bug that prompted this change: typing `/flo` shows nothing in the chat-input autocomplete unless pi-flows is installed AND the bridge has finished pushing its commands list. That part is correct behavior — the autocomplete tells the truth. The interceptors mask the issue by making `/flows` and `/flows:new` "work" via shell-side dialogs even when their tab-completion doesn't appear, creating an asymmetric UX where some flow commands need extension awareness and some don't.

`docs/plans/plano-pi-integration.md` (894 lines) advertises `/flows`, `/roles`, and `Ctrl+A auto-routing` as if they were a coherent dashboard feature set. They are not — `Ctrl+A` is unimplemented and the rest are extension features. The plan is stale and actively misleads.

## What Changes

Pure deletion. No new types, no new slots, no protocol changes, no flows-plugin manifest changes.

- **`packages/client/src/App.tsx`** — delete:
  - The two interceptor branches in `wrappedHandleSend`:
    ```ts
    if (trimmed === "/flows") { setFlowPickerOpen(true); return; }
    if (trimmed === "/flows:new") { setFlowNewOpen(true); return; }
    ```
  - The seven `useState` hooks for flow dialogs (`flowPickerOpen`, `flowNewOpen`, `flowEditPickerOpen`, `flowEditFlowName`, `flowDeletePickerOpen`, `flowDeleteFlowName`, `flowLaunchTarget`) and their setters.
  - The ~120 lines of JSX rendering `SearchableSelectDialog` (Flows + Edit Flow + Delete Flow), `FlowLaunchDialog` (new + edit-with-name + run-with-task), and `ConfirmDialog` (delete confirmation).
- **`BUILTIN_SLASH_COMMANDS`** — keep as-is. The Set retains all nine entries (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/compact`, `/reload`, `/new`, `/model`, `/roles`). Its sole remaining purpose is to reject extension UI modules trying to claim those reserved names; that purpose is still valid because the strings still have reserved meanings (handled by pi or by pi-flows-the-extension). The collision-warning branch in `wrappedHandleSend` stays untouched.
- **`docs/plans/plano-pi-integration.md`** — delete the file. References elsewhere in `docs/plans/command-palette-future.md` are left intact (out of scope for this change; can be addressed separately if they become a problem).

After this change:

- Typing `/flows` in chat goes through `handleSend` → bridge → pi → pi-flows' `flows` command handler → `ctx.ui.select(...)` → PromptBus → `DashboardDefaultAdapter` renders a generic action-menu dialog. Same workflow, simpler render.
- Typing `/flows:new` similarly reaches pi-flows' handler, which prompts via `ctx.ui.input(...)` then emits `flows:new-request`. The flow-engine takes over from there exactly as today.
- `SessionFlowActions` on the session card (flows-plugin) is unchanged — its rich picker is reachable via the existing action-bar slot click, not via slash commands.
- The Tab-completion bug from the original report is still solved by the autocomplete telling the truth: install pi-flows → see `/flows*`; don't → don't.

## Capabilities

### Modified Capabilities

- **`chat-command-routing`**: `wrappedHandleSend` no longer intercepts `/flows` or `/flows:new`. Routing reduces to: extension-UI-module match (with `BUILTIN_SLASH_COMMANDS` collision rejection) → default forward to bridge. The `BUILTIN_SLASH_COMMANDS` Set membership is unchanged.

## Impact

**Affected code** (deletion-only)

- `packages/client/src/App.tsx` — ~140 lines net deletion (state hooks + interceptors + JSX). No new code.
- `docs/plans/plano-pi-integration.md` — file deleted.
- Tests:
  - Add `packages/client/src/__tests__/wrappedHandleSend-no-flow-interceptor.test.tsx` — pin that submitting `/flows` calls the underlying `handleSend` (i.e. sends to bridge) and does NOT open a dashboard dialog.
  - Update any existing test that asserts `/flows` opens `SearchableSelectDialog` (search for `flowPickerOpen` / `setFlowPickerOpen` references in tests).

**Affected protocol** — none. `flow_action` WS message and the bridge's `flows:new-request` / `flows:edit-request` event emits stay byte-identical. The browser still sends `flow_action` messages from the *session card* `SessionFlowActions` picker. Slash commands route through pi-flows directly via the bridge's normal prompt path.

**Affected UX**

| Surface | Before | After |
|---|---|---|
| Type `/flows` in chat | Rich `SearchableSelectDialog` | Generic ctx.ui select dialog (PromptBus dialog) |
| Type `/flows:new` in chat | Rich `FlowLaunchDialog` | Generic ctx.ui input dialog |
| Type `/flows:edit`, `/flows:delete`, `/roles` | Generic ctx.ui dialog | Unchanged — generic ctx.ui dialog |
| Click flow action button on session card | Rich plugin-owned picker | Unchanged |
| Autocomplete `/flo` with pi-flows installed | Shows commands | Unchanged |
| Autocomplete `/flo` without pi-flows | Empty | Unchanged |

The visible regression is the loss of the rich `SearchableSelectDialog` and `FlowLaunchDialog` from the slash-command path. Users who prefer those dialogs have the session-card action button as an equivalent alternative (same code, same component, just triggered by click instead of slash).

**Migration / rollback**

- Single release. No data migration. To roll back, restore the deleted state hooks, interceptors, and JSX from git history; recreate `plano-pi-integration.md` from history.
- Flows users who relied on slash commands keep the workflow but get the universal ctx.ui rendering. CHANGELOG note recommended.

**Risk**

- Lower than the v1 (slot-based) proposal: zero new code paths, zero new types, zero new tests beyond a single negative-assertion regression test. The remaining workflow is the same code already exercised by every other extension's slash command in dashboard sessions.
- The `BUILTIN_SLASH_COMMANDS` Set retains its purpose without modification, so no extension that worked before will start being rejected.
- pi-flows version compatibility: this change assumes pi-flows registers `flows` and `flows:new` as commands with self-sufficient `ctx.ui` handlers. Verified against the current installed copy at `~/.pi/agent/git/.../pi-flows/extensions/flow-context/index.ts:284 and :505`. If a future pi-flows release removes those handlers, slash commands break — but that's pi-flows' contract to maintain, not the dashboard's.
