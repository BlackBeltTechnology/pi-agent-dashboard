# Changelog

All notable changes to **pi-agent-dashboard** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For the release workflow (including how `Unreleased` becomes a versioned section),
see [`docs/release-process.md`](docs/release-process.md).

## [Unreleased]

### Added
- **Electron Intel Mac DMG** (`darwin-x64`) is now published alongside the Apple Silicon DMG on every release. The CI matrix gained a `macos-13` row that produces `PI-Dashboard-darwin-x64-<ver>.dmg`. Fixes the long-standing "cannot be opened" error on Intel Macs trying to run an arm64-only artifact (Rosetta cannot translate arm64 → x86_64). The site's Download section now renders Apple Silicon and Intel as two equally prominent buttons. Local-builder helper `packages/electron/scripts/build-installer.sh` gained a `--mac-both` flag, sentinel-driven per-arch cache invalidation, and a Rosetta 2 preflight so maintainers can validate both DMGs on an Apple Silicon mac before cutting a release. (change: `add-darwin-x64-build`)

### Changed
- **Breaking (direct download links)**: the macOS Apple Silicon DMG is renamed from `PI-Dashboard-<ver>.dmg` to `PI-Dashboard-darwin-arm64-<ver>.dmg` for symmetry with the new Intel build (`PI-Dashboard-darwin-x64-<ver>.dmg`). External deep links pointing at the old unsuffixed filename will 404 — update them to the new naming or link to the [Releases page](https://github.com/BlackBeltTechnology/pi-agent-dashboard/releases) instead. (change: `add-darwin-x64-build`)

### Fixed

## [0.4.5] - 2026-05-01
### Added

### Changed

### Fixed

## [0.4.5-rc.1] - 2026-05-01
### Added
- Resume / Fork pills in the desktop session content header when the viewed session is `ended` and has a `sessionFile` — no more bouncing back to the sidebar after a server reload or pi crash. Mirrors the sidebar SessionCard's visual language and reuses the same `handleResumeSession` plumbing. (change: `resume-button-in-session-header`)
- New `reattachPlacement` config field (`"preserve" | "streaming-only" | "always"`) and a Settings → Sessions dropdown that controls how the dashboard places re-registering bridges in `sessionOrder` after a restart. (change: `reattach-move-to-front`)
- New `registerReason: "spawn" | "reattach"` field on the `session_register` extension protocol message; bridges set it automatically. Legacy bridges that omit the field are treated as `"spawn"` for backwards compatibility.
- New `server_restarting { reason, quiesceMs }` extension protocol message broadcast by `/api/restart` and `/api/shutdown` before exit. Bridges that receive it suppress the auto-start spawn step in `server-auto-start.ts` for the quiesce window so they don't race the orchestrator. Discovery + reconnection still run during the window. (change: `fix-restart-bridge-auto-start-race`)

### Changed
- **Windows electron CI no longer uses MSYS/bash.** Every step in `.github/workflows/publish.yml` that can run on a Windows runner now executes via `node`, `cmd.exe` (default), or `pwsh` — zero `shell: bash` invocations on Windows. `bundle-server.sh` ported to `bundle-server.mjs` (`cp -R` → `fs.cpSync`, `find` → recursive `readdir`, `chmod` → `fs.chmodSync`); produces bit-identical output (verified parity: 2251 files). Pins `electron: "32.3.3"` (drop the caret) so `app-builder-lib`'s `getElectronVersionFromInstalled` fallback finds a regex-valid version on Windows NSIS builds (workspace hoisting puts electron at the root `node_modules/`, where electron-builder doesn't look). New repo-lint `no-bash-on-windows.test.ts` parses every workflow YAML, computes per-step Windows reachability from each step's `if:` filter, and fails when any `shell: bash` step is reachable on a Windows runner — prevents future regressions at PR-review time. (eliminate-bash-on-windows-runners)
- **Prereleases now publish safely.** Versions with a SemVer prerelease segment (e.g. `0.4.5-rc.1`) are detected by the `prepare` job's new `is_prerelease` output and routed appropriately: npm publish uses `--tag next` instead of the default `latest` (so consumers running `npm install <pkg>` keep getting the last stable release; rc consumers opt in via `npm install <pkg>@next` or `@<exact-version>`), and the GitHub Release is created with `prerelease: true` so it surfaces as such on the Releases page. Stable versions are unchanged (default `latest` dist-tag, regular Release). Pre-fix, an rc tag would have polluted the `latest` dist-tag and surfaced as a regular Release — an `npm install` of any sub-package would have grabbed the rc, breaking every consumer. Locked by three new assertions in `packages/shared/src/__tests__/publish-workflow-contract.test.ts`. (eliminate-bash-on-windows-runners)
- **BREAKING (default behavior)**: when the dashboard restarts, still-alive pi sessions now float to the **top** of their folder lists by default, instead of being preserved at their pre-restart drag-order positions. This eliminates the case where a session you were actively running before a restart ended up buried mid-list. To restore the old behavior, set `reattachPlacement: "preserve"` in `~/.pi/dashboard/config.json` and run `pi-dashboard restart`. (change: `reattach-move-to-front`)

