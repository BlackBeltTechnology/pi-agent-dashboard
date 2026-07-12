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

See change: group-tool-call-bursts — message-grouping `useMemo` now calls `groupToolBursts` (temporal burst-outer) instead of `groupConsecutiveToolCalls`; renders `<ToolBurstGroup>` for `type:"burst"` items, `<CollapsedToolGroup>` for bare `type:"group"` (sub-threshold poll). Keys bursts + groups by first-member `id` (NOT positional `idx`) so event-trim head churn cannot bleed collapse state. Auto-collapse SHRINK handled by the container's existing `overflowAnchor:"auto"` scroll anchoring.

See change: enhance-tool-call-grouping — passes `turnActive={state.status==="streaming"}` to `<ToolBurstGroup>` (threads to absorbed ThinkingBlocks); streaming-text bubble gains `chat-stream-live` class (edge-pulse glow + shimmer sweep) while `streamingText` active, settles static on stream end.

See change: virtualize-chat-transcript-tanstack (Phase 2 Step B) — windows the historical transcript via `@tanstack/react-virtual`. Builds `displayRows` = `groupedMessages` with the ~7 prefs-gated `return null` rows filtered out via `isRowVisible` (CR-5), so `count === displayRows.length`. `useVirtualizer({count, getScrollElement:()=>scrollRef.current, estimateSize:estimateVirtualRowSize, getItemKey:virtualRowKey, overscan:6, onChange:re-pin-if-sticky})`; renders `getVirtualItems()` as absolutely-positioned `measureElement` rows (each `data-index`) over a `getTotalSize()` spacer (`chat-cv-skip` neutralizes Step A there). Streaming/pending tail stays static siblings BELOW the spacer (CR-2, never virtualized). Container `overflowAnchor:"auto"→"none"` + `data-testid="chat-scroll-container"` (task 9.2); dropped `space-y-1` (rows absolute). DOM scroll machine PRESERVED (CR-1): `handleScroll`/`stickToBottomRef`/`showScrollButton`/auto-scroll effect measure the REAL container. `scrollToTurn` → `virtualizer.scrollToIndex(turnToFirstRowIndex.get(t),{align:"start"})` (works for off-screen turns). Per-session persistence now `{anchorRowId,offset,nearBottom}` in virtual coords (CR-6). Known regression: Cmd-F find over off-screen rows. jsdom needs the `virtualizer-jsdom.ts` setup shim (offsetHeight) so unit tests mount rows.

See change: fix-chat-scroll-to-top-estimate-drift — scroll-UP never converged on index 0 (largest rows near top under-estimated 10-50x; on mount `getTotalSize()` jumped, top receded). Fix (3 parts): (1) `estimateSize:(i)=>estimateVirtualRowSize(displayRows[i], rowTextChars[i])` where `rowTextChars = displayRows.map(computeRowTextChars)` precomputed once per useMemo — content-aware estimate shrinks the delta driving TanStack's built-in above-viewport correction. (2) Do NOT add a manual `scrollTop+=delta` (built-in `resizeItem` already corrects; a 2nd double-moves); keep `overflowAnchor:"none"` + no CSS `scroll-behavior:smooth`. (3) Scroll-to-TOP button (`showScrollTopButton`, top-center, symmetric to scroll-to-bottom) → `scrollToTop()` sets `ascendingRef=true`+`stickToBottomRef=false` then `virtualizer.scrollToIndex(0,{align:"start"})`. `scrollToIndex` is BOUNDED (`maxAttempts=10`) so `onChange` re-issues it while `ascendingRef && scrollTop>0` on any `grew` (covers async image-load remeasure); `handleScroll` ascending branch holds `stickToBottomRef` false so starting from the bottom can't re-arm the pin (re-arm race). `cancelDescent` (wheel/touch) clears `ascendingRef`. Convergence Playwright-gated; jsdom shim can't reproduce the scroll-timing race.

See change: preserve-chat-selection-during-churn — keeps an active text selection alive across transcript churn. Wires `useActiveChatSelection(scrollRef, mapChatRange)` → `{ isSelecting, selectionSpanRef }`. (D2) The `stickToBottom` `useLayoutEffect` early-returns while `isSelecting` (WITHOUT clearing `stickToBottomRef`) and the virtualizer `onChange` bottom-pin is gated on `!isSelectingRef.current`; `isSelecting` is added to the layout-effect dep array so the `→false` edge re-fires the pin (resyncs `lastScrollHeightRef` first via `wasSelectingRef`) — else the user is stranded when no content arrives after collapse. (D3) `rangeExtractor: (r) => extendRangeWithSelection(defaultRangeExtractor(r), selectionSpanRef.current, selectionCapRef.current, r.count)` unions selection-intersecting rows into the mounted range so they never unmount (`getTotalSize()` may change; no bolt-on rows). `mapChatRange` maps the live Range → row span via `rangeToRowIndexSpan` and, past the device-aware ceiling (`SELECTION_RETAIN_CAP_DESKTOP=100` / `_MOBILE=40` via `useMobile()`), ACTIVELY `removeAllRanges()` + returns null (no silent truncated copy). Path B (streaming tail) stays at baseline — deferred to follow-ups `preserve-streaming-tail-selection` + `chat-copy-fidelity-intercept`.
