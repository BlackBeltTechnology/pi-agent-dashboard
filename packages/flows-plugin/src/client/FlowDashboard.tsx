import {
  type InteractiveUiRequestSnapshot,
  usePluginSend,
  useSessionData,
  useSessionEvents,
  useSessionInteractiveRequests,
  useT,
  useUiPrimitiveOrNull,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { BreadcrumbSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/BreadcrumbSlot";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession, FlowInfo, FlowState, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiChevronDown, mdiChevronRight, mdiChevronUp, mdiClose, mdiLoading, mdiPlay, mdiRobotOutline, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowAgentCard } from "./FlowAgentCard.js";
import { FlowGraph, flowStateToGraphSteps } from "./FlowGraph.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { FlowQuestionCard } from "./FlowQuestionCard.js";
import { FlowQuestionTranscriptPill } from "./FlowQuestionTranscriptPill.js";
import { FlowSummary } from "./FlowSummary.js";
import { type FlowsSessionState, useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { type FlowTab, FlowTabBar } from "./FlowTabBar.js";
import { FlowYamlPopoverButton } from "./FlowYamlPopoverButton.js";
import { clearAttachment, resolveBaseline, useFlowAttachment } from "./flow-attach-store.js";
import { useFlowCollapsePersisted } from "./flow-collapse-storage.js";
import { buildIdleFlowState, type FlowAttachment, type FlowSlot, type IdleLoad, resolveFlowSlot } from "./flow-idle-state.js";
import { makeSafeSend } from "./send-safe.js";

/**
 * Selection survives run progress; it resets only when the displayed flow
 * changes (tab switch / replacement) or the selected step no longer exists.
 * See change: attach-flow-before-run (D9).
 */
function useSelectionReset(
  displayState: FlowState,
  selectedStepId: string | null,
  setSelectedStepId: (id: string | null) => void,
) {
  const prevNameRef = useRef(displayState.flowName);
  useEffect(() => {
    if (prevNameRef.current !== displayState.flowName) {
      prevNameRef.current = displayState.flowName;
      setSelectedStepId(null);
      return;
    }
    if (selectedStepId && !hasStep(displayState, selectedStepId)) setSelectedStepId(null);
  }, [displayState, selectedStepId, setSelectedStepId]);
}

function hasStep(state: FlowState, stepId: string): boolean {
  if (state.agents.has(stepId)) return true;
  if (state.dagSteps?.some((s) => s.id === stepId)) return true;
  return Array.from(state.agents.values()).some((a) => (a.stepId || a.agentName) === stepId);
}

/** Run `onEnter` when `isIdle` flips false → true (not on first mount). */
function useOnEnterIdle(isIdle: boolean, onEnter: () => void) {
  const prevRef = useRef(isIdle);
  useEffect(() => {
    if (isIdle && !prevRef.current) onEnter();
    prevRef.current = isIdle;
  }, [isIdle, onEnter]);
}

/** Idle header controls: rejection reason, Run, Close. */
function IdleControls({ idle }: { idle: FlowDashboardIdle }) {
  const t = useT();
  return (
    <>
      {idle.rejectionReason && (
        <span className="text-[10px] text-red-400 truncate" data-testid="flow-run-rejected">
          {idle.rejectionReason}
        </span>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); idle.onRun(); }}
        disabled={idle.runDisabled}
        className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="flow-idle-run"
      >
        <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />{t("runFlow", undefined, "Run")}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); idle.onClose(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        data-testid="flow-idle-close"
      >
        <Icon path={mdiClose} size={0.4} className="inline mr-0.5" />{t("closeAttachedFlow", undefined, "Close")}
      </button>
    </>
  );
}

/** Not-started (attached) mode controls. See change: attach-flow-before-run (D2). */
interface FlowDashboardIdle {
  onRun: () => void;
  onClose: () => void;
  /** Run submitted and not yet started/rejected. */
  runDisabled?: boolean;
  /** Reason of the latest rejected start for this flow, shown inline. */
  rejectionReason?: string;
}

export function FlowDashboard({
  flowState,
  flowStates,
  onAbort,
  onToggleAutonomous,
  onDismiss,
  onSendPrompt,
  session,
  sessionId,
  idle,
}: {
  flowState: FlowState;
  /** All flow states (one per distinct flow run this session) for tab navigation */
  flowStates?: Map<string, FlowState>;
  onAbort: () => void;
  onToggleAutonomous: () => void;
  onDismiss: () => void;
  onSendPrompt?: (text: string, images?: import("@blackbelt-technology/pi-dashboard-shared/types.js").ImageContent[]) => void;
  /** Phase-2 decorator host — carries breadcrumb + agent-metric descriptors. */
  session?: Pick<DashboardSession, "uiDecorators">;
  /** Session id — threaded so child cards can render popout URLs and the
      upper-slot question card can submit responses. See change: add-flow-agent-popout. */
  sessionId?: string;
  /** Set → render the not-started (attached) panel; never forwards to the
   *  summary, no Abort, no tabs. See change: attach-flow-before-run (D2). */
  idle?: FlowDashboardIdle;
}) {
  const isMobile = useMobile();
  const t = useT();
  const Dialog = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.dialog);
  const [graphOpen, setGraphOpen] = useState(false);
  // Shared graph⇄card selection (live view parity with FlowSummary). See change:
  // improve-flow-graph-dialog-and-card-interaction.
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Persisted per session so a collapsed dashboard stays collapsed across
  // remounts. See change: fix-flow-ui-graph-zoom-summary.
  const [collapsed, toggleCollapsed] = useFlowCollapsePersisted(sessionId, "dashboard");
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>(flowState.flowName);
  const [followMode, setFollowMode] = useState(true);
  const prevFlowNameRef = useRef(flowState.flowName);

  // Build tab list from flowStates
  const tabs: FlowTab[] = useMemo(() => {
    if (idle || !flowStates || flowStates.size <= 1) return [];
    return Array.from(flowStates.keys()).map(name => ({
      id: name,
      label: name,
      isActive: name === flowState.flowName,
    }));
  }, [idle, flowStates, flowState.flowName]);

  // Follow mode: auto-switch to latest active flow
  useEffect(() => {
    if (followMode && flowState.flowName !== prevFlowNameRef.current) {
      setActiveTabId(flowState.flowName);
    }
    prevFlowNameRef.current = flowState.flowName;
  }, [followMode, flowState.flowName]);

  // Determine which flow state to display based on active tab
  const displayState = useMemo(() => {
    if (!idle && flowStates && activeTabId !== flowState.flowName) {
      return flowStates.get(activeTabId) || flowState;
    }
    return flowState;
  }, [idle, flowStates, activeTabId, flowState]);

  const agents = Array.from(displayState.agents.values());
  const allAgents = Array.from(flowState.agents.values());

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  }, []);
  useSelectionReset(displayState, selectedStepId, setSelectedStepId);
  // Entering idle (new attach / re-attach) starts fresh; leaving idle for live
  // keeps everything (same instance). See change: attach-flow-before-run (D2).
  const flowName = flowState.flowName;
  const resetOnEnterIdle = useCallback(() => {
    setSelectedStepId(null);
    setGraphOpen(false);
    setActiveTabId(flowName);
    setFollowMode(true);
  }, [flowName]);
  useOnEnterIdle(!!idle, resetOnEnterIdle);
  // Esc clears selection (Dialog handles its own Esc independently).
  useEffect(() => {
    if (!selectedStepId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedStepId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedStepId]);
  // Scroll the matching node + card into view on selection (counterpart sync).
  useEffect(() => {
    if (!selectedStepId || !rootRef.current) return;
    const esc = selectedStepId.replace(/["\\]/g, "\\$&");
    for (const attr of ["data-node", "data-step"]) {
      rootRef.current
        .querySelector(`[${attr}="${esc}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedStepId]);
  const doneCount = allAgents.filter(a => a.status === "complete" || a.status === "error" || a.status === "blocked").length;
  const totalCount = allAgents.length;
  const isRunning = !idle && flowState.status === "running";
  const isComplete = !idle && !isRunning;
  const progressText = idle
    ? t("flowNotStarted", undefined, "not started")
    : t("stepsCount", { done: doneCount, total: totalCount }, `${doneCount}/${totalCount} steps`);

  // After completion, show summary. Forward sessionId so the summary's per-session
  // collapse state persists (the hook no-ops without a session id).
  // See change: fix-flow-ui-graph-zoom-summary.
  if (isComplete) {
    return (
      <FlowSummary
        flowState={flowState}
        onDismiss={onDismiss}
        onSendPrompt={onSendPrompt}
        sessionId={sessionId}
      />
    );
  }

  const handleTabClick = (tabId: string) => {
    setActiveTabId(tabId);
    setFollowMode(false); // Manual click disables follow
  };

  const handleToggleFollow = () => {
    const newFollow = !followMode;
    setFollowMode(newFollow);
    if (newFollow) {
      // Re-enable: jump to latest active flow
      setActiveTabId(flowState.flowName);
    }
  };

  // Mobile collapsed bar
  if (isMobile && !mobileExpanded) {
    return (
      <div
        onClick={() => setMobileExpanded(true)}
        className="px-3 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] cursor-pointer flex items-center gap-2"
      >
        <span className="text-blue-400 text-sm">π</span>
        <span className="text-sm text-[var(--text-primary)] truncate flex-1">
          {flowState.flowName} · {progressText}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">tap to expand</span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-testid="flow-dashboard"
      data-flow-mode={idle ? "idle" : "live"}
      className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex text-[var(--text-tertiary)] cursor-pointer"
          onClick={toggleCollapsed}
        >
          <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.6} />
        </span>
        {isRunning ? (
          <Icon path={mdiLoading} size={0.55} className="text-blue-400 animate-spin shrink-0" />
        ) : (
          <span className="text-blue-400 text-sm font-medium">π</span>
        )}
        <span className="text-sm text-[var(--text-primary)] truncate flex-1">
          {flowState.flowName}
          <span className="text-[var(--text-tertiary)] ml-1.5">{progressText}</span>
        </span>

        {/* Controls */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleAutonomous(); }}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${
            flowState.autonomousMode
              ? "border-green-500/40 text-green-400 bg-green-500/10"
              : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
          }`}
          title={t("toggleAutonomousMode", undefined, "Toggle autonomous mode")}
        >
          <Icon path={mdiRobotOutline} size={0.4} className="inline mr-0.5" />AUTO
        </button>
        {idle && <IdleControls idle={idle} />}
        {isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onAbort(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
            title={t("abortFlow", undefined, "Abort flow")}
          >
            <Icon path={mdiStop} size={0.4} className="inline mr-0.5" />{t("abort", undefined, "Abort")}
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileExpanded(false)}
            className="text-[10px] text-[var(--text-tertiary)]"
          >
            <Icon path={mdiChevronUp} size={0.4} className="inline mr-0.5" />collapse
          </button>
        )}
      </div>

      {/* DAG graph — structural minimap */}
      <div className={`group-collapse ${collapsed ? "collapsed" : "expanded"}`}>
        <div>
          {/* Tab bar for multi-flow navigation */}
          <FlowTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            followMode={followMode}
            onTabClick={handleTabClick}
            onToggleFollow={handleToggleFollow}
          />

          {/* Phase-2 breadcrumb decorator slot. See change: add-extension-ui-decorations. */}
          <BreadcrumbSlot session={session} />

          {/* Pending flow-question card — head of the per-flow FIFO queue.
             See change: route-flow-asks-to-upper-slot. */}
          {sessionId && (
            <FlowQuestionsSection
              sessionId={sessionId}
              flowId={displayState.flowName}
              pendingOnly={!!idle}
            />
          )}

          <FlowGraph
            steps={flowStateToGraphSteps(displayState)}
            fit
            selectedStepId={selectedStepId}
            onSelectStep={handleSelectStep}
            onExpand={Dialog ? () => setGraphOpen(true) : undefined}
          />
          {displayState.flowSource && (
            <div className="mt-1">
              <FlowYamlPopoverButton
                flowSource={displayState.flowSource}
                flowName={displayState.flowName}
              />
            </div>
          )}
          {/* Expanded graph — centered Dialog with pan/zoom. See change: show-flow-cards-in-summary. */}
          {Dialog && (
            <Dialog
              open={graphOpen}
              onClose={() => setGraphOpen(false)}
              title={`Flow graph · ${displayState.flowName}`}
              size="full"
            >
              {/* Non-fit (pan/zoom) graph fills the full-size dialog. See change:
                  improve-flow-graph-dialog-and-card-interaction. */}
              <div style={{ height: "82vh", overflow: "hidden" }}>
                <FlowGraph
                  steps={flowStateToGraphSteps(displayState)}
                  selectedStepId={selectedStepId}
                  onSelectStep={handleSelectStep}
                />
              </div>
            </Dialog>
          )}

          {/* Agent card grid — detailed per-agent info */}
          <div
            className="grid gap-2 mt-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))` }}
          >
            {agents.map(agent => (
              <FlowAgentCard
                key={agent.stepId || agent.agentName}
                agent={agent}
                session={session}
                sessionId={sessionId}
                selected={selectedStepId === (agent.stepId || agent.agentName)}
                onSelect={handleSelectStep}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the head of the per-flow `flow-question` queue. Derived from
 * the shell's active interactive UI requests, filtered by component
 * type `flow-question` and grouped by `flowId`. The first matching
 * request is the head; queue depth shown as a "+N more queued" badge
 * on the rendered card.
 *
 * Returns null when no flow-question is pending for `flowId`.
 *
 * See change: route-flow-asks-to-upper-slot.
 */
/** Most recent N transcript entries kept visible. See change: fix-flows-plugin-polish (C3). */
const FLOW_QUESTION_TRANSCRIPT_CAP = 10;

/**
 * Renders the per-flow flow-question transcript above the agent grid.
 *
 * Includes ALL flow-question prompts for `flowId` — pending AND answered —
 * in insertion order (oldest first), capped at {@link FLOW_QUESTION_TRANSCRIPT_CAP}.
 * Pending entries render as the interactive `FlowQuestionCard`;
 * answered/cancelled/dismissed entries render as a collapsed
 * `FlowQuestionTranscriptPill`.
 *
 * Chat suppresses widget-bar prompts (B2) so the slot is the single visible
 * site — no double-render.
 *
 * See change: fix-flows-plugin-polish (C3).
 */
function FlowQuestionsSection({
  sessionId,
  flowId,
  pendingOnly = false,
}: {
  sessionId: string;
  flowId: string;
  /** Idle panel: only still-pending questions (no earlier-run transcript).
   *  See change: attach-flow-before-run (D2). */
  pendingOnly?: boolean;
}) {
  const requests = useSessionInteractiveRequests(sessionId);
  const send = usePluginSend();
  // Card callbacks cannot own the send promise — discard it explicitly.
  // See change: cleanup-client-plugin-promises.
  const dispatch = useMemo(() => makeSafeSend(send), [send]);

  const queue = useMemo<InteractiveUiRequestSnapshot[]>(() => {
    const out: InteractiveUiRequestSnapshot[] = [];
    for (const req of requests) {
      const cmp = req.params._promptBusComponent as
        | { type?: string; props?: { flowId?: unknown } }
        | undefined;
      if (cmp?.type !== "flow-question") continue;
      if (cmp?.props?.flowId !== flowId) continue;
      if (pendingOnly && req.status !== "pending") continue;
      out.push(req);
    }
    return out.slice(-FLOW_QUESTION_TRANSCRIPT_CAP);
  }, [requests, flowId, pendingOnly]);

  if (queue.length === 0) return null;

  const pendingCount = queue.filter((r) => r.status === "pending").length;

  return (
    <div data-testid="flow-questions-transcript" className="flex flex-col gap-1">
      {queue.map((req) => {
        const props =
          (req.params._promptBusComponent as { props?: Record<string, unknown> }).props ?? {};
        const question = typeof props.question === "string" ? props.question : "";
        if (req.status === "pending") {
          const submit = (answer: string) => {
            dispatch({
              type: "prompt_response",
              sessionId,
              promptId: req.requestId,
              answer,
              source: "dashboard-flow-question",
            });
          };
          const dismiss = () => {
            dispatch({ type: "prompt_cancel", sessionId, promptId: req.requestId });
          };
          return (
            <FlowQuestionCard
              key={req.requestId}
              sessionId={sessionId}
              promptId={req.requestId}
              flowId={typeof props.flowId === "string" ? props.flowId : flowId}
              stepId={typeof props.stepId === "string" ? props.stepId : ""}
              question={question}
              type={(props.type as FlowQuestionCardType) ?? "input"}
              options={Array.isArray(props.options) ? (props.options as string[]) : undefined}
              defaultValue={
                typeof props.defaultValue === "string" ? props.defaultValue : undefined
              }
              queueDepth={pendingCount}
              onSubmit={submit}
              onDismiss={dismiss}
            />
          );
        }
        const answer = typeof req.result === "string" ? req.result : undefined;
        return (
          <FlowQuestionTranscriptPill
            key={req.requestId}
            question={question}
            answer={answer}
            status={req.status}
          />
        );
      })}
    </div>
  );
}

type FlowQuestionCardType = "select" | "input" | "confirm" | "editor" | "multiselect";

const EMPTY_FLOWS: FlowInfo[] = [];
const LOADING: IdleLoad = Object.freeze({ kind: "loading" }) as IdleLoad;

/**
 * Fetch + build the attached flow's idle state once per attach (id + source),
 * cancel-safe on unmount (FlowAgentCard fetch pattern). The built state is kept
 * in React state, so its `agents` / `dagSteps` references are stable.
 * See change: attach-flow-before-run (D6).
 */
function useAttachedFlowState(attachment: FlowAttachment | null): IdleLoad {
  const t = useT();
  const name = attachment?.name ?? "";
  const source = attachment?.source;
  const key = attachment ? `${attachment.id}\u0000${source ?? ""}` : "";
  const [state, setState] = useState<{ key: string; load: IdleLoad } | null>(null);

  useEffect(() => {
    if (!key || !source) return;
    let cancelled = false;
    const fail = (message: string) => {
      if (!cancelled) setState({ key, load: { kind: "error", message } });
    };
    fetch(`/api/pi-resource-file?path=${encodeURIComponent(source)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (cancelled) return;
        if (json?.success && typeof json?.data?.content === "string") {
          setState({ key, load: buildIdleFlowState(json.data.content, { name, source }) });
        } else {
          fail(typeof json?.error === "string" ? json.error : `HTTP ${r.status}`);
        }
      })
      .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [key, name, source]);

  if (!attachment) return LOADING;
  if (!source) {
    return { kind: "error", message: t("flowDefinitionLoadError", undefined, "Flow definition file unavailable") };
  }
  if (!state || state.key !== key) return LOADING;
  return state.load;
}

type Translate = ReturnType<typeof useT>;

function slotMessage(slot: FlowSlot, t: Translate): string {
  if (slot.mode === "loading") return t("flowLoading", undefined, "loading…");
  if (slot.error?.kind === "unavailable") return t("flowNoLongerAvailable", undefined, "no longer available");
  return slot.error?.message ?? "";
}

/**
 * Idle Run state: launch dialog → pending until the panel leaves idle or a
 * rejection for this flow newer than the submit arrives (compared on the event
 * clock, never the browser clock). A new attach starts fresh.
 * See change: attach-flow-before-run (D7).
 */
function useIdleRun(
  isIdle: boolean,
  attachmentId: string | undefined,
  flowName: string | undefined,
  lastRejection: FlowsSessionState["lastRejection"],
) {
  const t = useT();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [pendingAfter, setPendingAfter] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | undefined>(undefined);
  const reset = useCallback(() => {
    setLaunchOpen(false);
    setPendingAfter(null);
    setRejectionReason(undefined);
  }, []);
  useEffect(() => {
    if (!isIdle) reset();
  }, [isIdle, reset]);
  const attachRef = useRef(attachmentId);
  useEffect(() => {
    if (attachRef.current !== attachmentId) reset();
    attachRef.current = attachmentId;
  }, [attachmentId, reset]);
  useEffect(() => {
    if (pendingAfter === null || !lastRejection) return;
    if (lastRejection.flowName !== flowName || lastRejection.timestamp <= pendingAfter) return;
    setPendingAfter(null);
    setRejectionReason(lastRejection.reason ?? t("flowRunRejected", undefined, "Start rejected"));
  }, [lastRejection, pendingAfter, flowName, t]);
  return {
    launchOpen,
    pending: pendingAfter !== null,
    rejectionReason,
    open: () => {
      setRejectionReason(undefined);
      setLaunchOpen(true);
    },
    cancel: () => setLaunchOpen(false),
    submitted: () => {
      setLaunchOpen(false);
      setPendingAfter(lastRejection?.timestamp ?? Number.NEGATIVE_INFINITY);
    },
  };
}

/** Minimal header for an attached flow that is loading or failed to load. */
function FlowSlotMessage({
  name,
  message,
  tone,
  onClose,
}: {
  name: string;
  message: string;
  tone: "muted" | "error";
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      data-testid="flow-slot-message"
      data-tone={tone}
      className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2 flex items-center gap-2"
    >
      <span className="text-blue-400 text-sm font-medium">π</span>
      <span className="text-sm text-[var(--text-primary)] truncate">{name}</span>
      <span className={`text-[11px] truncate flex-1 ${tone === "error" ? "text-red-400" : "text-[var(--text-tertiary)]"}`}>
        {message}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        data-testid="flow-idle-close"
      >
        <Icon path={mdiClose} size={0.4} className="inline mr-0.5" />{t("closeAttachedFlow", undefined, "Close")}
      </button>
    </div>
  );
}

/**
 * Slot-consumer wrapper for the `content-header-sticky` claim.
 * Self-derives flow state from useFlowsSessionState and the per-session
 * attachment store, then resolves the slot: running flow → attached
 * (not-started) flow → completed summary → nothing. One
 * `<FlowDashboard key={flowName}>` keeps the instance across idle → live of the
 * same flow and remounts for a different one. See changes:
 * pluginize-flows-via-registry, attach-flow-before-run (D3, D4, D6-D8).
 */
export function FlowDashboardClaim({ session }: { session: DashboardSession }) {
  const sessionId = session.id;
  const { flowState, flowStates, lastFlowStartedAt, lastAutonomousMode, lastRejection } =
    useFlowsSessionState(sessionId);
  const events = useSessionEvents(sessionId);
  const flowsList = useSessionData<FlowInfo[]>(sessionId, "flowsList") ?? EMPTY_FLOWS;
  const attachment = useFlowAttachment(sessionId);
  const idleLoad = useAttachedFlowState(attachment);
  const send = usePluginSend();
  // Dialog callbacks cannot own the send promise. See change: cleanup-client-plugin-promises.
  const dispatch = useMemo(() => makeSafeSend(send), [send]);
  const t = useT();

  const slot = resolveFlowSlot({
    live: flowState,
    liveStates: flowStates,
    attachment,
    idle: idleLoad,
    lastFlowStartedAt,
    flowsList,
  });

  // Baseline from the first non-empty snapshot when attached on an empty
  // stream (replay arrives as one batch = the pre-attach history). (D4)
  const hasEvents = events.length > 0;
  useEffect(() => {
    if (attachment && attachment.baselineStartedAt === null && hasEvents) {
      resolveBaseline(sessionId, attachment.id, lastFlowStartedAt ?? 0);
    }
  }, [attachment, hasEvents, lastFlowStartedAt, sessionId]);

  // A consumed attachment never lingers in storage; the delete is conditional
  // on the id judged consumed, so another tab's fresh attach survives. (D4)
  useEffect(() => {
    if (attachment && slot.attachmentConsumed) clearAttachment(sessionId, attachment.id);
  }, [attachment, slot.attachmentConsumed, sessionId]);

  const attachedName = attachment?.name;
  const isIdle = slot.mode === "idle";
  const run = useIdleRun(isIdle, attachment?.id, attachedName, lastRejection);

  // AUTO shows the last known value (engine default on). Shallow override keeps
  // the memoized agents / dagSteps references. (D8)
  const idleFlowState = isIdle ? slot.flowState : undefined;
  const autonomousMode = lastAutonomousMode ?? true;
  const idleDisplayState = useMemo(
    () => (idleFlowState ? { ...idleFlowState, autonomousMode } : undefined),
    [idleFlowState, autonomousMode],
  );

  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[flows] FlowDashboardClaim render", {
      sessionId,
      mode: slot.mode,
      flowName: slot.flowState?.flowName,
      flowStatus: slot.flowState?.status,
      flowsCount: flowStates.size,
    });
  }

  const flowControl = (action: string) => send({ type: "flow_control", sessionId, action });
  const detach = () => {
    if (attachment) clearAttachment(sessionId, attachment.id);
  };

  if (slot.mode === "none") return null;

  if (slot.mode === "loading" || slot.mode === "error") {
    return (
      <FlowSlotMessage
        name={attachedName ?? ""}
        message={slotMessage(slot, t)}
        tone={slot.mode === "error" ? "error" : "muted"}
        onClose={detach}
      />
    );
  }

  const shown = idleDisplayState ?? slot.flowState!;
  const flowInfo = flowsList.find((f) => f.name === shown.flowName);

  return (
    <>
      <FlowDashboard
        key={shown.flowName}
        flowState={shown}
        flowStates={isIdle ? undefined : (flowStates as Map<string, FlowState>)}
        session={session}
        sessionId={sessionId}
        idle={
          isIdle
            ? {
                onRun: run.open,
                onClose: detach,
                runDisabled: run.pending,
                rejectionReason: run.rejectionReason,
              }
            : undefined
        }
        onAbort={() => flowControl("abort")}
        onToggleAutonomous={() => flowControl("toggle_autonomous")}
        onDismiss={() => flowControl("dismiss_summary")}
        onSendPrompt={(text: string, images?: ImageContent[]) =>
          send({ type: "send_prompt", sessionId, text, images })
        }
      />
      {isIdle && run.launchOpen && (
        <FlowLaunchDialog
          flowName={shown.flowName}
          description={flowInfo?.description}
          session={session}
          onSubmit={(task) => {
            run.submitted();
            dispatch({ type: "flow_management", sessionId, action: "run", flowName: shown.flowName, task: task || undefined });
          }}
          onCancel={run.cancel}
        />
      )}
    </>
  );
}
