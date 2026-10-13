## Why

The folder home page (`/folder/:cwd`) is a dead-end launcher. Its composer collapses (issue #877). It offers no model, thinking level, or skills. It repeats the sidebar's session list while hiding the editor and terminals behind buttons. The same root cause also affects every **ended** session: composer context (commands, models) only arrives from a **live** bridge, so those composers have no `/` skill list and no model chip until pi is resumed.

## What Changes

- **CHANGED** The folder home becomes a *pre-session pane* inside the session split. Left: a new-session pane with skill starters and the composer docked at the bottom (variant B), built with the chat pane's own column geometry. Right: the folder editor/terminals pane. The two are switched by the Chat / Split / Editor control the session header already uses.
- **FIXED** Issue #877. In the docked geometry the composer's existing pane height budget resolves against the pane, so the card renders at natural height. No extra layout prop is needed.
- **NEW** Spawn-time choices in the composer toolbar:
  - **model**: global catalogue, with the Settings default pre-selected and tagged;
  - **thinking level**: the Settings default pre-selected and tagged;
  - **run location**: `This folder` or `New worktree…` (opens the existing worktree dialog; the page then issues one spawn for the new worktree carrying the typed prompt and choices).
- **NEW** `spawn_session` gains optional `model` and `thinkingLevel`. They map to pi's `--model` / `--thinking` argv. A failed spawn re-enables Start.
- **NEW** `GET /api/pi-resources/commands?cwd=` returns a folder's command list without needing a live session:
  - the latest list from a live session in exactly that cwd, if there is one;
  - otherwise the enabled skills and prompts from the resource scan.

  Models come from the global catalogue (`fetchModelCatalogue`, already used by Settings).
- **CHANGED** Ended sessions' composers use the folder command list and the catalogue. A model or thinking level picked there is carried on the resuming `send_prompt` / `resume_session` (continue) and applied to the resumed pi (`--model` / `--thinking` on the `continue` argv). With no pick, the session keeps its model.
- **NEW** Skill/prompt starter cards on the pre-session pane. They insert `/skill:<name> ` into the composer and never auto-send.
- **REMOVED** The session list on the folder home (the sidebar owns it) and the Terminals / Editor / Settings quick-action buttons (replaced by the editor pane and a header gear). **BREAKING** for the `directory-home-open-*` / `directory-home-session-*` test ids.
- Mockup: mockups/directory-home-split (in this change)

## Capabilities

### New Capabilities
- `sessionless-composer-context`: the folder command list without a live session (source precedence, scope, matching), the model catalogue for sessionless composers, and spawn/resume-time model and thinking reaching pi.

### Modified Capabilities
- `directory-home-page`: bare route hosts the split; docked prompt with spawn choices; content (no session list, no quick actions); skill starters.
- `command-autocomplete`: the composer of a session with no received `commands_list` uses the folder command list instead of an empty array.

## Impact

- **Client:**
  - `components/folder/DirectoryHomeView.tsx`: rewritten as the pre-session pane.
  - `App.tsx`: the folder route renders `SplitWorkspace`; the ended-session composer gets the folder command list and catalogue.
  - `hooks/useSessionActions.ts`: `handleSpawnSession` opts gain `model`, `thinkingLevel`; spawn-failure re-enable.
  - Spawn-mode toolbar chips in `CommandInput`.
  - Worktree dialog call site.
  - New `useFolderCommands` hook; `useModelCatalogue` hook extracted from `SettingsPanel`.
- **Shared:**
  - `SpawnSessionBrowserMessage`, `SendPromptToBrowserMessage` (`send_prompt`), `ResumeSessionBrowserMessage` gain optional `model?`, `thinkingLevel?`.
  - `ROUTE_TIERS` gains `GET /api/pi-resources/commands` at `observe`.
  - `spawn_register_timeout` gains optional `requestId`.
  - `SessionFlags.thinking`.
  - `sessionFlagsToArgv` emits `--model` / `--thinking` on the fresh and `continue` branches.
- **Server:**
  - One validator for `model` / `thinkingLevel`, used by `spawn_session`, `send_prompt`, and `resume_session`.
  - `spawn_session` forwards validated values, and fills `model` from the configured default when only `thinkingLevel` is given.
  - Auto-resume and `resume_session` pass the pick directly to their resume spawn (not via the cwd-keyed pending-resume registry).
  - New `GET /api/pi-resources/commands` route (`packages` road).
  - `sessionCommandRegistry` stamps `receivedAt` when it accepts a list.
- **Tests:** `tests/e2e/directory-home.spec.ts`, `tests/e2e/route-backed-overlay.spec.ts`, `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`, `packages/client/src/lib/__tests__/folder-home-route.test.tsx`.
- **Compatibility:** all protocol fields are optional. An old server ignores them, and its 404 on the commands route yields an empty `/` list. Rollback = revert. No persisted data changes shape.

## Discipline Skills

- `doubt-driven-review`: the resume-with-model path sits next to the archived `fix-resume-keeps-session-model` / `fix-default-model-clobbers-explicit-model` contracts.
- `security-hardening`: browser-supplied `model` / `thinkingLevel` become pi argv. Validate them, keep them as discrete argv elements, and shell-escape each one on the tmux path.
- `review-code`: before commit.