### Fixed
- Long-lived sessions no longer accumulate massive `messages[]` duplication across reconnects. A 5-day-old session with 50 unique `toolCall` ids in `events.jsonl` was rendering as 14–16 copies of every tool card in the DOM (~700+ rows), producing a never-ending-scroll feeling because the chat container's `scrollHeight` was enormous and packed with duplicate tool runs. Three orthogonal idempotency fixes in the client reducer/handler close this: (A) `useMessageHandler::case "event_replay"` resets state on every full replay sweep, not only when `firstSeq === 1` — it also fires when `firstSeq <= maxSeq` so paginated reconnect re-replays whose first batch starts mid-stream are correctly recognised as overlapping replays. (B) `tool_execution_start` updates an existing row keyed by `toolCallId` in place instead of pushing a duplicate React key. (C) `flushStreamingTextAsAssistantRow` derives its row id from `toolCallId` (`flush-${toolCallId}`) rather than `messages.length`, so re-running the same start event finds the existing row and skips the push. Property-style tests pin `reduceEvent` idempotency for both `toolResult` and flushed-assistant rows; an integration test pins the WS handler's reset trigger across paginated, repeated, and tail-extension batch shapes. (change: `fix-replay-duplicates-tool-and-flushed-rows`)
- **Windows electron installer is usable for the first time since v0.3.0.** End-to-end smoke testing on a fresh Windows machine surfaced a chain of 3 latent runtime defects + the install-layer naming chaos. Every prior CI run was masked by either fail-fast cancelling Windows or the build itself failing earlier (path-translation bug from PR #10). All four issues land together because each fix is small and the defect chain only fully breaks when they ship together. **Naming chaos**: `productName` was `pi-dashboard-electron`, npm `name` was `@blackbelt-technology/pi-dashboard-electron`, and electron-builder's NSIS install-dir fallback strips slashes — producing `%LOCALAPPDATA%\Programs\@blackbelt-technologypi-dashboard-electron\` install dirs and Start Menu shortcuts that targeted the non-existent `pi-dashboard-electron.exe`. The Forge NSIS maker's `getAppBuilderConfig` callback now explicitly pins `productName`, `appId`, and every `nsis.*` field to `pi-dashboard`. Pinned by `forge-config-naming.test.ts`. **Defect 1 — wizard auto-skip skipped the install**: when first-launch detected `pi.found && bridge.found`, the wizard auto-skipped its UI AND `installStandalone()`. Result: `~/.pi-dashboard/node_modules/` stayed empty, the bundled server's TS-loader resolution fell through to the user's system pi (which on machines with `pi-coding-agent@0.71.x` ships `jiti@2.6.5` — a version that misnormalizes `file:///` URL entries on Windows), and the server child crashed with `MODULE_NOT_FOUND` before binding. The fix decouples "show wizard UI?" from "run managed install?": the auto-skip removes the UI but ALWAYS runs `installStandalone()` (idempotent on populated dirs, fast on second launches). Decision logic extracted into the pure `decideStartupAction(state)` helper for test surface. **Defect 2 — jiti version contract**: `shouldUrlWrapEntry()`'s Windows-non-tsx arm assumes the jiti loader is from `pi-coding-agent@0.70.x` (jiti 2.x). The contract is now documented in the function's header comment (`!! JITI VERSION CONTRACT !!`) and regression-pinned by `node-spawn-jiti-contract.test.ts` which asserts `offline-packages.json` keeps the pin in `0.70.x`. Defended in practice by Defect 1's fix — once the managed dir has the pinned pi, the system-pi fallback is never reached. **Defect 3 — orphan shim ENOENT**: `detectPiDashboardCli()` picked `lines[0]` from `where pi-dashboard` output, which on Windows is the extensionless POSIX shim that npm-global ships next to the `.cmd`. `spawn()` without `shell: true` cannot invoke an extensionless shim. The new `pickSpawnableShim()` helper filters for `.cmd`/`.exe`/`.bat`/`.ps1` on `win32` and falls back to `lines[0]` only when no executable extension is found. POSIX behaviour unchanged. **Server-startup deadline + error wording**: `waitForReady` deadline bumped from 15s to 60s (gives `installStandalone()` + cold-start headroom on first launch). Error message split into cause-aware variants — "Server child process exited prematurely (...)" when `ready.error` mentions an exit, vs. "Server did not respond within 60 seconds (...)" when the deadline elapsed. Pre-fix wording said "Server failed to start within 15 seconds (child exited with code N)" even when the elapsed time was milliseconds. Pure helper `buildServerStartupError(...)` shared by both `launchViaCli` and `launchServer`. (fix-electron-windows-installer-and-server-bootstrap)

### Migration

For users with v0.4.4 installed (the broken-naming + broken-server version):

1. Open **Apps & Features** in Windows Settings.
2. Find `pi-dashboard-electron` and click **Uninstall**.
3. Manually delete `C:\Users\<you>\.pi-dashboard\node_modules\` so the v0.4.5 first-run install starts from a clean target.
4. Download the v0.4.5 `pi-dashboard-Setup-<version>.exe`.
5. Run Setup. The installer will install to `%LOCALAPPDATA%\Programs\pi-dashboard\`.
6. On first launch the splash will show "Setting up dependencies…" for ~5–15s while the offline cacache extracts into the managed dir. After that the dashboard opens normally.

No tooling required; no auto-migration from the broken install path.
- Assistant text now appears above its own tool card / `ask_user` dialog during the entire tool runtime, not just after `message_end`. Previously the streaming text bubble was rendered after `messages.map()` in ChatView, so any `toolResult` or `interactiveUi` row pushed mid-stream sat visually above the prose introducing it — invisible for fast tools but glaring for `npm test` (4-min) and `ask_user` (blocking on user response). The reducer now flushes `streamingText` into a permanent assistant row at `tool_execution_start`, with the flushed row's `entryId` stamped in place at `message_end` (preserves the `fork-entryid-accuracy` contract). Hard turn-boundary clamp on the stamp scan prevents cross-message `entryId` pollution if a prior message's `message_end` was dropped by a bridge disconnect. (change: `fix-streaming-text-vs-interactive-ui-order`)
- Dashboard restart no longer races bridge auto-start. `pi-dashboard restart` now delegates to `/api/restart` when the dashboard is up (mirroring the `cmdUpgradePi` pattern), and the `restart-helper.ts` orchestrator explicitly SIGTERM/SIGKILLs the previous PID before spawning the replacement. Symptoms fixed: agents running `pi-dashboard restart` from a chat would silently leave the server offline; clicking restart inside Electron could orphan the new server outside Electron's lifecycle supervision. (change: `fix-restart-bridge-auto-start-race`)

## [0.4.4] - 2026-04-30
### Added

### Changed

### Fixed

## [0.4.3] - 2026-04-30
### Added

### Changed

### Fixed

## [0.4.3-rc.1] - 2026-04-30
### Added

### Changed

### Fixed

## [0.4.2] - 2026-04-30
### Added
- **Folder OpenSpec section: clickable task counter.** The `N/M tasks` indicator on each change row in `FolderOpenSpecSection` is now a button that opens the existing `TasksPopover` with the row's cwd + change name — the same component used by session cards. No new server endpoint, no parallel toggle logic; one popover at a time, opening another row swaps the popover. Read-only progress glance becomes interactive without first attaching a session. (add-folder-task-checker-and-spawn-attach)
- **Folder OpenSpec section: spawn-with-attach.** Each change row gains a green play-icon button to spawn a new pi session in the folder's cwd with the change pre-attached, atomically. Implemented as an optional `attachProposal?: string` on `SpawnSessionBrowserMessage` (backward-compatible — old servers ignore the field, old clients omit it); the dashboard server queues the intent in `pendingAttachByCwd` (FIFO per cwd, cap 8, 60 s TTL) and consumes it on the next `session_register` for that cwd, applying the same idempotent attach + auto-rename logic as the explicit attach UI. The bare folder `+Session` button keeps the unattached semantics. (add-folder-task-checker-and-spawn-attach)

### Changed
- **Workspace package management now mirrors the global treatment.** The workspace card's Pi Resources view splits cleanly into two single-purpose tabs: **Resources** (browse-only — loose `<cwd>/.pi/{skills,extensions,prompts}` files plus per-package nested resource trees) and **Packages** (the only workspace-scope install/uninstall surface). The Packages tab renders a new "Installed Packages" section above search using the same `PackageRow` machinery as Settings → Pi Ecosystem, so npm, local-path, and git sources all get working `Update`/`Uninstall` actions — closing a long-standing gap where local-path packages had no uninstall affordance in the workspace UI. The legacy "Installed" filter pill in the search results is removed (the dedicated section replaces it), and the `MergedScopeSection` no longer renders standalone manage rows for installed packages alongside loose workspace files. The first tab is renamed from "Installed" to "Resources" to make the browse-vs-manage split self-evident. (unify-workspace-package-management)

### Fixed
- **Release CI: electron matrix no longer races `publish`.** Release run #34 (v0.4.2) failed with macOS hitting `npm error code ETARGET / No matching version found for @blackbelt-technology/dashboard-plugin-runtime@^0.4.2` while `bundle-server.sh` ran its `npm install --omit=dev` — because the `electron` matrix job declared `needs: prepare` only and started in parallel with `publish`. The bundled server's dependency on `@blackbelt-technology/dashboard-plugin-runtime` (added in commit b9fcea9 to fix `MODULE_NOT_FOUND` on clean installs) is resolved from the public npm registry, so electron MUST run after publish finishes uploading. The fix gates `electron` on `needs: [prepare, publish]` and adds `strategy.fail-fast: false` so a single-OS failure no longer cancels the other four matrix variants. A new repo-lint test (`packages/shared/src/__tests__/publish-workflow-contract.test.ts`) parses `publish.yml` and asserts both invariants so a future workflow refactor cannot silently regress the contract. Wallclock cost: ~+3 min on the electron matrix per release (acceptable — alternative is half-shipped releases that need manual recovery). (publish-fix-macos)
- **Dashboard OIDC login (Google / GitHub / generic OIDC) now completes successfully in the Electron build.** The `harden-external-link-handling` change (#13) added a `will-navigate` guard that intercepts every non-same-origin top-level navigation and routes it through `shell.openExternal`. That guard's predicate was target-only — it never asked which page initiated the navigation — so once the user was redirected to the OAuth provider's login (e.g. `accounts.google.com`), every multi-step navigation Google performs internally during sign-in (form → password challenge → 2FA → consent) was preempted and bounced to the OS default browser, mid-flow. The OAuth flow could never complete in Electron under any provider that uses multi-step authentication. Fix: a new pure helper `decideWillNavigate(serverOrigin, currentUrl, targetUrl)` in `packages/electron/src/lib/link-handling.ts` reads `webContents.getURL()` at the moment `will-navigate` fires and only intercepts when the user is currently on the dashboard. Mid-flight provider-internal navigation is allowed; the eventual callback redirect back to the dashboard origin lands as a same-origin navigation and the SPA reloads the authenticated state normally. The trap-guard for the primary failure mode (external link clicked from chat content) is preserved bit-for-bit. `setWindowOpenHandler` is unchanged. (fix-oauth-blocked-by-external-link-guard)
- **Multiselect dialogs no longer auto-cancel on the dashboard.** The bridge now patches `ctx.ui.multiselect` into the same PromptBus path as select/input/confirm/editor, and the browser response encoder preserves `{values: string[]}` as a JSON answer so empty selection (`[]`) remains distinct from cancellation. The `ask_user` schema keeps its OpenAI-compatible `type: object` root while restoring Anthropic-friendly per-method `oneOf` constraints. (fix-multiselect-auto-cancel-on-dashboard) Follow-up `fix-multiselect-tui-arm-self-cancel` removed an erroneous TUI adapter arm that was auto-dismissing the dashboard dialog within 1 second because pi 0.70's RPC mode `ctx.ui.custom` is a no-op.
- **Tool cards no longer render above their own assistant text.** When an Anthropic-style assistant message ships content `[text, toolCall]` in a single message (~22% of Opus assistant messages, measured across 20 recent sessions), the chat panel previously rendered the running tool card *before* the assistant text bubble that introduces it — because `tool_execution_start` pushes the running spinner to `messages[]` immediately while the streaming text only lands at `message_end`. The reducer's `case "message_end"` arm now runs a pure suffix-reorder helper (`reorderToolCardsForAssistantMessage`) that walks the assistant message's `content[]` in order and relocates the trailing rows to match: `text` → the just-pushed assistant bubble, `toolCall` → the `toolResult` row matched by `toolCallId`, `thinking` → the corresponding thinking bubble. The fix is API-agnostic (works for anthropic-messages, google-generative-ai, openai-completions, openai-responses; reads only the normalized content array) and order-faithful (a hypothetical `[toolCall, text]` model would render tool-then-text rather than being silently flipped). The reducer continues to push the running tool spinner immediately on `tool_execution_start` so the live UX is unchanged; the reorder happens a few hundred ms later when `message_end` lands, with React keyed reconciliation preserving the spinner DOM node. Replay path inherits the fix for free since it routes through the same reducer. (fix-text-tool-render-order)
- **Interactive UI dialogs (e.g. `ask_user`) now render below their own assistant text.** Extends the previous fix: when a `[text, toolCall:ask_user]` assistant message landed both a `toolResult` row and an `interactiveUi` row before `message_end`, the suffix-reorder helper sized its window to `relevant.length` (text + toolCall + thinking only), so the `interactiveUi` row pinned the assistant text below the dialog. ChatView's `findActiveInteractiveToolResultIds` then hid the running tool card, leaving the visible order `[ui-X, assistant-text]` — dialog above its own intro. The reducer now uses a turn-boundary anchored window (stops at `user`/`turnSeparator`/`commandFeedback`/`rawEvent` rows) and pairs each `interactiveUi` row with its parent `toolResult` via a new `metadata.toolCallId` carried on the `prompt_request` envelope. Bridge wrappers (`ctx.ui.{select, input, confirm, editor}`) now thread `toolCallId` through `opts` for tool-bound prompts; free-floating prompts (architect mode, slash commands) leave the field undefined and the reducer treats them as trailing-unclaimed, exactly where they sit today. Forward/backward compatible at the protocol level — old bridges keep today's ordering until upgraded. (fix-interactive-ui-reorder)
- **Just-killed sessions now land at the top of the ended tier.** When a user clicks ✕ (or pi exits naturally / is force-killed) on an alive session whose `startedAt` is older than other ended sessions in the same folder, the resulting card used to drop into the ended bucket sorted by `startedAt` desc — which placed it mid-bucket among other 14 h-old ended sessions, invisible to the user who just acted on it. The client now sorts the ended bucket by `(endedAt ?? startedAt)` descending so the most-recently-ended card surfaces at the top regardless of cause. Symmetrically, the server's user-intent resume branch now calls `sessionOrderManager.moveToFront(cwd, id)` instead of `insert-if-absent`, so repeated `end → resume → end → resume` cycles always land the just-resumed card at index 0 of the alive tier. Bridge auto-reattach on dashboard reboot is unchanged — it remains gated by `pendingResumeIntents` and never mutates the order. No protocol changes; the existing `sessions_reordered` broadcast carries the new order. (top-of-tier-on-status-change)
- **Desktop session-header back arrow now always lands somewhere visible.** Three closely related bugs are fixed: (1) cold loads / hard refreshes / deep links / post-server-switch state where browser history has only one entry no longer turn the back click into a silent `window.history.back()` no-op; (2) clicking a sidebar OpenSpec artifact letter, README link, or pi resource link while on `/settings` or `/tunnel-setup` no longer opens the overlay invisibly behind the JSX gate — the URL-route view auto-closes (navigate to `/`) before the overlay is set; (3) when multiple content-area overlays are simultaneously set, each back click peels exactly one in priority order until reaching the landing page. The desktop back-arrow now dispatches through a new `useDesktopBack` hook backed by a pure `selectDesktopBackTarget` helper that mirrors the priority chain mobile's inline `onBack` switch already uses, pinned by a 256-combination parity test. Mobile is untouched. (fix-desktop-back-navigation)
- **Local-path package installs no longer orphan their spinner.** The client package queue (`packages/client/src/lib/package-queue.ts`) was matching `package_operation_complete` strictly by `operationId`, but the WebSocket frame can arrive before `fetch()` resolves the HTTP response that carries the id (consistently for fast local-path installs that have no network round-trip; intermittently for small/cached npm packages). The completion was silently dropped, the spinner stuck on "Installing…", and the single-flight queue jammed for every subsequent operation until page reload. The new `matchesRunning(opId, source)` predicate falls back to `source` matching while `running.operationId` is still `null`, then prefers `operationId` once the HTTP response sets it. The same fix applies to `package_progress`. Three new tests in `package-queue.test.ts` lock down the reverse arrival order. (fix-local-path-install-spinner)
- ChatView: fixed a race during multi-batch `event_replay` that caused uncached session switches to land mid-conversation with the floating scroll-to-bottom button visible. `handleScroll` now ignores onScroll measurements that follow our own programmatic `scrollTo` for a ~150 ms window, so growing `scrollHeight` between batches no longer flips `isNearBottom` to false. (fix-chat-scroll-race-during-replay)
- Mobile session header and session card now show a read-only `📎 <change>` chip when an OpenSpec proposal is attached — previously the attached state was hidden behind the paperclip popover. The auto-rename rule on attach/detach is now idempotent across all three code paths (browser WS handler, REST endpoint, and the auto-detect activity branch in `event-wiring.ts`): detach reverts the name only when it was auto-set, and re-attach to a different change re-tracks the new name without overwriting user customisations. **Release-test reminder**: run the 6-step manual mobile QA matrix from `openspec/changes/fix-mobile-attach-proposal-display/tasks.md §6` before next release. (fix-mobile-attach-proposal-display)
- **External links in chat content no longer strand the dashboard view.** Clicking a URL emitted by the agent (or any other markdown-rendered link) used to navigate the dashboard's only window to the external page in Electron and installed PWAs — neither shell has a URL bar or a back button, so users had to force-quit or reload to recover (reported as #13). External links now open in your real system browser (Electron) or a new tab (browser / PWA). Same-origin navigation (e.g. the `/auth/login?return=...` redirect) is untouched. Two defense-in-depth layers: `MarkdownContent` renders external `<a>` with `target="_blank" rel="noopener noreferrer"`, and the Electron shell registers `setWindowOpenHandler` + `will-navigate` guards that route any remaining external URL through `shell.openExternal`. A repo-level lint prevents future client code from slipping bare external anchors in. See change: `harden-external-link-handling`.

## [0.4.1] - 2026-04-27
### Added
- **Build-time tool registry coverage for `electron` and `node-pty`.** Both packages are now registered in the dashboard's `ToolRegistry` (`override` → `bare-import` → optional `managed` strategy chain), and a new shell-callable resolver wrapper at `packages/shared/bin/pi-dashboard-resolve-tool.cjs` exposes registry resolution to CI workflows and Dockerfiles without requiring the shared package's TS build. CI's linux/arm64 electron rebuild step (`publish.yml`) and the cross-platform Docker electron rebuild step (`Dockerfile.build`) both now go through the wrapper, so npm workspace hoisting changes can no longer break releases (this was the root cause of the v0.4.0 release crisis). See change: `register-build-time-tools`.

### Changed
- **Root postinstall (`scripts/fix-pty-permissions.cjs`) is now hoist-aware.** Replaces the hardcoded `node_modules/node-pty/prebuilds` path with `require.resolve("node-pty/package.json")`, mirroring the registry's `bare-import` strategy. Previously failed silently on every fresh install of the root workspace, leaving `node-pty`'s `spawn-helper` without execute permission and producing `posix_spawnp failed` at terminal-spawn time. See change: `register-build-time-tools`.

### Fixed
- **Per-message Fork (⤘) now includes the clicked message in the new session.** Previously, clicking the per-message Fork button on either a user or assistant chat bubble produced a forked session whose history ended one entry BEFORE the bubble that was clicked. Root cause: pi 0.69+ awaits extension handlers BEFORE running `sessionManager.appendMessage`, so the bridge's `queueMicrotask`-based deferral resolved inside the awaited dispatcher and read the *previous* leaf via `getLeafId()`. The dashboard pins `pi >= 0.70.0`, so this affected every supported pi version. Fix: bridge now (1) stamps a `nonce` on `message_start`/`message_end` events instead of relying on `getLeafId()` for live emissions, (2) defers the `message_end` send via `setTimeout(0)` (macrotask) so pi has time to mutate `event.message.id` in place and the wrapped `appendMessage` to record the id, (3) emits a new `entry_persisted { entryId, nonce }` event after each successful append so the client reducer can back-fill the user-message bubble's `entryId`. The fork pipeline (`createBranchedSessionFile` + `pi --fork`) is unchanged — once the entry id is correct, it works. Tests: `packages/extension/src/__tests__/bridge-entry-id-pi-070.test.ts`, `packages/server/src/__tests__/fork-jsonl-roundtrip.test.ts`, `packages/shared/src/__tests__/state-replay-entry-id.test.ts`. See change: `fix-per-message-fork`.
- **New repo-level lint test prevents reintroduction of hardcoded `node_modules/<dep>` paths.** `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` scans the migrated build-time files for `node_modules/electron` and `node_modules/node-pty` substrings and fails `npm test` with a `file:line:col` citation. Mirrors the existing `no-direct-process-kill.test.ts` / `no-raw-node-import.test.ts` lint pattern. See change: `register-build-time-tools`.

## [0.4.0] - 2026-04-24

### Added
- **Per-session chat input drafts + bash-style history recall.** In-progress chat text is now preserved per session when you navigate away from the chat view (Settings, OpenSpec previews, file diffs, pi-resources) and survives across dashboard reloads via `localStorage`. Switching sessions cleanly isolates drafts so text no longer leaks from one session into another. Within a session, `ArrowUp` / `ArrowDown` walks your previously sent prompts (newest first, consecutive duplicates collapsed) — press `Escape` mid-history to restore your in-progress draft. See change: `chat-input-draft-and-history`.
- **Hot-reload for custom LLM providers + "Test" button.** Adding, editing, or removing a provider in **Settings → Providers** now takes effect immediately across every running pi session — no reload needed. The new **Test** button sends a probe request to the configured endpoint and surfaces HTTP status + response preview so misconfigured keys / URLs are obvious before you try to chat. Previously the bridge only read `providers.json` once at startup, so new providers stayed invisible until a full session restart. See change: `hot-reload-custom-providers`.
- **Single-dashboard-per-HOME advisory lock.** Two `pi-dashboard` processes sharing the same `HOME` directory would race on `~/.pi/agent/settings.json`, `.meta.json` files, PID registries, and Zrok tunnel reservations — occasionally corrupting state or SIGTERM-ing each other's child processes. A new per-HOME advisory lock detects a running sibling and hands off cleanly (via discovery + attach) instead of starting a second conflicting instance. See change: `single-dashboard-per-home`.

### Changed
- **Dashboard `/reload` now works for headless pi sessions.** Previously the bridge extension could only trigger `session.reload()` after a human had invoked `/__dashboard_reload` once in pi's TUI — making it unreachable on headless-spawned sessions. The dashboard now kills the old process and respawns it with `pi --session <file>`, producing the same observable effect (same `sessionId`, same entries) without requiring TUI interaction. `npm run reload` and the dashboard reload button now work uniformly across TUI and headless sessions. See change: `headless-reload-via-respawn`.

### Fixed
- **Trusted-network dashboard access works again without OAuth configured.** After the earlier `consolidate-trusted-networks` change repointed the Settings UI from `config.trustedNetworks` to `config.auth.bypassHosts`, users without an OAuth provider lost remote LAN access: entries added via the UI were silently dropped on save, hand-written entries were ignored at load, and the WebSocket upgrade guard kept blocking even after a save succeeded. Three bugs fixed together (UI-save persistence, config-load gate, runtime guard refresh) so adding a trusted network via the Settings UI now takes effect immediately without a server restart or an OAuth provider. See change: `fix-trusted-networks-no-oauth`.

### Performance
- **OpenSpec polling no longer pegs every CPU core every 30 seconds.** Polling across many pinned directories previously spawned dozens of `openspec` child processes simultaneously (one per change, per directory, per tick) — producing ~10-second 100% CPU bursts on workstations with many active changes. Polling now uses per-directory `mtime`-gated change detection (skips unchanged trees entirely), a shared concurrency semaphore (max N parallel spawns across all directories), and deterministic per-directory jitter to spread the work. Configurable via new `openspec.*` keys in `~/.pi/dashboard/config.json` (`pollIntervalSeconds`, `maxConcurrentSpawns`, `changeDetection`, `jitterSeconds`). Zero functional change; same poll results, orders-of-magnitude less CPU. See change: `optimize-openspec-poll-burst`.

### Fixed
- **`pi-dashboard start` and auto-start no longer crash with `ERR_UNSUPPORTED_ESM_URL_SCHEME` when the dashboard source lives on a non-C: Windows drive** (e.g. `B:\Dev\pi-agent-dashboard`). Previously the `fix-windows-server-parity` change wrapped only the `--import <loader>` argument as a `file://` URL; the entry-script argument (`<cli.ts>` position) was still passed as a raw Windows path. Node's ESM loader parses both positions as URLs, and its drive-letter heuristic has gaps on `A:`, `B:`, and other less-common drive letters, causing Node to interpret the drive letter as a URL scheme (e.g. `b:`) and reject it. All four server-spawn call sites (`packages/server/src/cli.ts`, `packages/extension/src/server-launcher.ts`, `packages/electron/src/lib/server-lifecycle.ts`, `packages/server/src/restart-helper.ts`) now route through a new `spawnNodeScript` helper / `toFileUrl` wrapper in `packages/shared/src/platform/node-spawn.ts` that URL-wraps both the loader and entry positions unconditionally. A repo-level lint test (`no-raw-node-import.test.ts`) prevents future spawn sites from regressing. See change: `fix-windows-entry-script-url`.
- **Custom-provider models now register with accurate `contextWindow`, `maxTokens`, `reasoning`, and `cost`** sourced from pi's model registry via `modelRegistry.find()` (captured from `ctx.modelRegistry` at the first `session_start` event). Previously every discovered model was hardcoded to 200k context / 16k maxTokens / no reasoning / `$0` cost — silently wrong for every proxied frontier model. E.g., `proxy/cc/claude-opus-4-7` now correctly reports its 1M context window instead of 200k, surfaces the thinking-level UI (reasoning capable), and tracks cost against Anthropic's Opus 4.7 pricing. Common proxy prefixes (`cc/`, `anthropic/`, `openrouter/openai/…`) are stripped before lookup so prefixed ids resolve to the same registry entry as the bare id. When the registry is unreachable or has no match, api-appropriate fallbacks apply (`anthropic-messages` → 200k/64k, `google-generative-ai` → 1M/65k, `openai-completions` → 128k/16k) — all keeping `input: ["text","image"]` so the image-capable-by-default behavior is preserved. The `session_start` handler also re-invokes `pi.setModel(refreshed)` for the currently-selected model after re-registration, so pi's internal `supportsThinking()` check sees `reasoning: true` instead of the pre-enrichment snapshot. Zero new dependencies; zero `providers.json` schema changes; zero impact on built-in / OAuth providers. See change: `enrich-custom-provider-model-metadata`.
- **Thinking level selector stays in sync across UI surfaces.** Previously clicking a thinking level in the bottom StatusBar updated the session card but not the StatusBar itself (which snapped back to `off`), because the server's `session_updated` broadcast only patched the `sessions` Map while the StatusBar reads `sessionStates[id].thinkingLevel` first. The client-side `session_updated` handler now mirrors `thinkingLevel` / `model` fields into `sessionStates` as well, so both surfaces update together. See change: `enrich-custom-provider-model-metadata`.

### Changed
- **Custom-provider models discovered via `~/.pi/agent/providers.json` now advertise image input capability by default**, so pasted images reach the upstream model instead of being stripped client-side by pi-ai's `downgradeUnsupportedImages`. Vision-capable models (Claude Opus 4.x, GPT-4o, Gemini 2+, OpenRouter multimodals) handle images correctly out of the box. Modern text-only models (GLM, MiniMax, etc.) return a polite "no image visible" reply; legacy text-only models (gpt-3.5-turbo, vanilla gpt-4) surface the upstream 400 error. Built-in / OAuth providers are unchanged — their capabilities still come from pi-ai's `models.generated.js`. See change: `enable-image-input-custom-providers`.

### Added
- **Auto-install pi on first `pi-dashboard` run** (degraded-mode first-run).
  When the server starts and `ToolRegistry.resolve("pi")` fails, it now flips
  `bootstrapState` to `installing`, runs a background `bootstrapInstall` into
  `~/.pi-dashboard/` (extracted from the Electron installer into the shared
  `@blackbelt-technology/pi-dashboard-shared/bootstrap-install.js` module),
  auto-registers the bridge extension on completion, and flips state back to
  `ready`. The UI renders a new `BootstrapBanner` above the main layout
  (`Installing pi…` while in progress, `pi install failed — [Retry]` on error,
  upgrade hints when the resolved pi version is below the compatibility
  range declared in `packages/server/package.json` `piCompatibility`). New
  `pi-dashboard upgrade-pi` subcommand upgrades `@mariozechner/pi-coding-agent`
  via the same shared installer, delegating to a running dashboard when
  present. Session spawn is queued during installs via the new
  `bootstrap-queue` (runs once status flips to `ready`); `/api/pi-core/*`,
  `/api/pi-resources`, and `POST /api/bootstrap/upgrade-pi` all 503/202 as
  appropriate. Extension is shipped as a runtime dep of
  `pi-dashboard-server` so `findBundledExtension` resolves it via
  `require.resolve` when installed via `npm i -g pi-dashboard`. See change:
  `unified-bootstrap-install`.

- **Bootstrap resolution harness** — in-memory (memfs-backed) test harness
  for the dashboard's bootstrap resolution: `ToolRegistry` strategy chains
  + bridge-extension registration across install mechanics, platforms, and
  HOME/path drift. Fail-closed scenario cube (3 platforms × 5 dash-locations
  × 6 pi-states × 4 settings-states × 3 env-states = 1080 cells) enforces
  that every new combination is either tested or explicitly skipped with a
  reason. Captures the current Windows `npm i -g pi-dashboard` bug (B1) as a
  trail snapshot so the fix in `unified-bootstrap-install` will flip visibly.
  Run via `npm run test:bootstrap`. No runtime behavior change; purely a
  regression-prevention layer. Prerequisites: `StrategyDeps` gains
  `resolveModule(id, from)` injector, `managed-paths.ts` exports
  `getManagedDir`/`getManagedBin` getters alongside existing constants,
  `ToolRegistry` accepts an optional `PlatformEnv` context,
  `registerBridgeExtension` accepts `{ homedir }` override — all
  backwards-compatible. See change: `bootstrap-resolution-harness`.

- **Offline first-run install for the Electron app** (opt-in). Release Electron builds now bundle a per-platform npm cacache containing pinned versions of `pi-coding-agent`, `openspec`, and `tsx` (plus all transitive dependencies) inside `resources/offline-packages/` — ~50 MB gzipped per installer. On first launch, the wizard extracts the tarball to `~/.pi-dashboard/.offline-cache/`, verifies its SHA-256 against the embedded manifest, runs ONE `npm install --offline`, then deletes the cache to reclaim ~140 MB. No network access is required. On SHA-256 mismatch or any cache-install failure the wizard aborts — there is **no silent fallback to `registry.npmjs.org`** (deterministic offline contract). When the bundle is absent (dev builds, opt-in flag off) the previous per-package registry install flow runs unchanged. New Doctor row "Offline packages bundle" shows target platform, pinned versions, and SHA-256 prefix. Gated on `BUNDLE_OFFLINE_PACKAGES=1` in CI; pins live in `packages/electron/offline-packages.json`. See change: `electron-offline-bundled-packages`.
- **Bundled first-party extensions in the Electron installer** (opt-in). A new `BUNDLED_EXTENSION_IDS` manifest in `@blackbelt-technology/pi-dashboard-shared` drives a build-time bundler (`packages/electron/scripts/bundle-recommended-extensions.sh`, gated by `BUNDLE_RECOMMENDED_EXTENSIONS=1`) that clones each listed extension into `packages/electron/resources/bundled-extensions/<id>/` with SPDX-license and 15 MB size-budget enforcement. At first launch, `installBundledExtensions()` copies each bundled tree into pi's git cache (`~/.pi/agent/git/<host>/<path>/`), runs `npm install --omit=dev` if needed, and registers the original git URL in `~/.pi/agent/settings.json` so pi's later `update()` can re-resolve upstream. The wizard renders distinct "Bundled ✓" / "Installed" badges. Release CI (`publish.yml`) runs the bundler before `bundle-server.sh` on macOS, Linux, and Windows runners and emits a per-platform size breakdown to the workflow summary. First-party scope: currently `pi-anthropic-messages` (and `pi-flows` once its repo adds a SPDX-conformant license). See change: `bundle-first-party-extensions`.
- **Windows cross-platform parity** — fresh-install dashboard now
  starts and runs correctly on Windows 10/11. Adds `netstat`/`taskkill`
  equivalents for every Unix-only `lsof`/`kill` path: `cli.ts`,
  `/api/restart`, `pi-dashboard stop`, terminal X button, tunnel
  cleanup, and headless-session tree-kill all route through shared
  `platform/process` helpers that select the correct per-OS strategy.
- **`packages/shared/src/platform/` primitive module** — single source
  for cross-OS behavior. `binary-lookup` (`where`/`which` + `.cmd`
  extension + login-shell fallback), `process` (findPortHolders,
  killProcess, killPidWithGroup, isProcessAlive), `process-scan`
  (pgrep vs tasklist), `shell` (COMSPEC vs SHELL), `commands`
  (openBrowser, isVirtualMachine), `paths` (OS-aware normalization +
  multi-drive invariants), `exec`/`runner` (subprocess execution with
  `windowsHide:true` baked in). Every helper takes optional
  `platform: NodeJS.Platform` injection so tests exercise both branches
  without mutating `process.platform`. Enforced by three lint-style
  tests: `no-direct-child-process`, `no-direct-process-kill`,
  `no-direct-platform-branch`.
- **`ToolRegistry` binary + module resolution** — single-source resolver
  for every external binary/module (pi, pi-coding-agent, openspec, npm,
  node, tsx, git, zrok, pi-dashboard). Ordered strategy chain per tool
  (override → bare-import → managed → npm-global → where), per-resolution
  diagnostic trail, in-memory cache, override-aware. REST API at
  `/api/tools*` with a new **Settings → Tools** section for inspecting
  resolution trails, setting overrides, and exporting diagnostics.
- **Node version preflight (`node-guard`)** — server refuses to start
  on Node versions affected by nodejs/node#58515
  (v22.0-v22.17 + v24.1-v24.2) with a clear upgrade message. Bumps
  `engines.node` to `>=22.18.0`.
- **Bridge extension polish** — server-readiness wait now blocks
  indefinitely with child-exit detection (no arbitrary timeout); launch
  progress renders via `pi-tui` Loader widget; spawn failures surface
  as `spawn_error` browser messages with the log path.
- **WSL-tmux probe cache** — per-server-lifetime cache eliminates the
  per-spawn cost of detecting the WSL tmux wrapper.

### Changed
- **Electron doctor/dependency-detector** migrated to `ToolRegistry`
  (drops direct `where`/`which` shelling out). `loadPiPackageManager()`
  now delegates module resolution to `ToolRegistry.resolveModule`.
- **PathPicker** uses OS-aware separator (`withTrailingSep`) and
  `parsePathInput` so Windows drive-letters (`B:`) are handled as
  drive roots, not cwd-relative paths.
- **`spawnDetached`** gained an explicit `detach?: boolean` option
  (default `true`). pi-session spawns now pass `detach:false` so the
  child is tied to the parent's libuv Job Object — no cmd.exe console
  flash on Windows and the child terminates when the parent exits.
- **`useWindowsRedirect` gate** tightened to require
  `stdinMode === "ignore"`; libuv only honors `CREATE_NO_WINDOW` when
  every stdio handle is ignored, and a piped stdin would otherwise
  allocate a visible console.

### Fixed
- **`npm install @blackbelt-technology/pi-agent-dashboard` now works in a
  fresh environment.** The 0.3.0 release on npm was unresolvable: the root
  tarball declared three workspace sub-packages as `dependencies`
  (`pi-dashboard-extension`, `pi-dashboard-server`, `pi-dashboard-web`), but
  those packages were never published to the registry because
  `.github/workflows/publish.yml` ran `npm publish` without `--workspaces`.
  Any clean-environment `npm install` — including `pi install
  npm:@blackbelt-technology/pi-agent-dashboard` — failed with E404 on the
  sub-dependencies. This release publishes the complete runtime package set
  (`root`, `-shared`, `-extension`, `-server`, `-web`) in lockstep, with
  inter-package dependency specifiers synchronised to the current version
  by a new `scripts/sync-versions.js` helper that runs between the version
  bump and the publish step. `packages/electron` remains `"private": true`
  and continues to ship as native installers (DMG/DEB/AppImage/EXE)
  attached to the GitHub Release, not via npm.
- **Bridge auto-registration path math** was off by one — fresh
  installs silently failed to register the dashboard bridge in pi's
  `~/.pi/agent/settings.json` because `baseDir` resolved to
  `<repo>/packages/` instead of `<repo>/`. Fix uses three `..` instead
  of two; adds success/failure log lines so future regressions surface
  loudly.
- **Extension server CLI resolution** in installed npm layouts —
  `resolveServerCliPath()` used sibling-path arithmetic that produced
  `@blackbelt-technology/server/src/cli.ts` (missing the
  `-dashboard-server` suffix) in the installed tree. Now uses
  `require.resolve('@blackbelt-technology/pi-dashboard-server/...')`
  which works in both monorepo and installed layouts.
- **Client directory resolution** in installed layouts — the server
  returned "No client build found" on installed packages because
  `clientSearchPaths[0]` used nested-`node_modules` arithmetic.
  Prepended a `require.resolve` path that works regardless of hoist.
- **Terminal X button on Windows** — now routes kill through
  `taskkill /F /T` with fallback cleanup so the whole process tree
  terminates.
- **Zrok scavenge on Unix** — `scavengeOrphanZrokProcesses` now kills
  the full process group (negative PID) so zrok's worker children
  die with it; Windows path unchanged (taskkill `/T` already tree-kills).
- **node-pty permissions in bundles** — hoist-aware permissions fix
  lands on all packaged Electron bundles (DMG / AppImage / NSIS).

### Deprecated
- **Direct `node:child_process` imports and `process.kill` calls**
  outside the `platform/` module are now architecturally forbidden
  (enforced by lint-style tests). Migrate to
  `@blackbelt-technology/pi-dashboard-shared/platform/exec` and
  `.../platform/process` respectively, or mark legitimate opt-outs
  with `// ban:child_process-ok` / `// platform-branch-ok`.

## [0.3.0] - 2026-04-20

### Added
- **LandingPage onboarding** — empty-state main pane renders three
  guided steps (① Setup credentials → ② Add folder → ③ Start session)
  with live state; each step collapses to a compact ✔ row once
  satisfied so returning users see a status strip rather than a wall
  of onboarding. Credentials detection consults both `/api/providers`
  (baseUrl + apiKey config) and `/api/provider-auth/status` (pi OAuth
  / auth.json), so OAuth-only setups count.
- **OpenSpec session-card lifecycle UI** — the attached-change row
  now shows an explicit `ChangeState` pill (PLANNING / READY /
  IMPLEMENTING / COMPLETE), a `Tasks N/M` button that opens a popover
  for toggling individual `tasks.md` checkboxes (with
  optimistic-concurrency line tokens), and an overflow `⋯` menu with
  **Archive anyway** for when artifacts are authored but
  manual-verification tasks remain unchecked. Bulk Archive moved to
  unattached sessions only.
- **Recommended extensions** — new *Packages* tab surfaces a curated
  set of pi extensions (`pi-anthropic-messages`, `pi-subagents`,
  `pi-flows`, `pi-web-access`, `pi-agent-browser`) with
  install/uninstall actions and live npm/GitHub enrichment. Missing
  *required* extensions trigger a top-of-page banner. The first-run
  wizard gained a matching step with already-installed entries greyed
  out.
- **Pi core version checker + updater** — header badge counts
  available updates for pi ecosystem core packages (pi, pi-dashboard,
  pi-model-proxy, …). A *Packages* settings section lists current →
  latest with per-package and "Update All" actions, live progress,
  and automatic session reload on success.
- **`ask_user` batch method** — new `{method: "batch", title,
  questions: [...]}` shape asks multiple related questions in one
  dialog; sequential execution via existing `ctx.ui.*` primitives,
  mid-batch cancellation returns partial results with
  `cancelled: true`. Forgiving argument coercion handles common LLM
  drift shapes (stringified `questions`, `input_type` wrapper
  flattening, `{label, value}` options, `header` / `question` →
  `title`). Backward compatible — existing single-method shapes
  unchanged.
- **Image paste in the OpenSpec explore dialog** — drop or paste
  screenshots directly into the explore prompt, matching the main
  command input (shared `useImagePaste` hook and `ImagePreviewStrip`
  component).
- **Error banner** — long LLM errors collapse to a summary line with
  *Retry* and *Copy* buttons; full detail expands on demand.
- **Model selector** — provider filter and multi-token typeahead
  search in the model picker; the same `ModelSelector` component now
  drives the default-model setting in *Settings*.
- **Anthropic payload transform extension** for the main session,
  delegating the transform to the shared `@pi/anthropic-messages`
  package.
- **Persistent editor PID registry** — spawned `code-server`
  processes are recorded to `~/.pi/dashboard/editor-pids.json`. On
  server boot, orphans from prior non-graceful exits (SIGKILL, crash,
  OOM, force-quit) are detected via cmdline ownership check and
  terminated (SIGTERM → 1 s grace → SIGKILL), freeing their bound
  port and `--user-data-dir` lockfile so next-click editor spawns
  don't collide.
- **Public marketing site** at `/site` (Astro + Tailwind + MDX +
  Preact), deployed to GitHub Pages via
  `.github/workflows/deploy-site.yml` with a 50 KB gzipped JS budget
  enforced in CI.
- **Cross-platform QA VMs** — new `qa/` Packer-based harness for
  Ubuntu / Windows / macOS base images plus clone → boot → test →
  destroy lifecycle scripts (`make build-*`, `make test-*`,
  `make manual-*`) to verify clean-state installation and runtime
  across platforms from a single command.

### Changed
- **Provider auth flow** — saving credentials now broadcasts
  `credentials_updated` to all sessions, refreshes the model
  registry, and pushes updated models to every connected client; the
  model selector updates in place with no manual reload. The OAuth
  device flow replaced its auto-popup with an explicit button so the
  browser no longer blocks it.
- **Path picker** — directory filtering moved server-side via a new
  `q` query param on `GET /api/browse` with 4-tier ranking
  (exact > prefix > word-boundary > substring), applied *before* the
  200-entry cap so best matches always survive. Client input is
  debounced with in-flight cancellation. Enter follows a strict state
  machine (exact > unique prefix > highlighted row), and a new
  `POST /api/browse/mkdir` endpoint creates folders inline.
- **Bundle size + HTTP compression** — web client is manually split
  into vendor chunks (React, markdown, syntax-highlighter,
  git-diff-view, xterm, dnd-kit, utilities), dropping the main chunk
  from 3.1 MB to ~570 KB (~150 KB gzipped). Fastify now compresses
  responses through `@fastify/compress` (gzip + deflate, 1 KB
  threshold); Brotli is intentionally disabled because the zrok free
  proxy stream-resets `content-encoding: br` responses under parallel
  browser load.
- **Sidebar brand mark** — the literal `π` glyph is replaced by an
  inline-SVG `PiLogo` component (`fill="currentColor"`, transparent
  background) that inherits theme colors. Applied to both
  `SessionList` (desktop) and `SessionSidebar` (alternate).
- **"Working" session indicator** — cards in the working state now
  render an animated diagonal barber-pole stripe alongside the
  existing opacity pulse, making working vs. waiting-on-user
  unambiguous at a glance. `prefers-reduced-motion` disables the
  animation but keeps the static stripes as a state cue.
- **Pin-folder button** — now reads `📌 Add folder` (tooltip: "Pin a
  folder to the sidebar") instead of the icon-only `📌+`.
- **Folder action bar** — removed the deprecated *+Terminal*
  quick-create button; use the *Terminals* tab instead.
- **File search** — replaced the `fd` binary dependency with a
  native Node.js directory walk, removing a platform-specific binary
  and simplifying Windows / portable packaging.

### Fixed
- **Test suite green baseline + jsdom unhandled errors** — restored a zero-failure `npm test` baseline (38 failing tests → 0; 2143 passed, 8 documented `.skip`s carrying `TODO(fix-failing-tests-followup)` markers). Fixes span assertion drift (auto-attach, PiResourcesView, SessionList, config, SessionCard), environment drift (git `master` → `main`, `os.homedir()` browse fixtures), component selectors (PinDirectoryDialog), and timing-flake skips in auto-shutdown / ws-ping-pong / session-lifecycle-logging. Also eliminated three vitest unhandled errors caused by jsdom gaps: `CommandInput` now optional-calls `scrollIntoView?.()`, and `QrCodeDialog` wraps `QRCode.toCanvas(...)` in `Promise.resolve(...).catch(…)` so headless-canvas rejections and `vi.fn()` mocks returning `undefined` no longer surface as "Errors 3".
- **Electron terminal spawn on macOS** — `node-pty`'s `spawn-helper` binary was shipped without execute permission in Electron bundles (npm hoisting skipped the postinstall fix), causing silent `posix_spawnp failed` errors. Added three-layer defense: build-time `chmod +x` + quarantine removal in `bundle-server.sh`, and a runtime permission fix in `createTerminalManager()` as fallback.
- **Zrok tunnel reliability** — eliminated stale
  `https://<token>.share.zrok.io` URLs returning 404 or "bad
  gateway!" caused by reservation leaks across restarts.
  `createTunnel()` is now serialized (concurrent calls share one
  in-flight promise), so UI double-clicks and the startup-auto /
  `/api/tunnel-connect` race no longer spawn parallel `zrok share`
  processes. The reserved-share retry is capped at 1 attempt and
  explicitly releases the old token before reserving a new one; the
  timeout path escalates SIGTERM → SIGKILL after a 2 s grace and
  releases just-in-time-reserved tokens; `POST /api/restart` and
  `POST /api/shutdown` now call `deleteTunnel(config.port)` before
  exit instead of bypassing the graceful-shutdown path; and an
  orphan-process scavenger sweeps any stray
  `zrok share … --override-endpoint http://localhost:<port>` agents
  that escaped pid-file tracking (runs on startup whenever the zrok
  binary is present, even in `--no-tunnel` mode).
- **Browser `ERR_ABORTED 500` on every asset over a zrok tunnel URL**
  — Vite emits `<script type="module" crossorigin>`, which forces
  browsers to request assets in CORS mode even same-origin; the
  server's CORS callback threw on unknown origins and
  `@fastify/cors` surfaced that as HTTP 500. The active tunnel URL
  and any `*.share.zrok.io` host are now auto-allowed, and unknown
  origins return `cb(null, false)` (no CORS headers, no 500) instead
  of throwing. Pre-compressed (`.gz`) sibling files are also now
  generated at build time and served by `@fastify/static` with
  stable `Content-Length` headers, avoiding streaming-compression
  edge cases in intermediate HTTP/2 proxies. (curl kept working
  throughout because it never sent an `Origin` header.)
- **Portable Windows + packaging** — `pi-coding-agent` is now
  resolved from the managed install under
  `~/.pi-dashboard/node_modules/` instead of expecting a system
  install, so portable zips work out of the box. The `node-pty`
  permissions fix is now hoist-aware (works regardless of which
  workspace triggered `npm install`).
- **Prompt templates** — resolved from global skills and installed
  packages in addition to the local project; template names are
  split on any whitespace so multi-line arguments work.
- **Packages UI freshness** — installed-packages list auto-refreshes
  after install / remove / update operations (no more stale counts);
  server now broadcasts `pi_core_update_complete` so the header
  badge refetches and clears.
- **Session fork + replay rendering** — leaf registry fix so forked
  sessions resolve their parent `entryId` correctly; assistant text
  in replay / fork messages now renders instead of showing an empty
  separator.
- **Terminal UX** — new terminal tabs auto-focus when created and
  the UI navigates to the folder view.
- **Miscellaneous** — Roles edit from the dashboard works again;
  `ask_user` argument validation rejects malformed payloads instead
  of silently misbehaving; the browser gateway logs handler errors
  instead of swallowing them.

### Docs
- README updated with Electron standalone install instructions,
  monorepo paths, and new feature callouts.
- OpenSpec proposals added for the dashboard-ux-fixes batch and the
  explore-dialog image-paste change.

## [0.2.0 – 0.2.9] - 2026-04-13 – 2026-04-16

*Initial public releases — installer and cross-platform CI hardening.*

These versions were primarily focused on getting CI to reliably produce
installers across macOS, Linux, and Windows (including arm64). The only
user-visible items worth calling out:

- npm package renamed to `@blackbelt-technology/pi-agent-dashboard` to match
  the GitHub repository (v0.2.1).
- Windows release artifacts now include a ZIP and a portable `.exe` in
  addition to the NSIS installer (v0.2.3).
- arm64 release artifacts added for Linux and Windows (v0.2.6).
- AppImage builds now work on Linux thanks to `libfuse2` in the CI image
  (v0.2.0).
- Docker cross-platform build pipeline added for producing Linux + Windows
  installers from macOS (v0.2.5).

For per-commit detail, see the Git history
(`git log v0.2.0..v0.2.9`).
