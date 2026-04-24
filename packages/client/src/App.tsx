import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRoute, useLocation, Redirect, Switch, Route } from "wouter";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useSidebarState } from "./hooks/useSidebarState.js";
import { SessionList } from "./components/SessionList.js";
import { ResizableSidebar } from "./components/ResizableSidebar.js";
import { HamburgerButton, MobileOverlay } from "./components/MobileOverlay.js";
import { MobileShell } from "./components/MobileShell.js";
import { useMobile } from "./hooks/useMobile.js";
import { getMobileDepth } from "./lib/mobile-depth.js";
import { ChatView, type ChatViewHandle } from "./components/ChatView.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { FlowDashboard } from "./components/FlowDashboard.js";
import { FlowAgentDetail } from "./components/FlowAgentDetail.js";
import { FlowArchitect, FlowArchitectDetail } from "./components/FlowArchitect.js";
import { MarkdownPreviewView } from "./components/MarkdownPreviewView.js";
import { PiResourcesView } from "./components/PiResourcesView.js";
import { SpecsBrowserView } from "./components/SpecsBrowserView.js";
import { ArchiveBrowserView } from "./components/ArchiveBrowserView.js";
import { useOpenSpecReader } from "./hooks/useOpenSpecReader.js";
import type { OpenSpecArtifact } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SessionHeader } from "./components/SessionHeader.js";
import { ServerSelector } from "./components/ServerSelector.js";
import { PiUpdateBadge } from "./components/PiUpdateBadge.js";
import { TokenStatsBar } from "./components/TokenStatsBar.js";

import { CommandInput } from "./components/CommandInput.js";
import { StatusBar } from "./components/StatusBar.js";
import { LandingPage } from "./components/LandingPage.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ZrokInstallGuide } from "./components/ZrokInstallGuide.js";
import { InstallBanner } from "./components/InstallBanner.js";
import { MissingRequiredBanner } from "./components/MissingRequiredBanner.js";
import { useInstallPrompt } from "./hooks/useInstallPrompt.js";
import { TerminalView } from "./components/TerminalView.js";
import { TerminalsView } from "./components/TerminalsView.js";
import { EditorView } from "./components/EditorView.js";
import { decodeFolderPath, encodeFolderPath } from "./lib/folder-encoding.js";
import { FileDiffView } from "./components/FileDiffView.js";
import { createInitialState, reduceEvent, resolveInteractiveRequest, type SessionState } from "./lib/event-reducer.js";
import { useMessageHandler } from "./hooks/useMessageHandler.js";
import { useEditors } from "./lib/use-editors.js";
import { useContentViews } from "./hooks/useContentViews.js";
import { useSessionActions } from "./hooks/useSessionActions.js";
import { usePendingPromptTimeout } from "./hooks/usePendingPromptTimeout.js";
import { useOpenSpecActions } from "./hooks/useOpenSpecActions.js";
import type { DashboardSession, CommandInfo, FlowInfo, FileEntry, OpenSpecData, ModelInfo, RoleInfo, ImageContent, CronJob, ExtensionUiModule } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SearchableSelectDialog, type SelectOption } from "./components/SearchableSelectDialog.js";
import { FlowLaunchDialog } from "./components/FlowLaunchDialog.js";
import { GenericExtensionDialog } from "./components/GenericExtensionDialog.js";
import { Toast, useToast } from "./components/Toast.js";
import { PinDirectoryDialog } from "./components/PinDirectoryDialog.js";
import { DialogPortal } from "./components/DialogPortal.js";
import { useProvidersReady } from "./hooks/useProvidersReady.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ToolContext } from "./components/tool-renderers/index.js";
import type { ContextUsageInfo } from "./components/SessionList.js";
import { ApiContext, deriveApiBase, VITE_API_URL, setGlobalApiBase } from "./lib/api-context.js";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port ? `:${window.location.port}` : "";
const DEFAULT_WS_URL = `${wsProtocol}//${window.location.hostname}${wsPort}/ws`;
const LAST_SERVER_KEY = "pi-dashboard-last-server";

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



function OpenSpecPreview({
  cwd,
  changeName,
  initialArtifact,
  artifacts,
  onBack,
}: {
  cwd: string;
  changeName: string;
  initialArtifact: string;
  artifacts: OpenSpecArtifact[];
  onBack: () => void;
}) {
  const reader = useOpenSpecReader(cwd, changeName, initialArtifact, artifacts);
  return (
    <MarkdownPreviewView
      title={reader.title}
      content={reader.content}
      isLoading={reader.isLoading}
      error={reader.error}
      tabs={reader.tabs}
      activeTab={reader.activeTab}
      onTabChange={reader.setActiveTab}
      onBack={onBack}
    />
  );
}

