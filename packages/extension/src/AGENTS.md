# DOX — packages/extension/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `abort-latch.ts` | Pure class `AbortLatch`. Keeps user abort latched so provider backoff (5–60s) outliving 2s persistent-abort… → see `abort-latch.ts.AGENTS.md` |
| `agent-settled.ts` | Bridge `agent_settled` normalization (pure). `nativeAgentSettledSupported(piVersion)` → pi ≥ 0.80.4 emits… → see `agent-settled.ts.AGENTS.md` |
| `artifact-roots.ts` | Artifact-root allowlist for Fix B bridge image inlining. `resolveArtifactRoots({homedir,env,realpathSync})` →… → see `artifact-roots.ts.AGENTS.md` |
| `ask-user-attachments.ts` | Persist image attachments for ask_user input responses. Exports `attachmentDirForSession`,… → see `ask-user-attachments.ts.AGENTS.md` |
| `ask-user-tool.ts` | Register `ask_user` pi tool at `session_start` (avoids static-name conflict). Exports `registerAskUserTool`. → see `ask-user-tool.ts.AGENTS.md` |
| `auto-session-namer.ts` | Automatic session topic-naming (bridge-side). Pure helpers `shouldSkipByPrefilter`, `parseTitle`,… → see `auto-session-namer.ts.AGENTS.md` |
| `bridge-context.ts` | Shared mutable bridge state + pure predicates. Exports `BridgeContext`, `DASHBOARD_NATIVE_COMMANDS`,… → see `bridge-context.ts.AGENTS.md` |
| `bridge-default-model-gate.ts` | Pure predicate `shouldApplyDefaultModel({reason, entryCount, hasModelRegistry, hasDefaultModel})`. → see `bridge-default-model-gate.ts.AGENTS.md` |
| `bridge.ts` | Main bridge extension entry (default export). Connects to dashboard server, forwards pi events via… → see `bridge.ts.AGENTS.md` |
| `command-handler.ts` | Command routing: `!`/`!!` bash, `/compact`, slash commands. → see `command-handler.ts.AGENTS.md` |
| `connection.ts` | WebSocket connection manager with exponential backoff reconnect, message buffering while disconnected,… → see `connection.ts.AGENTS.md` |
| `dashboard-context-injector.ts` | Registers `before_agent_start` handler. Splice-replaces trailing `Current working directory:` line of system… → see `dashboard-context-injector.ts.AGENTS.md` |
| `dashboard-default-adapter.ts` | Built-in last-resort `PromptAdapter` (priority `9999`). Exports `DashboardDefaultAdapter`. → see `dashboard-default-adapter.ts.AGENTS.md` |
| `dev-build.ts` | Dev build-on-reload helper. Exports `runDevBuild`, `DevBuildOptions`. → see `dev-build.ts.AGENTS.md` |
| `empty-actionable-guard-config.ts` | Resolve empty-actionable guard config from env. Exports `resolveGuardConfig(env)` → `{mode,retryCap}`. → see `empty-actionable-guard-config.ts.AGENTS.md` |
| `empty-actionable-guard.ts` | Bounded continue-or-surface decision for empty-actionable turns. → see `empty-actionable-guard.ts.AGENTS.md` |
| `event-forwarder.ts` | Map pi event objects to `event_forward` protocol messages. Exports `mapEventToProtocol`. → see `event-forwarder.ts.AGENTS.md` |
| `flow-event-wiring.ts` | Register pi-flows + pi-subagents event listeners on `pi.events`. → see `flow-event-wiring.ts.AGENTS.md` |
| `git-link-builder.ts` | Parse SSH/HTTPS remote URLs into branch + PR links. Exports `parseRemoteUrl`, `detectPlatform`,… → see `git-link-builder.ts.AGENTS.md` |
| `commit-draft.ts` | Pure AI-draft fallback ladder (no pi-SDK coupling). Exports `draftCommitMessage(deps)` → `{message, source}`,… → see `commit-draft.ts.AGENTS.md` |
| `commit-draft-agent.ts` | pi-SDK-coupled half of AI-draft. Exports `buildSessionContextText(ctx, maxChars)` (compacts… → see `commit-draft-agent.ts.AGENTS.md` |
| `git-poll.ts` | Exports `runGitPollTick(deps)` + `GitPollDeps` interface. Pure git + name/model poll-tick body. → see `git-poll.ts.AGENTS.md` |
| `hasui-flip.ts` | Flip `ctx.hasUI` to `true` after bridge patches `ctx.ui.*`. Exports `flipHasUI`. → see `hasui-flip.ts.AGENTS.md` |
| `markdown-image-inliner.ts` | Bridge helper rewriting assistant `![alt](path)` → `![alt](pi-asset:<hash>)` (SHA-256/16, MIME allowlist, 5… → see `markdown-image-inliner.ts.AGENTS.md` |
| `model-tracker.ts` | Diff-and-send trackers for model / session name / git info / pi version / cwd-missing. → see `model-tracker.ts.AGENTS.md` |
| `multiselect-decode.ts` | Pure helper decoding `PromptResponse` into `string[] | undefined`. → see `multiselect-decode.ts.AGENTS.md` |
| `multiselect-list.ts` | TUI multi-select component implementing pi-tui `ComponentLike`. Exports `MultiSelectList`, `ComponentLike`. → see `multiselect-list.ts.AGENTS.md` |
| `multiselect-polyfill.ts` | Polyfill `ctx.ui.multiselect`. Exports `polyfillMultiselect`, `PolyfillCtx`. → see `multiselect-polyfill.ts.AGENTS.md` |
| `process-metrics.ts` | Lightweight process metrics collector for bridge heartbeats. → see `process-metrics.ts.AGENTS.md` |
| `process-scanner.ts` | Detect child processes of a pi session. Exports `getOwnPgid`, `captureChildPgids`, `scanTrackedProcesses`,… → see `process-scanner.ts.AGENTS.md` |
| `project-trust.ts` | `project_trust` auto-decision (pure gate + defensive cwd read). → see `project-trust.ts.AGENTS.md` |
| `prompt-bus.ts` | Prompt dispatch bus — first-response-wins adapter routing + cross-adapter dismissal. → see `prompt-bus.ts.AGENTS.md` |
| `prompt-expander.ts` | Expand prompt templates from disk for dashboard slash commands (`pi.sendUserMessage` skips expansion). → see `prompt-expander.ts.AGENTS.md` |
| `provider-register.ts` | Register custom LLM providers + auto-discovered models from `~/.pi/agent/providers.json`. → see `provider-register.ts.AGENTS.md` |
| `subagent-frame-buffer.ts` | Pure class `SubagentFrameBuffer` + `SUBAGENT_CHANNELS` set. Makes running-subagent timeline reconcilable. → see `subagent-frame-buffer.ts.AGENTS.md` |
| `retry-tracker.ts` | Pure helper class `RetryTracker` synthesizes `auto_retry_start` / `auto_retry_end` by OBSERVING pi's own… → see `retry-tracker.ts.AGENTS.md` |
| `role-manager.ts` | Manages session model roles. Registers six `roles:*` handlers… → see `role-manager.ts.AGENTS.md` |
| `role-model-tools.ts` | Agent-facing tools registered via `pi.registerTool` (capability agent-role-model-tools). → see `role-model-tools.ts.AGENTS.md` |
| `server-auto-start.ts` | Auto-start orchestration: discover dashboard via mDNS → health-check fallback → spawn server process. → see `server-auto-start.ts.AGENTS.md` |
| `server-launcher.ts` | Spawns dashboard server as detached process via shared `launchDashboardServer`. → see `server-launcher.ts.AGENTS.md` |
| `server-probe.ts` | TCP port probe. Exports `isPortOpen(port)` — 1s timeout localhost connect, resolves `true` on connect else `false`. Detects running dashboard server. |
| `session-sync.ts` | Session register/replay/switch lifecycle. Exports `sendStateSync`, `replaySessionEntries`,… → see `session-sync.ts.AGENTS.md` |
| `slash-dispatch.ts` | Extension slash-command dispatch (routing-step 9). Exports `tryDispatchExtensionCommand`, `FeedbackSink`,… → see `slash-dispatch.ts.AGENTS.md` |
| `source-detector.ts` | Detects session source env. Exports `detectSessionSource(hasUI?, sessionFile?)` → `SessionSource`. → see `source-detector.ts.AGENTS.md` |
| `tool-result-image-inliner.ts` | Bridge Fix B tool-result image inliner. On `tool_execution_end` scans result text for absolute image paths… → see `tool-result-image-inliner.ts.AGENTS.md` |
| `turn-actionability.ts` | Pure provider-agnostic classifier. Exports `classifyTurnActionability(turn)` →… → see `turn-actionability.ts.AGENTS.md` |
| `ui-modules.ts` | Extension UI system bridge side. Exports `refreshUiModules`, `subscribeUiInvalidate`, `handleUiManagement`,… → see `ui-modules.ts.AGENTS.md` |
| `vcs-info.ts` | Gathers git branch/remote/PR/worktree info via shared platform git helpers. → see `vcs-info.ts.AGENTS.md` |
| `visibility-intent.ts` | Resolves `session_register` visibility fields. Exports `resolveVisibilityIntent`,… → see `visibility-intent.ts.AGENTS.md` |
