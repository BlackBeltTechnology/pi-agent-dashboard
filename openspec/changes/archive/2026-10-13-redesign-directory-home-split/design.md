## Context

- **Folder home today:** `DirectoryHomeView` mounts `CommandInput` centered in a flex column.
  - `CommandInput`'s root (`packages/client/src/components/chat/CommandInput.tsx:949`) is `border-t … shrink min-h-0 max-h-[40%]`, the chat-pane height budget, plus a 72px floor.
  - Off the pane, the 40% resolves against a content-sized wrapper, so the card collapses and scrolls internally (issue #877).
- **No commands or models are passed:** `App.tsx:2777` renders `<DirectoryHomeView>` with neither `commands` (defaults `[]`) nor model props. The model chip is gated on `onSelectModel` (`CommandInput.tsx:1180`).
- **Composer context is bridge-sourced:**
  - The server issues `request_commands` / `request_models` on `subscribe` (`packages/server/src/browser-handlers/subscription-handler.ts` `handleSubscribe`).
  - It forwards the bridge's replies with `sendToSubscribers` (`packages/server/src/event-wiring.ts:2135`).
  - A WS probe against the live server returned 173 commands (129 skills) for an active Documents session, and nothing for an ended one.
- **Resume:**
  - `sessionFlagsToArgv`'s `continue` branch emits no `--model` (`packages/shared/src/platform/spawn-mechanism.ts:160-175`).
  - Auto-resume spawns inline in the `send_prompt` handler with `{sessionFile, mode:"continue", strategy}` (`packages/server/src/browser-handlers/session-action-handler.ts:399`).
  - `pendingResumeRegistry` is keyed by cwd, last write wins (`packages/server/src/pending/pending-resume-registry.ts`).
- **Default model/thinking gate:**
  - The bridge applies `config.defaultModel` + `defaultThinkingLevel` only inside `applyDefaultModel` (`packages/extension/src/bridge.ts:196-218`).
  - That function is gated off by an explicit `--model` argv token or by `entryCount !== 0` (`packages/extension/src/bridge-default-model-gate.ts:72-85`).
- **Reusable pieces:**
  - `sessionCommandRegistry` + `canonicalPath` (`packages/server/src/pi/session-skill-registry.ts:31`).
  - `GET /api/pi-resources?cwd=` (`packages/server/src/routes/openspec-routes.ts:490`). Its HTTP road is `packages` (`packages/server/src/identity/http-road-classification.ts:77`) and its tier is `observe` (`packages/shared/src/route-tiers.ts:173`; the tier map is fail-closed on exact match).
  - `fetchModelCatalogue()` (`SettingsPanel.tsx:759`).
  - `THINKING_LEVELS` (`packages/shared/src/role-schema.ts:149`).
  - `SplitWorkspace`; `FolderEditorView` + `folderPaneId(cwd)`.
  - `WorktreeSpawnDialog` (`onSpawn`, `onSpawnStart`, `onSpawnAbort`).
  - Built-in commands (`CommandInput.tsx:24`).
- **pi CLI:** `--model <pattern>` (accepts an optional `:<thinking>` suffix) and `--thinking <level>`, checked with `pi --help`.

## Goals / Non-Goals

**Goals:**
- The folder-home composer and ended-session composers have skills and models with no live bridge.
- The folder home shares the session split, so after a spawn the user navigates to `/session/:newId` (requirement unchanged) inside the same split shape, with the folder's editor tabs carried over.

**Non-Goals:**
- Extension-registered commands for folders with no live session.
- Changing command delivery for running sessions.
- A per-folder default model.
- A mobile split.
- Applying a pick to forks.

## Decisions

**D1: The folder home renders inside `SplitWorkspace`.**
- Left: the pre-session pane. Right: the folder editor surface keyed by `folderPaneId(cwd)`. The layout mode persists under that key.
- The bare route still renders "the directory home page", which now hosts the editor pane (MODIFIED "Bare directory route").
- *Alternative:* a standalone page with buttons. Rejected: two surfaces for one folder.

**D2: The pre-session pane copies the chat pane's column geometry.**
- The pane is a column: starters (`flex-1 min-h-0 overflow-auto`), then the composer as the last child. `CommandInput`'s existing budget then resolves against the pane, as in a session.
- This fixes #877 with no new prop. The textarea keeps its own `maxHeight: 120px` (`CommandInput.tsx:1103`).
- *Alternative:* a `standalone` prop that drops the budget. Rejected: it leaves the card unbounded.

**D3: Folder command list: `GET /api/pi-resources/commands?cwd=<abs>`.**
- **Request:** `cwd` is required and must be absolute; otherwise the route returns 400 (no `process.cwd()` fallback).
- **Response:** `{commands: FolderCommand[], origin: "live"|"scan"|"none"}`, where `FolderCommand = CommandInfo & { scope: "folder"|"global" }`.
- **Live:** among sessions for which `piGateway.isSessionConnected(id)` (`packages/server/src/pi/pi-gateway.ts:131`) is true, whose normalized cwd equals the normalized request cwd, take the *non-empty* list with the latest `receivedAt`.
  - Normalization: strip trailing separators, then `canonicalPath` (raw-string fallback when the path does not exist).
  - Registry presence or status alone is not used, because crashed sessions never unregister.
  - The registry stores `{commands, receivedAt}` per session and stamps `receivedAt` when it *accepts* a list. Lists dropped by `retain`'s settling rule are not stamped.
  - An accepted empty list does not count as live; the request falls through to `scan`.
  - Equality is exact on purpose. A subdirectory or worktree session resolves a different `.pi/`, so its list is not "what loads here". This differs from the card-level `isWithinFolder` join, which answers a different question.
- **Scan:** otherwise, `enabled` skills from the scan become `{name:"skill:<n>", source:"skill", description, path: filePath}`, and prompts become `{name:<n>, source:"prompt", description, path: filePath}`. A `degraded` scan still returns `scan`; an empty result returns `none`.
- **Scope:** `folder` when the command's canonical `path` belongs to the folder set, otherwise `global`. The folder set is `local.*` resources plus resources of `packages[]` entries with `scope === "local"`. Live entries are joined by path the same way; entries with no `path` are `global`.
- **Routing and tiers:** the route is on the `packages` road through the `pi-resources` segment. It needs a new `ROUTE_TIERS` row `{GET, "/api/pi-resources/commands", observe}`, matching its sibling.
- **Built-ins** stay client-side: `CommandInput` merges and dedupes by name.
- **Old server:** a 404 maps to an empty list.
- *Alternative:* a WS request/response pair. Rejected: three classification maps, and an old server never replies.

**D4: Models and thinking defaults on the folder home.**
- A `useModelCatalogue()` hook is extracted from `SettingsPanel` and cached module-wide.
- The model chip pre-selects Settings `defaultModel`, tagged `default`, even when the catalogue fails (the value comes from config, not the catalogue). `pi default` only when no default is configured.
- The thinking chip pre-selects Settings `defaultThinkingLevel`, tagged `default`.
- Both are sent explicitly. This is required: explicit `--model` disables the bridge's default model *and* thinking application, so the client must carry the default thinking itself.

**D5: Validation (one server helper; used by `spawn_session`, `send_prompt`, `resume_session`).**
- `model`: at most 200 characters, with a mandatory `/` and non-empty provider and id.
  - Provider: `[A-Za-z0-9._-]+`. Id: `[A-Za-z0-9._:@/+-]+`.
  - No `/`-separated segment may be empty or start with `-`; this is checked explicitly, not by the character class.
  - When the message carries **no** `thinkingLevel` field, a trailing `:<level>` with `<level>` in `THINKING_LEVELS` is split off: model = prefix, thinking = suffix.
  - When a `thinkingLevel` field is present (valid or not), the model is left intact, and the field alone decides the thinking level (or is dropped).
  - Other `:` uses in the id pass through to pi unchanged.
- `thinkingLevel`: must be in `THINKING_LEVELS`.
- An invalid value is dropped with `console.warn`, and the operation proceeds.

**D6: Spawn argv.**
- `SessionFlags` and `SessionOptions` (`packages/server/src/spawn-process/process-manager.ts:176`) gain `thinking`. It is threaded through `spawnPiSession` and the spawn/resume call sites. `sessionFlagsToArgv` emits `--model` and `--thinking` as discrete elements on the fresh and `continue` branches; the fork branch is unchanged.
- Shell safety: the headless/wt paths pass argv with `shell:false`. The tmux pane path builds a command string with per-element `shellEscape` (`process-manager.ts:576-585`). Validated charset plus per-argument escaping means a value is never interpreted by a shell; a test asserts this on the tmux string.
- Requires a pi that supports `--thinking` (the pi version the dashboard currently pins does).
- **Server guarantee against a racing default:**
  - when a fresh spawn carries `thinkingLevel` but no `model`, and config has a `defaultModel`, the server adds that default as `model`;
  - so a `--thinking` choice is never overwritten by the bridge's post-start default thinking.
  - Resumes are already exempt (`entryCount !== 0`).

**D7: Spawn lifecycle on the folder home.**
- The spawn is tracked by App's existing `requestId`-keyed `pendingSpawnsRef` (spec `spawn-correlation`). The page reads its own entry and does not navigate; App owns navigation.
- Start stays disabled until `session_added` correlates. It re-enables, keeping the draft, on:
  - `spawn_result { success:false }` echoing that `requestId`;
  - `spawn_register_timeout` for it: the message gains optional `requestId`, filled by the server from its existing `spawnToken → requestId` map (`session-action-handler.ts:830-837`);
  - `WorktreeSpawnDialog.onSpawnAbort`.
- `spawn_error` carries no `requestId` and is not used for correlation.

**D8: Run location.**
- `This folder` (default) or `New worktree…`. The chip is shown only once `folderGitMap` reports the cwd as a git repo; sending before that uses This folder.
- `New worktree…` opens `WorktreeSpawnDialog`. `onSpawnStart` marks in-flight. `onSpawn(path, opts)` issues exactly one `spawn_session` for `path` with `{initialPrompt, model, thinkingLevel, gitWorktreeBase, requestId}`. `onSpawnAbort` re-enables.

**D9: Ended sessions.**
- **Commands:** when the selected session's status is `ended`, its composer gets `useFolderCommands(session.cwd)` and the catalogue. When the session goes live, it switches to the session's own `commands_list` once that arrives, keeping the folder list until then.
- **Chips:** each shows the pick if one exists, otherwise the persisted `session.model` / `session.thinkingLevel` (`pi default` when the model is unknown).
- **Pick storage:** client-side per session, for each field independently.
- **Pick transport:**
  - The pick is sent as optional `model` / `thinkingLevel` on `SendPromptToBrowserMessage` (`send_prompt`) and `ResumeSessionBrowserMessage`.
  - The server drops both fields unless `mode === "continue"`, before validation, so a crafted fork can never inject `--model`.
  - The server validates it (D5) and passes it **directly** to that resume's `spawnPiSession`. It is not stored in the cwd-keyed `pendingResumeRegistry`, which avoids cross-session bleed.
  - While a resume is already in flight (`alreadyResuming`), a second pick is ignored.
- **Field independence:** an unpicked thinking level is filled from the session's stored `thinkingLevel` when a model was picked. This guards against pi resetting thinking on a `--model` resume, whatever pi's semantics. An unpicked model adds no argv. The archived `fix-resume-keeps-session-model` gate is unchanged, and explicit `--model` is authoritative per `fix-default-model-clobbers-explicit-model`.
- **Clearing the pick:** on the session's live transition (register) and on any `set_model` / `set_thinking_level` for it. This prevents a stale pin on later resumes, including goal-supervisor respawns, which never carry picks.
- **Live sessions and forks:** the fields are ignored for a live session. Fork ignores the pick and keeps the parent model, per the archived contract.

**D10: Starter cards.**
- Up to 6 cards, in this order: `scope:"folder"` skills, prompts, global skills.
- Activating a card puts its invocation at the draft start, *replacing* a leading `/token` if the draft already starts with one.
- It calls the *current* `onDraftChange` through the same ref mechanism autocomplete selection uses (spec `command-autocomplete` "Selection callbacks invoke the current onDraftChange prop").
- It moves the caret to the end and focuses the composer. It never sends.

## Risks / Trade-offs

- **The scan list differs from what pi will load.** → The `/` popover footer shows "from disk" when `origin` is `scan`.
- **An old server ignores the new fields** (multi-server/remote setups), so a picked model is silently not applied. → The session shows its actual model after register. A version gate is not worth it for an optional preference.
- **Exact cwd equality skips subdirectory and worktree sessions for `live`.** → Intended (D3). Those folders fall back to the scan.
- **A server-side invalid-value drop is silent.** → Only reachable with a crafted message, since the client offers catalogue values only.
- **Pre-existing cwd-keyed races, not introduced here:** `pendingResumeRegistry` text and the `pendingXByCwd` spawn intents (`initialPrompt` / `attachProposal` / `gitWorktreeBase`) can cross between concurrent same-cwd resumes or spawns. → Picks bypass these registries (D9). Fixing the registries themselves is left to a separate change.
- **A model pick on an ended session is lost on reload.** → It is client-only. The worst case is that the resume keeps the old model.
- **Removing test ids.** → `tests/e2e/directory-home.spec.ts`, `tests/e2e/route-backed-overlay.spec.ts`, `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`, and `packages/client/src/lib/__tests__/folder-home-route.test.tsx` are updated in this change.

## Migration Plan

Client and server ship together. Protocol fields are optional in both directions, and an old server's 404 on the commands route yields an empty list. Rollback = revert. Nothing persisted changes shape.
