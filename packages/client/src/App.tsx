import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRoute, useLocation, useSearchParams, Redirect, Switch, Route } from "wouter";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { setInitSender } from "./lib/worktree-init-bus.js";
import { useSidebarState } from "./hooks/useSidebarState.js";
import { useDocumentTitle } from "./hooks/useDocumentTitle.js";
import { SessionList } from "./components/SessionList.js";
import { ResizableSidebar } from "./components/ResizableSidebar.js";
import { HamburgerButton, MobileOverlay } from "./components/MobileOverlay.js";
import { MobileShell } from "./components/MobileShell.js";
import { SpawnErrorToastHost } from "./components/SpawnErrorToastHost.js";
import { useMobile } from "./hooks/useMobile.js";
import { getMobileDepth } from "./lib/mobile-depth.js";
import { ChatView, type ChatViewHandle } from "./components/ChatView.js";
import { ChatViewMenu } from "./components/ChatViewMenu.js";
import { SessionBanner } from "./components/SessionBanner.js";
// Flow components are no longer imported by the shell. They render
// exclusively via plugin slot claims (content-header-sticky,
// content-view, content-inline-footer, command-route). See change:
// pluginize-flows-via-registry.
import { MarkdownPreviewView } from "./components/MarkdownPreviewView.js";
import { PreviewOverlayView } from "./components/PreviewOverlayView.js";
import { PiResourcesView } from "./components/PiResourcesView.js";
import { SpecsBrowserView } from "./components/SpecsBrowserView.js";
import { ArchiveBrowserView } from "./components/ArchiveBrowserView.js";
import { OpenSpecBoardView } from "./components/OpenSpecBoardView.js";
import { WorktreeSpawnDialog } from "./components/WorktreeSpawnDialog.js";
import { maybeAutoInitWorktreeOnSpawn } from "./lib/auto-init-worktree.js";
import { useOpenSpecReader } from "./hooks/useOpenSpecReader.js";
import type { OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SessionHeader } from "./components/SessionHeader.js";
import { ServerSelector } from "./components/ServerSelector.js";
import { Toast, useToast } from "./components/Toast.js";
import { ConnectionStatusBanner } from "./components/ConnectionStatusBanner.js";
import { performServerSwitch } from "./lib/server-switch.js";
import { openStagingSocket } from "./lib/staging-socket.js";
import { PiUpdateBadge } from "./components/PiUpdateBadge.js";
import { useLaunchSource } from "./hooks/useLaunchSource.js";
import { TokenStatsBar } from "./components/TokenStatsBar.js";

import { CommandInput } from "./components/CommandInput.js";
import { QueuePanel } from "./components/QueuePanel.js";
import { readAllDrafts, writeDraft, deleteDraft } from "./lib/draft-storage.js";
import { extractUserPromptHistory } from "./lib/message-history.js";
import { StatusBar } from "./components/StatusBar.js";
import { ComposerSessionActions } from "./components/ComposerSessionActions.js";
import { Icon } from "@mdi/react";
import { mdiRefresh } from "@mdi/js";
import { useOpenSpecConfig } from "./lib/openspec-config-api.js";
import { LandingPage } from "./components/LandingPage.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ZrokInstallGuide } from "./components/ZrokInstallGuide.js";
import { InstallBanner } from "./components/InstallBanner.js";

import { PluginStalenessBanner } from "./components/PluginStalenessBanner.js";

import { MissingRequiredBanner } from "./components/MissingRequiredBanner.js";
import { useInstallPrompt } from "./hooks/useInstallPrompt.js";
import { TerminalsView } from "./components/TerminalsView.js";
import { EditorView } from "./components/EditorView.js";
import { decodeFolderPath, encodeFolderPath } from "./lib/folder-encoding.js";
import { FileDiffView } from "./components/FileDiffView.js";
// SubagentPopoutPage no longer imported by the shell — it's registered via
// the subagents-plugin's `shell-overlay-route` claim and mounted through
// `<ShellOverlayRouteSlot>` below. See change: add-flow-agent-popout.
import { createInitialState, deriveBannerState, findLastUserPrompt, reduceEvent, resolveInteractiveRequest, type SessionState } from "./lib/event-reducer.js";
import { selectInflightBashTools } from "./hooks/useInflightBashTools.js";
import { useMessageHandler } from "./hooks/useMessageHandler.js";
import { clearLoadingHistory } from "./lib/loading-history.js";
import { useEditors } from "./lib/use-editors.js";
import { useContentViews } from "./hooks/useContentViews.js";
import { usePiResourceFileFetch } from "./hooks/usePiResourceFileFetch.js";
import {
  buildOpenSpecArchiveUrl,
  buildOpenSpecBoardUrl,
  buildOpenSpecPreviewUrl,
  buildOpenSpecSpecsUrl,
  buildSessionDiffUrl,
} from "./lib/route-builders.js";
import { goBack as goBackAction } from "./lib/history-back.js";
import {
  recordNavigation,
  resetNavStack,
  initNavTracker,
  predecessor,
  popNav,
} from "./lib/nav-tracker.js";