export default function App() {
  const [wsUrl, setWsUrl] = useState(getInitialWsUrl);
  const { send, onMessage, status } = useWebSocket(wsUrl);
  const apiBase = useMemo(() => {
    const base = deriveApiBase(wsUrl) || VITE_API_URL;
    setGlobalApiBase(base);
    return base;
  }, [wsUrl]);
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/session/:id");
  const [termMatch, termParams] = useRoute("/terminal/:id");
  const [folderTermMatch, folderTermParams] = useRoute("/folder/:encodedCwd/terminals");
  const [folderEditorMatch, folderEditorParams] = useRoute("/folder/:encodedCwd/editor");
  const [settingsMatch] = useRoute("/settings");
  const [tunnelSetupMatch] = useRoute("/tunnel-setup");
  const selectedId = match ? params?.id : undefined;
  const selectedSessionIdRef = useRef<string | undefined>(selectedId);
  selectedSessionIdRef.current = selectedId;
  const selectedTerminalId = termMatch ? termParams?.id : undefined;
  const folderTermCwd = folderTermMatch ? decodeFolderPath(folderTermParams?.encodedCwd ?? "") : null;
  const folderEditorCwd = folderEditorMatch ? decodeFolderPath(folderEditorParams?.encodedCwd ?? "") : null;
  const sidebar = useSidebarState();
  const chatViewRef = useRef<ChatViewHandle>(null);
  const isMobile = useMobile();
  const installPrompt = useInstallPrompt();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessions, setSessions] = useState<Map<string, DashboardSession>>(new Map());
  const [sessionStates, setSessionStates] = useState<Map<string, SessionState>>(new Map());
  const [sessionCommands, setSessionCommands] = useState<Map<string, CommandInfo[]>>(new Map());
  const [sessionUiModules, setSessionUiModules] = useState<Map<string, ExtensionUiModule[]>>(new Map());
  const [sessionUiData, setSessionUiData] = useState<Map<string, Map<string, any[]>>>(new Map());
  const [fileResults, setFileResults] = useState<{ query: string; files: FileEntry[] } | null>(null);
  const [openspecMap, setOpenspecMap] = useState<Map<string, OpenSpecData>>(new Map());
  const [modelsMap, setModelsMap] = useState<Map<string, ModelInfo[]>>(new Map());
  const [rolesMap, setRolesMap] = useState<Map<string, RoleInfo>>(new Map());
  const [spawnResult, setSpawnResult] = useState<{ success: boolean; message: string } | null>(null);
  const [spawnErrors, setSpawnErrors] = useState<Map<string, string>>(new Map());
  const [resumeErrors, setResumeErrors] = useState<Map<string, string>>(new Map());
  const [spawningCwds, setSpawningCwds] = useState<Set<string>>(new Set());
  const spawningCwdsRef = useRef<Set<string>>(spawningCwds);
  spawningCwdsRef.current = spawningCwds;
  const spawnTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [sessionOrderMap, setSessionOrderMap] = useState<Map<string, string[]>>(new Map());
  const [pinnedDirectories, setPinnedDirectories] = useState<string[]>([]);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const providersReady = useProvidersReady();
  const [terminals, setTerminals] = useState<Map<string, TerminalSession>>(new Map());
  const pendingTerminalCwdRef = useRef<string | null>(null);
  const lastCreatedTerminalIdRef = useRef<string | null>(null);
  const [editorStatuses, setEditorStatuses] = useState<Map<string, { id: string; status: EditorInstanceStatus }>>(new Map());
  const [editorAvailable, setEditorAvailable] = useState<boolean | undefined>(undefined);
  const [discoveredServers, setDiscoveredServers] = useState<import("./components/ServerSelector.js").DiscoveredServerInfo[]>([]);
  const subscribedRef = useRef(new Set<string>());
  const maxSeqMapRef = useRef(new Map<string, number>());
  const [flowDetailAgent, setFlowDetailAgent] = useState<string | null>(null);
  const [architectDetailOpen, setArchitectDetailOpen] = useState(false);
  const [previewState, setPreviewState] = useState<{
    cwd: string;
    changeName: string;
    artifactId: string;
    artifacts: OpenSpecArtifact[];
  } | null>(null);
  const [specsBrowserCwd, setSpecsBrowserCwd] = useState<string | null>(null);
  const [archiveBrowserCwd, setArchiveBrowserCwd] = useState<string | null>(null);
  const [diffViewSessionId, setDiffViewSessionId] = useState<string | null>(null);
  const [flowYamlPreview, setFlowYamlPreview] = useState<{ content: string; title: string } | null>(null);
  const [sourceOpenAgent, setSourceOpenAgent] = useState<string | null>(null);

  // Clear all App-level content view states (everything except useContentViews-owned states)
  const clearAppContentViews = useCallback(() => {
    setPreviewState(null);
    setSpecsBrowserCwd(null);
    setArchiveBrowserCwd(null);
    setDiffViewSessionId(null);
    setFlowYamlPreview(null);
    setSourceOpenAgent(null);
    setFlowDetailAgent(null);
    setArchitectDetailOpen(false);
  }, []);

  const {
    piResourcesState, setPiResourcesState,
    piResourceFilePreview, setPiResourceFilePreview,
    readmePreview, setReadmePreview,
    clearAll: clearContentViews,
    handleOpenPiResources,
    handleViewPiResourceFile,
    handleViewReadme,
  } = useContentViews({ onBeforeOpen: clearAppContentViews });

  /** Clear every content view — App-level + useContentViews-owned. */
  const clearAllContentViews = useCallback(() => {
    clearAppContentViews();
    clearContentViews();
  }, [clearAppContentViews, clearContentViews]);

  const handleServerSwitch = useCallback((host: string, port: number) => {
    const newUrl = `${wsProtocol}//${host}:${port}/ws`;
    localStorage.setItem(LAST_SERVER_KEY, `${host}:${port}`);
    // Persist to config.json for bridge/Electron reconnection
    fetch(`${apiBase}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastServer: `${host}:${port}` }),
    }).catch(() => {}); // Best-effort, don't block switching
    // Clear all state for clean reconnect
    setSessions(new Map());
    setSessionStates(new Map());
    setSessionCommands(new Map());
    setSessionUiModules(new Map());
    setSessionUiData(new Map());
    setOpenspecMap(new Map());
    setTerminals(new Map());
    subscribedRef.current.clear();
    setWsUrl(newUrl);
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

  const { messages, showToast, dismissToast } = useToast();

  const handleMessage = useMessageHandler(
    { setSessions, setSessionStates, setSessionCommands, setSessionUiModules, setSessionUiData, setFileResults, setOpenspecMap, setModelsMap, setRolesMap, setSpawnResult, setSessionOrderMap, setPinnedDirectories, setTerminals, setEditorStatuses, setDiscoveredServers, setSpawnErrors, setResumeErrors, showToast },
    { send, navigate, clearSpawningCwd, spawningCwdsRef, subscribedRef, pendingTerminalCwdRef, lastCreatedTerminalIdRef, maxSeqMapRef, selectedSessionIdRef },
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

  // Clear subscriptions on reconnect so sessions get re-subscribed
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (status === "connected" && prevStatusRef.current !== "connected") {
      subscribedRef.current.clear();
      setSessionOrderMap(new Map());
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

  // Clear preview when session changes + lazy subscribe ended sessions
  const prevSelectedRef = useRef(selectedId);
  useEffect(() => {
    if (selectedId !== prevSelectedRef.current) {
      clearAllContentViews();
      prevSelectedRef.current = selectedId;
    }
    // Lazy subscribe: load events for ended sessions when first selected.
    // Also re-subscribes the selected session after reconnect (status change
    // clears subscribedRef, and adding `status` here re-triggers the effect).
    if (selectedId && !subscribedRef.current.has(selectedId) && status === "connected") {
      subscribedRef.current.add(selectedId);
      send({ type: "subscribe", sessionId: selectedId, lastSeq: maxSeqMapRef.current.get(selectedId) ?? 0 });
      // Request model list for this session if we don't have it yet (e.g. after page refresh)
      if (!modelsMap.has(selectedId)) {
        send({ type: "request_models", sessionId: selectedId });
      }
    }
  }, [selectedId, send, status]);

  const selectedState = selectedId
    ? sessionStates.get(selectedId) ?? createInitialState()
    : createInitialState();

  // Safety timeout: clear stuck pendingPrompt after 30s and show error
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
  }, [selectedId, setSessionStates]));

  const selectedCommands = selectedId
    ? sessionCommands.get(selectedId) ?? []
    : [];

  const selectedFlows = selectedId
    ? (sessionUiData.get(selectedId)?.get("flow:list-flows") ?? [])
    : [];

  const selectedSession = selectedId ? sessions.get(selectedId) : undefined;
  const selectedCwd = selectedSession?.cwd;
  const editorCwds = useMemo(() => selectedCwd ? [selectedCwd] : [], [selectedCwd]);
  const editorMap = useEditors(editorCwds);
  const toolContext: ToolContext = useMemo(() => ({
    cwd: selectedCwd,
    editors: selectedCwd ? editorMap.get(selectedCwd) ?? [] : [],
  }), [selectedCwd, editorMap]);

  const contextUsageMap = useMemo(() => {
    const map = new Map<string, ContextUsageInfo>();
    // First: populate from event-reduced state (live sessions)
    for (const [id, state] of sessionStates) {
      if (state.contextUsage) {
        map.set(id, state.contextUsage);
      }
    }
    // Second: fill in from server-persisted session data (covers all sessions)
    for (const [id, session] of sessions) {
      if (!map.has(id) && session.contextWindow && session.contextTokens !== undefined) {
        map.set(id, { tokens: session.contextTokens ?? null, contextWindow: session.contextWindow });
      }
    }
    return map;
  }, [sessionStates, sessions]);

  const sessionActions = useSessionActions({
    selectedId, send, navigate, setMobileOpen,
    setSessions, setSessionStates, setSpawningCwds, setTerminals,
    clearSpawningCwd, spawnTimeoutsRef, pendingTerminalCwdRef, terminals,
  });
  const {
    handleAbort, handleForceKill, handleCancelPending, handleRespondToUi, handleFlowAction, handleSend,
    handleSelect, handleRenameSession, handleShutdownSession, handleKillProcess,
    handleSendPromptToSession, handleResumeSession, handleSpawnSession,
    handleHideSession, handleUnhideSession,
    handleCreateTerminal, handleKillTerminal, handleRenameTerminal, handleTerminalTitle,
    handleListFiles,
  } = sessionActions;

  // Flow picker state (for /flows command intercept)
  const [flowPickerOpen, setFlowPickerOpen] = useState(false);
  const [flowNewOpen, setFlowNewOpen] = useState(false);
  const [flowEditPickerOpen, setFlowEditPickerOpen] = useState(false);
  const [flowEditFlowName, setFlowEditFlowName] = useState<string | null>(null);
  const [flowDeletePickerOpen, setFlowDeletePickerOpen] = useState(false);
  const [flowDeleteFlowName, setFlowDeleteFlowName] = useState<string | null>(null);
  const [flowLaunchTarget, setFlowLaunchTarget] = useState<FlowInfo | null>(null);
  const [genericModuleOpen, setGenericModuleOpen] = useState<ExtensionUiModule | null>(null);

  // Wrap handleSend to intercept /flows commands
  const wrappedHandleSend = useCallback((text: string, images?: ImageContent[]) => {
    const trimmed = text.trim();
    console.log(`[App] Intercepting: "${trimmed}", selectedId: ${selectedId}`);

    // Dynamic Module Interception (Generalized UI)
    if (selectedId) {
      const modules = sessionUiModules.get(selectedId) || [];
      console.log(`[App] Modules for session ${selectedId}:`, modules.map(m => m.command));
      
      const match = modules.find(m => m.command === trimmed);
      
      if (match) {
        console.log(`[App] Matched dynamic module "${match.id}" for command "${trimmed}"`);
        // Request fresh data when opening
        if (match.initialViewId) {
           const initialView = match.views.find(v => v.id === match.initialViewId);
           if (initialView?.dataEvent) {
              send({ 
                type: "ui_management", 
                sessionId: selectedId, 
                action: "list", 
                event: "ui:get-data",
                params: { event: initialView.dataEvent }
              });
           }
        }
        setGenericModuleOpen(match);
        return;
      } else if (trimmed.startsWith("/") && modules.length === 0) {
        console.warn(`[App] No modules found for session ${selectedId}, but slash command used. Triggering refresh. Modules exist for IDs:`, Array.from(sessionUiModules.keys()));
        // Fallback: if we see a slash command but have 0 modules, try to refresh them once
        send({ type: "ui_management", sessionId: selectedId, action: "list", event: "ui:list-modules" });
        // DO NOT fall through to handleSend (LLM prompt) for slash commands when we're out of sync
        return;
      }
    }

    if (trimmed === "/flows") {
      setFlowPickerOpen(true);
      return;
    }
    if (trimmed === "/flows:new") {
      setFlowNewOpen(true);
      return;
    }

    handleSend(text, images);
  }, [handleSend, selectedId, sessionUiModules]);

  const openspecActions = useOpenSpecActions({ send, openspecMap, setPreviewState, clearAllContentViews });
  const {
    handleOpenSpecRefresh, handleBulkArchive, handleReadArtifact,
    handleAttachProposal, handleDetachProposal,
  } = openspecActions;

  // Flow YAML viewer helpers
  const openFlowYaml = useCallback(async (sessionId: string) => {
    const state = sessionStates.get(sessionId);
    if (!state) return;
    // Architect: use stored YAML content
    if (state.architectState?.flowYamlContent) {
      clearAllContentViews();
      setFlowYamlPreview({
        content: "```yaml\n" + state.architectState.flowYamlContent + "\n```",
        title: state.architectState.flowName || "Flow YAML",
      });
      return;
    }
    // Execution: fetch via /api/file
    const flowSource = state.flowState?.flowSource;
    const session = sessions.get(sessionId);
    if (flowSource && session?.cwd) {
      try {
        const res = await fetch(`${apiBase}/api/file?cwd=${encodeURIComponent(session.cwd)}&path=${encodeURIComponent(flowSource)}`);
        const body = await res.json();
        if (body.success && body.data?.content) {
          clearAllContentViews();
          setFlowYamlPreview({
            content: "```yaml\n" + body.data.content + "\n```",
            title: state.flowState?.flowName || "Flow YAML",
          });
        }
      } catch { /* ignore fetch errors */ }
    }
  }, [sessionStates, sessions, clearAllContentViews]);

  // Flow agent source viewer — toggle: fetch on open, clear on close
  const toggleFlowAgentSource = useCallback(async (sourcePath: string, agentName: string) => {
    // Toggle off if same agent's source is already open
    if (sourceOpenAgent === agentName) {
      setSourceOpenAgent(null);
      setFlowYamlPreview(null);
      return;
    }
    const session = selectedId ? sessions.get(selectedId) : undefined;
    if (!session?.cwd) return;
    try {
      const res = await fetch(`${apiBase}/api/file?cwd=${encodeURIComponent(session.cwd)}&path=${encodeURIComponent(sourcePath)}`);
      const body = await res.json();
      if (body.success && body.data?.content) {
        clearAllContentViews();
        setSourceOpenAgent(agentName);
        setFlowYamlPreview({ content: body.data.content, title: agentName });
      }
    } catch { /* ignore fetch errors */ }
  }, [selectedId, sessions, sourceOpenAgent, clearAllContentViews]);

  // Compute set of session IDs that have active errors
  const errorSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, state] of sessionStates) {
      if (state.lastError) ids.add(id);
    }
    return ids;
  }, [sessionStates]);

  const sessionList = (
    <SessionList
      sessions={Array.from(sessions.values())}
      terminals={Array.from(terminals.values())}
      selectedId={selectedId ?? selectedTerminalId}
      onSelect={handleSelect}
      contextUsageMap={contextUsageMap}
      openspecMap={openspecMap}
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
      onFlowAction={handleFlowAction}
      onOpenSpecRefresh={handleOpenSpecRefresh}
      onBulkArchive={handleBulkArchive}
      onReadArtifact={handleReadArtifact}
      onOpenPiResources={handleOpenPiResources}
      onOpenSpecs={(cwd) => { clearAllContentViews(); setSpecsBrowserCwd(cwd); }}
      onOpenArchive={(cwd) => { clearAllContentViews(); setArchiveBrowserCwd(cwd); }}
      onViewReadme={handleViewReadme}
      onAttachProposal={handleAttachProposal}
      onDetachProposal={handleDetachProposal}
      onRename={handleRenameSession}
      onShutdown={handleShutdownSession}
      onResume={handleResumeSession}
      onHideSession={handleHideSession}
      onUnhideSession={handleUnhideSession}
      onSpawnSession={handleSpawnSession}
      spawningCwds={spawningCwds}
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
      onKillTerminal={handleKillTerminal}
      onRenameTerminal={handleRenameTerminal}
      onCollapseSidebar={sidebar.toggleCollapse}
      commandsMap={sessionCommands}
      flowsMap={(() => {
         const m = new Map<string, FlowInfo[]>();
         for (const [sid, dataMap] of sessionUiData.entries()) {
            m.set(sid, dataMap.get("flow:list-flows") || []);
         }
         return m;
      })()}
      onKillProcess={handleKillProcess}

      onOpenTerminals={(cwd) => navigate(`/folder/${encodeFolderPath(cwd)}/terminals`)}
      onOpenEditor={(cwd) => navigate(`/folder/${encodeFolderPath(cwd)}/editor`)}
      editorStatuses={editorStatuses}
      editorAvailable={editorAvailable}
      errorSessionIds={errorSessionIds}
      spawnErrors={spawnErrors}
      onDismissSpawnError={(cwd) => setSpawnErrors((prev) => { const next = new Map(prev); next.delete(cwd); return next; })}
      resumeErrors={resumeErrors}
      onDismissResumeError={(id) => setResumeErrors((prev) => { const next = new Map(prev); next.delete(id); return next; })}
      headerExtra={
        <div className="flex items-center gap-2">
          <PiUpdateBadge />
          <ServerSelector
            currentHost={currentServerHost}
            currentPort={currentServerPort}
            connected={status === "connected"}
            onSwitch={handleServerSwitch}
            onManageServers={() => navigate("/settings?tab=servers")}
          />
        </div>
      }
    />
  );

  const connectionBanner = (
    <>
      {status === "connecting" && (
        <div className="bg-yellow-600/20 text-yellow-400 text-xs px-3 py-1 text-center">
          Connecting...
        </div>
      )}
      {status === "offline" && (
        <div className="bg-red-600/20 text-red-400 text-xs px-3 py-1 text-center">
          Server offline
        </div>
      )}
      {status === "auth_required" && (
        <div className="bg-amber-600/20 text-amber-400 text-xs px-3 py-1 text-center">
          Session expired —{" "}
          <a href={`${apiBase}/auth/login?return=${encodeURIComponent(window.location.pathname)}`} className="underline hover:text-amber-300">
            Sign in
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
        onBack={isMobile ? () => navigate("/") : () => window.history.back()}
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
          },
        } : undefined}
        commands={selectedCommands}
        flows={selectedFlows}
        onSendPrompt={wrappedHandleSend}
        openspecChanges={selectedCwd ? openspecMap.get(selectedCwd)?.changes : undefined}
        onAttachProposal={(changeName) => handleAttachProposal(selectedId, changeName)}
        onDetachProposal={() => handleDetachProposal(selectedId)}
        hasFileChanges={selectedState.hasFileChanges}
        onOpenDiffView={() => { clearAllContentViews(); setDiffViewSessionId(selectedId); }}
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
        }}
        uiModules={selectedId ? sessionUiModules.get(selectedId) : undefined}
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
              <span className="text-green-400">Thinking…</span>
            )}
            <span className="flex-1" />
            {selectedState.cost > 0 && <span>${selectedState.cost.toFixed(2)}</span>}
          </div>
          {selectedState.contextUsage && selectedState.contextUsage.contextWindow > 0 && (
            <div className="mt-1">
              <div className="flex items-center gap-2 text-[10px]">
                <span>{selectedState.contextUsage.tokens != null ? `${Math.round((selectedState.contextUsage.tokens / 1000))}k` : "—"}</span>
                <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                  {selectedState.contextUsage.tokens != null && (
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min((selectedState.contextUsage.tokens / selectedState.contextUsage.contextWindow) * 100, 100)}%` }}
                    />
                  )}
                </div>
                <span>{Math.round(selectedState.contextUsage.contextWindow / 1000)}k</span>
              </div>
            </div>
          )}
        </div>
      )}
      {!isMobile && (
        <TokenStatsBar
          turnStats={selectedState.turnStats}
          contextUsage={selectedState.contextUsage}
          tokensIn={selectedState.tokensIn}
          tokensOut={selectedState.tokensOut}
          cacheRead={selectedState.cacheRead}
          cacheWrite={selectedState.cacheWrite}
          cost={selectedState.cost}
          onTurnClick={(turnIndex) => chatViewRef.current?.scrollToTurn(turnIndex)}
        />
      )}
      {archiveBrowserCwd ? (
        <ArchiveBrowserView
          cwd={archiveBrowserCwd}
          onBack={() => setArchiveBrowserCwd(null)}
        />
      ) : specsBrowserCwd ? (
        <SpecsBrowserView
          cwd={specsBrowserCwd}
          onBack={() => setSpecsBrowserCwd(null)}
        />
      ) : piResourceFilePreview ? (
        <MarkdownPreviewView
          title={piResourceFilePreview.title}
          content={piResourceFilePreview.content}
          isLoading={piResourceFilePreview.isLoading}
          error={piResourceFilePreview.error}
          onBack={() => setPiResourceFilePreview(null)}
        />
      ) : readmePreview ? (
        <MarkdownPreviewView
          title={`README.md — ${readmePreview.cwd.split("/").pop()}`}
          content={readmePreview.content}
          isLoading={readmePreview.isLoading}
          error={readmePreview.error}
          onBack={() => setReadmePreview(null)}
        />
      ) : piResourcesState ? (
        <PiResourcesView
          cwd={piResourcesState.cwd}
          onBack={() => setPiResourcesState(null)}
          onViewFile={handleViewPiResourceFile}
        />
      ) : previewState ? (
        <OpenSpecPreview
          cwd={previewState.cwd}
          changeName={previewState.changeName}
          initialArtifact={previewState.artifactId}
          artifacts={previewState.artifacts}
          onBack={() => setPreviewState(null)}
        />
      ) : flowYamlPreview ? (
        <MarkdownPreviewView
          title={flowYamlPreview.title}
          content={flowYamlPreview.content}
          onBack={() => { setFlowYamlPreview(null); setSourceOpenAgent(null); }}
        />
      ) : diffViewSessionId ? (
        <FileDiffView
          sessionId={diffViewSessionId}
          onBack={() => setDiffViewSessionId(null)}
        />
      ) : architectDetailOpen && selectedState.architectState ? (
        <>
          {selectedState.architectState && (
            <div className="sticky top-0 z-10">
              <FlowArchitect
                state={selectedState.architectState}
                onAbort={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "abort" })}
                onClick={() => setArchitectDetailOpen(prev => !prev)}
                isDetailOpen={architectDetailOpen}
                onPromptRespond={(promptId, answer) => selectedId && send({ type: "architect_prompt_response" as any, sessionId: selectedId, promptId, answer })}
                onViewYaml={() => selectedId && openFlowYaml(selectedId)}
                onViewAgentSource={(name, source) => { clearAllContentViews(); setFlowYamlPreview({ content: "```yaml\n" + source + "\n```", title: name }); }}
              />
            </div>
          )}
          <FlowArchitectDetail
            state={selectedState.architectState}
            onBack={() => setArchitectDetailOpen(false)}
          />
        </>
      ) : flowDetailAgent && selectedState.flowState?.agents.has(flowDetailAgent) ? (
        <>
          {selectedState.architectState && (
            <div className="sticky top-0 z-10">
              <FlowArchitect
                state={selectedState.architectState}
                onAbort={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "abort" })}
                onClick={() => setArchitectDetailOpen(prev => !prev)}
                isDetailOpen={architectDetailOpen}
                onPromptRespond={(promptId, answer) => selectedId && send({ type: "architect_prompt_response" as any, sessionId: selectedId, promptId, answer })}
                onViewYaml={() => selectedId && openFlowYaml(selectedId)}
                onViewAgentSource={(name, source) => { clearAllContentViews(); setFlowYamlPreview({ content: "```yaml\n" + source + "\n```", title: name }); }}
              />
            </div>
          )}
          {selectedState.flowState && (
            <div className={`sticky ${selectedState.architectState ? 'top-auto' : 'top-0'} z-10`}>
              <FlowDashboard
                flowState={selectedState.flowState}
                flowStates={selectedState.flowStates}
                onAgentClick={setFlowDetailAgent}
                selectedAgent={flowDetailAgent}
                onAbort={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "abort" })}
                onToggleAutonomous={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "toggle_autonomous" })}
                onDismiss={() => {
                  setFlowDetailAgent(null);
                  selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "dismiss_summary" });
                }}
                onSendPrompt={(text) => handleSend(text)}
                onViewYaml={() => selectedId && openFlowYaml(selectedId)}
                onViewAgentSource={toggleFlowAgentSource}
                sourceOpenAgent={sourceOpenAgent}
              />
            </div>
          )}
          <FlowAgentDetail
            agent={selectedState.flowState!.agents.get(flowDetailAgent)!}
            onBack={() => setFlowDetailAgent(null)}
          />
        </>
      ) : (
        <>
          {selectedState.architectState && (
            <div className="sticky top-0 z-10">
              <FlowArchitect
                state={selectedState.architectState}
                onAbort={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "abort" })}
                onClick={() => setArchitectDetailOpen(prev => !prev)}
                isDetailOpen={architectDetailOpen}
                onPromptRespond={(promptId, answer) => selectedId && send({ type: "architect_prompt_response" as any, sessionId: selectedId, promptId, answer })}
                onViewYaml={() => selectedId && openFlowYaml(selectedId)}
                onViewAgentSource={(name, source) => { clearAllContentViews(); setFlowYamlPreview({ content: "```yaml\n" + source + "\n```", title: name }); }}
              />
            </div>
          )}
          {selectedState.flowState && (
            <div className={`sticky ${selectedState.architectState ? 'top-auto' : 'top-0'} z-10`}>
              <FlowDashboard
                flowState={selectedState.flowState}
                flowStates={selectedState.flowStates}
                onAgentClick={setFlowDetailAgent}
                selectedAgent={flowDetailAgent}
                onAbort={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "abort" })}
                onToggleAutonomous={() => selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "toggle_autonomous" })}
                onDismiss={() => {
                  selectedId && send({ type: "flow_control" as any, sessionId: selectedId, action: "dismiss_summary" });
                }}
                onSendPrompt={(text) => handleSend(text)}
                onViewYaml={() => selectedId && openFlowYaml(selectedId)}
                onViewAgentSource={toggleFlowAgentSource}
                sourceOpenAgent={sourceOpenAgent}
              />
            </div>
          )}
          <ErrorBoundary fallback={
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-2">
                <div className="text-red-400 text-sm">Chat view encountered an error</div>
                <button onClick={() => window.location.reload()} className="text-xs text-blue-400 hover:underline">Reload page</button>
              </div>
            </div>
          }>
            <ChatView ref={chatViewRef} sessionId={selectedId} state={selectedState} toolContext={toolContext} onCancelPending={handleCancelPending} onRespondToUi={handleRespondToUi} onAbort={handleAbort} onForceKill={handleForceKill} onForkFromMessage={selectedId ? (entryId) => handleResumeSession(selectedId, "fork", entryId) : undefined} onRetryAfterError={selectedId ? () => handleResumeSession(selectedId, "continue") : undefined} onDismissError={selectedId ? () => {
              setSessionStates((prev) => {
                const next = new Map(prev);
                const current = next.get(selectedId!);
                if (current?.lastError) {
                  next.set(selectedId!, { ...current, lastError: undefined });
                }
                return next;
              });
            } : undefined} />
          </ErrorBoundary>
          <StatusBar
            model={selectedState.model ?? selectedSession?.model}
            models={modelsMap.get(selectedId)}
            roles={rolesMap.get(selectedId)}
            thinkingLevel={selectedState.thinkingLevel ?? selectedSession?.thinkingLevel}
            status={selectedState.status}
            currentTool={selectedState.currentTool}
            streamingText={selectedState.streamingText || undefined}
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
          <CommandInput
            commands={selectedCommands}
            onSend={wrappedHandleSend}
            onListFiles={handleListFiles}
            fileResults={fileResults}
            disabled={false}
            sessionStatus={selectedState.status}
            onAbort={handleAbort}
            onForceKill={handleForceKill}
            pendingPrompt={!!selectedState.pendingPrompt}
            onCancelPending={handleCancelPending}
          />
          {flowPickerOpen && (() => {
            const hasFlowsNew = selectedCommands.some(c => c.name === "flows:new");
            const hasFlowsEdit = selectedCommands.some(c => c.name === "flows:edit");
            const hasFlowsDelete = selectedCommands.some(c => c.name === "flows:delete");
            const flowOptions: SelectOption[] = [
              ...(hasFlowsNew ? [{ value: "__new__", label: "+ New Flow", description: "Design a new flow with the Flow Architect" }] : []),
              ...(hasFlowsEdit && selectedFlows.length > 0 ? [{ value: "__edit__", label: "\u270E\uFE0E Edit Flow...", description: "Edit an existing flow" }] : []),
              ...(hasFlowsDelete && selectedFlows.length > 0 ? [{ value: "__delete__", label: "\u00D7 Delete Flow...", description: "Delete a saved flow" }] : []),
              ...selectedFlows.map((f) => ({
                value: f.name,
                label: f.name,
                description: f.description,
              })),
            ];
            return (
              <SearchableSelectDialog
                title="Flows"
                options={flowOptions}
                placeholder="Search flows..."
                emptyMessage="No flows available"
                onSelect={(value) => {
                  setFlowPickerOpen(false);
                  if (value === "__new__") {
                    setFlowNewOpen(true);
                  } else if (value === "__edit__") {
                    setFlowEditPickerOpen(true);
                  } else if (value === "__delete__") {
                    setFlowDeletePickerOpen(true);
                  } else {
                    const flow = selectedFlows.find(f => f.name === value);
                    if (flow) {
                      if (flow.taskRequired) {
                        setFlowLaunchTarget(flow);
                      } else {
                        if (selectedId) handleFlowAction(selectedId, "run", { flowName: flow.name });
                      }
                    }
                  }
                }}
                onCancel={() => setFlowPickerOpen(false)}
              />
            );
          })()}
          {flowNewOpen && (
            <FlowLaunchDialog
              flowName="flows:new"
              description="Design a new flow with the Flow Architect"
              onSubmit={(task) => {
                if (selectedId && task.trim()) handleFlowAction(selectedId, "new", { description: task.trim() });
                setFlowNewOpen(false);
              }}
              onCancel={() => setFlowNewOpen(false)}
            />
          )}
          {flowEditPickerOpen && (
            <SearchableSelectDialog
              title="Edit Flow"
              options={selectedFlows.map((f) => ({ value: f.name, label: f.name, description: f.description }))}
              placeholder="Search flows..."
              emptyMessage="No flows available"
              onSelect={(value) => {
                setFlowEditFlowName(value);
                setFlowEditPickerOpen(false);
              }}
              onCancel={() => setFlowEditPickerOpen(false)}
            />
          )}
          {flowEditFlowName && (
            <FlowLaunchDialog
              flowName={flowEditFlowName}
              description="Describe how this flow should be updated"
              onSubmit={(desc) => {
                if (selectedId && desc.trim()) handleFlowAction(selectedId, "edit", { flowName: flowEditFlowName, description: desc.trim() });
                setFlowEditFlowName(null);
              }}
              onCancel={() => setFlowEditFlowName(null)}
            />
          )}
          {genericModuleOpen && (
             <GenericExtensionDialog
               module={genericModuleOpen}
               data={(() => {
                 const sessionDataMap = sessionUiData.get(selectedId || "");
                 if (!sessionDataMap) return {};
                 return Object.fromEntries(sessionDataMap.entries());
               })()}
               onAction={(action, params) => {
                 if (selectedId) {
                    send({ 
                      type: "ui_management", 
                      sessionId: selectedId, 
                      action: action.label, 
                      event: action.emit, 
                      params 
                    });
                 }
               }}
               onRefresh={(view) => {
                 if (selectedId && view.dataEvent) {
                    send({ 
                      type: "ui_management", 
                      sessionId: selectedId, 
                      action: "list", 
                      event: "ui:get-data",
                      params: { event: view.dataEvent }
                    });
                 }
               }}
               onCancel={() => setGenericModuleOpen(null)}
             />
          )}
          {flowDeletePickerOpen && (
            <SearchableSelectDialog
              title="Delete Flow"
              options={selectedFlows.map((f) => ({ value: f.name, label: f.name, description: f.description }))}
              placeholder="Search flows..."
              emptyMessage="No flows available"
              onSelect={(value) => {
                setFlowDeleteFlowName(value);
                setFlowDeletePickerOpen(false);
              }}
              onCancel={() => setFlowDeletePickerOpen(false)}
            />
          )}
          {flowDeleteFlowName && (
            <ConfirmDialog
              message={`Delete flow "${flowDeleteFlowName}"? This will remove the flow file and any associated agents.`}
              confirmLabel="Delete"
              onConfirm={() => {
                if (selectedId) handleFlowAction(selectedId, "delete", { flowName: flowDeleteFlowName });
                setFlowDeleteFlowName(null);
              }}
              onCancel={() => setFlowDeleteFlowName(null)}
            />
          )}
          {flowLaunchTarget && (
            <FlowLaunchDialog
              flowName={flowLaunchTarget.name}
              description={flowLaunchTarget.description}
              onSubmit={(task) => {
                if (selectedId) handleFlowAction(selectedId, "run", { flowName: flowLaunchTarget.name, task: task || undefined });
                setFlowLaunchTarget(null);
              }}
              onCancel={() => setFlowLaunchTarget(null)}
            />
          )}
        </>
      )}
    </div>
  ) : null;

  // Terminal keep-alive views — always mounted, CSS toggled (for legacy /terminal/:id route)
  const terminalViews = useMemo(() => {
    return Array.from(terminals.values()).map((t) => (
      <TerminalView
        key={t.id}
        terminalId={t.id}
        visible={selectedTerminalId === t.id}
        terminalName={t.title || t.shell.split("/").pop()}
        onTitle={handleTerminalTitle}
        onClose={handleKillTerminal}
      />
    ));
  }, [terminals, selectedTerminalId, handleTerminalTitle, handleKillTerminal]);

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

  // Navigate away from terminal when it's removed
  useEffect(() => {
    if (selectedTerminalId && !terminals.has(selectedTerminalId)) {
      navigate("/");
    }
  }, [selectedTerminalId, terminals, navigate]);

  // Navigate away from invalid terminal URL (same as session logic)
  const terminalsLoaded = terminals.size > 0 || sessions.size > 0;
  useEffect(() => {
    if (selectedTerminalId && terminalsLoaded && !terminals.has(selectedTerminalId)) {
      navigate("/");
    }
  }, [selectedTerminalId, terminalsLoaded, terminals, navigate]);

  const apiProvider = (children: React.ReactNode) => (
    <ApiContext.Provider value={apiBase}>{children}</ApiContext.Provider>
  );

  // Mobile: two-step full-screen navigation
  if (isMobile) {
    const mobileDepth = getMobileDepth({
      selectedId,
      selectedTerminalId,
      folderTermCwd,
      folderEditorCwd,
      settingsMatch: !!settingsMatch,
      tunnelSetupMatch: !!tunnelSetupMatch,
      hasPreview: !!previewState || !!piResourcesState || !!piResourceFilePreview || !!readmePreview || !!specsBrowserCwd || !!archiveBrowserCwd || !!diffViewSessionId || !!flowYamlPreview,
    });
    return apiProvider(
      <div className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <MobileShell
          depth={mobileDepth}
          onBack={() => {
            if (archiveBrowserCwd) {
              setArchiveBrowserCwd(null);
            } else if (specsBrowserCwd) {
              setSpecsBrowserCwd(null);
            } else if (flowYamlPreview) {
              setFlowYamlPreview(null);
            } else if (diffViewSessionId) {
              setDiffViewSessionId(null);
            } else if (piResourceFilePreview) {
              setPiResourceFilePreview(null);
            } else if (readmePreview) {
              setReadmePreview(null);
            } else if (piResourcesState) {
              setPiResourcesState(null);
            } else if (previewState) {
              setPreviewState(null);
            } else {
              navigate("/");
            }
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
              <SettingsPanel />
            ) : tunnelSetupMatch ? (
              <ZrokInstallGuide onBack={() => navigate("/")} />
            ) : archiveBrowserCwd ? (
              <ArchiveBrowserView
                cwd={archiveBrowserCwd}
                onBack={() => setArchiveBrowserCwd(null)}
              />
            ) : specsBrowserCwd ? (
              <SpecsBrowserView
                cwd={specsBrowserCwd}
                onBack={() => setSpecsBrowserCwd(null)}
              />
            ) : flowYamlPreview ? (
              <MarkdownPreviewView
                title={flowYamlPreview.title}
                content={flowYamlPreview.content}
                onBack={() => { setFlowYamlPreview(null); setSourceOpenAgent(null); }}
              />
            ) : diffViewSessionId ? (
              <FileDiffView
                sessionId={diffViewSessionId}
                onBack={() => setDiffViewSessionId(null)}
              />
            ) : piResourceFilePreview ? (
              <MarkdownPreviewView
                title={piResourceFilePreview.title}
                content={piResourceFilePreview.content}
                isLoading={piResourceFilePreview.isLoading}
                error={piResourceFilePreview.error}
                onBack={() => setPiResourceFilePreview(null)}
              />
            ) : readmePreview ? (
              <MarkdownPreviewView
                title={`README.md — ${readmePreview.cwd.split("/").pop()}`}
                content={readmePreview.content}
                isLoading={readmePreview.isLoading}
                error={readmePreview.error}
                onBack={() => setReadmePreview(null)}
              />
            ) : piResourcesState ? (
              <PiResourcesView
                cwd={piResourcesState.cwd}
                onBack={() => setPiResourcesState(null)}
                onViewFile={handleViewPiResourceFile}
              />
            ) : previewState ? (
              <OpenSpecPreview
                cwd={previewState.cwd}
                changeName={previewState.changeName}
                initialArtifact={previewState.artifactId}
                artifacts={previewState.artifacts}
                onBack={() => setPreviewState(null)}
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
            ) : selectedTerminalId ? (
              <div className="flex-1 flex flex-col min-w-0 h-full">
                {terminalViews}
              </div>
            ) : sessionDetail ?? (
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
        {/* Terminal views are always mounted (keep-alive), CSS hidden/shown */}
        {terminalViews}
        {/* Folder views (TerminalsView or EditorView) */}
        {folderViewContent && (
          <div className="flex-1 flex flex-col min-w-0 min-h-0">{folderViewContent}</div>
        )}
        {/* Show session detail or landing page when no terminal/folder view is selected */}
        {!selectedTerminalId && !folderTermCwd && !folderEditorCwd && !settingsMatch && !tunnelSetupMatch && (
          archiveBrowserCwd ? (
            <ArchiveBrowserView
              cwd={archiveBrowserCwd}
              onBack={() => setArchiveBrowserCwd(null)}
            />
          ) : specsBrowserCwd ? (
            <SpecsBrowserView
              cwd={specsBrowserCwd}
              onBack={() => setSpecsBrowserCwd(null)}
            />
          ) : piResourceFilePreview ? (
            <MarkdownPreviewView
              title={piResourceFilePreview.title}
              content={piResourceFilePreview.content}
              isLoading={piResourceFilePreview.isLoading}
              error={piResourceFilePreview.error}
              onBack={() => setPiResourceFilePreview(null)}
            />
          ) : readmePreview ? (
            <MarkdownPreviewView
              title={`README.md — ${readmePreview.cwd.split("/").pop()}`}
              content={readmePreview.content}
              isLoading={readmePreview.isLoading}
              error={readmePreview.error}
              onBack={() => setReadmePreview(null)}
            />
          ) : piResourcesState && !selectedId ? (
            <PiResourcesView
              cwd={piResourcesState.cwd}
              onBack={() => setPiResourcesState(null)}
              onViewFile={handleViewPiResourceFile}
            />
          ) : previewState && !selectedId ? (
            <OpenSpecPreview
              cwd={previewState.cwd}
              changeName={previewState.changeName}
              initialArtifact={previewState.artifactId}
              artifacts={previewState.artifacts}
              onBack={() => setPreviewState(null)}
            />
          ) : (
            sessionDetail ?? (
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
        })()} />}
        {tunnelSetupMatch && <ZrokInstallGuide onBack={() => navigate("/")} />}
      </div>
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
      <Toast messages={messages} onDismiss={dismissToast} />
    </div>
  );
}
