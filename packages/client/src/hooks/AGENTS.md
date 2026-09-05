# DOX — packages/client/src/hooks

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `useActiveChatSelection.ts` | `useActiveChatSelection(containerRef, mapRange) → { isSelecting, isSelectingRef, selectionSpanRef,… → see `useActiveChatSelection.ts.AGENTS.md` |
| `useAnthropicPeerProbe.ts` | `useAnthropicPeerProbe() -> { peerMissing, peerReason }` for the Anthropic OAuth row hint. → see `useAnthropicPeerProbe.ts.AGENTS.md` |
| `useAppHidden.ts` | NEW. Exports `useAppHidden()` hook + `applyAppHiddenClass(root, hidden)`. → see `useAppHidden.ts.AGENTS.md` |
| `useArchiveListing.ts` | Fetches `GET /api/openspec-archive?cwd=` into `entries: ArchiveEntry[]` with `isLoading`/`error`. → see `useArchiveListing.ts.AGENTS.md` |
| `useAsyncAction.ts` | `useAsyncAction(fn, opts) → { pending, error, run, bind }`. Wraps async action. → see `useAsyncAction.ts.AGENTS.md` |
| `useAuthStatus.ts` | Fetches `GET /auth/status` into `authStatus: AuthStatus | null` (`authenticated`, `authEnabled`, `user`) with… → see `useAuthStatus.ts.AGENTS.md` |
| `useContentViews.ts` | URL-routing navigation helpers. `handleOpenDirectorySettings(cwd)` (renamed from `handleOpenPiResources`,… → see `useContentViews.ts.AGENTS.md` |
| `useDebugToolsVisible.ts` | Deprecated shim over `useDisplayPrefs().debugTools`. Exports `DEBUG_TOOL_NAMES` set +… → see `useDebugToolsVisible.ts.AGENTS.md` |
| `useDisplayPrefs.ts` | `useDisplayPrefs(sessionId?): DisplayPrefs` — reads context, returns `mergeDisplayPrefs(global,… → see `useDisplayPrefs.ts.AGENTS.md` |
| `useDocumentTitle.ts` | Sets `document.title` via `buildDocumentTitle(session, folderCwd)`; resets to `"PI Dashboard"` on cleanup. Re-runs on `session`/`folderCwd` change. |
| `useFolderUrgencySort.ts` | Per-folder opt-in urgency-sort pref. Default off. localStorage key dashboard:folder-urgency-sort… → see `useFolderUrgencySort.ts.AGENTS.md` |
| `useHostPlatform.ts` | One-shot probe of `/api/health` `platform` field. Returns host OS (darwin\|win32\|linux) for Settings → Tools… → see `useHostPlatform.ts.AGENTS.md` |
| `useImagePaste.ts` | Clipboard-image-paste state. Supports uncontrolled (owns `pendingImages`) and controlled… → see `useImagePaste.ts.AGENTS.md` |
| `useInflightBashTools.ts` | Pure selector `selectInflightBashTools(state)` + memoized hook `useInflightBashTools(state)`. → see `useInflightBashTools.ts.AGENTS.md` |
| `useInitStatus.ts` | `useInitStatus(cwd) → { status: WorktreeInitStatus\|null, refetch }`. → see `useInitStatus.ts.AGENTS.md` |
| `useInstalledPackages.ts` | Fetches `GET /api/packages/installed?scope=&cwd=` into `packages: InstalledPackage[]` with… → see `useInstalledPackages.ts.AGENTS.md` |
| `useInstallPrompt.ts` | PWA install-prompt state. Returns `{ canInstall, isInstalled, isIOS, prompt }`. → see `useInstallPrompt.ts.AGENTS.md` |
| `useLaunchSource.ts` | One-shot probe of `/api/health` `launchSource` field (`"electron" | "standalone" | "bridge"`). → see `useLaunchSource.ts.AGENTS.md` |
| `useMainSpecsReader.ts` | Reads `openspec/specs/` directory, fetches each `spec.md` in parallel, concatenates into single markdown… → see `useMainSpecsReader.ts.AGENTS.md` |
| `useMediaQuery.ts` | Re-export shim. Forwards `useMediaQuery` from `@blackbelt-technology/pi-dashboard-client-utils/useMediaQuery`. Migration Layer 0. |
| `useMessageHandler.ts` | New `case "view_messages_update"`: replaces `viewMessagesMap.get(sessionId)` with `msg.viewMessages.slice()`. → see `useMessageHandler.ts.AGENTS.md` |
| `useMobile.tsx` | Re-export shim. Forwards `useMobile` from `@blackbelt-technology/pi-dashboard-client-utils/useMobile`. Migration Layer 0. |
| `useOpenSpecActions.ts` | OpenSpec action callbacks. `handleOpenSpecRefresh`/`handleBulkArchive` send WS… → see `useOpenSpecActions.ts.AGENTS.md` |
| `useOpenSpecReader.ts` | Fetches OpenSpec change artifact content. `activeTab` derives from URL `initialArtifact` (single source of… → see `useOpenSpecReader.ts.AGENTS.md` |
| `usePackageOperations.ts` | Subscriber over singleton `packageQueue`. Returns `operation`, `install`/`remove`/`update` (enqueue),… → see `usePackageOperations.ts.AGENTS.md` |
| `usePackageSearch.ts` | Debounced npm package search via `GET /api/packages/search?q=&type=`. → see `usePackageSearch.ts.AGENTS.md` |
| `usePendingPromptTimeout.ts` | Calls `onTimeout` after 30s if `hasPendingPrompt` stays true and `paused` is false. → see `usePendingPromptTimeout.ts.AGENTS.md` |
| `usePiChangelog.ts` | Lazy hook (enabled gate). Refetches on `pi_core_update_complete` WS event for matching `pkg`. Never throws. See change: pi-update-whats-new-panel. |
| `usePiCompatibility.ts` | NEW. Fetches `/api/health` on mount + every 60s (instance-scoped: invoke ONCE per panel, pass fields down). → see `usePiCompatibility.ts.AGENTS.md` |
| `usePiCoreVersions.ts` | Fetches `GET /api/pi-core/versions` into `status: PiCoreStatus` with `isLoading`/`error`/`refresh(force?)`. Polls every 30 min. Force-refreshes on `pi-core-event` `pi_core_update_complete`. |
| `usePiResourceFileFetch.ts` | Fetches `GET /api/pi-resource-file?path=` into `{ content, isLoading, error }`. → see `usePiResourceFileFetch.ts.AGENTS.md` |
| `usePiResources.ts` | Fetches `GET /api/pi-resources?cwd=&refresh=` into `data: PiResourcesResult` with… → see `usePiResources.ts.AGENTS.md` |
| `useResourceActivation.ts` | Owns the Resources-surface activation UX. `useResourceActivation(cwd?)` → `{isEnabled,… → see `useResourceActivation.ts.AGENTS.md` |
| `usePluginEnabledSet.ts` | Drives `registry.setEnabledSet(ids)` from `/api/health.plugins[]` snapshot on mount + on every… → see `usePluginEnabledSet.ts.AGENTS.md` |
| `usePluginToggle.tsx` | Exports `usePluginList`, `usePluginToggle`, `applyDesiredEnabled`. → see `usePluginToggle.tsx.AGENTS.md` |
| `usePopoverFlip.ts` | Shared viewport-anchored popover positioning hook. `usePopoverFlip(triggerRef, { open, estimatedHeight?,… → see `usePopoverFlip.ts.AGENTS.md` |
| `useProvidersReady.ts` | Polls `/api/providers` + `/api/provider-auth/status`, returns `ProvidersReadyState` (`loading`, `ready`,… → see `useProvidersReady.ts.AGENTS.md` |
| `useRecommendedExtensions.ts` | Fetches `GET /api/packages/recommended`, returns `EnrichedRecommendedExtension[]` +… → see `useRecommendedExtensions.ts.AGENTS.md` |
| `useSessionActions.ts` | Session action callbacks extracted from App.tsx. Sends… → see `useSessionActions.ts.AGENTS.md` |
| `useSessionDiff.ts` | Fetches `GET /api/session-diff?sessionId=`, returns `SessionDiffResponse` + `isLoading`/`error`/`refresh`. Refetches on `sessionId` change. Exports `useSessionDiff`, `UseSessionDiffResult`. |
| `useSessionState.ts` | Embed-side session-state accumulator. Exports `useSessionState(sessionId?)` (`{state, apply, reset}`) and the… → see `useSessionState.ts.AGENTS.md` |
| `useSidebarState.ts` | Persists sidebar `width` + `collapsed` to `localStorage` (`dashboard:sidebar-width`,… → see `useSidebarState.ts.AGENTS.md` |
| `useStaleToolReconcile.ts` | Session-scoped stale running-tool heal (survives transcript virtualization). → see `useStaleToolReconcile.ts.AGENTS.md` |
| `useSubagentResyncCadence.ts` | Open-inspector liveness (D4 v1): a mounted detail view re-fires `subagent_resync_request` on a backoff… → see `useSubagentResyncCadence.ts.AGENTS.md` |
| `useSwipeBack.ts` | iOS-style left-edge swipe-back gesture. Touch listeners decide horizontal vs vertical after 10px, triggers… → see `useSwipeBack.ts.AGENTS.md` |
| `useTreeColumnWidth.ts` | Persisted width + drag lifecycle for the Instructions folder-tree column (peer of `useSidebarState`). → see `useTreeColumnWidth.ts.AGENTS.md` |
| `useTheme.ts` | Theme mode + named-theme state. Reads `dashboard:theme`/`dashboard:theme-name` from `localStorage`, resolves… → see `useTheme.ts.AGENTS.md` |
| `useToolFullResult.ts` | NEW. Fetch hook `useToolFullResult(sessionId, toolCallId) → { result?, error?, loading, fetchFull }`. → see `useToolFullResult.ts.AGENTS.md` |
| `useViewDispatcher.ts` | Sends `session_view`/`session_unview` on `viewedSessionId` transitions, re-sends `session_view` on every WebSocket (re)connect into `connected`. Exports `useViewDispatcher`, `UseViewDispatcherDeps`. |
| `useWebSocket.ts` | WebSocket lifecycle: connects `url`, parses `ServerToBrowserMessage`, exposes `send`/`onMessage`/`status`… → see `useWebSocket.ts.AGENTS.md` |
| `useZoomPan.ts` | Re-export shim. Forwards `@blackbelt-technology/pi-dashboard-client-utils/useZoomPan` (moved in `complete-flows-plugin-migration` Layer 0). |
