import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@mdi/react";
import { mdiPencilOutline, mdiArrowLeft, mdiPaperclip, mdiRefresh, mdiLinkOff, mdiPlay, mdiFileCompare, mdiHeadLightbulb, mdiApps } from "@mdi/js";
import type { DashboardSession, OpenSpecChange, CommandInfo, FlowInfo, ImageContent, ExtensionUiModule } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { SessionState } from "../lib/event-reducer.js";
import type { DetectedEditor } from "../lib/editor-api.js";
import { getSessionDisplayName } from "../lib/session-display-name.js";
import { InlineRenameInput } from "./InlineRenameInput.js";
import { MobileActionMenu } from "./MobileActionMenu.js";
import { useMobile } from "../hooks/useMobile.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { SearchableSelectDialog, type SelectOption } from "./SearchableSelectDialog.js";

interface Props {
  session?: DashboardSession;
  state: SessionState;
  onRename?: (sessionId: string, name: string) => void;
  showBack?: boolean;
  onBack?: () => void;
  commands?: CommandInfo[];
  flows?: FlowInfo[];
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  openspecChanges?: OpenSpecChange[];
  onAttachProposal?: (changeName: string) => void;
  onDetachProposal?: () => void;
  hasFileChanges?: boolean;
  onOpenDiffView?: () => void;
  onRefresh?: () => void;
  uiModules?: ExtensionUiModule[];
  /** Mobile action menu props (only used on mobile) */
  mobileActions?: {
    editors?: DetectedEditor[];
    openspecChanges?: OpenSpecChange[];
    onHide?: () => void;
    onUnhide?: () => void;
    onResume?: (mode: "continue" | "fork") => void;
    onShutdown?: () => void;
    onOpenEditor?: (editorId: string) => void;
    onAttachProposal?: (changeName: string) => void;
    onDetachProposal?: () => void;
    onSendPrompt?: (text: string, images?: ImageContent[]) => void;
    onReadArtifact?: (changeName: string, artifactId: string) => void;
    onRefresh?: () => void;
  };
}

