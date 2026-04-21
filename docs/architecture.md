# PI Dashboard Architecture

> **Adjacent artifact:** the public marketing site lives at `/site` and is
> product-adjacent, not part of the dashboard runtime. It has its own Astro
> build, its own Playwright screenshot pipeline, and its own GitHub Pages
> deploy workflow (`.github/workflows/deploy-site.yml`). See
> `/site/README.md` for details.


## Overview

The PI Dashboard is a web-based dashboard for monitoring and interacting with pi agent sessions. It consists of three components:

```
┌─────────────┐     WebSocket      ┌──────────────┐     WebSocket     ┌─────────────┐
│   Bridge    │ ◄─────────────────► │  Dashboard   │ ◄───────────────► │  Web Client  │
│  Extension  │    (port 9999)      │   Server     │    (port 8000)    │  (React)     │
│  (per pi)   │                     │  (Node.js)   │                   │  (Browser)   │
└─────────────┘                     └──────────────┘                   └─────────────┘
                                          │
                                    ┌─────┴─────┐
                                    │  In-Memory │
                                    │  + JSON    │
                                    └───────────┘
```

## Components

### 1. Bridge Extension (`src/extension/`)
A global pi extension that runs in every pi session. It:
- Detects session source (TUI, Zed, tmux, dashboard-spawned) via `.meta.json` sidecar files and environment variables
- Forwards all pi events to the dashboard server via WebSocket
- Relays commands from the dashboard back to pi
- Handles reconnection with exponential backoff and event buffering
- Sends heartbeats every 15s with process metrics (CPU%, RSS, heap, event loop max delay, load average); server responds with `heartbeat_ack`
- Server liveness watchdog: forces reconnect if no message received for 60s
- Server-side WS ping/pong (60s interval) detects dead TCP connections; requires 2 consecutive missed pongs before killing (tolerates long-running bash commands that block the event loop)
- Detects OpenSpec activity (phase/change) from tool events; server auto-attaches the change when `changeName` is detected (phase is not required — skills loaded via prompt templates don't emit a SKILL.md read event). The session card's OpenSpec activity badge displays when either `openspecPhase` or `openspecChange` is detected (not just phase).
- **Duplicate bridge prevention**: Uses `process`-level shared state (not `globalThis`) with a monotonic generation counter. When the extension is loaded multiple times (e.g., local + global npm package), only the latest instance's event handlers are active — stale listeners bail out immediately. All previous connections and timers are tracked and cleaned up on re-init.
- **Subagent re-entry guard**: When pi-subagents launches an Agent tool, the subagent creates its own `AgentSession` which loads extensions (including the bridge) in the same process. Without protection, this would overwrite the parent bridge's global state, disconnect its WebSocket, and prevent `tool_execution_end`/`agent_end` from being forwarded — leaving the parent session stuck at "streaming" forever. The bridge stores a reference to its owning `pi` instance and skips initialization when called from a different instance (subagent).
- Routes `ctx.ui` dialog methods (confirm, select, input, editor, notify) through `PromptBus` (`prompt-bus.ts`)
  - Adapters register to handle prompts: `DashboardDefaultAdapter` renders generic dialogs inline; extensions (e.g. pi-flows) can register custom adapters via `prompt:register-adapter` event
  - First-response-wins: multiple adapters (TUI, dashboard, custom) can claim a prompt; the first to respond resolves it, others are dismissed
  - Bridge's TUI adapter is registered inline (captures original `ctx.ui` methods before patching) and presents prompts in the terminal with AbortController-based cancellation
  - Patched `ctx.ui` methods forward the `message` field (from opts) via `metadata` in the PromptBus request
  - Client-side `prompt-component-registry.ts` maps component type strings to render placement (inline, widget-bar, overlay)
  - Protocol messages: `prompt_request`, `prompt_dismiss`, `prompt_cancel`, `prompt_response`

### 2. Dashboard Server (`src/server/`)
A Node.js HTTP + WebSocket server that:
- Accepts connections from bridge extensions (Pi Gateway, port 9999)
- Accepts connections from web browsers (Browser Gateway, port 8000)
- Stores events in an in-memory buffer with LRU eviction (max 100 sessions, 5000 events per session)
- Truncates large event payloads (tool results, file content, thinking blocks) to bound memory
- Applies WebSocket backpressure on browser connections (drops messages when send buffer > 4MB)
- Manages sessions in a pure in-memory registry (populated from bridge connections and direct disk discovery)
- Persists global preferences (pinned directories, session order) in `~/.pi/dashboard/preferences.json`
- Discovers historical sessions directly from disk via `SessionManager.list()` (DirectoryService)
- Loads session events on demand directly from disk via `SessionManager.open()` (DirectoryService)
- Polls OpenSpec CLI per directory every 30s, broadcasting changes to browsers (DirectoryService)
- Serves the built web client as static files (production) or proxies to Vite dev server (dev mode)
- Writes per-session `.meta.json` sidecar files with dashboard state and cached stats
- Exposes REST API for session management, event content fetch, pinned directories, and file reading
- Provides session control REST endpoints (`/api/session/:id/*`) wrapping WebSocket-only operations (prompt, abort, spawn, resume, rename, hide, flow-control, model, thinking-level, attach/detach-proposal) — see `src/server/session-api.ts`

**Server decomposition:** The server is split into focused modules:
- `server.ts` — Orchestrator: creates services, composes modules, manages lifecycle
- `routes/` — REST API routes grouped by domain (session, git, file, openspec, system)
- `event-wiring.ts` — Pi gateway → browser gateway event forwarding
- `idle-timer.ts` — Auto-shutdown idle timer
- `session-bootstrap.ts` — Startup session discovery and OpenSpec polling init
- `extension-register.ts` — Auto-registers bundled bridge extension in pi's global settings (`~/.pi/agent/settings.json`) on startup; no-op in dev mode
- `browser-handlers/` — Browser WebSocket message handlers by domain (subscription, session-actions, session-meta, terminal, directory)

### 3. Web Client (`src/client/`)
A React-based responsive web UI that:
- Shows all active sessions organized by directory, with pinned directories always visible at the top
- Renders chat messages with markdown, syntax highlighting, and streaming
- Persists scroll position per session — switching sessions restores exact scroll position if locked, or scrolls to bottom if following
- Displays collapsed tool call steps with lazy-loaded content and elapsed time badges
- Shows live ticking elapsed counters on running operations (thinking, tool calls) and final duration on completed ones
- Provides command autocomplete with `/` prefix
- Supports bidirectional interaction (send prompts, run commands)
- Works on mobile with responsive layout and swipe gestures
- Shows an onboarding `LandingPage` whenever the main pane is empty, narrating the three steps needed to go from install → first running session (Setup credentials → Add folder → Start session). Each step is a card in **pending**, **done**, or **locked** state, derived purely from client state: `useProvidersReady()` (from `GET /api/providers`), `pinnedDirectories.length`, and `sessions.size`. Satisfied steps collapse to single-line ✔ rows, so returning users see a compact status strip rather than a full onboarding wall. The `PinDirectoryDialog` used by Step ② is mounted once at the app root in `App.tsx` and shared with the sidebar "Add folder" button via a single `onOpenPinDialog` callback.

### 4. Shared Types (`src/shared/`)
TypeScript type definitions shared across all components:
- `protocol.ts` - Extension↔Server WebSocket messages
- `browser-protocol.ts` - Server↔Browser WebSocket messages (includes PromptBus messages: `prompt_request`, `prompt_dismiss`, `prompt_cancel`)
- `types.ts` - Data models (Session, Workspace, Event, etc.)

## Data Flow

### Event Flow (pi → browser)
1. Pi emits event (e.g., `message_update`)
2. Bridge extension converts to `event_forward` protocol message
3. Server receives, stores in in-memory buffer, assigns sequence number
4. Server broadcasts to all subscribed browsers via `event` message
5. Browser's event reducer processes event, React renders update

### Interactive UI Flow (PromptBus — extension dialog → browser → response)
1. Extension calls `ctx.ui.confirm()` / `select()` / `input()` / `editor()`
2. Bridge PromptBus intercepts via patched `ctx.ui` methods, creates a `PromptRequest` with a unique `promptId` and `pipeline` tag (e.g. `"command"`, `"architect"`)
3. Registered adapters claim the prompt:
   - `DashboardDefaultAdapter` (always registered) returns a `PromptClaim` with `component: { type: "generic-dialog", props }` and `placement: "inline"`
   - Custom adapters (e.g. `ArchitectUIAdapter` from pi-flows) can claim with custom component types and widget-bar placement
   - TUI adapters (registered via `prompt:register-adapter` event) can claim to show a terminal dialog
4. Bus sends `prompt_request` to server with the winning adapter's component info
5. Server forwards to subscribed browsers
6. Browser's `prompt-component-registry.ts` resolves the component type to a React renderer and placement
7. User responds in browser → `prompt_response` sent to server → routed to bridge
8. Bus resolves the original dialog promise and calls `onResponse()` on all adapters for cleanup

**First-response-wins (multi-adapter):**
- Multiple adapters can claim the same prompt (e.g. TUI + dashboard)
- The first adapter to respond wins; the bus sends `prompt_dismiss` to the server for the losing adapter's dashboard component
- Adapters implement `onCancel()` for cleanup when another adapter wins

**Custom UI components:**
- Extensions register adapters via `pi.events.emit("prompt:register-adapter", adapter)`
- Adapters return custom `PromptClaim` with arbitrary component types (e.g. `"architect-prompt"`)
- Client-side registry maps type strings to render placement; unknown types fall back to `"generic-dialog"`

**Message passthrough:**
- The `message` field from `ask_user` tool (and other `ctx.ui` callers) is forwarded via `metadata.message` in the PromptBus request, through the `prompt_request` protocol message, and extracted by the client into the interactive renderer's `params.message`.

**Type safety:**
- `prompt_request`, `prompt_dismiss`, and `prompt_cancel` **must** be in the `ServerToBrowserMessage` union in `browser-protocol.ts`. If they are only handled via `case "..." as any:` in switch statements, esbuild's dead-code elimination will strip the handlers in production builds, silently breaking the interactive UI.

**Resilience:**
- **Page refresh**: Server replays pending `prompt_request` messages when a browser subscribes. Client deduplicates by `requestId` or pending title match.
- **Bridge reconnect**: Bridge replays pending PromptBus requests on WebSocket reconnect so dashboard dialogs survive server restarts.

### Command Flow (browser → pi)
1. User types prompt or command in browser
2. Browser sends `send_prompt` via WebSocket
3. Server routes to correct bridge extension by sessionId
4. Bridge extension's command handler parses input for pi command prefixes:
   - `!!<cmd>` → silent bash execution via `pi.exec()`, result as `bash_output` event
   - `!<cmd>` → bash execution via `pi.exec()`, result as `bash_output` event + send to LLM
   - `/compact [instructions]` → `ctx.compact()`, feedback as `command_feedback` event
   - `/<command>` → `session.prompt()` for extension commands/skills/templates (fallback to `sendUserMessage()`)
   - Colon-to-hyphen aliasing: `/opsx:continue` resolves to `opsx-continue.md` template (both `:` and `-` forms work)
   - Plain text → `pi.sendUserMessage()` (default)
5. Pi processes the command, events flow back via event flow

### Flow Dashboard Data Flow (pi-flows → browser)
pi-flows runs multi-agent workflows in-process. Subagent sessions use `SessionManager.inMemory()` and don't bootstrap the bridge, so flow data must be explicitly forwarded by the parent session's bridge.

1. pi-flows `EventEmitObserver` emits `flow:*` events on `pi.events` (all 10 `FlowObserver` callbacks)
2. Bridge extension listens to `flow:*` events and forwards as `event_forward` messages with `flow_*` event types
3. Server stores events, extracts flow metadata to `DashboardSession` fields (`activeFlowName`, `flowAgentsDone`, `flowAgentsTotal`, `flowStatus`)
4. Browser event reducer builds client-side `FlowState` (agents map, tool history, detail entries)
5. React renders `FlowDashboard` (sticky card grid above ChatView), `FlowAgentDetail` (replaces chat), `FlowSummary` (post-completion)

**Flow controls (browser → pi-flows):**
- Abort: browser sends `flow_control { action: "abort" }` → server → bridge → `pi.events.emit("flow:abort")` → `flowManager.abort()`
- Autonomous toggle: browser sends `flow_control { action: "toggle_autonomous" }` → same path → `setAutonomousMode()`

### Force Kill Escalation
The Stop button supports two-click escalation for stuck sessions:
1. **Click 1 (Abort)**: Sends `abort` → bridge → `ctx.abort()`. Button transitions to orange pulsing "Force Stop".
2. **Click 2 (Force Kill)**: Sends `force_kill` → server delegates termination to the **platform layer** (`packages/shared/src/platform/process.ts::killProcess(pid, { timeoutMs: 2000 })`), which:
   - on **Windows** runs `taskkill /F /T /PID <pid>` (genuine tree kill — descendant `node.exe`, pi children, tmux panes, `wt` tabs, code-server subtrees all die together),
   - on **POSIX** sends `SIGTERM`, polls liveness every 200ms for up to 2s, then escalates to `SIGKILL` if the process is still alive.

   Session marked "ended" (not removed), resumable via fork/continue.

The bridge includes `process.pid` in `session_register` so the server can kill the process. The server also force-closes the bridge WebSocket and uses the headless PID registry as a fallback. If no PID is available, only the WebSocket is closed.

### Platform-routed kill paths
All process termination across the codebase goes through `packages/shared/src/platform/process.ts`. No code outside that module may call `process.kill(...)` directly — enforcement is handled by `packages/shared/src/__tests__/no-direct-process-kill.test.ts`, a repo-level lint that scans every `.ts` file under `packages/*/src/` and fails CI if a direct call slips in. The three canonical helpers are:

| Helper | POSIX | Windows |
|--------|-------|---------|
| `isProcessAlive(pid)` | `kill(pid, 0)` | same |
| `killProcess(pid, {timeoutMs})` | SIGTERM → wait → SIGKILL (tree via pgroup) | `taskkill /F /T /PID <pid>` |
| `killPidWithGroup(pid, sig)` | `kill(-pid, sig)` (process group) | `kill(pid, sig)` (leaf) |

Sites routed through these helpers: `session-action-handler.ts::handleForceKill`, `process-scanner.ts::killProcessByPgid`, `tunnel.ts::cleanupStaleZrok` + `deleteTunnel`, `editor-manager.ts::stop`, `headless-pid-registry.ts`, `server-pid.ts`. See specs: [`command-executor`](../openspec/specs/command-executor/spec.md), [`force-kill-handler`](../openspec/specs/force-kill-handler/spec.md).

`taskkill` is invoked via the platform's `execSync` wrapper (`platform/exec.ts`) so it inherits `windowsHide: true` — no console flash — and stays consistent with the `no-direct-child_process-import` invariant.

Inline stop buttons also appear on running tool cards in `ToolCallStep`, providing contextual abort access right where the stuck command is visible.

### Repeated Tool Call Collapsing
Consecutive tool calls with the same name and identical args (e.g. health check polling loops) are collapsed into a single expandable group showing a count badge (e.g. "×24"). Implemented via `groupConsecutiveToolCalls()` in the chat rendering pipeline. Groups require 3+ calls; running tools are never grouped.

**Fork decisions and subagent ask_user:**
- Work through PromptBus — `TuiFlowIOAdapter` calls `ctx.ui.select/confirm/input` which the bridge routes through the bus to registered adapters (dashboard, TUI, or custom)

**Flow launcher:**
- Available flows detected from session commands list (heuristic: `source: "extension"`, excluding management commands)
- Launch dispatched as `send_prompt` with `/<flow-name> <task>`
- Commands list auto-refreshed on `flow:rediscover` and `flow:complete` events

**pi-flows local patches required** (upstream report prepared):
- `EventEmitObserver`: 5 missing methods added (flow-started, agent-started, agent-complete, assistant-text, thinking-text)
- `index.ts`: `flow:abort` and `flow:toggle-autonomous` event listeners added
- `flow-tui.ts`: `autonomousMode` included in `flow:flow-started` event data

### Auto-Resume on Prompt
When a user sends a prompt to an ended session, the server automatically resumes it:
1. Server detects `send_prompt` for a session with `status === "ended"` and a valid `sessionFile`
2. Prompt is queued in `PendingResumeRegistry` (keyed by cwd, 30s expiry)
3. Session is set to `resuming: true`, card shows pulsing yellow dot + "Resuming…"
4. Server spawns `pi --session <file>` (continue mode)
5. `pi --session` reconnects with the same session ID — `session_register` sets status back to `"active"`
6. Server flushes queued prompt to the session and clears `resuming` flag
7. No navigation needed — user is already viewing the same session
8. On timeout (30s) or spawn failure, `resuming` flag is cleared and session returns to normal ended state
9. If user sends another prompt while already resuming, the queued prompt is updated without spawning a second process

### Model & Thinking Level Flow
1. Bridge sends current model and thinking level in `session_register` on connect
2. When user changes model (via `/model`), pi emits `model_select` event
3. Bridge enriches the event with current `thinkingLevel` from context before forwarding
4. Bridge also sends a `model_update` protocol message for session-level tracking
5. Server extracts model/thinkingLevel from events and `model_update`, broadcasts to browsers
6. Thinking level changes (via pi keybinding) are detected when `model_select` events fire, on reconnect, and immediately after `set_thinking_level` commands
7. Browser can send `set_thinking_level` to change thinking level remotely

### Context Usage Tracking
1. On each `turn_end`, the bridge calls pi's `ctx.getContextUsage()` API to get real-time context usage (tokens used + actual context window from the provider)
2. Bridge enriches the `turn_end` event with this `contextUsage` data before forwarding to the server
3. Server extracts `contextUsage` from the event data and passes it to `extractTurnStats()`, which includes it in the synthesized `stats_update` event
4. Server updates `session.contextTokens` and `session.contextWindow` and broadcasts to browsers
5. The `onChange` handler persists these values to `.meta.json` (debounced 1s)
6. On server restart, the scanner restores `contextTokens`/`contextWindow` from `.meta.json`
7. Client's event reducer stores `contextUsage` from `stats_update` events; `App.tsx` falls back to `session.contextTokens/contextWindow` for sessions without live reducer state
8. When real data is unavailable (e.g., old sessions without persisted context data), `state-replay.ts` and `session-stats-reader.ts` use `inferContextWindow()` to estimate context window from the model name

### Git Polling
1. Bridge polls git info every 30s (`git-info.ts`): branch, remote URL, PR number
2. Changes are sent to the server only when values differ from last poll
3. Server broadcasts updates to subscribed browsers

### Child Process Scanning
1. Bridge scans child processes every 10s via `process-scanner.ts` (two-phase: capture new PGIDs during active bash calls, then check tracked PGIDs)
2. Only processes running ≥30s are reported (filters out short-lived commands)
3. Bash/sh wrapper processes are excluded (only leaf commands shown)
4. Bridge sends `process_list` to server only when the PID set changes (dedup)
5. Server stores processes on the session object and forwards to subscribed browsers as `process_list_update`
6. New browser connections receive current processes via the initial `session_added` message
7. Session cards display processes with elapsed time and a kill button (sends SIGTERM to process group)

### OpenSpec Polling (Server-Side)
1. Server's DirectoryService polls `openspec` CLI every 30s for each known directory (union of pinned dirs + session cwds)
2. OpenSpec data is keyed by directory (cwd), not by session — one poll per directory regardless of session count
3. Changes are broadcast to all connected browsers via `openspec_update { cwd, data }`
4. Browsers can request immediate refresh via `openspec_refresh { cwd }`
5. New directories (pinned or from new sessions) trigger immediate discovery + polling
6. Each `OpenSpecChange` carries an optional `isComplete?: boolean` field forwarded straight through from `openspec status --change <name> --json`. It indicates artifact-authoring completeness only — orthogonal to the task tally — and never feeds `deriveChangeState`. The dashboard uses it solely to gate the **Archive anyway** escape hatch (see “OpenSpec session card”).

### OpenSpec session card UI

The attached-change row on every session card has four affordances driven by the polled `OpenSpecChange`:

- **State pill** — `StatePill.tsx` renders `deriveChangeState(change)` as a small color-coded pill (`PLANNING`=zinc, `READY`=blue, `IMPLEMENTING`=amber, `COMPLETE`=green) next to the `📋 <name>` badge. Hidden when the attached change isn't present in OpenSpec data (e.g. archived under another name).
- **Tasks popover** — a `Tasks N/M` action button appears whenever the change has at least one parseable task. Clicking opens `TasksPopover.tsx`, a portal-rendered popover that lists every `- [ ] / - [x]` line in `tasks.md`, grouped by `## ` heading, with native checkboxes. Toggling a checkbox issues an optimistic `POST /api/openspec/tasks/toggle`; HTTP 409 (the file changed under us) refetches and surfaces a “File changed — please try again” banner. After every successful toggle the server re-polls openspec for that cwd and broadcasts the standard `openspec_update`, so card counts (`30/33` → `31/33`) refresh without a manual reload.
- **Archive anyway** — when `state === IMPLEMENTING && change.isComplete === true && allArtifactsDone`, an overflow `⋯` button appears on the action row. The single menu item opens a `ConfirmDialog` reading `"<unchecked> of <total> tasks are unchecked. Archive anyway?"`. Confirming dispatches `/opsx:archive <name>` through the normal `onSendPrompt` path. The default Apply button is unaffected; this is purely an escape hatch for changes whose remaining tasks are manual-verification items the user owns.
- **Bulk Archive relocation** — the Bulk Archive button now appears **only on unattached sessions** that have at least one folder change with `status === "complete"`. It is removed from the attached-session action row to free up space; the folder-level Bulk Archive in `FolderOpenSpecSection` is unchanged.

**Server endpoints (localhost-guarded, registered alongside the existing openspec routes in `packages/server/src/routes/openspec-routes.ts`):**

- `GET /api/openspec/tasks?cwd=<abs>&change=<name>` — parses `<cwd>/openspec/changes/<name>/tasks.md` via `parseTasksMarkdown` (top-level `- [ ] <id> <text>` / `- [x] <id> <text>` only; everything else is ignored). Returns `{ success: true, data: { tasks: OpenSpecTask[], groups: string[] } }`. 404 when the file is missing, 403 when the network guard denies.
- `POST /api/openspec/tasks/toggle` — body `{ cwd, change, id, done, line }`. Reads the file, validates that `line` still contains the requested `id` and the *opposite* state (optimistic-concurrency check), rewrites only that one line's `[ ]`/`[x]` marker, and atomic-writes via `tmp + rename` so other lines are preserved byte-for-byte. Maps typed errors to HTTP: `NotFoundError` → 404, `LineMismatchError` → 409, `NotACheckboxError` → 400. On success, fires a fire-and-forget `directoryService.refreshOpenSpec(cwd)` followed by an `openspec_update` broadcast.

### File Read API
The server exposes `GET /api/file?cwd=...&path=...` for reading files or listing directories from session working directories. Guards: localhost-only, cwd must match a known session, resolved path must stay inside cwd. Returns `{ type: "file", content }` or `{ type: "directory", entries }`.

### Filesystem Browser (PathPicker)

The dashboard's reusable directory chooser (`PathPicker`) is backed by two localhost-only endpoints:

- `GET /api/browse?path=<dir>&q=<query>` — lists subdirectories of `<dir>` (or `$HOME` when omitted), with `.git` / `.pi` detection. When `q` is non-empty, entries are case-insensitive substring-filtered and ranked:
  - **Tier 0** exact match → **Tier 1** prefix → **Tier 2** word-boundary substring (after `-`, `_`, `.`, space, `/`) → **Tier 3** plain substring.
  - Alphabetical within each tier. The 200-entry cap is applied **after** filter+rank so best matches always survive truncation.
- `POST /api/browse/mkdir` body `{ parent, name }` — creates a new directory non-recursively (`fs.mkdir` without `recursive: true`). Name validation rejects `/`, `\`, `\0`, `.`, `..`, empty, and leading/trailing whitespace. Errors map to 400 (`invalid name`, `parent is not a directory`), 404 (`parent not found`), 409 (`already exists`).

Client-side, `PathPicker` debounces the `q` request at 150ms and cancels in-flight requests via `AbortController`. Enter/Select follow a strict state machine instead of confirming arbitrary input:

1. Exact case-insensitive match against a visible entry → `onSelect(<entry.path>)` + close.
2. Input ends with `/` and its parsed parent equals the fetched directory → `onSelect(inputValue)` + close.
3. Exactly one filtered candidate → complete to `<path>/` (do not close).
4. Otherwise → no-op with a 300ms red-border flash.

If a debounced query is still pending when Enter fires, the client flushes it synchronously before evaluating the rules so the freshest server result is considered.

New folders can be created from two entry points — a footer **＋ New folder** button (inline name entry), or an inline **＋ Create "<name>" here** row shown when the typed partial has no exact match. The create-here row is suppressed if the parsed parent differs from the last-successfully-fetched directory (prevents creating inside a stale parent after a mid-path typo). On success the picker refetches and descends into the new directory.

### Pi Resources Browser

The dashboard can display pi extensions, skills, and prompts installed for each workspace. The server-side scanner (`pi-resource-scanner.ts`) discovers resources from three sources:

1. **Local**: `<cwd>/.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`
2. **Global**: `~/.pi/agent/extensions/`, `skills/`, `prompts/`
3. **Packages**: Resolved from `packages[]` in both `<cwd>/.pi/settings.json` and `~/.pi/agent/settings.json` — supports npm, git, and local path packages with pi manifest or conventional directory fallback

Metadata is parsed from SKILL.md YAML frontmatter (`name`, `description`), prompt frontmatter, and `package.json`. Results are cached in DirectoryService and polled every 30s alongside OpenSpec.

**API endpoints:**
- `GET /api/pi-resources?cwd=...` — returns grouped resources (local, global, packages) from cache
- `GET /api/pi-resource-file?path=...` — reads resource files from allowed locations (`.pi/`, `~/.pi/agent/`, `node_modules/`, `.pi/git/`)

**Package Management:**
- `GET /api/packages/search?q=&type=` — proxied npm search for `keywords:pi-package`, cached 5min
- `GET /api/packages/readme?pkg=` — fetch package README from npm registry
- `GET /api/packages/installed?scope=global|local&cwd=` — list installed packages via pi's `PackageManager`
- `POST /api/packages/install` — install package (returns 202 + operationId, streams progress via WS)
- `POST /api/packages/remove` — remove package (same async pattern)
- `POST /api/packages/update` — update packages (same async pattern)
- `POST /api/packages/check-updates` — check for available updates (on-demand)

Package operations use pi's `DefaultPackageManager` API on the server, serialized (one at a time, 409 on concurrent). Progress events are forwarded to browsers via `package_progress` WebSocket messages. After any successful operation, the server sends `/reload` to all connected pi sessions.

**Pi Core Version Check (separate from extension management):**
- `GET /api/pi-core/versions[?refresh=true]` — returns `PiCoreStatus` with all discovered pi ecosystem CLI packages (pi itself, pi-dashboard, pi-model-proxy, bare `pi-*` and scoped `@x/pi-*`), their installed version, latest npm-registry version, `updateAvailable` flag, and `installSource` (`"global"` via `npm list -g --depth=0 --json` vs `"managed"` in `~/.pi-dashboard/node_modules/`). Cached 5 min.
- `POST /api/pi-core/update` with `{ packages?: string[] }` — updates the listed packages, or all packages with `updateAvailable` when omitted. Runs `npm update -g <pkg>` (global) or `npm update <pkg>` in `~/.pi-dashboard/` (managed). Shares the `PackageManagerWrapper.runExclusive()` busy-lock with extension operations — returns 409 on contention.

Why a separate system? Pi's `DefaultPackageManager` only manages packages listed in `settings.json packages[]` (extensions/skills/prompts/themes). The pi CLI binary itself and the dashboard server package are installed directly via `npm -g` (or into `~/.pi-dashboard/` in the Electron case) and are invisible to pi's manager. `PiCoreChecker` + `PiCoreUpdater` (`pi-core-checker.ts` + `pi-core-updater.ts`) fill that gap.

Progress for core updates is delivered via typed `pi_core_update_progress` / `pi_core_update_complete` browser-protocol messages (not the `package_progress` channel) and fanned out to `PiCoreVersionsSection` and `PiUpdateBadge` via a `pi-core-event` DOM event. After any successful core update the server sends `/reload` to connected pi sessions just like extension updates.

**Header badge**: `PiUpdateBadge` polls `/api/pi-core/versions` on mount + every 30 min. When `updatesAvailable > 0` it renders a small pill-shaped button next to the `ServerSelector` that navigates to `/settings?tab=packages`.

**Client navigation stack:**
- Puzzle icon button in folder header → PiResourcesView (content area, "Installed" / "Packages" tabs)
- "View" button on resource → MarkdownPreviewView (`.md` as markdown, `.ts` as code block)
- Settings → Packages tab → inline PackageBrowser for global package management
- Back buttons pop the stack: Preview → Resources → Chat

### Git Branch Selector

The dashboard provides a git branch selector at the folder group level. Clicking the branch icon in `GroupGitInfo` opens a typeahead `BranchPicker` dialog. The flow supports three states:

1. **No git repo**: Dimmed icon labeled "Init git" — clicking triggers `POST /api/git/init`
2. **Detached HEAD**: Shows short commit SHA — clicking opens the branch picker
3. **Normal branch**: Shows branch name — clicking opens the branch picker

**Server API endpoints** (all localhost-only in `git-operations.ts`):
- `GET /api/git/branches?cwd=...` — lists local + remote branches sorted by committer date
- `POST /api/git/checkout` — switches branch; returns 409 with dirty file list if working tree is dirty
- `POST /api/git/init` — initializes a git repository
- `POST /api/git/stash-pop` — pops the most recent stash, reports conflicts

**Checkout flow**: Clean checkout closes immediately. Dirty working tree → client shows file list + "Stash & Switch" button → stash + checkout → asks "Pop stash on new branch?" with explicit Yes/No. Remote branches auto-create local tracking branches.

### Session File Diff View

The dashboard provides a GitHub-style file diff viewer for sessions. It shows what files a session has changed, with per-change drill-down.

**Data flow**: `GET /api/session-diff?sessionId=xxx` (localhost-only) scans session events for Write/Edit tool calls, extracts file paths and change data, optionally enriches with `git diff HEAD` output. Returns `SessionDiffResponse` with files, per-file change events (timestamps + context messages), and optional git diffs.

**UI**: Split-pane content-area view (replaces ChatView when active). Left panel shows a two-level file tree — files with status indicators, expandable to show individual change events with timestamps and assistant message context. Right panel renders diffs via `@git-diff-view/react` with `@git-diff-view/lowlight` syntax highlighting. Supports split/unified diff modes and a file content view toggle.

**Entry point**: "Changed Files" button in SessionHeader (only visible when Write/Edit tool events exist). Works for both active and ended sessions.

### Markdown Preview View
The web client includes a generic `MarkdownPreviewView` component that replaces the chat area. It supports a back button, title, optional tab bar, and loading/error states. For OpenSpec artifacts, the `useOpenSpecReader` hook maps artifact IDs (P/S/D/T) to file paths, fetches content via the file API, and concatenates specs from subdirectories.

### Archive Browser
The `ArchiveBrowserView` provides a searchable, date-grouped listing of archived OpenSpec changes. It uses a dedicated `GET /api/openspec-archive?cwd=<path>` endpoint that scans `openspec/changes/archive/` and returns entry metadata (name, date, artifacts). The view uses two-level navigation: the list is the first level, and clicking an artifact letter (P/D/S/T) opens the reader as the second level. Back from the reader returns to the list (preserving search and scroll), and back from the list returns to the session view. Entry point is the `[Archive]` button in `FolderOpenSpecSection`.

### Content View Management

The content area (right panel) shows one view at a time: ChatView, ArchiveBrowserView, SpecsBrowserView, PiResourcesView, MarkdownPreviewView (readme, pi resource file, flow YAML, OpenSpec artifact), FileDiffView, FlowArchitectDetail, or FlowAgentDetail. Each view is controlled by independent state in `App.tsx` and `useContentViews`. A priority chain in the JSX determines which view renders (first truthy state wins).

**Mutual exclusivity**: A `clearAllContentViews()` helper resets all content view states. It is called before opening any new content view, ensuring the previous view is always dismissed. This combines `clearAppContentViews()` (App-level states: preview, specs browser, archive browser, diff view, flow YAML, architect detail, flow agent detail) with `clearContentViews()` from `useContentViews` (pi resources, pi resource file preview, readme preview).

**Session switch**: When the selected session changes, `clearAllContentViews()` is called to dismiss any open content view.

**Sub-navigation**: `handleViewPiResourceFile` (viewing a file within PiResourcesView) does not clear other views — it's sub-navigation within an already-active content view.

**`onBeforeOpen` callback**: `useContentViews` accepts an optional `onBeforeOpen` callback. When `handleOpenPiResources` or `handleViewReadme` opens a new top-level view, it calls `onBeforeOpen` first so App.tsx can clear its own states, then clears the hook's sibling states internally.

### Network Access Control

The server has a two-layer access model:

**Layer 1: Network Guard (`createNetworkGuard`)** — Fastify `preHandler` on all sensitive routes. Allows requests via three paths:
1. **Loopback** — `127.0.0.1`, `::1`, `::ffff:127.0.0.1` (always allowed)
2. **Trusted networks** — IPs matching `resolvedTrustedNetworks` (CIDR, wildcard, exact). Configured via top-level `trustedNetworks` in config, merged with `auth.bypassHosts` at load time.
3. **Authenticated** — `request.isAuthenticated === true` (set by auth `onRequest` hook via `decorateRequest`)

Otherwise → 403. The guard strips `::ffff:` IPv4-mapped prefixes before matching.

**Layer 2: Auth Plugin (`onRequest` hook)** — Only registered when `auth` is configured. Skips loopback, trusted networks, `/auth/*`, `/api/health`, and `bypassUrls`. Validates JWT cookie for all other requests. Tags valid requests with `request.isAuthenticated = true`.

**Execution order**: `onRequest` (auth) → `preHandler` (guard) → handler. This means the auth hook tags the request before the guard checks it.

**WebSocket upgrades** follow the same logic: loopback → trusted network → JWT cookie validation.

**Zrok tunnel** connections appear as `127.0.0.1` (zrok proxies to localhost), so both layers pass automatically.

**`GET /api/network-interfaces`** returns detected non-internal IPv4 interfaces with computed CIDRs. Used by the Settings UI "Add Local Network" button. This endpoint uses the legacy `localhostGuard` (localhost-only, not network-guard-aware) since it exposes machine network topology.

### OAuth Authentication Flow

Optional OAuth2 authentication protects the dashboard when accessed remotely.

1. Server loads `auth` config from `~/.pi/dashboard/config.json` at startup
2. If `auth.providers` has entries, the auth plugin registers routes, the `isAuthenticated` request decorator, and an `onRequest` hook
3. The `onRequest` hook skips localhost requests (`isLoopback`), trusted network IPs (`resolvedTrustedNetworks`), `/auth/*` paths, `/api/health`, and configured `bypassUrls` path prefixes
4. External requests without a valid `pi_dash_token` JWT cookie are redirected to `/auth/login`
5. `/auth/login` shows a provider picker (or auto-redirects if single provider)
6. OAuth callback exchanges code for token, fetches user info, validates against `allowedEmails`
7. On success, a signed JWT cookie is set (7-day expiry) and user is redirected back
8. WebSocket upgrade requests are also validated — external connections without valid cookie or trusted network get 401
9. Supported providers: GitHub (hardcoded endpoints), Google/Keycloak/OIDC (via OIDC discovery)

### Settings Panel
The web client includes a Settings panel (gear icon in sidebar header → `/settings` route) that lets users view and edit all dashboard configuration. The panel:
1. Loads config via `GET /api/config` (secrets redacted as `***`)
2. Renders grouped form fields: Server, Sessions, Tunnel, Trusted Networks, Authentication, Developer
3. Sends only changed fields via `PUT /api/config` (partial merge)
4. Server preserves `***` secrets (doesn't overwrite real values), writes to disk, and applies runtime-safe changes
5. Port/piPort changes flag `restartRequired` in the response

### Reconnection Flow
1. Browser reconnects with `subscribe` message including `lastSeq`
2. Server replays missed events from in-memory buffer in async batches of 50 with backpressure handling
3. Browser's event reducer processes replay, rebuilding state

### Bridge Reconnection (State Reset)
When a bridge extension reconnects (e.g., after `npm run reload` or network recovery):
1. Bridge sends `session_register` with `eventCount` to re-register the session
2. Server checks `canSkipWipe`: if the bridge's `eventCount` matches the server's `lastEntryCount` and events exist in the store, the wipe is skipped (fast reconnect path)
3. **Full replay path** (`canSkipWipe = false`): Server clears the in-memory event store, broadcasts `session_state_reset` to browsers, stores replayed events, and sends them as `event_replay` batch after `replay_complete`
4. **Skip replay path** (`canSkipWipe = true`): Server keeps existing events in the store, marks the session in `skipReplayInsert` set so replayed events are NOT re-inserted (preventing exponential duplication). Status updates are still processed for session state accuracy. After `replay_complete`, the `event_replay` batch is skipped since browsers already have the events.
5. Bridge replays full session history as individual `event_forward` messages
6. Bridge sends `replay_complete` to signal replay is done
7. If the agent is currently mid-turn (bridge tracks `isAgentStreaming` flag in persistent `BridgeState`), a synthetic `agent_start` event is sent after `replay_complete` so the session card shows "Thinking…" instead of "Waiting for input"
8. Server clears the replaying flag, broadcasts the final accumulated session status
9. Browser rebuilds state cleanly from the replayed events (full replay) or continues with existing state (skip replay)

Without the `session_state_reset` message (full replay path), replayed events would duplicate existing messages in the browser's accumulated state.

**Replay status suppression**: During step 5, replayed events like `agent_start`/`agent_end` would normally trigger rapid `session_updated` broadcasts (e.g., `status: "streaming"` → `status: "idle"` for each turn), causing visible flicker on session cards. The server suppresses these status broadcasts while replaying, accumulating them in the session manager. Only the final status is broadcast after `replay_complete`. A 5-second safety timeout ensures the flag is cleared even if `replay_complete` never arrives (e.g., older bridge versions).

**Agent streaming state recovery**: The bridge tracks `isAgentStreaming` in process-level `BridgeState` (survives reload). Set `true` on `agent_start`, `false` on `agent_end`/`session_shutdown`. Since the replay doesn't include `agent_start`/`agent_end` events, the session status would otherwise stay "active" (displayed as "Waiting for input") when the agent is mid-turn during reconnect.

### Session File Deduplication
When pi continues a session via `--session <file>`, it reuses the same JSONL file but may create a new session ID. The server detects this: when a new session registers with a `sessionFile` already associated with another session, the old session's `sessionFile` is cleared. This prevents the Resume button from loading the wrong conversation.

### Ghost Session Cleanup
When the bridge extension is loaded multiple times (e.g., local project + global npm package), duplicate connections can create "ghost" sessions — active sessions with no sessionFile and no events. The server detects and removes these:
- **Pi gateway**: When a `session_register` changes the connection's session ID, the old session is cleaned up if it has `source: "unknown"` or no `sessionFile`
- **Event wiring**: When `session_register` arrives, any active sessions in the same cwd that have no sessionFile, no events, aren't connected, and were created within 30s are removed as ghosts

### On-Demand Session Loading (Server-Side)
When a browser subscribes to a session whose events have been evicted from memory:
1. Server sends empty `event_replay` with `isLast: false` to indicate loading
2. Server's DirectoryService loads the session file directly via `SessionManager.open(sessionFile).getBranch()`
3. Entries are converted via `replayEntriesAsEvents()` and stored in the event buffer (truncated, capped at 5000/session)
4. Server sends `event_replay` in async batches with backpressure to all waiting browsers
5. If the session file is missing or corrupt, server sends `dataUnavailable: true`
6. Concurrent loads for the same session are deduplicated

### Flows Refresh Deduplication
When a session sends `flows_list`, the server notifies other sessions in the same cwd to rediscover flows. To prevent infinite loops (A→refresh B→B sends flows→refresh A→...), a per-session 5-second cooldown (`recentFlowsRefresh` set) suppresses duplicate refresh requests.

### Event Broadcast During Replay
During bridge session replay (while `replayingSessions` set contains the session), `event_forward` messages are stored but NOT broadcast individually to browser subscribers. Instead, when `replay_complete` arrives (or the 5s safety timeout fires), the server sends all accumulated events as a single `event_replay` batch to subscribers. This prevents per-event serialization overhead during replay while still delivering the full history to browsers.

## Persistence

| Data | Storage | Details |
|------|---------|---------|
| Events | In-memory Map | LRU eviction, max 100 sessions. Pinned if active bridge or browser subscribers. |
| Sessions | In-memory Map + `.meta.json` | In-memory registry. Each session's state cached in per-session `.meta.json` sidecar next to `.jsonl`. On startup, `session-scanner.ts` scans `~/.pi/agent/sessions/*/` to restore all sessions from cached meta. |
| Session meta | `~/.pi/agent/sessions/…/<id>.meta.json` | Per-session sidecar: dashboard-owned state (name, attachedProposal, hidden, source) + cached stats (tokens, cost, model, status). Debounced per-session writes (max 1/sec). Stale cache detected via `cachedAt` vs `.jsonl` mtime. |
| Pinned directories | `~/.pi/dashboard/preferences.json` | Ordered array of cwd paths. Pinned dirs always visible in sidebar. |
| Session order | `~/.pi/dashboard/preferences.json` | Per-cwd ordering managed by `session-order-manager.ts`. |
| Server PID | `~/.pi/dashboard/server.pid` | Tracks running server process for daemon management. |
| Headless PIDs | `~/.pi/dashboard/headless-pids.json` | Maps spawned headless processes to sessions. Unix: `tail -f /dev/null \| pi --mode rpc` (uses tail instead of sleep to avoid stdin pipeline bug). Windows: `pi.cmd --mode rpc` with `shell: true` and quoted paths for spaces in usernames. |
| Bridge extension | `~/.pi/agent/settings.json` | On bundled installs (Electron DEB/DMG), the server auto-registers the bridge extension path in pi's global settings so all spawned pi sessions discover and load it. No-op in dev mode. |
| Session files | `~/.pi/agent/sessions/` (pi's own) | Source of truth. Bridge loads on demand. |

## Configuration

Precedence: CLI flags → environment variables → config file (`~/.pi/dashboard/config.json`)

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | 8000 | HTTP + Browser WebSocket port |
| `piPort` | 9999 | Pi extension WebSocket port |
| `autoStart` | true | Bridge extension auto-starts server if not running |
| `autoShutdown` | false | Server shuts down after idle period (disabled by default; enable for TUI auto-start scenarios) |
| `shutdownIdleSeconds` | 300 | Idle timeout before auto-shutdown |
| `spawnStrategy` | `"headless"` | How to spawn new sessions: `"headless"` or `"tmux"` |
| `tunnel.enabled` | true | Enable zrok tunnel for remote access |
| `tunnel.reservedToken` | _(auto)_ | Reserved zrok share token for persistent URL (auto-created on first run) |

### Tunnel Lifecycle

The tunnel is **enabled by default** (`tunnel.enabled: true`). When the server starts:

1. **Binary detection** — `detectZrokBinary()` checks if `zrok` is on PATH via `which`/`where`
2. **Environment check** — `loadZrokEnv()` reads zrok's own config (`~/.zrok2/environment.json` or `~/.zrok/environment.json`) to verify enrollment. The dashboard never stores zrok API keys — they live entirely in zrok's config directory, created by `zrok enable <token>`.
3. **Stale cleanup** — Runs **unconditionally on startup** whenever the zrok binary is present (even in `--no-tunnel` mode) so leftovers from a previous run are always swept:
   - `cleanupStaleZrok()` reads `~/.pi/dashboard/zrok.pid` and SIGTERMs the tracked process
   - `scavengeOrphanZrokProcesses(port)` scans `ps -ax` for any `zrok share … --override-endpoint http://localhost:<port>` processes that escaped pid-file tracking (previous crashes, failed retries) and SIGTERMs them. Never kills the current process.
4. **Reserved share** — If `tunnel.reservedToken` is not set, `zrok reserve public` is called to create a persistent share token. The token is saved to config so the URL stays the same across restarts. If a saved token fails (e.g., expired or orphaned on the zrok edge), `releaseShare(token)` explicitly releases it and a new reservation is created automatically (capped at 1 retry to prevent cascades).
5. **Subprocess spawn** — `createTunnel(port, reservedToken?)` spawns `zrok share reserved <token> --headless` (or `zrok share public --headless` as fallback) as a child process. Concurrent calls are serialized via an in-flight promise (`pendingCreate`) so a UI double-click or a race between startup auto-connect and `/api/tunnel-connect` can’t create two parallel reservations.
6. **URL parsing** — The public URL is parsed from stdout/stderr (30s timeout). On timeout: SIGTERM → SIGKILL after 2s grace, plus `releaseShare(token)` if the token was reserved just-in-time within the call (prevents leaking a dead reservation that would leave a "live but broken" URL on the zrok edge).
7. **PID tracking** — The subprocess PID is written to `~/.pi/dashboard/zrok.pid`
8. **Shutdown** — `deleteTunnel(port?)` SIGTERMs the active subprocess, removes the PID file, and (when `port` is supplied) re-runs `scavengeOrphanZrokProcesses(port)` as belt-and-braces cleanup. The reserved token is preserved for next restart. Called from graceful shutdown, `/api/shutdown`, `/api/restart`, and `/api/tunnel-disconnect`.

To disable: set `tunnel.enabled` to `false` in `~/.pi/dashboard/config.json` or pass `--no-tunnel` on the CLI. When disabled, step 3 still runs so orphan processes are cleaned up even if the tunnel is turned off.

The client can query `GET /api/tunnel-status` which returns `{ status: "active"|"inactive"|"unavailable", url?, serverOs }`.
The client can connect/disconnect the tunnel via `POST /api/tunnel-connect` and `POST /api/tunnel-disconnect`.



### CORS

The Fastify CORS callback in `server.ts` allows:

- Same-origin navigations (no `Origin` header).
- `localhost`, `127.0.0.1`, `[::1]` on any port.
- The currently-active zrok tunnel URL (looked up dynamically via `getTunnelUrl()` so URL rotation picks up without a restart).
- Any `*.share.zrok.io` host (covers stale tabs, new reservations, and the brief window before `activeTunnelUrl` is populated on startup).
- Explicitly-configured `corsAllowedOrigins` from config.

On a mismatch the callback returns `cb(null, false)` — **not** `cb(new Error(…), false)`. The `Error` form causes `@fastify/cors` to surface the error as HTTP 500 on every asset response, which is exactly what caused the long-running “zrok returns 500 on assets” debugging saga: Vite emits `<script type="module" crossorigin>` entry tags, which per HTML spec browsers always fetch in CORS mode (even same-origin), so the tunnel URL appearing in `Origin` is unavoidable. Returning `cb(null, false)` simply omits CORS headers; the browser enforces same-origin policy on its own.

### HTTP Compression

The Fastify server registers `@fastify/compress` globally with `gzip` + `deflate` encodings (threshold 1 KB). Brotli is intentionally **not** enabled — zrok’s free public proxy has been observed to truncate/stream-reset `content-encoding: br` responses under parallel browser load (curl succeeds, Chrome reports `ERR_ABORTED 500`). gzip round-trips cleanly through zrok and is universally supported.

Additionally, the client build generates `.gz` sibling files (via `packages/client/scripts/precompress.mjs`, run from the `build` / `prepare` scripts) and `@fastify/static` is registered with `preCompressed: true`. This serves pre-compressed assets directly with a stable `Content-Length` header, avoiding any streaming-compression edge cases in intermediate HTTP/2 proxies. Dynamic compression via `@fastify/compress` still handles API responses and other non-file routes.

Combined with client bundle splitting (see `packages/client/vite.config.ts` → `rollupOptions.output.manualChunks`), the main initial chunk ships at ~150 KB gzipped (down from 3.1 MB uncompressed), well under tunnel abort thresholds.

### PWA Support

The dashboard is installable as a Progressive Web App on mobile devices:

- **Manifest** (`public/manifest.json`) — app name, icons, standalone display mode
- **Service Worker** (`public/sw.js`) — minimal fetch pass-through for installability
- **Tunnel/QR Button** — unified sidebar button: shows tunnel icon when zrok is not installed (click → setup guide), QR code icon when set up but disconnected (click → setup guide), green QR code icon when connected (click → QR dialog with disconnect and setup buttons)

| `devBuildOnReload` | false | Rebuild Vite client + restart server on `/reload` |

## Shared Config

Both the server CLI and bridge extension read from `~/.pi/dashboard/config.json` via a shared module (`src/shared/config.ts`). On first access, the config file is auto-created with defaults.

### Dev Mode with Production Fallback

When started with `--dev`, the server proxies client requests to the Vite dev server for HMR. If Vite is not running, it falls back to serving the production build from `dist/client/`. This means:
- `pi-dashboard start --dev` **always works** — no 502 errors
- If Vite is running → hot module replacement, fast iteration
- If Vite is not running → serves last production build silently
- Vite can be started/stopped independently without restarting the dashboard

### Graceful Restart

The `POST /api/restart` endpoint and `pi-dashboard restart` command perform fault-tolerant restarts:
1. Flush all pending state (meta persistence, preferences)
2. Spawn new server process
3. Wait for old server's port to become free (up to 10s)
4. Start new server with the same (or overridden) flags
5. Verify health via `/api/health` (up to 10s)
6. `pi-dashboard stop` also kills any stale processes holding the port (via `lsof`)

The restart endpoint accepts `{ dev: boolean }` to switch between dev/production mode.

### Cross-Platform Server Launch

The dashboard server is spawned via `node --import <loader> <cli.ts>` from three call sites (`packages/server/src/cli.ts` `cmdStart`, `packages/extension/src/server-launcher.ts` `launchServer`, `packages/electron/src/lib/server-lifecycle.ts` `launchServer`). On Node ≥ 20, Windows rejects raw absolute paths passed to `--import` because it parses the drive-letter prefix (e.g. `B:`) as a URL scheme (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). Every resolver therefore returns a `file://` URL, not a raw path:

- `packages/shared/src/resolve-jiti.ts` — `resolveJitiImport()` (anchor = `process.argv[1]`) and `resolveJitiFromAnchor(anchorPath)` (anchor supplied explicitly) both return `pathToFileURL(registerPath).href`
- `packages/electron/src/lib/server-lifecycle.ts` — `resolveJitiFromPi()` now imports `resolveJitiFromAnchor` from shared (previously duplicated; consolidated in the `consolidate-platform-handlers` change)
- `packages/server/src/cli.ts` — the tsx fallback wraps `esm/index.mjs` the same way

The URL form is cross-platform safe (Linux/macOS accept both raw paths and `file://` URLs) so no platform gating is needed in the resolvers.

#### stdout + stderr capture parity

Both server-launch call sites (`packages/server/src/cli.ts` and `packages/extension/src/server-launcher.ts`) capture **both** stdout and stderr into `~/.pi/dashboard/server.log`. The CLI uses `stdio: ["ignore", logFd, logFd]` on its direct `spawn()` call; the bridge uses `spawnDetached({ stdoutFd: logFd, logFd })`. Without this parity, crash diagnostics from jiti / Fastify / ajv-compiler that reach stdout would be invisible via the bridge path while remaining visible via the CLI path. See change: `fix-bridge-autostart-diagnostics`.

#### CJS preload for Fastify (nodejs/node#58515 mitigation)

Every server-spawn call site injects `--require <preload-fastify.cjs>` BEFORE `--import <jiti-loader>` in the child's argv, as long as the resolver `resolvePreloadFastifyPath()` in `packages/shared/src/platform/preload-fastify.ts` finds the preload file. The order matters: Node processes `--require` before `--import`, so the preload runs through Node's **legacy synchronous CJS loader** (which predates and bypasses the ESM→CJS translator). The preload synchronously `require()`s `@fastify/ajv-compiler/standalone`, `@fastify/ajv-compiler`, and `fastify` — populating `require.cache` with those modules in `kEvaluated` state.

When jiti's ESM hook later resolves an `import "fastify"`, Node's translator finds the modules already cached and short-circuits — it never enters the recursive require chain that triggers the `Unexpected module status 3` assertion on Node <22.18 / 24.1–24.2.

This is a **race-independent fix**: it doesn't try to close the timing window, it removes the racy code path from the execution trace. All four spawn sites (CLI daemon, bridge auto-start, Electron, restart orchestrator) share the resolver and the same injection pattern. See change: `preload-fastify-cjs`.

#### Node-version preflight

`packages/shared/src/platform/node-version-check.ts` exports `isKnownBadNode(version)` — a pure predicate flagging Node builds affected by [nodejs/node#58515](https://github.com/nodejs/node/issues/58515) (ESM loader assertion when Fastify's `@fastify/ajv-compiler` requires CJS modules). Affected ranges: `>=22.0.0 <22.18.0` and `>=24.1.0 <24.3.0`. Three consumers share the predicate:

- **CLI** (`cmdStart`) — emits a warning to stderr and appends it to `server.log` before spawning. Advisory only; CLI still proceeds.
- **Bridge auto-start** (`server-launcher.ts`) — `buildReadyTimeoutMessage()` includes an issue-#58515 upgrade hint in the failure notification when `waitForReady` times out on an affected Node.
- **Electron doctor** (`doctor.ts`) — "Node runtime compatibility" row shows `warning` with upgrade guidance.

`packages/server/package.json` declares `"engines": { "node": ">=22.18.0 <23 || >=24.3.0" }` as an npm-level advisory.

### Cross-OS Platform Primitives

Cross-OS behavior (`process.platform === "win32"` branches) is centralized in `packages/shared/src/platform/` (pure Node, consumed by server + extension + Electron). The module has an `index.ts` barrel plus per-concern files:

| File | Concerns |
|---|---|
| `binary-lookup.ts` | `where`/`which` dispatch, `.cmd` extension on Windows, managed-bin search, login-shell fallback. Exports `ToolResolver` class + pi/tsx/node resolve helpers. |
| `process.ts` | `findPortHolders` (netstat vs lsof), `killProcess` (taskkill tree on Windows, SIGTERM→SIGKILL on Unix), `isProcessAlive`, `killPidWithGroup` (negative-pid on Unix, positive on Windows). |
| `process-scan.ts` | `isProcessRunning` (tasklist vs pgrep), pure `parseEtime`. |
| `shell.ts` | `detectShell` (COMSPEC on Windows, SHELL on Unix, with fallbacks), `getTerminalEnvHints` (TERM=cygwin hint for node-pty on Windows). |
| `commands.ts` | `openBrowser` (`open`/`start`/`xdg-open`), `isVirtualMachine` (`sysctl`/`systemd-detect-virt`/`wmic`). |
| `detached-spawn.ts` | `spawnDetached` (libuv-correct detached defaults on every OS — on Windows, `detached: true` excludes the child from the parent's kill-on-close job for PGID-equivalent lifecycle), `waitForNoCrash` (short window: did the child survive?), `waitForReady` (positive probe: is it serving HTTP yet?). |
| `spawn-mechanism.ts` | `SpawnMechanism` enum (`tmux`/`wt`/`wsl-tmux`/`headless`) and pure `selectMechanism` selector. `buildWtArgs` builds argv for Windows Terminal `new-tab`. `sessionFlagsToArgv` is the uniform `--session`/`--fork` builder every mechanism MUST use so no branch drops options. |
| `process-identify.ts` | `findPidByMarker` + `isProcessLikePi` + `isPiCommandLine`. Unix implementations run `ps`/`/proc`; Windows stubs return empty/true because command-line lookup is delegated to `headlessPidRegistry`. |

Every exported helper that depends on OS takes an optional `platform: NodeJS.Platform` parameter (and usually `exec`/`kill`/`env` for full injection). Tests exercise both branches via these parameters rather than mutating `process.platform`. This is the pattern to follow for any new cross-OS primitives.

**Invariant guard:** `packages/shared/src/__tests__/no-direct-platform-branch.test.ts` scans all `packages/**/src/` for `process.platform === "<os>"` branches. Every violation must either move into a platform primitive or be listed in the documented allowlist (seeded with extension's process-scanner, Electron's dependency-detector/main/doctor/forge.config, server's process-manager/editor-registry/tunnel/browse, and the inference-comment in client's session-grouping).

Electron-bound presentation concerns (tray icons, menu template, dock behavior, bundled Node path) remain in `packages/electron/src/lib/` because they import from the `electron` package and cannot live in shared.

### Session spawn dispatch

Session spawning uses a two-tier type system:

- **`SpawnStrategy`** (user-visible, in `shared/config.ts`): `"tmux" | "headless"`. What the user wrote in their config.
- **`SpawnMechanism`** (internal, in `platform/spawn-mechanism.ts`): `"tmux" | "wt" | "wsl-tmux" | "headless"`. What the system actually runs on this platform given availability.

`selectMechanism({ platform, userStrategy, electronMode, available })` is the single pure function that maps (config, platform, availability) → mechanism. Rules:

1. `electronMode` → `headless`.
2. `userStrategy === "headless"` → `headless`.
3. Unix with tmux → `tmux`; Unix without → `headless`.
4. Windows: `wt` if available, else `wsl-tmux` if available, else `headless`.

Every mechanism branch forwards `sessionFile` + `mode` via the shared `sessionFlagsToArgv` helper; no branch may silently drop them. This was the root cause of the Windows fork/continue bugs fixed in `consolidate-windows-spawn-and-platform-handlers` — the WSL/cmd fallback paths in the old code invoked pi without `--fork`/`--session`, silently downgrading to a fresh session.

On Windows, `spawnDetached` uses `detached: true` which (via libuv's `src/win/process.c`) emits `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` and critically does NOT call `AssignProcessToJobObject` on the parent's global Job Object. This excludes the child from the parent's `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job, so pi sessions survive when the dashboard server exits — matching Unix PGID behavior. The `headlessPidRegistry` reconciles these survivors on server restart.

### Server Log Hygiene

The daemon log at `~/.pi/dashboard/server.log` is opened in **append mode** (`"a"`) so crash output from prior start attempts survives subsequent retries — essential for diagnosing silent failures. Each attempt writes a timestamped header to distinguish runs:

```
[2026-04-18T14:30:00.000Z] pi-dashboard start (parent pid 12345, port 8000)
[2026-04-18T14:30:02.000Z] bridge auto-start (parent pid 23456, port 8000)
```

Both `pi-dashboard start` (CLI) and the bridge extension's `launchServer` write to this file. Previously the extension used `stdio: "ignore"` (losing all error output) and the CLI opened the log with `"w"` (truncating prior runs); both were fixed in `fix-windows-server-parity`. On auto-start failure, the bridge now surfaces the log path in its `ui.notify` message so users can open the file directly.

### Auto-Start Flow

When `autoStart` is `true` (default), the bridge extension automatically starts the dashboard server:

```
pi session_start
       │
       ▼
  ensureConfig() → create ~/.pi/dashboard/config.json if missing
  loadConfig()   → read piPort, port, autoStart
       │
       ▼
  TCP probe localhost:{piPort}
       │
  ┌────┴────┐
  │ open    │ closed & autoStart=true
  │         │
  ▼         ▼
connect   spawn server (detached)
silently  pass --port & --pi-port
               │
               ▼
          notify user:
          "🌐 Dashboard started at http://localhost:{port}"
               │
               ▼
            connect
```

The server is spawned detached (`child_process.spawn` with `detached: true`, stdout/stderr redirected to `~/.pi/dashboard/server.log`), so it outlives the pi session. If multiple pi sessions start simultaneously, duplicate spawn attempts fail harmlessly with EADDRINUSE. After a failed launch, the bridge re-probes the port — if another agent started the server concurrently, the warning is suppressed. The auto-start logic is extracted into `server-auto-start.ts` for testability.

## mDNS Server Discovery

The dashboard uses mDNS (via `bonjour-service`) for zero-config server discovery:

### Discovery Chain
1. **mDNS browse** (2s timeout) — discover `_pi-dashboard._tcp` services on the local network
2. **Health check fallback** — `GET /api/health` on configured port, verifies `{ ok: true, pid }` response
3. **Auto-start** — if no server found and `autoStart` is enabled, spawn detached server

### Server Advertisement
- On startup, the server publishes a `_pi-dashboard._tcp` mDNS service with TXT record: `{ version, pid, piPort }`
- On shutdown, the service is unpublished
- A continuous mDNS browser discovers peer servers and broadcasts updates to connected browsers via `servers_discovered`/`servers_updated` WebSocket messages

### Bridge Discovery
- Bridge extensions use the mDNS discovery chain instead of bare TCP port probes
- `isDashboardRunning(port)` replaces `isPortOpen(port)` for identity-verified detection
- After auto-starting, the bridge waits up to 10s for the server's mDNS advertisement

### Known Servers
- Users can persist remote servers in `config.json` via `knownServers: KnownServer[]`
- Each entry has `host`, `port`, optional `label`, and `addedAt` timestamp
- REST API: `GET/POST/DELETE /api/known-servers` for CRUD, `POST /api/discover-servers` for on-demand mDNS scan
- Localhost is always implicitly available (not stored)
- The data model is extensible for future key exchange / auth tokens

### Server Selector UI
- The header dropdown shows persisted known servers (from config) plus localhost, not raw mDNS results
- Each entry shows label (or hostname), host:port, Local/Remote badge, and availability status
- Non-current servers are probed via health check when the dropdown opens
- Switching closes the current WebSocket and connects to the selected server
- Last-used server persisted in `localStorage` (`pi-dashboard-last-server`)

### Server Management (Settings Panel)
- **Known Servers section**: lists persisted servers with remove buttons and an inline add form (host, port, label)
- **Network Discovery section**: "Scan network" triggers `POST /api/discover-servers`, shows results with "Add" button that prompts for a label
- Already-known servers show "Already added" badge in discovery results
- Electron loading page shows known servers as fallback when primary server is unreachable

## Provider Authentication

The dashboard supports browser-based authentication with pi's LLM providers, enabling login from phones, tablets, or remote tunnel access without needing terminal access.

### Flow

1. **Settings UI** shows OAuth providers (Anthropic, Codex, GitHub Copilot, Gemini CLI, Antigravity) and API key providers
2. **Auth-code flow** (Anthropic, Codex, Gemini, Antigravity): browser opens popup → provider consent → callback HTML relays code via `postMessage`/`BroadcastChannel`/`localStorage` → server exchanges code for tokens using PKCE
3. **Device-code flow** (GitHub Copilot): server requests device code → UI shows user code + verification URL → server polls until authorized
4. **API key flow**: user pastes key in Settings → saved directly
5. All credentials written to `~/.pi/agent/auth.json` with lockfile + atomic write (`0600` permissions)
6. Server broadcasts `credentials_updated` to all connected bridges → bridges call `authStorage.reload()` so running pi sessions pick up new tokens immediately

### Key Files

| File | Purpose |
|------|--------|
| `src/server/provider-auth-handlers.ts` | Per-provider OAuth logic (PKCE, token exchange, project discovery) |
| `src/server/provider-auth-storage.ts` | auth.json read/write with file locking |
| `src/server/routes/provider-auth-routes.ts` | REST API for authorize, exchange, callback, device-code, API keys |
| `src/client/components/ProviderAuthSection.tsx` | Settings UI component |

## Terminal Emulator

The dashboard includes a browser-based terminal emulator for direct shell access.

### Architecture

```
Browser                              Server
┌────────────────┐            ┌──────────────────┐
│  xterm.js      │            │ TerminalManager   │
│  (per terminal)│◄──binary──►│  ├─ node-pty      │
│  FitAddon      │    WS      │  ├─ RingBuffer    │
│  AttachAddon   │            │  └─ clients Set   │
└────────────────┘            └──────────────────┘
```

### WebSocket Protocol

Each terminal has a dedicated binary WebSocket at `/ws/terminal/:id`:
- **Binary frames**: Raw terminal I/O (keystrokes client→server, PTY output server→client)
- **Text frames**: JSON control messages (`{ "type": "resize", "cols": N, "rows": N }`)

This is separate from the main JSON dashboard WebSocket (`/ws`).

### Terminal Lifecycle

1. Browser sends `create_terminal` on main WS → server spawns PTY via `node-pty`
2. Server broadcasts `terminal_added` to all browsers
3. Browser opens binary WS to `/ws/terminal/:id`, attaches `xterm.js`
4. Shell exit → PTY `onExit` → server broadcasts `terminal_removed` → card removed

**Native binary permissions.** `node-pty`'s prebuilt `spawn-helper` (and `pty.node`) must be executable for `pty.spawn` to succeed on macOS/Linux. Three layers of defense ensure this:

1. **Postinstall** — `packages/server/scripts/fix-pty-permissions.cjs` (wired at workspace-root `postinstall`) uses `require.resolve("node-pty/package.json")` to locate the dependency wherever npm placed it and sets mode `0o755` on every `prebuilds/*/spawn-helper` and `prebuilds/*/pty.node`.
2. **Electron bundle** — `packages/electron/scripts/bundle-server.sh` runs `find … -name spawn-helper -exec chmod +x` after `npm install` and removes macOS quarantine flags (`xattr -d com.apple.quarantine`) from native binaries.

### Bundled first-party extensions (Electron installer)

The Electron installer can optionally ship a curated subset of recommended pi extensions inside `resources/bundled-extensions/<id>/` so first-run works with zero network access. The set is declared by `BUNDLED_EXTENSION_IDS` in `packages/shared/src/recommended-extensions.ts` (currently `pi-anthropic-messages`, `pi-flows`) — a strict subset of `RECOMMENDED_EXTENSIONS`, enforced by a unit test.

**Build time** (`packages/electron/scripts/bundle-recommended-extensions.sh`): gated on `BUNDLE_RECOMMENDED_EXTENSIONS=1` (set in `.github/workflows/publish.yml`, unset everywhere else). Clones each id shallow, records the commit SHA to `.bundled-sha`, validates the SPDX identifier against a fixed allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC), and fails the build if the combined bundle exceeds 15 MB. `forge.config.ts` conditionally appends `./resources/bundled-extensions` to `extraResource` when the directory exists.

**First launch** (`installBundledExtensions()` in `dependency-installer.ts`): enumerates bundled subdirectories, and for each id whose `manager.getInstalledPath(source, "user")` is **not** already populated, copies the bundled tree into pi's git cache location (`~/.pi/agent/git/<host>/<path>/`), runs `npm install --omit=dev` if the package declares runtime dependencies, then calls `manager.addSourceToSettings(gitUrl)` + `settingsManager.flush()` so the original git URL is persisted in `~/.pi/agent/settings.json`. The function runs before `installRecommendedExtensions`, and its return value seeds that call's `skipPackages` set so already-bundled ids are reported with `output: "Already installed (bundled)"`. The wizard renders a distinct "Bundled ✓" badge for those rows and an "Installed" badge for entries that were already present from a prior CLI install (logic factored into the pure helper `wizard-badge.ts`).

**Why not simply `installAndPersist("local:")`?** Investigated in `packages/electron/scripts/spike-local-install.mjs`: pi has no `local:` scheme, and `installAndPersist(source)` always persists the exact source string it receives. Installing from a local path therefore persists the local path (breaking `manager.update()`) rather than the git URL. The copy-into-cache + `addSourceToSettings(gitUrl)` approach produces the same on-disk shape as a normal `installGit` run, so pi's later `update()` naturally replaces the bundled copy with upstream via `git fetch && reset --hard`. See design.md of change `bundle-first-party-extensions` for details.
3. **Runtime** — `packages/server/src/fix-pty-permissions.ts` runs once when `createTerminalManager()` is called. Uses `createRequire().resolve("node-pty")` to find the actual install location and fixes any non-executable `spawn-helper`.

A regression test (`packages/server/src/__tests__/fix-pty-permissions.test.ts`) asserts the current platform's helper is executable after install.

**Browser-gateway error visibility.** `browser-gateway.ts` distinguishes two failure modes when receiving a WebSocket frame: a `JSON.parse` error (silently dropped — garbage frames are normal on the open internet) and an exception thrown by an individual message handler (logged to stderr as `[browser-gw] handler error type=<msg.type>: <err>`). The connection stays open after handler errors so subsequent messages still flow. This stops failures like a broken `node-pty` `spawn` from manifesting as a silently dead UI button.

### Output Buffering

Each terminal maintains a 256KB ring buffer of raw PTY output. When a new WebSocket connects (reconnect, new tab), the buffer is replayed before live streaming. Combined with client-side 10,000-line scrollback.

### Keep-Alive

Terminal xterm.js instances stay mounted in the DOM (CSS hidden/shown) for instant switching without replay flicker. The binary WebSocket stays open while mounted.

### Folder-Scoped View

Terminals are displayed in a tabbed `TerminalsView` per folder, accessed via the folder action bar's `Terminals(N)` button. Terminal cards no longer appear in the sidebar — the sidebar shows only pi session cards. The tab bar supports switching, closing, renaming, and creating new terminals.

## Embedded Editor (code-server)

The dashboard supports embedding VS Code in the browser via code-server.

### Architecture

```
Browser                     Dashboard Server              code-server
┌──────────────┐         ┌─────────────────┐         ┌──────────────┐
│  EditorView  │         │  EditorManager  │         │  VS Code     │
│  (iframe)    │◄─HTTP──►│  EditorProxy    │◄─HTTP──►│  :10001      │
│              │  same   │  /editor/:id/*  │  local  │  (per folder)│
└──────────────┘  origin └─────────────────┘         └──────────────┘
```

### Lifecycle

1. User clicks `Editor` button in folder action bar → navigates to `/folder/:encodedCwd/editor`
2. `EditorView` sends `POST /api/editor/start` with `{ cwd }`
3. `EditorManager` spawns code-server on a free port with `--auth none --bind-addr 127.0.0.1:<port>`
4. Waits for TCP ready probe → returns `{ id, proxyPath }` → iframe loads
5. Browser sends heartbeat every 30s → resets idle timer
6. No heartbeat for 10 min → instance killed via SIGTERM

### Reverse Proxy

All code-server traffic is proxied through `/editor/:id/*` on the dashboard server. This provides same-origin access (no CORS/iframe issues) and works transparently through zrok tunnels.

### Orphan Cleanup

`EditorManager` state is purely in-memory. On graceful shutdown, `editorManager.stopAll()` SIGTERMs every child. On non-graceful shutdown (SIGKILL, crash, OOM, force-quit), spawned code-server processes get reparented to init/launchd and continue holding their port and `--user-data-dir` lockfile.

To recover, every spawn is recorded in `~/.pi/dashboard/editor-pids.json` (`editor-pid-registry.ts`). On the next server boot, `editorPidRegistry.cleanupOrphans()` runs at the top of `server.start()` (before `fastify.listen`) and:

1. Reads the persisted PIDs.
2. For each entry whose PID is alive AND whose OS-reported command line contains `--user-data-dir <~/.pi/dashboard/editors/...>`, sends `SIGTERM`.
3. After a 1 second grace period, sends `SIGKILL` to any survivor.
4. Rewrites the file empty.

The cmdline ownership check prevents killing unrelated `code-server` instances the user may run themselves. Cleanup completes before any `POST /api/editor/start` request can be served, so a new spawn for the same folder cannot race with a surviving orphan on the same `--user-data-dir` lockfile.

### Configuration

```json
{
  "editor": {
    "binary": "/usr/local/bin/code-server",
    "idleTimeoutMinutes": 10,
    "maxInstances": 3
  }
}
```

Binary auto-detection order: config override → `code-server` on PATH → `openvscode-server` on PATH.

### Known Servers Configuration

```json
{
  "knownServers": [
    { "host": "office-mac.local", "port": 8000, "label": "Office Mac", "addedAt": "2024-01-15T10:30:00Z" },
    { "host": "build-server", "port": 8000, "addedAt": "2024-01-20T14:00:00Z" }
  ]
}
```

Managed via REST API (`/api/known-servers`) or Settings panel. Localhost is always implicit.

## Bundled Skill: pi-dashboard

The `.pi/skills/pi-dashboard/` directory is both a local project skill (discovered by pi from `.pi/skills/`) and shipped with the npm package (discovered via `pi.skills` in `package.json`). This means any pi session in the dashboard project or any project that installs the dashboard package gets access to the skill.

### Session Control REST API

`src/server/session-api.ts` registers REST wrappers for operations that were previously WebSocket-only:

| Endpoint | Description |
|----------|-------------|
| `POST /api/session/:id/prompt` | Send a text prompt to a session |
| `POST /api/session/:id/abort` | Abort current operation |
| `POST /api/session/:id/shutdown` | Shutdown a pi session |
| `POST /api/session/:id/rename` | Rename a session |
| `POST /api/session/:id/hide` | Hide session |
| `POST /api/session/:id/unhide` | Unhide session |
| `POST /api/session/spawn` | Spawn new session in a directory |
| `POST /api/session/:id/resume` | Resume or fork ended session |
| `POST /api/session/:id/flow-control` | Abort flow or toggle autonomous |
| `POST /api/session/:id/model` | Set provider + model |
| `POST /api/session/:id/thinking-level` | Set thinking level |
| `POST /api/session/:id/attach-proposal` | Attach OpenSpec change |
| `POST /api/session/:id/detach-proposal` | Detach OpenSpec change |

These call the same internal methods as the browser-gateway WebSocket handlers — no duplicated logic.

### Skill Contents

- `SKILL.md` — Auto-discovers dashboard port from `~/.pi/dashboard/config.json`, organized by capability, auth-aware
- `references/api-reference.md` — Complete REST API documentation
- `references/recipes.md` — Multi-step orchestration patterns (spawn→prompt→monitor, batch operations, health checks)
- `scripts/dashboard-api.sh` — curl wrapper with port detection, optional auth token, graceful jq fallback

## Tool Resolution (`ToolRegistry`)

Every external binary, module, and directory the dashboard depends on is resolved through a single `ToolRegistry` service in `packages/shared/src/tool-registry/`. Previously, resolution logic was scattered across `ToolResolver` (low-level PATH search), `runner.ts`'s private `resolverCache`, `npm.ts`'s `cachedGlobalRoot`, and two copies of `loadPiPackageManager()` (server + electron). The registry consolidates all of that behind one API, adds user-facing overrides, and records a diagnostic trail so "tool not found" is never a silent failure.

### Registered tools

| Tool | Kind | Strategy chain |
|---|---|---|
| `pi` | binary | override → managed (`MANAGED_BIN/pi[.cmd]`) → where |
| `pi-coding-agent` | module | override → bare-import → managed (`MANAGED_DIR/node_modules/.../dist/index.js`) → npm-global; probes both `@mariozechner/*` and `@oh-my-pi/*` aliases |
| `openspec`, `npm`, `node`, `tsx`, `git`, `zrok` | binary | override → managed → where |
| `pi-dashboard` | module | override → managed → npm-global (presence of `package.json` is enough) |

### Resolution record

`registry.resolve(name)` returns a `Resolution` with:

- `ok` — whether any strategy succeeded
- `path` / `source` — winning path and its classification (`override`, `managed`, `system`, `npm-global`, `bare-import`)
- `tried[]` — ordered trail: `[{ strategy, result }]` where `result` is `"ok"` on success or the strategy's failure reason
- `resolvedAt` — epoch ms

### Overrides

User-set overrides live at `~/.pi/dashboard/tool-overrides.json`:

```json
{
  "version": 1,
  "overrides": {
    "pi":              { "path": "C:\custom\pi.cmd" },
    "pi-coding-agent": { "path": "D:\dev\pi-coding-agent\dist\index.js" }
  }
}
```

The file is machine-local (deliberately separate from `config.json` so dotfile syncs don't follow paths across machines). Invalid overrides (path doesn't exist) are recorded as `invalid: <reason>` in `tried[]` and the registry falls through to the next strategy.

### Caching

- One `Resolution` per tool, cached in the registry instance.
- Loaded ES modules (for `kind: "module"`) cached alongside.
- `registry.rescan(name?)` invalidates one or all entries + re-reads the overrides file.
- The runner's old `resolverCache` and `npm.ts`'s old `cachedGlobalRoot` are gone — the registry owns caching now.

### REST API (`/api/tools`)

Guarded by the same network guard as `/api/config`.

| Endpoint | Purpose |
|---|---|
| `GET /api/tools` | Snapshot of every registered tool's Resolution |
| `GET /api/tools/:name` | Single Resolution (404 for unregistered) |
| `POST /api/tools/rescan` | Invalidate all caches (body empty) or one (`{ name }`) + return refreshed list |
| `PUT /api/tools/:name` | Set an override (`{ path }`) + return refreshed Resolution |
| `DELETE /api/tools/:name` | Clear the override + return refreshed Resolution |
| `POST /api/tools/diagnostics` | Plain-text export — one block per tool with the full `tried[]` trail, for bug reports |

### Settings UI

Settings → General → **Tools** renders one row per registered tool: status badge, source, truncated path, expand-to-trail, override input, per-row rescan. The header has **Rescan all**, **Reset overrides**, **Export diagnostics**.

### Migration path

`ToolResolver` remains the low-level PATH search primitive. The registry calls `ToolResolver.which()` from its `where` strategy. Unregistered binary names (e.g., ad-hoc `code-server` detection) still flow through `ToolResolver` directly. This keeps `ToolResolver` useful for one-off lookups and lets the registry focus on tools the dashboard formally depends on.

See change: `consolidate-tool-resolution`.

## Path Handling (`platform/paths.ts`)

Filesystem paths are OS-aware, and the dashboard touches them in three user-visible places: pin-directory storage (server), session-grouping (client), and the path picker UI (client). All three go through a single module — `packages/shared/src/platform/paths.ts` — rather than inventing their own logic.

### Primitives

| Function | Purpose |
|---|---|
| `normalizePath(p, platform?)` | Canonical form for storage/comparison: OS-native separator, trailing sep stripped (except roots), `..`/`.` resolved, case preserved. |
| `samePath(a, b, platform?)` | Filesystem equality — case-insensitive on Win/macOS, case-sensitive on Linux, tolerant of trailing/separator drift. Different Windows drives (`A:\` vs `B:\`) NEVER match. |
| `parsePathInput(value, platform?)` | Split user-typed input into `{ parent, partial }` — handles Windows drive-letter roots, UNC roots, Unix roots, mixed separators. |
| `withTrailingSep(p, platform?)` | Append OS-native separator if not already terminated. |
| `isFilesystemRoot(p, platform?)` | True for `/`, `C:\`, `\server\share\` uniformly — replaces `resolved === "/"` checks that only recognized Unix roots. |

### Platform injection pattern

Every OS-dependent function takes an optional trailing `platform: NodeJS.Platform` parameter defaulting to `process.platform`. Tests exercise both branches on any host (Windows tests run on Linux CI and vice versa) without mutating `process.platform`. Client code uses `inferPlatform(samples)` (in `client/src/lib/session-grouping.ts`) to sniff the server's platform from observed path shapes — backslash or drive-letter prefix → Windows, leading `/` → POSIX.

### Windows multi-drive invariants

| Drive letter | Contract |
|---|---|
| A:, B:, C:, …, Z: | each a distinct filesystem root |
| `B:\` vs `b:\` | case-insensitive (match) |
| `A:\Foo` vs `B:\Foo` | never match (different drives) |
| `\server\share` vs `B:` | never match |
| Bare `B:` input | treated as `B:\`, not cwd-relative |
| `B:Dev` input | drive root + partial (defensive) |
| `B:/Dev/BB` (fwd slash) | canonicalizes to `B:\Dev\BB` |
| Browse at `B:\` | `parent: null` (root is its own dead-end) |

### Protocol extension

`BrowseResult` includes an optional `platform` field (`"win32" | "darwin" | "linux"`) populated from `process.platform` on the server. Path picker prefers this server-issued value and falls back to client-side inference when absent (for backward compatibility with older servers).

### Common gotcha: `Array.prototype.map(normalizePath)`

`Array.prototype.map` passes `(element, index, array)`. When a function takes `platform` as an optional second argument, the index (a number) gets passed as `platform`, silently failing the `=== "win32"` check and taking the POSIX branch. Always wrap: `.map((p) => normalizePath(p))` instead of `.map(normalizePath)`.

See change: `platform-path-normalization`.
