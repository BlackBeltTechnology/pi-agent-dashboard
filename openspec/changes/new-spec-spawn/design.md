## Context

The `openspec-folder-card-ui` change adds a `FolderOpenSpecSection` to folder group headers. This change adds a "New Spec" button to that section which spawns a new pi agent with `/opsx:explore` as the initial prompt. The existing `process-manager.ts` spawns sessions via tmux or headless mode but has no concept of an initial prompt. The `openspec-activity-detector.ts` detects phase and change names from tool events but misses the `openspec new change "name"` positional CLI syntax.

## Goals / Non-Goals

**Goals:**
- "New Spec" button on folder card spawns a pi agent that enters explore mode
- ~~Process manager supports initial prompt passed as positional argument to pi CLI~~ *(Superseded — registry dispatch shipped by `project-init-skill-and-profiles`)*
- Activity detector catches `openspec new change "name"` immediately
- Auto-attach works when the explore session creates a proposal

**Non-Goals:**
- General-purpose "spawn with prompt" UI (this is specifically for OpenSpec explore)
- Changing auto-attach logic (already works once change name is detected)
- Custom explore topic input (just launches bare `/opsx:explore` — user can type context in the session)

## Decisions

### 1. Transport: pending-initial-prompt registry (shipped by `project-init-skill-and-profiles`)

The positional-CLI-arg approach originally described is **obsolete**. The shipped solution uses a **pending-initial-prompt registry** (`packages/server/src/pending-initial-prompt-registry.ts`):

1. Browser sends `spawn_session { cwd, initialPrompt }` → server enqueues prompt by cwd.
2. When the new session sends its first `session_register`, the bridge notifies the registry.
3. Registry dispatches the prompt into the session via `sendMessageToSession`.

`SessionOptions` is NOT modified — the prompt never touches `process-manager.ts`.

### 2. Extend `spawn_session` message instead of new message type

Add optional `initialPrompt?: string` to the existing `spawn_session` browser→server message rather than creating a new `spawn_spec_session` message type. Keeps the protocol simpler — it's the same operation (spawn) with an optional parameter.

### 3. Fix activity detector with new regex — done via `fix-openspec-activity-detection` archive

`CLI_NEW_CHANGE_RE` added to `packages/shared/src/openspec-activity-detector.ts` by archived change `fix-openspec-activity-detection`. Already wired in the Bash tool handler alongside `CLI_CHANGE_FLAG_RE` and `CLI_ARCHIVE_RE`.

### 4. "New Spec" button placement

The button renders in `FolderOpenSpecSection` next to Bulk Archive and Refresh. It's always visible (even when section is collapsed) because it's a primary action. Sends `spawn_session` with `cwd` and `initialPrompt: "/opsx:explore"`.

### 5. Auto-attach flow relies on existing logic

No changes to auto-attach. The flow:
1. Agent starts, reads `openspec-explore` SKILL.md → phase = "explore" detected
2. During explore, agent creates change → `openspec new change "name"` → changeName detected (with regex fix)
3. Server has both phase + changeName → auto-attach fires
4. Session gets attached, renamed to change name

## Risks / Trade-offs — drift reconciliation 2026-07-13

- ~~**[Risk] Shell escaping of initial prompt**~~ — Moot: registry-based dispatch sends prompt post-spawn via `sendMessageToSession`, no shell escaping needed.
- ~~**[Risk] Tmux command quoting**~~ — Moot: prompt never enters tmux command string (same reason as above).
- **[Trade-off] No topic input dialog** — Still relevant: "New Spec" button launches bare `/opsx:explore` without asking the user what to explore. User can type context in the session after it starts. Adding a dialog is future work if needed.
