import {
  type InteractiveUiRequestSnapshot,
  usePluginSend,
  useSessionInteractiveRequests,
  useT,
  useUiPrimitiveOrNull,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { BreadcrumbSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/BreadcrumbSlot";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession, FlowState, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiChevronDown, mdiChevronRight, mdiChevronUp, mdiFileDocumentOutline, mdiLoading, mdiRobotOutline, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowAgentCard } from "./FlowAgentCard.js";
import { FlowGraph, flowStateToGraphSteps } from "./FlowGraph.js";
import { FlowQuestionCard } from "./FlowQuestionCard.js";
import { FlowQuestionTranscriptPill } from "./FlowQuestionTranscriptPill.js";
import { FlowSummary } from "./FlowSummary.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { type FlowTab, FlowTabBar } from "./FlowTabBar.js";
import { FlowYamlPopoverButton } from "./FlowYamlPopoverButton.js";
import { useFlowCollapsePersisted } from "./flow-collapse-storage.js";




export function FlowDashboard({
  flowState,
  flowStates,
  onAbort,
  onToggleAutonomous,
  onDismiss,
  onSendPrompt,
  session,
  sessionId,
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
    if (!flowStates || flowStates.size <= 1) return [];
    return Array.from(flowStates.keys()).map(name => ({
      id: name,
      label: name,
      isActive: name === flowState.flowName,
    }));
  }, [flowStates, flowState.flowName]);

  // Follow mode: auto-switch to latest active flow
  useEffect(() => {
    if (followMode && flowState.flowName !== prevFlowNameRef.current) {
      setActiveTabId(flowState.flowName);
    }
    prevFlowNameRef.current = flowState.flowName;
  }, [followMode, flowState.flowName]);

  // Determine which flow state to display based on active tab
  const displayState = useMemo(() => {
    if (flowStates && activeTabId !== flowState.flowName) {
      return flowStates.get(activeTabId) || flowState;
    }
    return flowState;
  }, [flowStates, activeTabId, flowState]);

  const agents = Array.from(displayState.agents.values());
  const allAgents = Array.from(flowState.agents.values());

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  }, []);
  // Selection is ephemeral; reset when the displayed agent set changes.
  useEffect(() => {
    setSelectedStepId(null);
  }, [displayState.agents]);
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
  const isRunning = flowState.status === "running";
  const isComplete = !isRunning;

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
          {flowState.flowName} · {doneCount}/{totalCount} steps
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">tap to expand</span>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2">
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
          <span className="text-[var(--text-tertiary)] ml-1.5">{t("stepsCount", { done: doneCount, total: totalCount }, `${doneCount}/${totalCount} steps`)}</span>
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
}: {
  sessionId: string;
  flowId: string;
}) {
  const requests = useSessionInteractiveRequests(sessionId);
  const send = usePluginSend();

  const queue = useMemo<InteractiveUiRequestSnapshot[]>(() => {
    const out: InteractiveUiRequestSnapshot[] = [];
    for (const req of requests) {
      const cmp = req.params._promptBusComponent as
        | { type?: string; props?: { flowId?: unknown } }
        | undefined;
      if (cmp?.type !== "flow-question") continue;
      if (cmp?.props?.flowId !== flowId) continue;
      out.push(req);
    }
    return out.slice(-FLOW_QUESTION_TRANSCRIPT_CAP);
  }, [requests, flowId]);

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
            send({
              type: "prompt_response",
              sessionId,
              promptId: req.requestId,
              answer,
              source: "dashboard-flow-question",
            });
          };
          const dismiss = () => {
            send({ type: "prompt_cancel", sessionId, promptId: req.requestId });
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

/**
 * Slot-consumer wrapper for the `content-header-sticky` claim.
 * Self-derives flow state from useFlowsSessionState; selection state
 * and callbacks come from useFlowsUiState / pluginContext.send.
 * Returns null when no flow is active. See change:
 * pluginize-flows-via-registry.
 */
export function FlowDashboardClaim({ session }: { session: DashboardSession }) {
  const { flowState, flowStates } = useFlowsSessionState(session.id);
  const send = usePluginSend();

  // Diagnostic logging — helps trace why the upper slot might be empty when
  // a flow is running. Gated to dev builds. See change: fix-flows-plugin-polish (C1).
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // eslint-disable-next-line no-console
    console.debug(
      "[flows] FlowDashboardClaim render",
      {
        sessionId: session.id,
        hasFlowState: !!flowState,
        flowName: flowState?.flowName,
        flowStatus: flowState?.status,
        flowsCount: flowStates.size,
      },
    );
  }

  if (!flowState) return null;

  const flowControl = (action: string) =>
    send({ type: "flow_control", sessionId: session.id, action });

  return (
    <FlowDashboard
      flowState={flowState}
      flowStates={flowStates as Map<string, FlowState>}
      session={session}
      sessionId={session.id}
      onAbort={() => flowControl("abort")}
      onToggleAutonomous={() => flowControl("toggle_autonomous")}
      onDismiss={() => flowControl("dismiss_summary")}
      onSendPrompt={(text: string, images?: ImageContent[]) =>
        send({ type: "send_prompt", sessionId: session.id, text, images })
      }
    />
  );
}