// Stable tracker facade for the depth-aware back action
// (change: fix-mobile-back-depth-aware).
const NAV_TRACKER = { predecessor, popNav };
import { deriveSelectedSessionId } from "./lib/selectedSessionId.js";
import { useViewDispatcher } from "./hooks/useViewDispatcher.js";
import { selectViewedSessionId } from "./lib/selectViewedSessionId.js";
import { useSessionActions } from "./hooks/useSessionActions.js";
import { usePendingPromptTimeout } from "./hooks/usePendingPromptTimeout.js";
import { useOpenSpecActions } from "./hooks/useOpenSpecActions.js";
import type { DashboardSession, CommandInfo, FileEntry, OpenSpecData, OpenSpecGroup, ModelInfo, RoleInfo, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SearchableSelectDialog, type SelectOption } from "./components/SearchableSelectDialog.js";
import { GenericExtensionDialog } from "./components/extension-ui/GenericExtensionDialog.js";
import { ToastSlot } from "./components/extension-ui/ToastSlot.js";
import { PinDirectoryDialog } from "./components/PinDirectoryDialog.js";
import { DialogPortal } from "./components/DialogPortal.js";
import { useProvidersReady } from "./hooks/useProvidersReady.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ToolContext } from "./components/tool-renderers/index.js";
import { buildContextUsageMap } from "./lib/context-usage.js";
import { ApiContext, deriveApiBase, VITE_API_URL, setGlobalApiBase } from "./lib/api-context.js";
import { DisplayPrefsProvider } from "./lib/DisplayPrefsContext.js";
import { FirstLaunchDisplayModal } from "./components/FirstLaunchDisplayModal.js";
import { SessionAssetsProvider } from "./lib/SessionAssetsContext.js";
import { useI18n } from "./lib/i18n.js";
import { PluginContextProvider, applyPluginConfigUpdate, type SubagentStateSnapshot } from "@blackbelt-technology/dashboard-plugin-runtime/context";
// Stable empty references for plugin context's session-state primitives.
// See change: route-flow-asks-to-upper-slot + add-flow-agent-popout.
const EMPTY_INTERACTIVE_REQUESTS: readonly never[] = Object.freeze([]);
// Typed as the runtime's snapshot type so the empty map satisfies the provider's
// `useSessionSubagents` contract. Shell state holds the stricter `SubagentState`
// which is upcast at the closure boundary below.
const EMPTY_SUBAGENTS_MAP: ReadonlyMap<string, SubagentStateSnapshot> = Object.freeze(new Map());
import {
  ContentViewSlot,
  ContentHeaderStickySlot,
  ContentInlineFooterSlot,
  forSession,
  ShellOverlayRouteSlot,
  ShellSessionsProvider,
  useShellOverlayRouteMatched,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { PLUGIN_REGISTRY } from "./generated/plugin-registry.js";
import { usePluginEnabledSet } from "./hooks/usePluginEnabledSet.js";

// Populate the slot registry from the build-time generated plugin manifest.
// PLUGIN_REGISTRY is `[]` on a fresh checkout (committed stub) — slot consumers
// then render zero contributions, which is fine. The vite plugin overwrites the
// generated file on dev start and on every build.
const _pluginRegistry = createSlotRegistry();
for (const entry of PLUGIN_REGISTRY) {
  for (const claim of entry.claims) {
    _pluginRegistry.addClaim(claim);
  }
}

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port ? `:${window.location.port}` : "";
const DEFAULT_WS_URL = `${wsProtocol}//${window.location.hostname}${wsPort}/ws`;
const LAST_SERVER_KEY = "pi-dashboard-last-server";
// Stable empty-array reference for sessions with no pending images.
// Frozen so accidental mutation throws in strict mode.
const EMPTY_IMAGES: readonly ImageContent[] = Object.freeze([]);

function getInitialWsUrl(): string {
  const saved = localStorage.getItem(LAST_SERVER_KEY);
  if (saved) {
    try {
      const [host, port] = saved.split(":");
      if (host && port) {
        return `${wsProtocol}//${host}:${port}/ws`;
      }
    } catch { /* ignore */ }
  }
  return DEFAULT_WS_URL;
}



/**
 * URL-driven OpenSpec preview overlay.
 *
 * Receives cwd/change/artifact from the route params and looks up the
 * artifacts list from `openspecMap[cwd]`. On cold load with empty
 * `openspecMap`, renders a loading spinner; once WS replay populates the
 * map but the change is still not found, renders an inline "Not found"
 * with a back button.
 *
 * See change: overlay-url-routing.
 */
export function OpenSpecPreview({
  cwd,
  changeName,
  initialArtifact,
  openspecMap,
  onBack,
}: {
  cwd: string;
  changeName: string;
  initialArtifact: string;
  openspecMap: Map<string, OpenSpecData>;
  onBack: () => void;
}) {
  // URL is the single source of truth for the active artifact. Switching tabs
  // pushes the new artifact URL; `activeTab` derives from `initialArtifact`
  // (the route's `:artifactId`). See change: fix-openspec-artifact-tab-url-sync.
  const [, navigate] = useLocation();
  const openspecData = openspecMap.get(cwd);
  const change = openspecData?.changes.find((c) => c.name === changeName);
  const artifacts: OpenSpecArtifact[] = change?.artifacts ?? [];

  // Cold-load: openspecMap empty (WS hasn't settled yet for this cwd).
  // Render a loading spinner instead of "Not found" until WS replay finishes.
  const isWaitingForReplay = !openspecData;

  // Always invoke the reader hook (rules-of-hooks). Pass an empty artifacts
  // list during waiting-for-replay; the placeholder JSX below masks the
  // reader's output in that case.
  const reader = useOpenSpecReader(cwd, changeName, initialArtifact, artifacts);

  if (isWaitingForReplay) {
    return (
      <MarkdownPreviewView
        title={`${changeName} — loading…`}
        isLoading
        onBack={onBack}
      />
    );
  }

  if (!change) {
    return (
      <MarkdownPreviewView
        title={`${changeName} — not found`}
        content={`The OpenSpec change \`${changeName}\` was not found in this folder.\n\n[← Back](#)`}
        error={`No change named "${changeName}" in ${cwd}.`}
        onBack={onBack}
      />
    );
  }

  return (
    <MarkdownPreviewView
      title={reader.title}
      content={reader.content}
      isLoading={reader.isLoading}
      error={reader.error}
      tabs={reader.tabs}
      activeTab={reader.activeTab}
      onTabChange={(tabId) => navigate(buildOpenSpecPreviewUrl(cwd, changeName, tabId))}
      onBack={onBack}
    />
  );
}

/**
 * URL-driven pi-resource file preview overlay.
 *
 * Reads `path` and `title` from the URL search string and fetches
 * `/api/pi-resource-file?path=...` on mount.
 * See change: overlay-url-routing.
 */
function PiResourceFileRoute({
  filePath,
  title,
  onBack,
}: { filePath: string; title: string; onBack: () => void }) {
  const r = usePiResourceFileFetch(filePath);
  return (
    <MarkdownPreviewView
      title={title}
      content={r.content}
      isLoading={r.isLoading}
      error={r.error}
      onBack={onBack}
    />
  );
}

export default function App() {
  const { t } = useI18n();
  const [wsUrl, setWsUrl] = useState(getInitialWsUrl);
  const { send, onMessage, status } = useWebSocket(wsUrl);
  // Worktree-init bus needs a way to send subscribe/unsubscribe
  // messages over the same socket. See change: generalize-worktree-init-hook.
  useEffect(() => {
    setInitSender(send);
    return () => setInitSender(null);
  }, [send]);
  // Drives the slot-registry enable filter from /api/health.plugins[] +
  // plugin_config_update broadcasts. The returned `startedAt` is also
  // consumed inside the Plugins tab via this same hook re-call, so we don't
  // thread it through props here.
  // See change: add-plugin-activation-ui.
  usePluginEnabledSet(_pluginRegistry);
  const { messages: toastMessages, showToast, dismissToast } = useToast();
  const apiBase = useMemo(() => {
    const base = deriveApiBase(wsUrl) || VITE_API_URL;
    setGlobalApiBase(base);
    return base;
  }, [wsUrl]);
  const [, rawNavigate] = useLocation();
  // Instrument the single navigation path so every navigate records into the
  // in-app depth-tagged nav tracker (change: fix-mobile-back-depth-aware).
  // wouter pushState/replaceState does not fire popstate, so record here; the
  // tracker's own popstate listener realigns on browser back/forward.
  const navigate = useCallback(
    (to: string, opts?: { replace?: boolean }) => {
      recordNavigation(to, opts);
      rawNavigate(to, opts);
    },
    [rawNavigate],
  );
  // Seed the stack with the cold-load location and attach the popstate listener.
  useEffect(() => {
    resetNavStack(window.location.pathname + window.location.search);
    return initNavTracker();
  }, []);
  const [match, params] = useRoute("/session/:id");
  // Legacy /terminal/:id route removed — see change:
  // fix-terminal-half-height-dual-mount. Terminals are reached via
  // /folder/:encodedCwd/terminals. The dual-mount it caused (one
  // <TerminalView> here + one inside <TerminalsView>) was the root
  // cause of half-height rendering and competing FitAddon resizes.
  const [folderTermMatch, folderTermParams] = useRoute("/folder/:encodedCwd/terminals");
  const [folderEditorMatch, folderEditorParams] = useRoute("/folder/:encodedCwd/editor");
  const [settingsMatch] = useRoute("/settings/:page?");
  const [tunnelSetupMatch] = useRoute("/tunnel-setup");
  // Shell-owned overlay routes (overlay-url-routing).
  const [openspecPreviewMatch, openspecPreviewParams] = useRoute("/folder/:encodedCwd/openspec/:changeName/:artifactId");
  const [openspecBoardMatch, openspecBoardParams] = useRoute("/folder/:encodedCwd/openspec");
  const [archiveMatch, archiveParams] = useRoute("/folder/:encodedCwd/openspec/archive");
  const [specsMatch, specsParams] = useRoute("/folder/:encodedCwd/openspec/specs");
  const [piResourcesMatch, piResourcesParams] = useRoute("/folder/:encodedCwd/pi-resources");
  // `/view` overlay routes (change: render-file-previews).
  const [fileViewMatch, fileViewParams] = useRoute("/folder/:encodedCwd/view");
  const [urlViewMatch] = useRoute("/pi-view");
  const [urlViewSearch] = useSearchParams();
  const fileViewSearch = urlViewSearch; // useSearchParams is route-independent
  const urlViewUrl = urlViewMatch ? urlViewSearch.get("url") : null;
  const fileViewPath = fileViewMatch ? fileViewSearch.get("path") : null;
  const fileViewCwd = fileViewMatch && fileViewParams ? decodeFolderPath(fileViewParams.encodedCwd) : null;
  const [diffMatch, diffParams] = useRoute("/session/:id/diff");
  // Subagent inspector popout route. See change: add-subagent-inspector §7.
  // Plugin-owned overlay routes (subagent popout, flow-agent popout, etc.)
  // dispatch via `<ShellOverlayRouteSlot>` from dashboard-plugin-runtime.
  // No per-route useRoute() here. See change: add-flow-agent-popout.
  const [piResourceFileMatch] = useRoute("/pi-resource");
  const [piResourceFileSearch] = useSearchParams();
  const piResourceFilePath = piResourceFileSearch.get("path");
  const piResourceFileTitle = piResourceFileSearch.get("title") ?? "";
  // Decoded overlay cwds (memo-free; cheap base64url decode).
  const openspecPreviewCwd = openspecPreviewMatch && openspecPreviewParams ? decodeFolderPath(openspecPreviewParams.encodedCwd) : null;
  const openspecBoardCwd = openspecBoardMatch && openspecBoardParams ? decodeFolderPath(openspecBoardParams.encodedCwd) : null;
  const archiveCwd = archiveMatch && archiveParams ? decodeFolderPath(archiveParams.encodedCwd) : null;
  const specsCwd = specsMatch && specsParams ? decodeFolderPath(specsParams.encodedCwd) : null;
  const piResourcesCwd = piResourcesMatch && piResourcesParams ? decodeFolderPath(piResourcesParams.encodedCwd) : null;
  const diffSessionId = diffMatch && diffParams ? diffParams.id : null;
  // Subagent popout decoded params + parent-session label.
  // See change: add-subagent-inspector §7.
  // Plugin overlay routes are tracked by the slot consumer hook.
  // We pass `_pluginRegistry` explicitly because this hook is called from
  // App's body — BEFORE the `<PluginContextProvider>` (rendered later in
  // App's JSX) wraps the tree, so `useSlotRegistryOrNull()` would return
  // null at this call site. See change: fix-flows-plugin-polish
  // (hook-outside-provider fix).
  const pluginOverlayMatched = useShellOverlayRouteMatched(_pluginRegistry);
  const hasShellOverlayRoute =
    !!openspecPreviewMatch || !!openspecBoardMatch || !!archiveMatch || !!specsMatch ||
    !!piResourcesMatch || !!diffMatch ||
    !!(fileViewMatch && fileViewPath) || !!(urlViewMatch && urlViewUrl) ||
    pluginOverlayMatched;
  const hasPiResourceRouteFlag = !!piResourceFileMatch && !!piResourceFilePath;
  const selectedId = deriveSelectedSessionId(!!match, params, !!diffMatch, diffParams);
  const selectedSessionIdRef = useRef<string | undefined>(selectedId);
  selectedSessionIdRef.current = selectedId;

  // Drives the server-side viewed-session tracker for unread state.
  // See change: session-card-unread-stripes.
  useViewDispatcher({
    viewedSessionId: selectViewedSessionId(match, params ?? undefined),
    connectionStatus: status,
    send,
  });
  const folderTermCwd = folderTermMatch ? decodeFolderPath(folderTermParams?.encodedCwd ?? "") : null;
  const folderEditorCwd = folderEditorMatch ? decodeFolderPath(folderEditorParams?.encodedCwd ?? "") : null;
  const sidebar = useSidebarState();
  const chatViewRef = useRef<ChatViewHandle>(null);
  const isMobile = useMobile();
  const installPrompt = useInstallPrompt();
  const launchSource = useLaunchSource();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessions, setSessions] = useState<Map<string, DashboardSession>>(new Map());
  const [sessionStates, setSessionStates] = useState<Map<string, SessionState>>(new Map());
  // Per-session dashboard-local `/view` preview rows. Lives separately from
  // event-reducer state so the reducer never sees them. Merged with
  // `state.messages` by timestamp when passing to ChatView.
  // See change: render-file-previews.
  const [viewMessagesMap, setViewMessagesMap] = useState<Map<string, import("./lib/event-reducer.js").ChatMessage[]>>(new Map());
  // Per-session chat-input drafts. Hydrated once from localStorage on mount,
  // then persisted (debounced) whenever the map changes.
  const [drafts, setDrafts] = useState<Map<string, string>>(() => readAllDrafts());
  // Track the previous drafts snapshot so the persist effect can compute a
  // precise write-set (added/changed keys) and delete-set (removed/emptied keys).
  const prevDraftsRef = useRef<Map<string, string>>(drafts);
  // Per-session pending pasted-image attachments. Lifted out of
  // useImagePaste's local useState into App so they survive the
  // unmount/remount of <CommandInput> caused by content-area route
  // changes (Settings, terminals, OpenSpec preview, …) and so they
  // do NOT leak across session switches. NOT persisted to
  // localStorage — base64 blobs are large and per-reload reset is
  // acceptable (see openspec/specs/chat-input-state).
  const [pendingImagesMap, setPendingImagesMap] = useState<Map<string, ImageContent[]>>(new Map());
  const [sessionCommands, setSessionCommands] = useState<Map<string, CommandInfo[]>>(new Map());
  // sessionFlows state was removed; flows-plugin reads the per-session
  // flows list directly from the plugin-runtime per-session-data store
  // (mirrored by useMessageHandler on `flows_list` messages). See
  // change: pluginize-flows-via-registry.
  const [fileResults, setFileResults] = useState<{ query: string; files: FileEntry[] } | null>(null);
  const [openspecMap, setOpenspecMap] = useState<Map<string, OpenSpecData>>(new Map());
  const [openspecGroupsMap, setOpenspecGroupsMap] = useState<Map<string, { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder?: Record<string, string[]> }>>(new Map());
  // Worktree-spawn dialog for the OpenSpec board route (board is a top-level
  // overlay; SessionList's own dialog isn't in scope here).
  // See change: redesign-openspec-board.
  const [boardWorktreeForChange, setBoardWorktreeForChange] = useState<{ cwd: string; changeName: string } | null>(null);
  const [modelsMap, setModelsMap] = useState<Map<string, ModelInfo[]>>(new Map());
  const [rolesMap, setRolesMap] = useState<Map<string, RoleInfo>>(new Map());
  const [spawnResult, setSpawnResult] = useState<{ success: boolean; message: string } | null>(null);
  const [spawnErrors, setSpawnErrors] = useState<Map<string, import("./hooks/useMessageHandler.js").SpawnErrorDetail>>(new Map());
  const [resumeErrors, setResumeErrors] = useState<Map<string, string>>(new Map());
  const [spawningCwds, setSpawningCwds] = useState<Set<string>>(new Set());
  const spawningCwdsRef = useRef<Set<string>>(spawningCwds);
  spawningCwdsRef.current = spawningCwds;
  const spawnTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Maps client-minted requestId → cwd, used to correlate session_added
  // back to the originating click for auto-select after spawn AND fork.
  // Lives alongside `spawningCwds` (which keeps placeholder + disabled-button
  // behavior cwd-keyed). See change: spawn-correlation-token.
  const pendingSpawnsRef = useRef<Map<string, { cwd: string; kind: "spawn" | "resume"; placeholderCwd?: string }>>(new Map());
  const [sessionOrderMap, setSessionOrderMap] = useState<Map<string, string[]>>(new Map());
  const [pinnedDirectories, setPinnedDirectories] = useState<string[]>([]);
  // Favorite model labels ("provider/id"), server-persisted. Synced via
  // `favorite_models_updated`; cold-loaded from GET /api/favorite-models.
  // See change: enrich-model-selector-capabilities-favorites.
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  // folder-workspaces: full workspace list, kept in sync via workspaces_updated broadcast.
  const [workspaces, setWorkspaces] = useState<import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").Workspace[]>([]);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const providersReady = useProvidersReady();
  const [terminals, setTerminals] = useState<Map<string, TerminalSession>>(new Map());
  const pendingTerminalCwdRef = useRef<string | null>(null);
  const lastCreatedTerminalIdRef = useRef<string | null>(null);
  const [editorStatuses, setEditorStatuses] = useState<Map<string, { id: string; status: EditorInstanceStatus }>>(new Map());
  const [editorAvailable, setEditorAvailable] = useState<boolean | undefined>(undefined);
  // UI preference: show worktree spawn buttons. Fetched from /api/config on
  // mount. Defaults to true while loading. See change:
  // openspec-worktree-spawn-button.
  const [gitWorktreeEnabled, setGitWorktreeEnabled] = useState<boolean>(true);
  const [discoveredServers, setDiscoveredServers] = useState<import("./components/ServerSelector.js").DiscoveredServerInfo[]>([]);
  // Global chat-display preferences. `undefined` until the initial GET
  // /api/preferences/display response lands. When the server returns
  // `displayPrefs: undefined` the FirstLaunchDisplayModal opens.
  // See change: configurable-chat-display.
  const [displayPrefs, setDisplayPrefs] = useState<import("@blackbelt-technology/pi-dashboard-shared/display-prefs.js").DisplayPrefs | undefined>(undefined);
  const [displayPrefsLoaded, setDisplayPrefsLoaded] = useState(false);
  const subscribedRef = useRef(new Set<string>());
  const maxSeqMapRef = useRef(new Map<string, number>());
  // Per-session "history loading" flag: true between sending `subscribe`
  // and the first content / terminal / failure / timeout. Drives the
  // ChatView loading indicator. See change: show-chat-history-loading-indicator.
  const [loadingHistory, setLoadingHistory] = useState<Map<string, boolean>>(new Map());
  const loadingHistoryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // After overlay-url-routing: shell overlays are URL-driven via the
  // useRoute matches declared above. `previewState`, `specsBrowserCwd`,
  // `archiveBrowserCwd`, `diffViewSessionId`, and the three useContentViews
  // `useState`s are gone; their values are derived from URL params.
  // Flow YAML / agent detail / architect detail remain plugin-owned and
  // are NOT migrated by this change (see proposal §6).

  const {
    handleOpenPiResources,
    handleViewPiResourceFile,
  } = useContentViews({ navigate });

  // Transactional server switching — see openspec/changes/safe-server-switch.
  // Opens a staging WebSocket first; only commits state/localStorage after
  // it reaches OPEN. On failure, live connection is preserved intact.
  const inFlightSwitchKeyRef = useRef<string | null>(null);
  const [inFlightSwitchKey, setInFlightSwitchKey] = useState<string | null>(null);
  const handleServerSwitch = useCallback((host: string, port: number) => {
    const key = `${host}:${port}`;
    if (inFlightSwitchKeyRef.current) return; // ignore duplicate clicks
    inFlightSwitchKeyRef.current = key;
    setInFlightSwitchKey(key);
    const wsProto = wsProtocol === "wss:" ? "wss:" : "ws:";
    performServerSwitch(
      { host, port, wsProtocol: wsProto },
      {
        openStagingSocket,
        clearInMemoryState: () => {
          setSessions(new Map());
          setSessionStates(new Map());
          setSessionCommands(new Map());
          setOpenspecMap(new Map());
          setOpenspecGroupsMap(new Map());
          setTerminals(new Map());
          subscribedRef.current.clear();
        },
        setWsUrl,
        persistLastServer: (h, p) => {
          localStorage.setItem(LAST_SERVER_KEY, `${h}:${p}`);
        },
        notifyError: (msg) => showToast(msg),
      },
    ).finally(() => {
      inFlightSwitchKeyRef.current = null;
      setInFlightSwitchKey(null);
    });
  }, []);

  // Parse current server host/port from wsUrl
  const currentServerHost = useMemo(() => {
    try {
      const u = new URL(wsUrl.replace("ws://", "http://").replace("wss://", "https://"));
      return u.hostname;
    } catch { return "localhost"; }
  }, [wsUrl]);
  const currentServerPort = useMemo(() => {
    try {
      const u = new URL(wsUrl.replace("ws://", "http://").replace("wss://", "https://"));
      return parseInt(u.port, 10) || 8000;
    } catch { return 8000; }
  }, [wsUrl]);

  const clearSpawningCwd = useCallback((cwd: string) => {
    setSpawningCwds((prev) => {
      if (!prev.has(cwd)) return prev;
      const next = new Set(prev);
      next.delete(cwd);
      return next;
    });
    const timer = spawnTimeoutsRef.current.get(cwd);
    if (timer) {
      clearTimeout(timer);
      spawnTimeoutsRef.current.delete(cwd);
    }
  }, []);

  // Add a cwd to the spawning set + arm a 30s safety timeout, guarding
  // against double-add/double-timeout. Used by WorktreeSpawnDialog's
  // `onSpawnStart` so a placeholder appears from dialog submit (covering
  // the createWorktree window), before `handleSpawnSession` runs.
  // See change: add-worktree-spawn-placeholder-card.
  const addSpawningCwd = useCallback((cwd: string) => {
    setSpawningCwds((prev) => {
      if (prev.has(cwd)) return prev;
      const next = new Set(prev);
      next.add(cwd);
      return next;
    });
    if (!spawnTimeoutsRef.current.has(cwd)) {
      const timer = setTimeout(() => {
        spawnTimeoutsRef.current.delete(cwd);
        clearSpawningCwd(cwd);
      }, 30_000);
      spawnTimeoutsRef.current.set(cwd, timer);
    }
  }, [clearSpawningCwd]);

  // Live snapshot of visible-cwd inputs for the off-screen spawn_error
  // toast fallback. Updated every render so the latest pinned/workspace/
  // session set drives the isVisibleCwd check inside useMessageHandler.
  // See change: harden-worktree-spawn.
  const cwdVisibilityInputsRef = useRef({
    pinnedDirectories: [] as ReadonlyArray<string>,
    workspaces: [] as ReadonlyArray<{ folders: ReadonlyArray<string> }>,
    sessions: [] as ReadonlyArray<{ cwd: string }>,
  });
  cwdVisibilityInputsRef.current = {
    pinnedDirectories,
    workspaces,
    sessions: Array.from(sessions.values()).map((s) => ({ cwd: s.cwd })),
  };

  // Enter LOADING for a session: set the flag and arm a 15s safety-net
  // timer (clearing any prior timer). Called from every `subscribe` send
  // site so cleared / refreshed chats show the spinner during replay, not
  // the empty placeholder. See change: show-chat-history-loading-indicator.
  const beginLoadingHistory = useCallback((id: string) => {
    const existingTimer = loadingHistoryTimersRef.current.get(id);
    if (existingTimer) clearTimeout(existingTimer);
    setLoadingHistory((prev) => {
      const next = new Map(prev);
      next.set(id, true);
      return next;
    });
    loadingHistoryTimersRef.current.set(
      id,
      setTimeout(() => clearLoadingHistory(setLoadingHistory, loadingHistoryTimersRef, id), 15000),
    );
  }, []);

  const handleMessage = useMessageHandler(
    { setSessions, setSessionStates, setSessionCommands, setFileResults, setOpenspecMap, setOpenspecGroupsMap, setModelsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setFavoriteModels, setWorkspaces, setTerminals, setEditorStatuses, setDiscoveredServers, setSpawnErrors, setResumeErrors, setDisplayPrefs, setViewMessagesMap, setLoadingHistory },
    { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef, pendingSpawnsRef, cwdVisibilityInputsRef, loadingHistoryTimersRef },
  );

  useEffect(() => {
    return onMessage(handleMessage);
  }, [onMessage, handleMessage]);

  // Detect code-server binary availability on mount
  useEffect(() => {
    fetch(`${apiBase}/api/editor/detect`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setEditorAvailable(d.data.available); })
      .catch(() => {});
  }, []);

  // Fetch the gitWorktreeEnabled preference on mount.
  // See change: openspec-worktree-spawn-button.
  useEffect(() => {
    fetch(`${apiBase}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && typeof d.data?.gitWorktreeEnabled === "boolean") {
          setGitWorktreeEnabled(d.data.gitWorktreeEnabled);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch global chat-display prefs once on mount, then run the legacy
  // `show-debug-tools` localStorage migration (idempotent). The reply may
  // carry `displayPrefs: undefined`, in which case the FirstLaunchDisplay
  // Modal opens. See change: configurable-chat-display.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/api/preferences/display`, { credentials: "include" });
        if (!r.ok) return;
        const body = await r.json() as { displayPrefs?: import("@blackbelt-technology/pi-dashboard-shared/display-prefs.js").DisplayPrefs };
        if (cancelled) return;
        setDisplayPrefs(body.displayPrefs);
      } catch { /* ignore */ }
      finally {
        if (!cancelled) setDisplayPrefsLoaded(true);
      }
      // Legacy `show-debug-tools` migration. Runs once per browser; the key
      // is removed on first PATCH so subsequent renders no-op.
      try {
        const legacy = localStorage.getItem("show-debug-tools");
        if (legacy !== null) {
          await fetch(`${apiBase}/api/preferences/display`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ debugTools: legacy === "true" }),
            credentials: "include",
          });
          localStorage.removeItem("show-debug-tools");
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  // Clear subscriptions on reconnect so sessions get re-subscribed
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === "connected" && prevStatusRef.current !== "connected") {
      subscribedRef.current.clear();
      // sessionOrderMap is replaced atomically by the on-connect
      // `sessions_snapshot` message — no pre-reset needed.
      // See change: fix-stale-sessions-on-reconnect.
      setTerminals(new Map());
      // Fetch current editor statuses
      fetch(`${apiBase}/api/editor/status`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success && Array.isArray(data.data)) {
            const map = new Map<string, { id: string; status: EditorInstanceStatus }>();
            for (const inst of data.data) {
              if (inst.status !== "stopped") {
                map.set(inst.cwd, { id: inst.id, status: inst.status });
              }
            }
            setEditorStatuses(map);
          }
        })
        .catch(() => {});
    }
    prevStatusRef.current = status;
  }, [status]);

  // Redirect to / if session ID in URL is not found after sessions have loaded
  const sessionsLoaded = sessions.size > 0;
  useEffect(() => {
    if (selectedId && sessionsLoaded && !sessions.has(selectedId)) {
      navigate("/", { replace: true });
    }
  }, [selectedId, sessionsLoaded, sessions, navigate]);

  // Request global roles once on connect, using any available session id
  // as a routing target (the bridge handler doesn't actually scope by it).
  // Without this the Settings → Roles panel stays empty until something else
  // (a `flow:role-set`, `session_start`, etc.) triggers a `roles_list`.
  // See change: fix-pi-flows-end-to-end (Group 5 — global roles).
  const globalRefreshRequestedRef = useRef(false);
  useEffect(() => {
    if (status !== "connected" || globalRefreshRequestedRef.current) return;
    // Pick a session that's actually CONNECTED to a live pi process (the
    // bridge handler runs in pi; ended sessions have no live WS). Status
    // values: "active" | "idle" | "streaming" — anything but "ended".
    let liveSession: string | undefined;
    for (const [id, s] of sessions) {
      if (s.status !== "ended") { liveSession = id; break; }
    }
    if (!liveSession) return;
    globalRefreshRequestedRef.current = true;
    // Both roles and models are GLOBAL in pi-flows / pi-coding-agent. The
    // bridge re-emits them on session_start, but on a fresh dashboard load
    // (no new pi sessions starting) the client has no copy. Pull both via
    // any live session id; the handlers in the bridge use a local sessionId
    // closure and don't actually scope by it.
    send({ type: "request_roles", sessionId: liveSession });
    send({ type: "request_models", sessionId: liveSession });
  }, [status, sessions, send]);

  // Re-arm the one-shot on reconnect.
  useEffect(() => {
    if (status !== "connected") globalRefreshRequestedRef.current = false;
  }, [status]);

  // After overlay-url-routing: overlays are URL-driven, so a session switch
  // (which navigates to /session/:id) automatically clears any overlay route
  // matches. No imperative clear-on-switch needed. We keep `prevSelectedRef`
  // for the subscription side-effect below.
  const prevSelectedRef = useRef(selectedId);
  useEffect(() => {
    if (selectedId !== prevSelectedRef.current) {
      prevSelectedRef.current = selectedId;
    }
    // Lazy subscribe: load events for ended sessions when first selected.
    // Also re-subscribes the selected session after reconnect (status change
    // clears subscribedRef, and adding `status` here re-triggers the effect).
    if (selectedId && !subscribedRef.current.has(selectedId) && status === "connected") {
      subscribedRef.current.add(selectedId);
      send({ type: "subscribe", sessionId: selectedId, lastSeq: maxSeqMapRef.current.get(selectedId) ?? 0 });
      // Enter LOADING. Covers warm (in-memory replay / reconnect re-subscribe)
      // and cold (disk-load) paths uniformly, since the warm path never sends
      // an empty `isLast:false` start marker.
      // See change: show-chat-history-loading-indicator.
      beginLoadingHistory(selectedId);
      // Request model list for this session if we don't have it yet (e.g. after page refresh)
      if (!modelsMap.has(selectedId)) {
        send({ type: "request_models", sessionId: selectedId });
      }
    }
  }, [selectedId, send, status]);

  // Cold-open subscription for plugin overlay routes is now the claim's
  // responsibility — each claim (e.g. SubagentPopoutClaim, FlowAgentPopoutClaim)
  // subscribes on mount via `usePluginSend({ type: "subscribe", ... })`.
  // See change: add-flow-agent-popout.

  const rawSelectedState = selectedId
    ? sessionStates.get(selectedId) ?? createInitialState()
    : createInitialState();
  // Merge dashboard-local `/view` rows into the rendered chat by timestamp.
  // View rows are stored separately so the event reducer never sees them.
  // See change: render-file-previews.
  const selectedState = useMemo(() => {
    if (!selectedId) return rawSelectedState;
    const views = viewMessagesMap.get(selectedId);
    if (!views || views.length === 0) return rawSelectedState;
    const merged = [...rawSelectedState.messages, ...views].sort((a, b) => a.timestamp - b.timestamp);
    return { ...rawSelectedState, messages: merged };
  }, [rawSelectedState, viewMessagesMap, selectedId]);

  // Per-session draft text + history recall for CommandInput.
  const selectedDraft = selectedId ? (drafts.get(selectedId) ?? "") : "";
  // Per-session pending images. Returns the stable EMPTY_IMAGES ref
  // when the session has no entry, so unrelated re-renders don't
  // produce a fresh `[]` and re-render <CommandInput>.
  const selectedImages = (selectedId ? pendingImagesMap.get(selectedId) : undefined) ?? (EMPTY_IMAGES as ImageContent[]);
  const selectedHistory = useMemo(
    () => extractUserPromptHistory(selectedState.messages),
    [selectedState.messages],
  );

  // Debounced persistence for drafts. When the map changes, diff against the
  // previous snapshot and flush writes/deletes after a short idle window so we
  // don't hammer localStorage on every keystroke.
  useEffect(() => {
    const prev = prevDraftsRef.current;
    const timer = setTimeout(() => {
      // Writes: new or changed entries.
      for (const [sid, text] of drafts) {
        if (text === "") {
          // Empty string in the map = cleared draft, treat as delete.
          if (prev.get(sid) !== undefined) deleteDraft(sid);
          continue;
        }
        if (prev.get(sid) !== text) writeDraft(sid, text);
      }
      // Deletes: keys present before but gone now.
      for (const sid of prev.keys()) {
        if (!drafts.has(sid)) deleteDraft(sid);
      }
      prevDraftsRef.current = drafts;
    }, 300);
    return () => clearTimeout(timer);
  }, [drafts]);

  const setDraftForSelected = useCallback(
    (text: string) => {
      if (!selectedId) return;
      setDrafts((m) => {
        const existing = m.get(selectedId) ?? "";
        if (existing === text) return m;
        const next = new Map(m);
        next.set(selectedId, text);
        return next;
      });
    },
    [selectedId],
  );

  const clearDraftForSession = useCallback((sid: string) => {
    setDrafts((m) => {
      if (!m.has(sid)) return m;
      const next = new Map(m);
      next.delete(sid);
      return next;
    });
    // Also clear from localStorage eagerly so a reload before the debounce
    // window fires doesn't resurrect the cleared draft.
    deleteDraft(sid);
  }, []);

  // Per-session pending-image setter. Mutates pendingImagesMap for the
  // currently selected session. Deletes the entry when `next` is empty
  // so the map doesn't accumulate empty arrays.
  const setImagesForSelected = useCallback((next: ImageContent[]) => {
    if (!selectedId) return;
    setPendingImagesMap((m) => {
      const existing = m.get(selectedId);
      if (next.length === 0) {
        if (!m.has(selectedId)) return m;
        const out = new Map(m);
        out.delete(selectedId);
        return out;
      }
      if (existing === next) return m;
      const out = new Map(m);
      out.set(selectedId, next);
      return out;
    });
  }, [selectedId]);

  // Clear pending images for a specific session (used after a successful send).
  const clearImagesForSession = useCallback((sid: string) => {
    setPendingImagesMap((m) => {
      if (!m.has(sid)) return m;
      const next = new Map(m);
      next.delete(sid);
      return next;
    });
  }, []);

  // Safety timeout: clear stuck pendingPrompt after 30s and show error.
  // Pauses while the prompt text appears in pi's mirrored queues
  // (i.e. pi has acknowledged custody). Resumes on removal.
  // See change: add-followup-edit-and-steer-cancel.
  const _selectedSessionForQueue = selectedId ? sessions.get(selectedId) : undefined;
  const queuedTextsForSelected: string[] = [
    ...(_selectedSessionForQueue?.pendingQueues?.steering ?? []),
    ...(_selectedSessionForQueue?.pendingQueues?.followUp ?? []),
  ];
  const safetyTimerPaused = !!(
    selectedState.pendingPrompt && queuedTextsForSelected.includes(selectedState.pendingPrompt.text)
  );
  usePendingPromptTimeout(!!selectedState.pendingPrompt, useCallback(() => {
    if (selectedId) {
      setSessionStates((prev) => {
        const next = new Map(prev);
        const current = next.get(selectedId);
        if (current?.pendingPrompt) {
          next.set(selectedId, {
            ...current,
            pendingPrompt: undefined,
            lastError: {
              message: "No response from session — the prompt may not have been received.",
              timestamp: Date.now(),
            },
          });
        }
        return next;
      });
    }
  }, [selectedId, setSessionStates]), safetyTimerPaused);

  const selectedCommands = selectedId
    ? sessionCommands.get(selectedId) ?? []
    : [];

  // selectedFlows derivation removed — flows-plugin's SessionFlowActions
  // claim reads flows from the per-session-data store directly. See
  // change: pluginize-flows-via-registry.

  const selectedSession = selectedId ? sessions.get(selectedId) : undefined;
  // Per-cwd OpenSpec workflow config — drives which action buttons render.
  // See change: redesign-session-card-and-composer (config-driven-workflow).
  const openspecConfig = useOpenSpecConfig(selectedSession?.cwd);
  const folderTitleCwd = folderEditorCwd ?? folderTermCwd
    ?? openspecPreviewCwd ?? archiveCwd ?? specsCwd
    ?? piResourcesCwd ?? null;
  useDocumentTitle(selectedSession, folderTitleCwd ?? undefined);
  const selectedCwd = selectedSession?.cwd;
  const editorCwds = useMemo(() => selectedCwd ? [selectedCwd] : [], [selectedCwd]);
  const editorMap = useEditors(editorCwds);
  const toolContext: ToolContext = useMemo(() => ({
    cwd: selectedCwd,
    editors: selectedCwd ? editorMap.get(selectedCwd) ?? [] : [],
    sessionId: selectedId,
    session: selectedId ? sessionStates.get(selectedId) : undefined,
  }), [selectedCwd, editorMap, selectedId, sessionStates]);

  const contextUsageMap = useMemo(
    () => buildContextUsageMap(sessionStates, sessions),
    [sessionStates, sessions],
  );

  // Header context-usage value derived the same way the session card does:
  // shared two-tier map (live event-reducer value, else persisted fallback),
  // falling back to raw live state only if the map has no entry.
  // See change: align-content-header-context-usage.
  const selectedContextUsage =
    (selectedId ? contextUsageMap.get(selectedId) : undefined) ?? selectedState.contextUsage;

  const sessionActions = useSessionActions({
    selectedId, send, navigate, setMobileOpen,
    sessions, setSessions, setSessionStates, setSpawningCwds, setTerminals,
    clearSpawningCwd, spawnTimeoutsRef, pendingTerminalCwdRef, terminals,
    pendingSpawnsRef,
  });
  const {
    // Queue-mutation action senders removed entirely (pi exposes no mutation
    // primitives). QueuePanel is display-only; Stop is now the bare abort
    // (no yank-to-draft, which produced ghost duplicates). See change:
    // honest-mid-turn-queue-surface.
    handleAbort, handleForceKill, handleCancelPending, handleRespondToUi, handleSend,
    handleSelect, handleRenameSession, handleShutdownSession, handleKillProcess,
    handleSendPromptToSession, handleResumeSession, handleResumeSessionKeepPosition, handleSpawnSession,
    handleHideSession, handleUnhideSession,
    handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleTerminalTitle,
    handleOpenInlineTerminal, handleCloseInlineTerminal,
    handleListFiles,
    // Bridge-owned follow-up buffer mutation senders. See change: rework-mid-turn-prompt-queue.
    removeFollowUpEntry, editFollowUpEntry, promoteFollowUpEntry, clearFollowUpEntries,
  } = sessionActions;

  // Flow command interception is gone. /flows, /flows:new, /flows:edit,
  // /flows:delete are now handled by flows-plugin's command-route claims
  // (see manifest claims in packages/flows-plugin/package.json). The
  // shell's command-route slot consumer dispatches the matching plugin
  // contribution. See change: pluginize-flows-via-registry.

  // Extension UI System (Phase 1): currently-open module modal, and the
  // searchable picker shown via the Modules entry point.
  // See change: add-extension-ui-modal.
  const [extensionModuleOpen, setExtensionModuleOpen] = useState<{ sessionId: string; moduleId: string } | null>(null);
  const [extensionModulePickerOpen, setExtensionModulePickerOpen] = useState(false);

  // Built-in slash commands the dashboard handles natively. If an extension
  // pushes a module whose `command` matches one of these, we drop the module
  // (the built-in wins) and warn the developer. (/flows commands are NOT
  // built-in; they're owned by flows-plugin via command-route claims.)
  const BUILTIN_SLASH_COMMANDS = useMemo(() => new Set([
    "/compact", "/reload", "/new", "/model", "/roles",
  ]), []);

  // Wrap handleSend to intercept extension UI module commands and clear
  // the per-session draft. Plugin command-route claims (e.g. /flows*)
  // are handled separately by the shell's command-route slot consumer.
  const wrappedHandleSend = useCallback((text: string, images?: ImageContent[], delivery?: "steer" | "followUp") => {
    const trimmed = text.trim();
    // Bare `!!` (no command) opens an inline interactive terminal card in the
    // chat stream. `!! <cmd>` / `! <cmd>` keep their one-shot bash semantics
    // (handled in the extension). Intercept here client-side so the trigger
    // matches the composer button's open path. See change: add-inline-terminal-card.
    if (trimmed === "!!" && selectedId && selectedCwd) {
      handleOpenInlineTerminal(selectedId, selectedCwd);
      clearDraftForSession(selectedId);
      clearImagesForSession(selectedId);
      return;
    }
    // Extension UI System (Phase 1): exact-match slash command opens the
    // matching module modal and suppresses the prompt send.
    // See change: add-extension-ui-modal.
    if (selectedId && trimmed.startsWith("/")) {
      const session = sessions.get(selectedId);
      const modules = session?.uiModules ?? [];
      const match = modules.find((m) => m.command === trimmed && !BUILTIN_SLASH_COMMANDS.has(m.command));
      if (match) {
        setExtensionModuleOpen({ sessionId: selectedId, moduleId: match.id });
        if (selectedId) {
          clearDraftForSession(selectedId);
          clearImagesForSession(selectedId);
        }
        return;
      }
      // Drop modules colliding with built-ins; warn once per id per session-tick.
      const colliding = modules.find((m) => m.command === trimmed && BUILTIN_SLASH_COMMANDS.has(m.command));
      if (colliding) {
        console.warn(`[extension-ui] Dropping module "${colliding.id}" — command ${colliding.command} collides with a built-in.`);
      }
    }
    handleSend(text, images, delivery);
    if (selectedId) {
      clearDraftForSession(selectedId);
      clearImagesForSession(selectedId);
    }
  }, [handleSend, selectedId, selectedCwd, handleOpenInlineTerminal, clearDraftForSession, clearImagesForSession, sessions, BUILTIN_SLASH_COMMANDS]);

  // wrappedHandleAbort removed. The yank-to-draft UX ("restoreQueuedMessages
  // ToEditor" parity) required pi to actually clear its queues on abort, which
  // it does not — pi.Agent.abort() only signals the AbortController, queues
  // persist. The yank therefore produced ghost duplicates (drafted-edited copy
  // + original drain). Stop now invokes bare handleAbort; queued messages stay
  // visible in QueuePanel / inline steering bubbles until pi drains them at
  // the next prompt. See change: honest-mid-turn-queue-surface.

  const openspecActions = useOpenSpecActions({
    send,
    openspecMap,
    navigate,
  });

  // Depth-aware back arrow: history.back() fast-path when the tracker proves a
  // shallower in-app predecessor, else navigate to the computed parent route.
  // Replaces goBackOrHome (change: fix-mobile-back-depth-aware).
  const goBack = useCallback(() => {
    goBackAction(
      navigate,
      window.location.pathname + window.location.search,
      NAV_TRACKER,
    );
  }, [navigate]);
  const {
    handleOpenSpecRefresh, handleBulkArchive, handleReadArtifact,
    handleAttachProposal, handleDetachProposal, handleReplaceProposal,
  } = openspecActions;

  // Flow YAML viewer + agent source viewer moved into flows-plugin's
  // FlowYamlPreview (content-view route flow-yaml-preview) + the
  // FlowsUiStateContext setters. The shell no longer fetches yaml or
  // tracks per-agent source state. See change:
  // pluginize-flows-via-registry.

  // Compute set of session IDs that have active errors
  const errorSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, state] of sessionStates) {
      if (state.lastError) ids.add(id);
    }
    return ids;
  }, [sessionStates]);

  // Compute set of session IDs in active provider-retry phase (retryState set,
  // no terminal error). See change: fix-provider-retry-infinite-loop.
  const retrySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, state] of sessionStates) {
      if (state.retryState && !state.lastError) ids.add(id);
    }
    return ids;
  }, [sessionStates]);

  // Per-session map of unresolved `bash` toolCalls, consumed by the
  // SessionActivityBar inside each session card's PROCESS subcard.
  // See change: redesign-process-list-activity-bar.
  const inflightBashMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof selectInflightBashTools>>();
    for (const [id, state] of sessionStates) {
      const tools = selectInflightBashTools(state);
      if (tools.length > 0) map.set(id, tools);
    }
    return map;
  }, [sessionStates]);

  // Activity-bar stop button. Phase 1 maps every per-toolCall abort to the
  // session-level abort wire message (only abort path that exists today).
  // toolCallId is accepted for forward-compat; Phase 2 may add a per-toolCall
  // abort. See change: redesign-process-list-activity-bar (Q2 path b).
  const handleAbortTool = useCallback((sessionId: string, _toolCallId: string) => {
    send({ type: "abort", sessionId });
  }, [send]);

  const sessionList = (
    <SessionList
      sessions={Array.from(sessions.values())}
      terminals={Array.from(terminals.values())}
      selectedId={selectedId}
      onSelect={handleSelect}
      contextUsageMap={contextUsageMap}
      openspecMap={openspecMap}
      openspecGroupsMap={openspecGroupsMap}
      sessionOrderMap={sessionOrderMap}
      onReorderSessions={(cwd, sessionIds) => {
        setSessionOrderMap((prev) => {
          const next = new Map(prev);
          next.set(cwd, sessionIds);
          return next;
        });
        send({ type: "reorder_sessions", cwd, sessionIds });
      }}
      onSendPrompt={handleSendPromptToSession}
      onOpenSpecRefresh={handleOpenSpecRefresh}
      onBulkArchive={handleBulkArchive}
      onReadArtifact={handleReadArtifact}
      onOpenPiResources={handleOpenPiResources}
      onOpenSpecs={(cwd) => navigate(buildOpenSpecSpecsUrl(cwd))}
      onOpenArchive={(cwd) => navigate(buildOpenSpecArchiveUrl(cwd))}
      onOpenBoard={(cwd) => navigate(buildOpenSpecBoardUrl(cwd))}
      onAttachProposal={handleAttachProposal}
      onDetachProposal={handleDetachProposal}
      onReplaceProposal={handleReplaceProposal}
      onRename={handleRenameSession}
      onShutdown={handleShutdownSession}
      onResume={handleResumeSession}
      onResumeKeepPosition={handleResumeSessionKeepPosition}
      onHideSession={handleHideSession}
      onUnhideSession={handleUnhideSession}
      onSpawnSession={handleSpawnSession}
      spawningCwds={spawningCwds}
      addSpawningCwd={addSpawningCwd}
      clearSpawningCwd={clearSpawningCwd}
      spawnResult={spawnResult}
      onSpawnResultSeen={() => setSpawnResult(null)}
      pinnedDirectories={pinnedDirectories}
      onOpenPinDialog={() => setPinDialogOpen(true)}
      onPinDirectory={(dirPath) => {
        setPinnedDirectories((prev) => prev.includes(dirPath) ? prev : [...prev, dirPath]);
        send({ type: "pin_directory", path: dirPath });
      }}
      onUnpinDirectory={(dirPath) => {
        setPinnedDirectories((prev) => prev.filter((p) => p !== dirPath));
        send({ type: "unpin_directory", path: dirPath });
      }}
      onReorderPinnedDirs={(paths) => {
        setPinnedDirectories(paths);
        send({ type: "reorder_pinned_dirs", paths });
      }}
      onReorderWorkspaces={(ids) => send({ type: "reorder_workspaces", ids })}
      onReorderWorkspaceFolders={(id, paths) => send({ type: "reorder_workspace_folders", id, paths })}
      // folder-workspaces — optimistic UI is intentionally omitted: server
      // is the single source of truth and broadcasts `workspaces_updated`
      // for every mutation, so we just dispatch and let the broadcast
      // arrive (matches the pattern of other workspace-scoped state).
      workspaces={workspaces}
      onCreateWorkspace={(name) => send({ type: "create_workspace", name })}
      onRenameWorkspace={(id, name) => send({ type: "rename_workspace", id, name })}
      onDeleteWorkspace={(id) => send({ type: "delete_workspace", id })}
      onSetWorkspaceCollapsed={(id, collapsed) => send({ type: "set_workspace_collapsed", id, collapsed })}
      onAddFolderToWorkspace={(id, path) => send({ type: "add_folder_to_workspace", id, path })}
      onRemoveFolderFromWorkspace={(id, path) => send({ type: "remove_folder_from_workspace", id, path })}
      onKillTerminal={handleKillTerminal}
      onRenameTerminal={handleRenameTerminal}
      onCollapseSidebar={sidebar.toggleCollapse}
      commandsMap={sessionCommands}
      onKillProcess={handleKillProcess}
      onSetProcessDrawer={(sessionId, collapsed) => send({ type: "set_session_process_drawer", sessionId, collapsed })}
      inflightBashMap={inflightBashMap}
      onAbortTool={handleAbortTool}
      onOpenTerminals={(cwd) => navigate(`/folder/${encodeFolderPath(cwd)}/terminals`)}
      onOpenEditor={(cwd) => navigate(`/folder/${encodeFolderPath(cwd)}/editor`)}
      editorStatuses={editorStatuses}
      editorAvailable={editorAvailable}
      gitWorktreeEnabled={gitWorktreeEnabled}
      errorSessionIds={errorSessionIds}
      retrySessionIds={retrySessionIds}
      spawnErrors={spawnErrors}
      onDismissSpawnError={(cwd) => setSpawnErrors((prev) => { const next = new Map(prev); next.delete(cwd); return next; })}
      resumeErrors={resumeErrors}
      onDismissResumeError={(id) => setResumeErrors((prev) => { const next = new Map(prev); next.delete(id); return next; })}
      headerExtra={
        <div className="flex items-center gap-2">
          {launchSource !== "electron" && <PiUpdateBadge />}
          <ServerSelector
            currentHost={currentServerHost}
            currentPort={currentServerPort}
            connected={status === "connected"}
            onSwitch={handleServerSwitch}
            inFlightSwitchKey={inFlightSwitchKey}
            onManageServers={() => navigate("/settings/remote")}
          />
        </div>
      }
    />
  );

  // Full-page OpenSpec board overlay element. Shared across the three overlay
  // render sites (desktop + responsive layouts). See change: redesign-openspec-board.
  const openspecBoardOverlay = openspecBoardMatch && openspecBoardCwd ? (
    <OpenSpecBoardView
      cwd={openspecBoardCwd}
      data={openspecMap.get(openspecBoardCwd) ?? { initialized: false, pending: false, changes: [], hasOpenspecDir: false }}
      sessions={Array.from(sessions.values())}
      openspecMap={openspecMap}
      groupsState={openspecGroupsMap.get(openspecBoardCwd)}
      onBack={goBack}
      onRefresh={() => handleOpenSpecRefresh(openspecBoardCwd)}
      onReadArtifact={(changeName, artifactId) => handleReadArtifact(openspecBoardCwd, changeName, artifactId)}
      onNavigateToSession={handleSelect}
      onOpenSpecs={() => navigate(buildOpenSpecSpecsUrl(openspecBoardCwd))}
      onOpenArchive={() => navigate(buildOpenSpecArchiveUrl(openspecBoardCwd))}
      onSpawnSession={handleSpawnSession}
      onSpawnAttachedWorktree={(c, changeName) => setBoardWorktreeForChange({ cwd: c, changeName })}
      onResumeSession={handleResumeSession}
      onHideSession={handleHideSession}
      onUnhideSession={handleUnhideSession}
      onSendPrompt={handleSendPromptToSession}
      onAttachProposal={handleAttachProposal}
      onDetachProposal={handleDetachProposal}
      onReplaceProposal={handleReplaceProposal}
      onBulkArchive={() => handleBulkArchive(openspecBoardCwd)}
      isGitRepo={Array.from(sessions.values()).some((s) => s.cwd === openspecBoardCwd && !!s.gitBranch)}
      gitWorktreeEnabled={gitWorktreeEnabled}
      selectedId={selectedId}
    />
  ) : null;

  const connectionBanner = (
    <>
      {status === "connecting" && (
        <div className="bg-yellow-600/20 text-yellow-400 text-xs px-3 py-1 text-center">
          {t("connection.connecting", undefined, "Connecting...")}
        </div>
      )}
      {status === "offline" && (
        <div className="bg-red-600/20 text-red-400 text-xs px-3 py-1 text-center">
          {t("connection.offline", undefined, "Server offline")}
        </div>
      )}
      {status === "auth_required" && (
        <div className="bg-amber-600/20 text-amber-400 text-xs px-3 py-1 text-center">
          {t("connection.authRequired", undefined, "Session expired")}{" - "}
          <a href={`${apiBase}/auth/login?return=${encodeURIComponent(window.location.pathname)}`} className="underline hover:text-amber-300">
            {t("connection.signIn", undefined, "Sign in")}
          </a>
        </div>
      )}
    </>
  );

  const sessionDetail = selectedId ? (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {connectionBanner}
      <SessionHeader
        session={sessions.get(selectedId)}
        state={selectedState}
        onRename={handleRenameSession}
        showBack
        onBack={goBack}
        onResume={selectedId ? (mode) => handleResumeSession(selectedId, mode) : undefined}
        mobileActions={isMobile ? {
          editors: selectedCwd ? editorMap.get(selectedCwd) : undefined,
          openspecChanges: selectedCwd ? openspecMap.get(selectedCwd)?.changes : undefined,
          onHide: () => handleHideSession(selectedId),
          onUnhide: () => handleUnhideSession(selectedId),
          onResume: (mode) => handleResumeSession(selectedId, mode),
          onShutdown: () => handleShutdownSession(selectedId),
          onOpenEditor: selectedCwd ? (editorId) => {
            import("./lib/editor-api.js").then(({ openEditor }) => openEditor(selectedCwd!, editorId));
          } : undefined,
          onAttachProposal: (changeName) => handleAttachProposal(selectedId, changeName),
          onDetachProposal: () => handleDetachProposal(selectedId),
          onSendPrompt: (text) => wrappedHandleSend(text),
          onReadArtifact: (changeName, artifactId) => handleReadArtifact(selectedCwd!, changeName, artifactId),
          onRefresh: () => {
            setSessionStates((prev) => {
              const next = new Map(prev);
              next.set(selectedId, createInitialState());
              return next;
            });
            maxSeqMapRef.current.set(selectedId, 0);
            subscribedRef.current.delete(selectedId);
            subscribedRef.current.add(selectedId);
            send({ type: "subscribe", sessionId: selectedId, lastSeq: 0 });
            beginLoadingHistory(selectedId);
          },
        } : undefined}
        commands={selectedCommands}
        onSendPrompt={wrappedHandleSend}
        openspecChanges={selectedCwd ? openspecMap.get(selectedCwd)?.changes : undefined}
        onAttachProposal={(changeName) => handleAttachProposal(selectedId, changeName)}
        onDetachProposal={() => handleDetachProposal(selectedId)}
        onReadArtifact={selectedCwd ? (changeName, artifactId) => handleReadArtifact(selectedCwd, changeName, artifactId) : undefined}
        hasFileChanges={selectedState.hasFileChanges}
        onOpenDiffView={() => navigate(buildSessionDiffUrl(selectedId))}
        onOpenExtensionModulePicker={() => setExtensionModulePickerOpen(true)}
        onRefresh={() => {
          setSessionStates((prev) => {
            const next = new Map(prev);
            next.set(selectedId, createInitialState());
            return next;
          });
          maxSeqMapRef.current.set(selectedId, 0);
          subscribedRef.current.delete(selectedId);
          subscribedRef.current.add(selectedId);
          send({ type: "subscribe", sessionId: selectedId, lastSeq: 0 });
          beginLoadingHistory(selectedId);
        }}
      />
      {/* Mobile info strip */}
      {isMobile && selectedSession && (
        <div className="px-4 py-1.5 border-b border-[var(--border-primary)] text-xs text-[var(--text-tertiary)]">
          <div className="flex items-center gap-2 flex-wrap">
            {(selectedState.model || selectedSession.model) && (
              <span>{selectedState.model || selectedSession.model}</span>
            )}
            {(selectedState.thinkingLevel || selectedSession.thinkingLevel) && (
              <span>💭 {selectedState.thinkingLevel || selectedSession.thinkingLevel}</span>
            )}
            {selectedState.status === "streaming" && selectedState.currentTool && (
              <span className="text-yellow-400">⚡ {selectedState.currentTool}</span>
            )}
            {selectedState.status === "streaming" && !selectedState.currentTool && (
              <span className="text-green-400">{t("status.thinking", undefined, "Thinking...")}</span>
            )}
            <span className="flex-1" />
            {selectedState.cost > 0 && <span>${selectedState.cost.toFixed(2)}</span>}
          </div>
          {selectedContextUsage && selectedContextUsage.contextWindow > 0 && (
            <div className="mt-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span>{selectedContextUsage.tokens != null ? `${Math.round((selectedContextUsage.tokens / 1000))}k` : "—"}</span>
                <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                  {selectedContextUsage.tokens != null && (
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min((selectedContextUsage.tokens / selectedContextUsage.contextWindow) * 100, 100)}%` }}
                    />
                  )}
                </div>
                <span>{Math.round(selectedContextUsage.contextWindow / 1000)}k</span>
              </div>
            </div>
          )}
        </div>
      )}
      {!isMobile && (() => {
        // Effective pref = override ?? global ?? true (default visible while
        // prefs load). "Token stats bar" gates the butterfly chart + stats;
        // "Context usage bar" independently gates the progress bar.
        // See change: configurable-chat-display.
        const statsOverride = selectedSession?.displayPrefsOverride?.tokenStatsBar;
        const showStats = statsOverride ?? displayPrefs?.tokenStatsBar ?? true;
        const ctxOverride = selectedSession?.displayPrefsOverride?.contextUsageBar;
        const showContextBar = ctxOverride ?? displayPrefs?.contextUsageBar ?? true;
        if (!showStats && !showContextBar) return null;
        return (
          <TokenStatsBar
            turnStats={selectedState.turnStats}
            contextUsage={selectedContextUsage}
            tokensIn={selectedState.tokensIn}
            tokensOut={selectedState.tokensOut}
            cacheRead={selectedState.cacheRead}
            cacheWrite={selectedState.cacheWrite}
            cost={selectedState.cost}
            onTurnClick={(turnIndex) => chatViewRef.current?.scrollToTurn(turnIndex)}
            showStats={showStats}
            showContextBar={showContextBar}
          />
        );
      })()}
      {openspecBoardMatch && openspecBoardCwd ? (
        openspecBoardOverlay
      ) : archiveMatch && archiveCwd ? (
        <ArchiveBrowserView cwd={archiveCwd} onBack={goBack} />
      ) : specsMatch && specsCwd ? (
        <SpecsBrowserView cwd={specsCwd} onBack={goBack} />
      ) : piResourceFileMatch && piResourceFilePath ? (
        <PiResourceFileRoute
          filePath={piResourceFilePath}
          title={piResourceFileTitle}
          onBack={goBack}
        />
      ) : piResourcesMatch && piResourcesCwd ? (
        <PiResourcesView
          cwd={piResourcesCwd}
          onBack={goBack}
          onViewFile={handleViewPiResourceFile}
        />
      ) : openspecPreviewMatch && openspecPreviewCwd && openspecPreviewParams ? (
        <OpenSpecPreview
          cwd={openspecPreviewCwd}
          changeName={decodeURIComponent(openspecPreviewParams.changeName)}
          initialArtifact={decodeURIComponent(openspecPreviewParams.artifactId)}
          openspecMap={openspecMap}
          onBack={goBack}
        />
      ) : fileViewMatch && fileViewCwd && fileViewPath ? (
        <PreviewOverlayView
          target={{ kind: "file", cwd: fileViewCwd, path: fileViewPath }}
          onBack={goBack}
        />
      ) : urlViewMatch && urlViewUrl ? (
        <PreviewOverlayView
          target={{ kind: "url", url: urlViewUrl }}
          onBack={goBack}
        />
      ) : diffMatch && diffSessionId ? (
        <FileDiffView sessionId={diffSessionId} onBack={goBack} />
      ) : (
        <>
          {/* Plugin slot: content-header-sticky — contributions from
              flows-plugin (FlowArchitectClaim, FlowDashboardClaim) and
              future plugins. The shell renders zero flow-specific
              content. See change: pluginize-flows-via-registry. */}
          {selectedSession && (
            <div className="sticky top-0 z-10">
              <ContentHeaderStickySlot session={selectedSession} />
            </div>
          )}
          <ErrorBoundary fallback={
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-2">
                <div className="text-red-400 text-sm">{t("shell.chatError", undefined, "Chat view encountered an error")}</div>
                <button onClick={() => window.location.reload()} className="text-xs text-blue-400 hover:underline">{t("shell.reloadPage", undefined, "Reload page")}</button>
              </div>
            </div>
          }>
            <SessionAssetsProvider assets={selectedSession?.assets}>
            <ChatView ref={chatViewRef} sessionId={selectedId} state={selectedState} toolContext={toolContext} queuedTexts={queuedTextsForSelected} onRespondToUi={handleRespondToUi} onAbort={handleAbort} onForceKill={handleForceKill} onForkFromMessage={selectedId ? (entryId) => handleResumeSession(selectedId, "fork", entryId) : undefined} onCloseInlineTerminal={selectedId ? (tid) => handleCloseInlineTerminal(selectedId, tid) : undefined} pendingSteering={selectedSession?.pendingQueues?.steering ?? []} loadingHistory={selectedId ? loadingHistory.get(selectedId) ?? false : false} />
            </SessionAssetsProvider>
          </ErrorBoundary>
          {/* Unified status banner. Sticky above the command input — picks
              exactly ONE variant from `(retryState, lastError)`. Replaces
              RetryBanner + ErrorBanner that previously lived inside ChatView.
              See change: unify-status-banner-and-terminal-limit-stop. */}
          <SessionBanner
            state={deriveBannerState(selectedState)}
            onAbort={handleAbort}
            onRetry={selectedId ? () => {
              // Retry the last user prompt by re-sending it via send_prompt.
              // The reducer flags the new user message `retriedFrom` so the
              // chat view does not render a duplicate bubble. See change:
              // fix-retry-resends-last-user-message.
              const last = findLastUserPrompt(selectedState.messages);
              if (last) handleSendPromptToSession(selectedId, last.text, last.images);
            } : undefined}
            onDismiss={selectedId ? () => {
              setSessionStates((prev) => {
                const next = new Map(prev);
                const current = next.get(selectedId!);
                if (current?.lastError) {
                  next.set(selectedId!, { ...current, lastError: undefined });
                }
                return next;
              });
            } : undefined}
          />
          <StatusBar
            model={selectedState.model ?? selectedSession?.model}
            models={modelsMap.get(selectedId)}
            favorites={favoriteModels}
            onToggleFavorite={(label, makeFavorite) =>
              send({ type: makeFavorite ? "favorite_model" : "unfavorite_model", label })
            }
            roles={rolesMap.get(selectedId)}
            thinkingLevel={selectedState.thinkingLevel ?? selectedSession?.thinkingLevel}
            status={selectedState.status}
            currentTool={selectedState.currentTool}
            streamingText={selectedState.streamingText || undefined}
            leading={selectedSession && selectedCwd ? (
              <>
                <StatusBarRefreshButton cwd={selectedCwd} onRefresh={handleOpenSpecRefresh} />
                {selectedId && (
                  <ChatViewMenu
                    sessionId={selectedId}
                    currentOverride={selectedSession?.displayPrefsOverride}
                    send={(msg) => send({ type: "setSessionDisplayPrefs", sessionId: selectedId, override: msg.override })}
                  />
                )}
              </>
            ) : undefined}
            actions={selectedSession ? (
              <ComposerSessionActions
                session={selectedSession}
                changes={selectedCwd ? openspecMap.get(selectedCwd)?.changes : undefined}
                openspecHasDir={selectedCwd ? openspecMap.get(selectedCwd)?.hasOpenspecDir : undefined}
                openspecPending={selectedCwd ? openspecMap.get(selectedCwd)?.pending : undefined}
                onSendPrompt={(text, images) => wrappedHandleSend(text, images)}
                onReadArtifact={selectedCwd ? (changeName, artifactId) => handleReadArtifact(selectedCwd, changeName, artifactId) : undefined}
                onBulkArchive={selectedCwd ? () => handleBulkArchive(selectedCwd) : undefined}
                allSessions={Array.from(sessions.values())}
                showGitInfo={true}
                openspecConfig={openspecConfig}
              />
            ) : undefined}
            onSelectModel={(modelStr) => {
              const slashIdx = modelStr.indexOf("/");
              if (slashIdx > 0) {
                const provider = modelStr.slice(0, slashIdx);
                const modelId = modelStr.slice(slashIdx + 1);
                send({ type: "set_model", sessionId: selectedId, provider, modelId });
              }
            }}
            onSelectThinkingLevel={(level) => {
              send({ type: "set_thinking_level", sessionId: selectedId, level });
            }}
            onRoleSet={(role, modelId) => {
              send({ type: "role_set", sessionId: selectedId, role, modelId });
            }}
            onPresetLoad={(presetName) => {
              send({ type: "role_preset_load", sessionId: selectedId, presetName });
            }}
            onPresetSave={(presetName) => {
              send({ type: "role_preset_save", sessionId: selectedId, presetName });
            }}
            onPresetDelete={(presetName) => {
              send({ type: "role_preset_delete", sessionId: selectedId, presetName });
            }}
          />
          {/* Pi-native follow-up queue — DISPLAY-ONLY (cycle with ↑/↓).
              Mutation controls (clear / edit / promote / remove) removed:
              pi's ExtensionAPI doesn't expose queue mutation; the previous
              implementation called fictional `clearFollowUpQueue` and
              corrupted pi's queue with append-duplicates. Empirical test:
              /tmp/pi-queue-experiment.mjs. See change:
              unify-status-banner-and-terminal-limit-stop. */}
          <QueuePanel
            followUp={selectedSession?.pendingQueues?.followUp ?? []}
            onEdit={(index, text) => editFollowUpEntry(index, text)}
            onRemove={removeFollowUpEntry}
            onPromote={promoteFollowUpEntry}
            onClearAll={() => clearFollowUpEntries("all")}
          />
          <CommandInput
            commands={selectedCommands}
            onSend={wrappedHandleSend}
            onListFiles={handleListFiles}
            fileResults={fileResults}
            disabled={false}
            sessionStatus={selectedState.status}
            retrying={selectedState.retryState !== undefined}
            onAbort={handleAbort}
            onForceKill={handleForceKill}
            pendingPrompt={!!selectedState.pendingPrompt}
            onCancelPending={handleCancelPending}
            sessionId={selectedId}
            draft={selectedDraft}
            onDraftChange={setDraftForSelected}
            history={selectedHistory}
            images={selectedImages}
            onImagesChange={setImagesForSelected}
            currentCwd={selectedSession?.cwd}
            onViewLocal={(target) => {
              if (!selectedId) return;
              send({ type: "inject_view_message", sessionId: selectedId, target });
            }}
            onOpenInlineTerminal={selectedId && selectedCwd ? () => handleOpenInlineTerminal(selectedId, selectedCwd) : undefined}
            sessionMessages={selectedState.messages}
          />
          {/* Plugin slot: content-inline-footer — contributions from flows-plugin (per-session inline footer) and other plugins. */}
          {selectedSession && <ContentInlineFooterSlot session={selectedSession} />}
          {/* Extension UI System (Phase 1): module picker + generic modal. */}
          {/* See change: add-extension-ui-modal. */}
          {extensionModulePickerOpen && selectedId && (() => {
            const session = sessions.get(selectedId);
            const modules = session?.uiModules ?? [];
            const options: SelectOption[] = modules.map((m) => ({
              value: m.id,
              label: m.title,
              description: m.description ?? m.command,
              badge: m.category,
            }));
            return (
              <SearchableSelectDialog
                title={t("extension.modules", undefined, "Extension Modules")}
                options={options}
                placeholder={t("extension.searchModules", undefined, "Search modules...")}
                emptyMessage={t("extension.noModules", undefined, "No modules available")}
                onSelect={(moduleId) => {
                  setExtensionModuleOpen({ sessionId: selectedId, moduleId });
                  setExtensionModulePickerOpen(false);
                }}
                onCancel={() => setExtensionModulePickerOpen(false)}
              />
            );
          })()}
          {/* Extension UI System (Phase 2): toast slot — top-right tray. */}
          {/* See change: add-extension-ui-decorations. */}
          <ToastSlot sessions={sessions} />
          {extensionModuleOpen && (() => {
            const session = sessions.get(extensionModuleOpen.sessionId);
            const module = session?.uiModules?.find((m) => m.id === extensionModuleOpen.moduleId);
            if (!module) return null;
            const dataEvent = module.view.dataEvent;
            const rows = dataEvent ? (session?.uiDataMap?.[dataEvent] ?? []) : [];
            return (
              <GenericExtensionDialog
                module={module}
                rows={rows}
                onDispatch={({ action, event, params }) => {
                  send({
                    type: "ui_management",
                    sessionId: extensionModuleOpen.sessionId,
                    action,
                    event,
                    params,
                  });
                }}
                onClose={() => setExtensionModuleOpen(null)}
              />
            );
          })()}
        </>
      )}
    </div>
  ) : null;

  // Get terminals for a specific folder cwd
  const getTerminalsForCwd = useCallback((cwd: string) => {
    return Array.from(terminals.values()).filter((t) => t.cwd === cwd);
  }, [terminals]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const handleEditorClose = useCallback(() => navigateRef.current("/"), []);

  // Folder view content (TerminalsView or EditorView)
  const folderViewContent = useMemo(() => {
    if (folderTermCwd) {
      const pendingTermId = lastCreatedTerminalIdRef.current;
      if (pendingTermId) lastCreatedTerminalIdRef.current = null;
      return (
        <TerminalsView
          cwd={folderTermCwd}
          terminals={getTerminalsForCwd(folderTermCwd)}
          activeTerminalId={pendingTermId ?? undefined}
          onCreateTerminal={handleCreateTerminal}
          onKillTerminal={handleKillTerminal}
          onRenameTerminal={handleRenameTerminal}
          onTerminalTitle={handleTerminalTitle}
        />
      );
    }
    if (folderEditorCwd) {
      return <EditorView cwd={folderEditorCwd} onClose={handleEditorClose} />;
    }
    return null;
  }, [folderTermCwd, folderEditorCwd, getTerminalsForCwd, handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleTerminalTitle, handleEditorClose]);

  const allSessionsList = useMemo(() => Array.from(sessions.values()), [sessions]);

  // Outer chrome ErrorBoundary — defense-in-depth for first-party shell
  // components (sidebar, session list, content header, MobileShell). The
  // inner ChatView ErrorBoundary still wins for chat-tree errors via React's
  // nearest-boundary semantics; this only fires when chrome itself throws
  // (e.g. a missing import / undefined symbol in SessionCard / SessionList).
  // Without it, a render-time ReferenceError in any chrome component blanks
  // the entire window. See change:
  // fix-session-card-icon-import-and-shell-boundary.
  // Memoize the session-override lookup so consumer `useDisplayPrefs`
  // re-runs only when the relevant session's override actually changes.
  const displayPrefsContextValue = useMemo(() => ({
    global: displayPrefs,
    getSessionOverride: (sessionId: string | undefined) =>
      sessionId ? sessions.get(sessionId)?.displayPrefsOverride : undefined,
  }), [displayPrefs, sessions]);

  const apiProvider = (children: React.ReactNode) => (
    <ApiContext.Provider value={apiBase}>
      <DisplayPrefsProvider value={displayPrefsContextValue}>
      <PluginContextProvider
        registry={_pluginRegistry}
        sessions={allSessionsList}
        selectedSessionId={selectedId}
        send={(msg) => send(msg as Parameters<typeof send>[0])}
        useSessionInteractiveRequests={(sid) =>
          sessionStates.get(sid)?.interactiveRequests ?? EMPTY_INTERACTIVE_REQUESTS
        }
        useSessionSubagents={(sid) =>
          // Upcast `Map<string, SubagentState>` to `ReadonlyMap<string, SubagentStateSnapshot>`.
          // `SubagentState` is structurally compatible with `SubagentStateSnapshot` but TS
          // can't bridge the `Record<string, unknown>` index-signature requirement directly,
          // so we route the cast through `unknown`. Plugins downcast at their boundary.
          ((sessionStates.get(sid)?.subagents ?? EMPTY_SUBAGENTS_MAP) as unknown as ReadonlyMap<string, SubagentStateSnapshot>)
        }
        connectionStatus={
          status === "connected" || status === "connecting" ? status : "disconnected"
        }
      >
      <ShellSessionsProvider value={sessions}>
        <ErrorBoundary fallback={
          <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--bg-primary)] text-[var(--text-primary)]" data-testid="shell-error-fallback">
            <div className="text-center space-y-2">
              <div className="text-red-400 text-sm">{t("shell.error", undefined, "Shell encountered an error")}</div>
              <button onClick={() => window.location.reload()} className="text-xs text-blue-400 hover:underline">{t("shell.reloadPage", undefined, "Reload page")}</button>
            </div>
          </div>
        }>
          {children}
        </ErrorBoundary>
      </ShellSessionsProvider>
      </PluginContextProvider>
      </DisplayPrefsProvider>
    </ApiContext.Provider>
  );

  // Mobile: two-step full-screen navigation
  if (isMobile) {
    const mobileDepth = getMobileDepth({
      hasSessionRoute: !!selectedId,
      hasFolderRoute: !!folderTermCwd || !!folderEditorCwd,
      hasSettingsRoute: !!settingsMatch,
      hasTunnelRoute: !!tunnelSetupMatch,
      hasOverlayRoute: hasShellOverlayRoute,
      hasPiResourceRoute: hasPiResourceRouteFlag,
    });
    return apiProvider(
      <div className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <PluginStalenessBanner />
        <ConnectionStatusBanner
          status={status}
          currentServerHost={currentServerHost}
          inFlightSwitch={inFlightSwitchKey !== null}
        />
        <Toast messages={toastMessages} onDismiss={dismissToast} />
        <SpawnErrorToastHost />
        {/* First-launch chat-display preset picker. Opens once when the
            server reports `displayPrefs: undefined`. See change:
            configurable-chat-display. */}
        {displayPrefsLoaded && displayPrefs === undefined && (
          <FirstLaunchDisplayModal
            apiBase={apiBase}
            onClose={() => { /* PATCH inside the modal triggers display_prefs_updated which seeds the store; no extra work needed. */ }}
          />
        )}
        <MobileShell
          depth={mobileDepth}
          onBack={() => {
            goBack();
          }}
          listPanel={
            <div className="flex flex-col h-full">
              <InstallBanner canInstall={installPrompt.canInstall} isIOS={installPrompt.isIOS} isInstalled={installPrompt.isInstalled} prompt={installPrompt.prompt} />
              <MissingRequiredBanner />
              {connectionBanner}
              {sessionList}
            </div>
          }
          detailPanel={
            settingsMatch ? (
              <SettingsPanel onMessage={onMessage} onBack={goBack} />
            ) : tunnelSetupMatch ? (
              <ZrokInstallGuide onBack={goBack} />
            ) : pluginOverlayMatched ? (
              // Plugin-owned overlay routes (subagent popout, flow-agent popout,
              // any future plugin route). The slot consumer matches the active
              // URL against every registered claim's `config.path`.
              // We pass `_pluginRegistry` explicitly for the same reason the
              // hook does — see change: fix-flows-plugin-polish.
              <ShellOverlayRouteSlot onBack={goBack} registry={_pluginRegistry} />
            ) : openspecBoardMatch && openspecBoardCwd ? (
              openspecBoardOverlay
            ) : archiveMatch && archiveCwd ? (
              <ArchiveBrowserView cwd={archiveCwd} onBack={goBack} />
            ) : specsMatch && specsCwd ? (
              <SpecsBrowserView cwd={specsCwd} onBack={goBack} />
            ) : diffMatch && diffSessionId ? (
              <FileDiffView sessionId={diffSessionId} onBack={goBack} />
            ) : piResourceFileMatch && piResourceFilePath ? (
              <PiResourceFileRoute
                filePath={piResourceFilePath}
                title={piResourceFileTitle}
                onBack={goBack}
              />
            ) : piResourcesMatch && piResourcesCwd ? (
              <PiResourcesView
                cwd={piResourcesCwd}
                onBack={goBack}
                onViewFile={handleViewPiResourceFile}
              />
            ) : openspecPreviewMatch && openspecPreviewCwd && openspecPreviewParams ? (
              <OpenSpecPreview
                cwd={openspecPreviewCwd}
                changeName={decodeURIComponent(openspecPreviewParams.changeName)}
                initialArtifact={decodeURIComponent(openspecPreviewParams.artifactId)}
                openspecMap={openspecMap}
                onBack={goBack}
              />
            ) : fileViewMatch && fileViewCwd && fileViewPath ? (
              <PreviewOverlayView
                target={{ kind: "file", cwd: fileViewCwd, path: fileViewPath }}
                onBack={goBack}
              />
            ) : urlViewMatch && urlViewUrl ? (
              <PreviewOverlayView
                target={{ kind: "url", url: urlViewUrl }}
                onBack={goBack}
              />
            ) : folderTermCwd ? (
              <TerminalsView
                cwd={folderTermCwd}
                terminals={getTerminalsForCwd(folderTermCwd)}
                activeTerminalId={lastCreatedTerminalIdRef.current ?? undefined}
                onCreateTerminal={handleCreateTerminal}
                onKillTerminal={handleKillTerminal}
                onRenameTerminal={handleRenameTerminal}
                onTerminalTitle={handleTerminalTitle}
              />
            ) : folderEditorCwd ? (
              <EditorView cwd={folderEditorCwd} onClose={handleEditorClose} />
            ) : sessionDetail ?? (
            // Legacy /terminal/:id branch removed — see change:
            // fix-terminal-half-height-dual-mount.
              <LandingPage
                providersReady={providersReady.ready}
                pinnedCount={pinnedDirectories.length}
                sessionsCount={sessions.size}
                firstPinnedCwd={pinnedDirectories[0] ?? null}
                onOpenPinDialog={() => setPinDialogOpen(true)}
                onSpawnSession={handleSpawnSession}
                navigate={navigate}
              />
            )
          }
        />
        {pinDialogOpen && (
          <DialogPortal>
            <PinDirectoryDialog
              onPin={(dirPath) => {
                setPinnedDirectories((prev) => prev.includes(dirPath) ? prev : [...prev, dirPath]);
                send({ type: "pin_directory", path: dirPath });
                setPinDialogOpen(false);
              }}
              onCancel={() => setPinDialogOpen(false)}
            />
          </DialogPortal>
        )}
      </div>
    );
  }

  // Desktop: side-by-side layout
  return apiProvider(
    <div className="flex h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="hidden md:flex">
        <ResizableSidebar sidebar={sidebar}>
          {sessionList}
        </ResizableSidebar>
      </div>

      <HamburgerButton onClick={() => setMobileOpen(true)} />
      <MobileOverlay open={mobileOpen} onClose={() => setMobileOpen(false)}>
        {sessionList}
      </MobileOverlay>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {connectionBanner}
        {/* Folder views (TerminalsView or EditorView) — single owner of
            <TerminalView> mounting. The legacy keep-alive list above
            (mounted unconditionally for the /terminal/:id route) was
            removed; it caused dual-mounting per terminal id and the
            half-height rendering bug. See change:
            fix-terminal-half-height-dual-mount. */}
        {folderViewContent && (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">{folderViewContent}</div>
        )}
        {/* Show session detail or landing page when no folder view is selected */}
        {!folderTermCwd && !folderEditorCwd && !settingsMatch && !tunnelSetupMatch && (
          pluginOverlayMatched ? (
            // Plugin-owned overlay routes — see change: add-flow-agent-popout.
            // Pass `_pluginRegistry` explicitly (see comment on
            // `pluginOverlayMatched` declaration above).
            <ShellOverlayRouteSlot onBack={goBack} registry={_pluginRegistry} />
          ) : openspecBoardMatch && openspecBoardCwd ? (
            openspecBoardOverlay
          ) : archiveMatch && archiveCwd ? (
            <ArchiveBrowserView cwd={archiveCwd} onBack={goBack} />
          ) : specsMatch && specsCwd ? (
            <SpecsBrowserView cwd={specsCwd} onBack={goBack} />
          ) : piResourceFileMatch && piResourceFilePath ? (
            <PiResourceFileRoute
              filePath={piResourceFilePath}
              title={piResourceFileTitle}
              onBack={goBack}
            />
          ) : piResourcesMatch && piResourcesCwd && !selectedId ? (
            <PiResourcesView
              cwd={piResourcesCwd}
              onBack={goBack}
              onViewFile={handleViewPiResourceFile}
            />
          ) : openspecPreviewMatch && openspecPreviewCwd && openspecPreviewParams && !selectedId ? (
            <OpenSpecPreview
              cwd={openspecPreviewCwd}
              changeName={decodeURIComponent(openspecPreviewParams.changeName)}
              initialArtifact={decodeURIComponent(openspecPreviewParams.artifactId)}
              openspecMap={openspecMap}
              onBack={goBack}
            />
          ) : fileViewMatch && fileViewCwd && fileViewPath && !selectedId ? (
            <PreviewOverlayView
              target={{ kind: "file", cwd: fileViewCwd, path: fileViewPath }}
              onBack={goBack}
            />
          ) : urlViewMatch && urlViewUrl && !selectedId ? (
            <PreviewOverlayView
              target={{ kind: "url", url: urlViewUrl }}
              onBack={goBack}
            />
          ) : (
            /* Plugin slot: content-view — only render when at least one
               registered claim's predicate returns true for the current
               session. Each claim's predicate closes over the plugin's
               own UI-state store; a `false` predicate means "this claim
               doesn't want to render right now" and the slot returns
               null. Without this gate, plugins that registered
               content-view claims with all-false predicates would cause
               `<ContentViewSlot>` to return null while still satisfying
               the `??` operator, masking sessionDetail / LandingPage.
               See change: pluginize-flows-via-registry (design.md
               Decision 3 RECONSIDERED). */
            (selectedId && selectedSession && forSession(_pluginRegistry.getClaims("content-view"), selectedSession).length > 0
              ? <ContentViewSlot session={selectedSession} routeParams={{}} onClose={() => { /* Plugin claim clears its own UI state on dismiss, revealing the chat at the current /session/:id; the shell must NOT navigate away. See change: fix-settings-back-to-launching-route. */ }} />
              : null
            ) ?? sessionDetail ?? (
              <LandingPage
                providersReady={providersReady.ready}
                pinnedCount={pinnedDirectories.length}
                sessionsCount={sessions.size}
                firstPinnedCwd={pinnedDirectories[0] ?? null}
                onOpenPinDialog={() => setPinDialogOpen(true)}
                onSpawnSession={handleSpawnSession}
                navigate={navigate}
              />
            )
          )
        )}
        {settingsMatch && <SettingsPanel availableModels={(() => {
          const seen = new Set<string>();
          const models: Array<{ provider: string; id: string }> = [];
          for (const list of modelsMap.values()) {
            for (const m of list) {
              const key = `${m.provider}/${m.id}`;
              if (!seen.has(key)) { seen.add(key); models.push(m); }
            }
          }
          return models;
        })()} onMessage={onMessage} onBack={goBack} />}
        {tunnelSetupMatch && <ZrokInstallGuide onBack={goBack} />}
      </div>
      {boardWorktreeForChange && (
        <WorktreeSpawnDialog
          cwd={boardWorktreeForChange.cwd}
          initialBranch={`os/${boardWorktreeForChange.changeName}`}
          attachProposal={boardWorktreeForChange.changeName}
          onCancel={() => setBoardWorktreeForChange(null)}
          onSpawnStart={(c) => addSpawningCwd(c)}
          onSpawnAbort={(c) => clearSpawningCwd(c)}
          onSpawn={(path, opts) => {
            const placeholderCwd = boardWorktreeForChange.cwd;
            setBoardWorktreeForChange(null);
            handleSpawnSession(path, opts?.attachProposal, { ...opts, placeholderCwd });
            // Opt-in trusted-only worktree auto-init. See change: auto-init-worktree-on-spawn.
            void maybeAutoInitWorktreeOnSpawn(path);
          }}
        />
      )}
      {pinDialogOpen && (
        <DialogPortal>
          <PinDirectoryDialog
            onPin={(dirPath) => {
              setPinnedDirectories((prev) => prev.includes(dirPath) ? prev : [...prev, dirPath]);
              send({ type: "pin_directory", path: dirPath });
              setPinDialogOpen(false);
            }}
            onCancel={() => setPinDialogOpen(false)}
          />
        </DialogPortal>
      )}
    </div>
  );
}

/**
 * StatusBar refresh button — local state for a brief spinner so the user
 * gets visual confirmation that the click registered. The actual refetch
 * is fire-and-forget over the websocket; the spin timeout is purely UX
 * affordance.
 * See change: redesign-session-card-and-composer (refresh-before-model).
 */
function StatusBarRefreshButton({ cwd, onRefresh }: { cwd: string; onRefresh: (cwd: string) => void }) {
  const { t } = useI18n();
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRefresh(cwd);
        setSpinning(true);
        setTimeout(() => setSpinning(false), 600);
      }}
      title={t("status.refreshOpenSpec", undefined, "Refresh OpenSpec data")}
      data-testid="statusbar-refresh-btn"
      className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] p-0.5"
    >
      <Icon path={mdiRefresh} size={0.55} spin={spinning} />
    </button>
  );
}