/** Separate attach/detach icon button for mobile session header */
function MobileAttachButton({ session, openspecChanges, onAttach, onDetach }: {
  session: DashboardSession;
  openspecChanges?: OpenSpecChange[];
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click/touch
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const attached = session.attachedProposal;
  const changes = openspecChanges ?? [];
  const hasChanges = changes.length > 0;

  // Nothing to show
  if (!attached && !hasChanges) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center ${
          attached ? "text-blue-400" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
        aria-label={attached ? `Attached: ${attached}` : "Attach change"}
        data-testid="mobile-attach-btn"
      >
        <Icon path={mdiPaperclip} size={0.7} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-lg z-50 overflow-hidden" data-testid="mobile-attach-menu">
          {attached ? (
            <>
              <div className="px-4 py-2 text-xs text-blue-400 border-b border-[var(--border-primary)]">
                <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}
              </div>
              {onDetach && (
                <button
                  onClick={() => { setOpen(false); onDetach(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left min-h-[44px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  Detach
                </button>
              )}
            </>
          ) : (
            changes.map((change) => (
              <button
                key={change.name}
                onClick={() => { setOpen(false); onAttach?.(change.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left min-h-[44px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {change.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Mobile header: back + name + attach icon + kebab */
function MobileHeader({ session, showBack, onBack, isRenaming, onConfirmRename, onCancelRename, canRename, onStartRename, mobileActions }: {
  session: DashboardSession;
  showBack?: boolean;
  onBack?: () => void;
  isRenaming: boolean;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
  canRename: boolean;
  onStartRename: () => void;
  mobileActions?: SessionHeaderMobileActions;
}) {
  return (
    <div className="px-2 py-1 border-b border-[var(--border-primary)] flex items-center gap-1 text-sm min-h-[44px]">
      {showBack && onBack && (
        <button
          onClick={onBack}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title="Go back"
          data-testid="back-button"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
      )}
      {isRenaming ? (
        <InlineRenameInput
          currentName={getSessionDisplayName(session)}
          onConfirm={onConfirmRename}
          onCancel={onCancelRename}
          className="font-medium flex-1"
        />
      ) : (
        <span className="font-medium truncate flex-1">{getSessionDisplayName(session)}</span>
      )}
      {mobileActions && (
        <MobileAttachButton
          session={session}
          openspecChanges={mobileActions.openspecChanges}
          onAttach={mobileActions.onAttachProposal}
          onDetach={mobileActions.onDetachProposal}
        />
      )}
      {mobileActions && (
        <MobileActionMenu
          session={session}
          editors={mobileActions.editors}
          openspecChanges={mobileActions.openspecChanges}
          onRename={canRename ? onStartRename : undefined}
          onHide={mobileActions.onHide}
          onUnhide={mobileActions.onUnhide}
          onResume={mobileActions.onResume}
          onShutdown={mobileActions.onShutdown}
          onOpenEditor={mobileActions.onOpenEditor}
          onAttachProposal={mobileActions.onAttachProposal}
          onDetachProposal={mobileActions.onDetachProposal}
          onSendPrompt={mobileActions.onSendPrompt}
          onReadArtifact={mobileActions.onReadArtifact}
          onRefresh={mobileActions.onRefresh}
        />
      )}
    </div>
  );
}

/** Type for mobile action props to keep interface clean */
type SessionHeaderMobileActions = NonNullable<Props["mobileActions"]>;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function SessionHeader({ session, state, onRename, showBack, onBack, mobileActions, commands, flows, onSendPrompt, openspecChanges, onAttachProposal, onDetachProposal, hasFileChanges, onOpenDiffView, onRefresh, uiModules }: Props) {
  const [now, setNow] = useState(Date.now());
  const [isRenaming, setIsRenaming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [flowPickerOpen, setFlowPickerOpen] = useState(false);
  const [flowLaunchTarget, setFlowLaunchTarget] = useState<FlowInfo | null>(null);
  const [openspecPickerOpen, setOpenspecPickerOpen] = useState(false);
  const [extensionsPickerOpen, setExtensionsPickerOpen] = useState(false);
  const flowCmds = flows ?? [];
  const flowOptions: SelectOption[] = flowCmds.map(f => ({ value: f.name, label: f.name, description: f.description }));

  const extensionOptions: SelectOption[] = (uiModules || []).map(m => ({
    value: m.command,
    label: m.title,
    icon: m.icon
  }));

  const attached = session?.attachedProposal;
  const openspecOptions: SelectOption[] = (openspecChanges || []).map(c => {
    const stateLabels: Record<string, string> = {
      "no-tasks": "Planning",
      "in-progress": `Implementing — ${c.completedTasks}/${c.totalTasks} tasks`,
      "complete": `Complete — ${c.completedTasks}/${c.totalTasks} tasks`,
    };
    return {
      value: c.name,
      label: c.name,
      description: stateLabels[c.status] || c.status,
      badge: c.status === "complete" ? "✓" : c.status === "in-progress" ? `${c.completedTasks}/${c.totalTasks}` : undefined,
      badgeColor: c.status === "complete" ? "text-green-400" : "text-blue-400",
    };
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!session) {
    return (
      <div className="px-4 py-2 border-b border-[var(--border-primary)] text-sm text-[var(--text-tertiary)]">
        No session selected
      </div>
    );
  }

  const duration = now - session.startedAt;
  const canRename = session.status !== "ended" && onRename;

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    if (onRename && session) {
      onRename(session.id, name);
    }
  }

  const isMobile = useMobile();

  // Mobile: compact header with back + name + attach icon + kebab
  if (isMobile) {
    return (
      <MobileHeader
        session={session}
        showBack={showBack}
        onBack={onBack}
        isRenaming={isRenaming}
        onConfirmRename={handleConfirmRename}
        onCancelRename={() => setIsRenaming(false)}
        canRename={!!canRename}
        onStartRename={() => setIsRenaming(true)}
        mobileActions={mobileActions}
      />
    );
  }

  // Desktop: full header
  return (
    <div className="px-4 py-2 border-b border-[var(--border-primary)] flex items-center gap-4 text-sm">
      {showBack && onBack && (
        <button
          onClick={onBack}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
          title="Go back"
          data-testid="back-button"
        >
          <Icon path={mdiArrowLeft} size={0.65} />
        </button>
      )}
      {isRenaming ? (
        <InlineRenameInput
          currentName={getSessionDisplayName(session)}
          onConfirm={handleConfirmRename}
          onCancel={() => setIsRenaming(false)}
          className="font-medium"
        />
      ) : (
        <span className="font-medium flex items-center gap-1">
          <span
            onDoubleClick={() => canRename && setIsRenaming(true)}
            className={canRename ? "cursor-pointer" : ""}
          >
            {getSessionDisplayName(session)}
          </span>
          {canRename && (
            <button
              onClick={() => setIsRenaming(true)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
              title="Rename session"
            >
              <Icon path={mdiPencilOutline} size={0.5} />
            </button>
          )}
        </span>
      )}
      {(state.model || session.model) && <span className="text-[var(--text-secondary)]">{state.model || session.model}</span>}
      {(state.thinkingLevel || session.thinkingLevel) && (
        <span className="text-[var(--text-tertiary)] inline-flex items-center gap-0.5"><Icon path={mdiHeadLightbulb} size={0.45} /> {state.thinkingLevel || session.thinkingLevel}</span>
      )}
      {/* OpenSpec + Flow buttons */}
      <span className="flex-1" />
      {onAttachProposal && openspecChanges && openspecChanges.length > 0 && (
        attached ? (
          <span className="text-[10px] flex items-center gap-1 mr-2">
            <span className="text-blue-400"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}</span>
            {onDetachProposal && (
              <button
                onClick={onDetachProposal}
                className="text-[var(--text-muted)] hover:text-red-400 px-0.5"
                title="Detach change"
              >
                <Icon path={mdiLinkOff} size={0.45} />
              </button>
            )}
          </span>
        ) : (
          <button
            onClick={() => setOpenspecPickerOpen(true)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 mr-1"
            title="Attach OpenSpec change"
          >
            <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />Attach
          </button>
        )
      )}
      {flowCmds.length > 0 && onSendPrompt && (
        <button
          onClick={() => setFlowPickerOpen(true)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 mr-1"
          title="Run a flow"
        >
          <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />Flow
        </button>
      )}
      {uiModules && uiModules.length > 0 && onSendPrompt && (
        <button
          onClick={() => setExtensionsPickerOpen(true)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 mr-1"
          title="Extensions"
        >
          <Icon path={mdiApps} size={0.4} className="inline mr-0.5" />Extensions
        </button>
      )}
      {hasFileChanges && onOpenDiffView && (
        <button
          onClick={onOpenDiffView}
          className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 mr-1"
          title="View changed files"
        >
          <Icon path={mdiFileCompare} size={0.4} className="inline mr-0.5" />Changed Files
        </button>
      )}
      <span className="text-[var(--text-muted)]">{formatDuration(duration)}</span>
      {onRefresh && (
        <button
          onClick={() => { onRefresh(); setRefreshing(true); setTimeout(() => setRefreshing(false), 500); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
          title="Refresh chat"
        >
          <Icon path={mdiRefresh} size={0.6} className={refreshing ? "animate-spin" : ""} />
        </button>
      )}
      {openspecPickerOpen && onAttachProposal && (
        <SearchableSelectDialog
          title="Attach OpenSpec Change"
          options={openspecOptions}
          placeholder="Search changes..."
          emptyMessage="No changes available"
          onSelect={(value) => {
            onAttachProposal(value);
            setOpenspecPickerOpen(false);
          }}
          onCancel={() => setOpenspecPickerOpen(false)}
        />
      )}
      {flowPickerOpen && onSendPrompt && (
        <SearchableSelectDialog
          title="Run Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            const flow = flowCmds.find(f => f.name === value);
            if (flow) setFlowLaunchTarget(flow);
            setFlowPickerOpen(false);
          }}
          onCancel={() => setFlowPickerOpen(false)}
        />
      )}
      {extensionsPickerOpen && onSendPrompt && (
        <SearchableSelectDialog
          title="Extensions"
          options={extensionOptions}
          placeholder="Search extensions..."
          emptyMessage="No extensions available"
          onSelect={(value) => {
            onSendPrompt(value);
            setExtensionsPickerOpen(false);
          }}
          onCancel={() => setExtensionsPickerOpen(false)}
        />
      )}
      {flowLaunchTarget && onSendPrompt && (
        <FlowLaunchDialog
          flowName={flowLaunchTarget.name}
          description={flowLaunchTarget.description}
          onSubmit={(task) => {
            const prompt = task ? `/${flowLaunchTarget.name} ${task}` : `/${flowLaunchTarget.name}`;
            onSendPrompt(prompt);
            setFlowLaunchTarget(null);
          }}
          onCancel={() => setFlowLaunchTarget(null)}
        />
      )}
    </div>
  );
}
