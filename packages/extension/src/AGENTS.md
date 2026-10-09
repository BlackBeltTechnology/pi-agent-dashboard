# DOX — packages/extension/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `abort-latch.ts` | Pure class `AbortLatch`. Keeps user abort latched so provider backoff (5–60s) outliving 2s persistent-abort… → see `abort-latch.ts.AGENTS.md` |
| `artifact-roots.ts` | Artifact-root allowlist for Fix B bridge image inlining. `resolveArtifactRoots({homedir,env,realpathSync})` →… → see `artifact-roots.ts.AGENTS.md` |
| `ask-user-attachments.ts` | Persist image attachments for ask_user input responses. Exports `attachmentDirForSession`,… → see `ask-user-attachments.ts.AGENTS.md` |
| `ask-user-tool.ts` | Register `ask_user` pi tool at `session_start` (avoids static-name conflict). Exports `registerAskUserTool`. → see `ask-user-tool.ts.AGENTS.md` |
| `auto-session-namer.ts` | Automatic session topic-naming (bridge-side). Pure helpers `shouldSkipByPrefilter`, `parseTitle`,… → see `auto-session-namer.ts.AGENTS.md` |
| `autostart-guard.ts` | Worktree auto-start refusal + durable log. Exports `isWorktreeCliPath`, `shouldRefuseWorktreeAutoStart`, `appendAutoStartLog`. See change: fix-worktree-server-autostart-leak. |
| `autostart-lock.ts` | Single-flight auto-start lock at `~/.pi/dashboard/autostart-<port>.lock`. → see `autostart-lock.ts.AGENTS.md` |
| `bridge-activation.ts` | Activation gate `shouldActivateBridge(env, readConfig)`: `bridgeEnvOverride(env)` (`PI_DASHBOARD_BRIDGE`… → see `bridge-activation.ts.AGENTS.md` |
| `bridge-context.ts` | Shared mutable bridge state + pure predicates. Exports `BridgeContext`, `DASHBOARD_NATIVE_COMMANDS`,… → see `bridge-context.ts.AGENTS.md` |
| `bridge-default-model-gate.ts` | Pure predicate `shouldApplyDefaultModel({reason, entryCount, hasModelRegistry, hasDefaultModel,… → see `bridge-default-model-gate.ts.AGENTS.md` |
| `bridge-polling.ts` | Testable seams from `bridge.ts` to the poll-cost machinery: `createPollingHolder` (scan + tracker, replace… → see `bridge-polling.ts.AGENTS.md` |
| `bridge-ticket-client.ts` | Mints the credential a REMOTE bridge needs to open a gateway connection (§6 made TCP bridge auth mandatory). → see `bridge-ticket-client.ts.AGENTS.md` |
| `bridge.ts` | Main bridge extension entry (default export). Connects to dashboard server, forwards pi events via… → see… → see `bridge.ts.AGENTS.md` |
| `command-handler.ts` | Command routing: `!`/`!!` bash, `/compact`, slash commands. → see `command-handler.ts.AGENTS.md` Team `/skill:` route → see `command-handler.ts.AGENTS.md`. See change: add-team-skill-access. |
| `connect-target.ts` | `parseConnectTarget()` / `describeConnectTarget()` — parses the overloaded `/dashboard connect <target>`… → see `connect-target.ts.AGENTS.md` |
| `connection.ts` | WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected,… → see… → see `connection.ts.AGENTS.md` |
| `custom-entry-forward.ts` | Pure mappers for the bridge's custom-content forwarding: `toCustomEntryForward(entry)` (null for… → see `custom-entry-forward.ts.AGENTS.md` |
| `dashboard-context-injector.ts` | Registers `before_agent_start` handler. Splice-replaces trailing `Current working directory:` line of system… → see `dashboard-context-injector.ts.AGENTS.md` |
| `dashboard-default-adapter.ts` | Built-in last-resort `PromptAdapter` (priority `9999`). Exports `DashboardDefaultAdapter`. → see `dashboard-default-adapter.ts.AGENTS.md` |
| `dev-build.ts` | Dev build-on-reload helper. Exports `runDevBuild`, `DevBuildOptions`. → see `dev-build.ts.AGENTS.md` |
| `empty-actionable-guard-config.ts` | Resolve empty-actionable guard config from env. Exports `resolveGuardConfig(env)` → `{mode,retryCap}`. → see `empty-actionable-guard-config.ts.AGENTS.md` |
| `empty-actionable-guard.ts` | Bounded continue-or-surface decision for empty-actionable turns. → see `empty-actionable-guard.ts.AGENTS.md` |
| `endpoint-resolution.ts` | Pure D3 precedence ladder + D4 stickiness decisions; the only place the bridge chooses an endpoint. → see `endpoint-resolution.ts.AGENTS.md` |
| `extension-identity.ts` | NEW. `bridgeExtensionIdentity()` (cached) / `resolveExtensionIdentity(dir)`: nearest package dir (realpath) +… → see `extension-identity.ts.AGENTS.md` |
| `git-dir-watcher.ts` | Non-recursive `fs.watch` on a session's git dir; routes HEAD/refs events to the fast lane, index to the slow lane. → see `git-dir-watcher.ts.AGENTS.md` |
| `git-probe-scheduler.ts` | Pure two-lane debounced scheduler for the async `git status` probe. → see `git-probe-scheduler.ts.AGENTS.md` |
| `git-tracker.ts` | Per-bridge git state: facts cache, HEAD-file branch, async status probe, watcher. → see `git-tracker.ts.AGENTS.md` |
| `instance-verification.ts` | "Is this the dashboard I meant?" — the question no local credential answers (socket mode + local token are per-HOME, so every same-HOME inst. → see `instance-verification.ts.AGENTS.md` |
| `event-forwarder.ts` | Map pi event objects to `event_forward` protocol messages. Exports `mapEventToProtocol`. → see `event-forwarder.ts.AGENTS.md` |
| `flow-event-wiring.ts` | Register pi-flows + pi-subagents event listeners on `pi.events`. → see `flow-event-wiring.ts.AGENTS.md` |
| `followup-buffer.ts` | Bridge-owned follow-up buffer, extracted from `bridge.ts` so admission is testable + the byte ceiling… → see `followup-buffer.ts.AGENTS.md` |
| `git-link-builder.ts` | Parse SSH/HTTPS remote URLs into branch + PR links. Exports `parseRemoteUrl`, `detectPlatform`,… → see `git-link-builder.ts.AGENTS.md` |
| `commit-draft.ts` | Pure AI-draft fallback ladder (no pi-SDK coupling). Exports `draftCommitMessage(deps)` → `{message, source}`,… → see `commit-draft.ts.AGENTS.md` |
| `commit-draft-agent.ts` | pi-SDK-coupled half of AI-draft. Exports `buildSessionContextText(ctx, maxChars)` (compacts… → see `commit-draft-agent.ts.AGENTS.md` |
| `git-poll.ts` | Exports `runGitPollTick(deps): Promise<void>`, `createGitPollState`, `GitPollDeps`. Poll-tick body; version every 10th tick. → see `git-poll.ts.AGENTS.md` |
| `hasui-flip.ts` | Flip `ctx.hasUI` to `true` after bridge patches `ctx.ui.*`. Exports `flipHasUI`. → see `hasui-flip.ts.AGENTS.md` |
| `local-token-header.ts` | Bridge side of D6: `readLocalToken(env?)` (`~/.pi/dashboard/local/token`, trimmed; empty ⇒ undefined) +… → see `local-token-header.ts.AGENTS.md` |
| `markdown-image-inliner.ts` | Bridge helper rewriting assistant `![alt](path)` → `![alt](pi-asset:<hash>)` (SHA-256/16, MIME allowlist, 5… → see `markdown-image-inliner.ts.AGENTS.md` |
| `mcp-token-delivery.ts` | Bridge-side per-session registration of the dashboard MCP server with pi's BUILT-IN MCP. → see `mcp-token-delivery.ts.AGENTS.md` |
| `message-update-coalescer.ts` | Bridge-side coalescer for streaming text snapshots. Exports `COALESCE_WINDOW_MS` (50), class… → see `message-update-coalescer.ts.AGENTS.md` |
| `model-refresh.ts` | Shared `ModelRegistry.refresh()` handling: `reportRefresh(pending,label)` surfaces abort/per-provider errors… → see `model-refresh.ts.AGENTS.md` |
| `model-tracker.ts` | Diff-and-send trackers for model / session name / git info / pi version / cwd-missing; `readRunningPiVersion`… → see `model-tracker.ts.AGENTS.md` |
| `multiselect-decode.ts` | Pure helper decoding `PromptResponse` into `string[] | undefined`. → see `multiselect-decode.ts.AGENTS.md` |
| `multiselect-list.ts` | TUI multi-select component implementing pi-tui `ComponentLike`. Exports `MultiSelectList`, `ComponentLike`. → see `multiselect-list.ts.AGENTS.md` |
| `multiselect-polyfill.ts` | Polyfill `ctx.ui.multiselect`. Exports `polyfillMultiselect`, `PolyfillCtx`. → see `multiselect-polyfill.ts.AGENTS.md` |
| `notify-proxy.ts` | `createNotifyProxy({sessionId, send, originalNotify, newId?})` — builds the `ctx.ui.notify` replacement… → see `notify-proxy.ts.AGENTS.md` |
| `openspec-cli-shim.ts` | Provision bare `openspec` in-session: shim pinned CLI onto `process.env.PATH` at bridge init (fail-soft). Exports `provisionOpenspecCli`,… → see `openspec-cli-shim.ts.AGENTS.md` |
| `pi-env.d.ts` | Ambient fallback declarations for current `@earendil-works/pi-*` hosts (fork aliases removed — → see `pi-env.d.ts.AGENTS.md` |
| `pi-retry-settings.ts` | READ-ONLY reader for pi's own retry policy. Exports… → see `pi-retry-settings.ts.AGENTS.md` |
| `plugin-event-forward-registry.ts` | Plugin-declared bus forwarding. `PluginForwardRegistry(bus, deps{send,isSessionReady,isActive,isConnected,isCoreChannel})`: `attach()` listens on `dashboard:register-event-forward` then emits `dashboard:bridge-ready`; `declare`, `flush`, `declaredChannels`, `stats`, `dispose`. Delivery `live` (ready+active) / `latest` / `stream` (retained in `StreamForwardBuffer` until ready+active+connected). First owner wins; core-channel + cross-plugin conflicts counted. See change: add-plugin-bridge-contributions. |
| `plugin-request-client.ts` | Bridge half of the private plugin request lane (no pi dep). → see `plugin-request-client.ts.AGENTS.md` |
| `poll-cost.ts` | Cumulative poll-cost counters spread into heartbeat metrics. → see `poll-cost.ts.AGENTS.md` |
| `pr-status.ts` | Per-bridge async PR-status scheduler (`gh pr view` off the tick). Exports `createPrStatusScheduler`, `handleGitInfoRefresh`,… → see `pr-status.ts.AGENTS.md` |
| `process-metrics.ts` | Lightweight process metrics collector for bridge heartbeats. → see `process-metrics.ts.AGENTS.md` |
| `process-scan-scheduler.ts` | Pure adaptive (fast/idle) scheduler for the async child-process scan. → see `process-scan-scheduler.ts.AGENTS.md` |
| `process-scanner.ts` | Detect child processes from ONE `ps -A` / CIM snapshot. Exports `getOwnPgid`, `scanChildProcesses`, `scanChildProcessesAsync`,… → see `process-scanner.ts.AGENTS.md` |
| `project-trust.ts` | `project_trust` auto-decision (pure gate + defensive cwd read). → see `project-trust.ts.AGENTS.md` |
| `pending-prompt-emitter.ts` | ONE emitter for re-sending every PromptBus prompt still awaiting an answer — shared by `onReconnect` replay… → see `pending-prompt-emitter.ts.AGENTS.md` |
| `prompt-bus.ts` | Prompt dispatch bus — first-response-wins adapter routing + cross-adapter dismissal. → see `prompt-bus.ts.AGENTS.md` |
| `prompt-expander.ts` | Expand prompt templates from disk for dashboard slash commands (`pi.sendUserMessage` skips expansion). `readTemplate` exported — team `/skill:` route reads granted `<root>/SKILL.md` through it. → see `prompt-expander.ts.AGENTS.md` |
| `prompt-meta.ts` | `buildPromptMeta(opts, explicitMessage?)` — dialog `metadata`: `message`, `toolCallId`, plus validated… → see `prompt-meta.ts.AGENTS.md` |
| `provider-register.ts` | Register custom LLM providers + auto-discovered models from `~/.pi/agent/providers.json`. → see `provider-register.ts.AGENTS.md` |
| `session-move.ts` | `createMoveCoordinator()` + `MOVE_TIMEOUT` — two-connection move handover; forwards path-gate frames via `onServerMessage`. → see `session-move.ts.AGENTS.md` |
| `stream-forward-buffer.ts` | Bounded retention for `latest`/`stream` plugin channels. `StreamForwardBuffer`: one buffer keyed by (pluginId, key value) preserving cross-channel order; 2000 msgs / 2MiB per key; 64-key shared budget, drop-oldest counted; `keyCount` getter. See change: add-plugin-bridge-contributions. |
| `subagent-fanout-admission.ts` | Pure `decideAdmission` (in-flight count + resolved config + saturated → `admit` / `refuse{cause,reason}`) +… → see `subagent-fanout-admission.ts.AGENTS.md` |
| `subagent-forward-sites.ts` | The two subagent forward paths that call `sendEventForward` directly, extracted so strip PLACEMENT is… → see `subagent-forward-sites.ts.AGENTS.md` |
| `subagent-frame-buffer.ts` | Pure class `SubagentFrameBuffer` + `SUBAGENT_CHANNELS` set. Makes running-subagent timeline reconcilable. → see `subagent-frame-buffer.ts.AGENTS.md` |
| `subagent-frame-strip.ts` | Drops `details.entries` from `queued`/`running` subagent frames on the forward path. → see `subagent-frame-strip.ts.AGENTS.md` |
| `subagent-saturation.ts` | Private pressure sampler for fan-out admission: own `monitorEventLoopDelay` histogram over a fixed 5 s window… → see `subagent-saturation.ts.AGENTS.md` |
| `subagent-tick-throttle.ts` | Bridge-side rate limiter for subagent `Agent` tool `tool_execution_update` ticks (WIRE cost; the parent… → see `subagent-tick-throttle.ts.AGENTS.md` |
| `retry-tracker.ts` | Pure helper class `RetryTracker` synthesizes `auto_retry_start` / `auto_retry_end` by OBSERVING pi's own… → see `retry-tracker.ts.AGENTS.md` |
| `role-manager.ts` | Manages session model roles. Registers six `roles:*` handlers… → see `role-manager.ts.AGENTS.md` Sole WRITER… → see `role-manager.ts.AGENTS.md` |
| `role-model-tools.ts` | Agent-facing tools registered via `pi.registerTool` (capability agent-role-model-tools). → see `role-model-tools.ts.AGENTS.md` |
| `remote-registration-gate.ts` | Pre-register D8 gate for REMOTE endpoints: `isRemoteEndpoint`, `httpBaseUrlFor`, `gateRemoteRegistration`… → see `remote-registration-gate.ts.AGENTS.md` |
| `server-pin-store.ts` | `~/.pi/dashboard/pinned-servers.json` (0600) — server identities pinned at pairing time, keyed by FINGERPRINT… → see `server-pin-store.ts.AGENTS.md` |
| `server-auto-start.ts` | Auto-start orchestration: discover dashboard via mDNS → health-check fallback → spawn server process. → see `server-auto-start.ts.AGENTS.md` |
| `server-launcher.ts` | Spawns dashboard server as detached process via shared `launchDashboardServer`. → see `server-launcher.ts.AGENTS.md` |
| `server-probe.ts` | TCP port probe. Exports `isPortOpen(port)` — 1s timeout localhost connect, resolves `true` on connect else `false`. Detects running dashboard server. |
| `session-sync.ts` | Session register/replay/switch lifecycle. Exports `sendStateSync`, `replaySessionEntries`,… → see `session-sync.ts.AGENTS.md` |
| `slash-dispatch.ts` | Extension slash-command dispatch (routing-step 9): ONE in-process… → see `slash-dispatch.ts.AGENTS.md` |
| `source-detector.ts` | Detects session source env. Exports `detectSessionSource(hasUI?, sessionFile?)` → `SessionSource`. → see `source-detector.ts.AGENTS.md` |
| `terminal-reload.ts` | In-process terminal-hosted `/reload`. Exports `createTerminalReload({pi,getSessionId,mintToken?})` →… → see `terminal-reload.ts.AGENTS.md` |
| `tool-result-image-inliner.ts` | Bridge Fix B tool-result image inliner. On `tool_execution_end` scans result text for absolute image paths… → see `tool-result-image-inliner.ts.AGENTS.md` |
| `transcript-backfill.ts` | `readTranscriptChunk(file, cursor, {maxBytes})` + `makeCursor()` — bounded resumable `.jsonl` reads for D12's… → see `transcript-backfill.ts.AGENTS.md` |
| `transport-diagnostics.ts` | `createTransportDiagnostics()` — bounded buffer (32, oldest dropped) that turns the endpoint decision + every… → see `transport-diagnostics.ts.AGENTS.md` |
| `tui-prompt-adapter.ts` | Production PromptBus adapter for Pi's TUI. Exports `createTuiPromptAdapter`, `TuiPromptUi`. → see `tui-prompt-adapter.ts.AGENTS.md` |
| `turn-actionability.ts` | Pure provider-agnostic classifier. Exports `classifyTurnActionability(turn)` →… → see `turn-actionability.ts.AGENTS.md` |
| `ui-modules.ts` | Extension UI system bridge side. Exports `refreshUiModules`, `subscribeUiInvalidate`, `handleUiManagement`,… → see `ui-modules.ts.AGENTS.md` |
| `ui-stale-guard.ts` | `runUiSafely(fn)` — runs a `ctx.ui` thunk and absorbs the throw when the extension ctx has been invalidated… → see `ui-stale-guard.ts.AGENTS.md` |
| `usage-drain.ts` | Non-message usage drain. `UsageDrain` cursor `{sessionId,lastEntryId}` over `getEntries()`: `baseline(sm)` →… → see `usage-drain.ts.AGENTS.md` |
| `vcs-info.ts` | Gathers git branch/remote/PR/worktree info via shared platform git helpers. → see `vcs-info.ts.AGENTS.md` |
| `visibility-intent.ts` | Resolves `session_register` visibility fields. Exports `resolveVisibilityIntent`,… → see `visibility-intent.ts.AGENTS.md` |
