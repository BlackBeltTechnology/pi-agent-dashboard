# ChatView.tsx — index

`msg.view` rows render as `<PreviewCard target={msg.view}>` (right-aligned, `bubbleMax` width) BEFORE role-based branching — default user/agent bubble suppressed. See change: render-file-previews.

Mounts `<ChatViewMenu sessionId={...}>` in toolbar.

Reads `prefs = useDisplayPrefs(sessionId)`; gates `<ThinkingBlock>` on `prefs.thinking`, `<ToolCallStep>` on `prefs.toolCalls[toolCallPrefKey(name)]` (ask_user always shown), turn separators on `prefs.turnSeparators`.

Passes `showResultBody={prefs.toolResultBodies}` to `<ToolCallStep>`.

See change: configurable-chat-display.

Sticky-bottom auto-scroll via `useLayoutEffect` (synchronizes scroll before paint, avoids per-line jumps). `stickToBottomRef` chases new content until scroll-up or `scrollToTurn`; re-arms on scroll-to-bottom button or near-bottom (`SCROLL_THRESHOLD`). Scroll-to-bottom uses `behavior: "instant"` while `streamingText`/`streamingThinking`/`pendingSteering` active, else `"smooth"`. Scroll container `overflowAnchor: "auto"`. Per-session scroll position persisted across switches. Replaces old `markProgrammatic`/`programmaticScroll` suppression window. See change: fix-chat-scroll-race-during-replay.

**User-message branch routes to `<SkillInvocationCard>` when `msg.skill` is set** (raw `<MessageBubble>` for plain users); container preserves `mt-4 mb-4 flex justify-end` + `bubbleMax`. See change: render-skill-invocations-collapsibly.

See change: unify-status-banner-and-terminal-limit-stop — banner mounts removed; `filteredMessages` drops entries with `retriedFrom`; `onDismissError` / `onRetryAfterError` removed from `Props`.

See change: honest-mid-turn-queue-surface. onCancelPending prop removed from Props + destructure. Steering ghost-bubble rendering kept display-only.

Renders `inlineTerminal` role via `InlineTerminalCard`; `onCloseInlineTerminal` prop. See change: add-inline-terminal-card.

`bashOutput` branch renders `<MissingToolInlineError>` when `args.missingTool.kind==="missing-tool"`. See change: register-bash-and-tool-install-help.

New optional prop `loadingHistory?: boolean`. Empty-state 3-way: `loadingHistory && messages empty` → spinner (`mdiLoading` animate-spin + i18n "Loading conversation…"); else messages empty → "No messages yet"; else bubbles. See change: show-chat-history-loading-indicator.

Wraps message list in `FilePreviewProvider`; renders single `FilePreviewHost`. See change: fix-file-preview-survives-message-churn.

`bashOutput` branch passes `args.source` to `BashOutputCard source={...}`. See change: add-dashboard-slash-commands.

See change: unify-error-retry-lifecycle — computes `surfaceActive = !!(lastError||retryState)`; `findSurfaceSuppressedErrorIds` collapses trailing inline failed-tool card to `RetriedErrorBadge` while surface active (single-red-surface). Optimistic pending-prompt card re-activated, idle-scoped; sending/sent states off `pendingPrompt.status`; removed `queuedTexts` suppression; sweep clipped via `prompt-sending-fx`. See change: optimistic-prompt-progress.
