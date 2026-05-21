import React, { useRef, useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiChevronRight,
  mdiChevronDown,
  mdiLoading,
  mdiFileDocumentOutline,
  mdiEyeOutline,
  mdiEyeOffOutline,
  mdiOpenInNew,
} from "@mdi/js";
import type {
  ArchitectState,
  ArchitectPhase,
  ArchitectPrompt,
  ArchitectAgentEntry,
  DashboardSession,
  FlowDetailEntry,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useUiPrimitive, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  MinimalChatView,
  type MinimalChatEntry,
  type MinimalChatStatus,
} from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
import { FlowGraph, architectStepsToGraphSteps } from "./FlowGraph.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { buildFlowArchitectPopoutUrl } from "./popout-url.js";
import {
  useFlowsUiState,
  useFlowsUiActions,
} from "./FlowsUiStateContext.js";

// ── Architect detail view ─────────────────────────────────────────────────
//
// Shim over `MinimalChatView`. Inline `ToolCallEntry` / `TextEntry` /
// `ThinkingEntry` / `extractInputPreview` were removed in
// `fix-flows-plugin-polish` (A1) — the architect now uses the same
// timeline renderer as `FlowAgentDetail` and `SubagentDetailView`.
//
// See change: fix-flows-plugin-polish (A1).

function mapArchitectPhase(phase: ArchitectPhase): MinimalChatStatus {
  switch (phase) {
    case "context":
    case "designing":
      return "running";
    case "preview":
      return "running";
    case "complete":
      return "complete";
    case "cancelled":
      return "error";
    default: {
      const _exhaustive: never = phase;
      void _exhaustive;
      return "pending";
    }
  }
}

function mapArchitectEntries(detailHistory: FlowDetailEntry[]): MinimalChatEntry[] {
  return detailHistory.map((e) => {
    switch (e.kind) {
      case "tool":
        return {
          kind: "tool",
          toolName: e.toolName,
          input: e.input,
          output: e.output,
          isError: e.isError,
        };
      case "text":
        return { kind: "text", text: e.text };
      case "thinking":
        return { kind: "thinking", text: e.text };
      case "error":
        return { kind: "error", text: e.text };
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
        return { kind: "error", text: "(unknown entry)" };
      }
    }
  });
}

export function FlowArchitectDetail({
  state,
  onBack,
  sessionId,
}: {
  state: ArchitectState;
  onBack?: () => void;
  /** Forwarded to MinimalChatView so per-tool renderers can build session-scoped links. */
  sessionId?: string;
}) {
  const status = mapArchitectPhase(state.phase);
  const entries = mapArchitectEntries(state.detailHistory);
  const modeLabel = state.architectMode === "edit" ? "Edit" : "New";
  const iterationSuffix = state.iteration > 1 ? ` · Iter ${state.iteration}` : "";

  return (
    <MinimalChatView
      title="Flow Architect"
      subtitle={state.flowName || undefined}
      status={status}
      entries={entries}
      mode="popout"
      onBack={onBack}
      sessionId={sessionId}
      meta={{ modelName: `${modeLabel}${iterationSuffix}` }}
      emptyMessage={
        state.phase === "context" || state.phase === "designing"
          ? "Working…"
          : "No activity yet"
      }
    />
  );
}

// ── Inline prompt renderers ───────────────────────────────────────

function ArchitectSelectPrompt({
  prompt,
  onRespond,
}: {
  prompt: ArchitectPrompt;
  onRespond: (answer: string) => void;
}) {
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">
        {prompt.question}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {prompt.options?.map((opt) => (
          <button
            key={opt}
            onClick={() => onRespond(opt)}
            className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
              opt === "Cancel" || opt === "Don't save"
                ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                : opt === "Save"
                  ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                  : "border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

/** @internal — exported for testing */
export function ArchitectInputPrompt({
  prompt,
  onRespond,
}: {
  prompt: ArchitectPrompt;
  onRespond: (answer: string) => void;
}) {
  const [value, setValue] = React.useState(prompt.defaultValue || "");
  const handleSubmit = () => {
    onRespond(value.trim());
  };
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">
        {prompt.question}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="flex-1 text-[11px] px-2 py-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:border-purple-500/50"
          placeholder="Enter a value..."
          autoFocus
        />
        <button
          onClick={handleSubmit}
          className="text-[11px] px-2.5 py-1 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function ArchitectConfirmPrompt({
  prompt,
  onRespond,
}: {
  prompt: ArchitectPrompt;
  onRespond: (answer: string) => void;
}) {
  return (
    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]">
      <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">
        {prompt.question}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onRespond("true")}
          className="text-[11px] px-2.5 py-1 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10"
        >
          Yes
        </button>
        <button
          onClick={() => onRespond("false")}
          className="text-[11px] px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
        >
          No
        </button>
      </div>
    </div>
  );
}

function ArchitectPromptInline({
  prompt,
  onRespond,
}: {
  prompt: ArchitectPrompt;
  onRespond: (answer: string) => void;
}) {
  switch (prompt.type) {
    case "select":
      return <ArchitectSelectPrompt prompt={prompt} onRespond={onRespond} />;
    case "input":
      return <ArchitectInputPrompt prompt={prompt} onRespond={onRespond} />;
    case "confirm":
      return <ArchitectConfirmPrompt prompt={prompt} onRespond={onRespond} />;
    default:
      return null;
  }
}

// ── Agent card for architect (similar to FlowAgentCard) ──────────

const AGENT_STATUS_MAP: Record<
  string,
  "pending" | "running" | "complete" | "error"
> = {
  pending: "pending",
  creating: "running",
  done: "complete",
  error: "error",
};

function ArchitectAgentCard({
  agent,
}: {
  agent: ArchitectAgentEntry;
}) {
  const AgentCardShell = useUiPrimitive(UI_PRIMITIVE_KEYS.agentCard);
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const sourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);

  // Architect's custom agents carry their raw markdown inline on the
  // ArchitectAgentEntry (set by the architect-reducer when capturing
  // `agent_write` events). No REST fetch needed — just render in a
  // popover anchored to the doc button.
  const hasSource = Boolean(agent.source);

  return (
    <AgentCardShell
      name={agent.name}
      status={AGENT_STATUS_MAP[agent.status] || "pending"}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)] truncate">
          {agent.type === "custom" ? "custom agent" : agent.type}
        </span>
        {hasSource && (
          <>
            <button
              ref={sourceButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                setSourceOpen((prev) => !prev);
              }}
              className={`transition-colors p-0.5 rounded ${
                sourceOpen
                  ? "text-purple-400 bg-purple-400/10"
                  : "text-[var(--text-tertiary)] hover:text-purple-400 hover:bg-[var(--bg-surface)]"
              }`}
              title={sourceOpen ? `Close ${agent.name} source` : `View ${agent.name} source`}
            >
              <Icon path={mdiFileDocumentOutline} size={0.5} />
            </button>
            {sourceOpen && sourceButtonRef.current && (
              <Popover
                anchorEl={sourceButtonRef.current}
                onDismiss={() => setSourceOpen(false)}
              >
                <div
                  className="w-[640px] max-w-[90vw] max-h-[70vh] overflow-auto bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-xl p-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-[11px] text-[var(--text-tertiary)] mb-2 font-mono">
                    {agent.name}
                  </div>
                  <MarkdownContent content={agent.source!} />
                </div>
              </Popover>
            )}
          </>
        )}
      </div>
    </AgentCardShell>
  );
}

/**
 * Small icon button that opens a popover anchored to itself, showing the
 * given markdown/YAML `content`. Replaces the previous callback-based
 * ViewFileButton that routed via the dormant FlowYamlPreview slot.
 *
 * See change: add-ui-popover-primitive.
 */
function ViewFilePopoverButton({
  title,
  content,
  filename,
  language,
}: {
  title: string;
  content: string;
  /** Path/filename shown as a small caption above the content. */
  filename?: string;
  /** Hint for code fence (e.g. "yaml", "markdown"). When omitted we render raw. */
  language?: string;
}) {
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  // Wrap raw YAML/text in a code fence so MarkdownContent renders it as a
  // syntax-highlighted block. Already-markdown content is shown verbatim.
  const rendered = language
    ? "```" + language + "\n" + content + "\n```"
    : content;

  return (
    <>
      <button
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className={`transition-colors p-0.5 rounded inline-flex items-center ${
          open
            ? "text-purple-400 bg-purple-400/10"
            : "text-[var(--text-tertiary)] hover:text-purple-400 hover:bg-[var(--bg-surface)]"
        }`}
        title={title}
      >
        <Icon path={mdiFileDocumentOutline} size={0.5} />
      </button>
      {open && ref.current && (
        <Popover anchorEl={ref.current} onDismiss={() => setOpen(false)}>
          <div
            className="w-[640px] max-w-[90vw] max-h-[70vh] overflow-auto bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-xl p-3"
            onClick={(e) => e.stopPropagation()}
          >
            {filename && (
              <div className="text-[11px] text-[var(--text-tertiary)] mb-2 font-mono truncate" title={filename}>
                {filename}
              </div>
            )}
            <MarkdownContent content={rendered} />
          </div>
        </Popover>
      )}
    </>
  );
}

// ── Card (shown in the sticky header bar) ─────────────────────────

export function FlowArchitect({
  state,
  onAbort,
  onPromptRespond,
  sessionId,
}: {
  state: ArchitectState;
  onAbort: () => void;
  onPromptRespond?: (promptId: string, answer: string) => void;
  /** Session id — threaded so the popout button can build a URL.
      See change: fix-flows-plugin-polish (A4). */
  sessionId?: string;
}) {
  const popoutUrl = buildFlowArchitectPopoutUrl(sessionId);
  const popoutEnabled = popoutUrl !== null;
  const handlePopout = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (popoutUrl) window.open(popoutUrl, "_blank", "noopener");
    },
    [popoutUrl],
  );
  const [collapsed, setCollapsed] = useState(false);
  // Popover state for the architect-detail view. Lives in this component
  // so the eye button (the anchor) and the Popover share the same scope.
  // Replaces the old `content-view` slot claim + global UI-state flag.
  // See change: add-ui-popover-primitive.
  const [detailOpen, setDetailOpen] = useState(false);
  const detailButtonRef = useRef<HTMLButtonElement | null>(null);
  const Popover = useUiPrimitive(UI_PRIMITIVE_KEYS.popover);
  const isActive = state.phase === "context" || state.phase === "designing";
  const isPreview = state.phase === "preview";
  const customAgents = state.agents.filter((a) => a.type === "custom");
  const firstFlow = state.parsedFlows[0];

  return (
    <div className="bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] px-3 py-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex text-[var(--text-tertiary)] cursor-pointer"
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon
            path={collapsed ? mdiChevronRight : mdiChevronDown}
            size={0.6}
          />
        </span>
        {isActive ? (
          <Icon path={mdiLoading} size={0.55} className="text-purple-400 animate-spin shrink-0" />
        ) : (
          <span className="text-purple-400 text-sm font-medium">π</span>
        )}
        <span className="text-sm text-[var(--text-primary)] truncate flex-1">
          Flow Architect{" "}
          <span className="text-[var(--text-tertiary)] ml-1.5">
            {state.phase === "context"
              ? "Analyzing conversation..."
              : state.phase === "designing"
                ? state.flowName
                  ? `Designing: ${state.flowName}`
                  : "Designing..."
                : state.phase === "preview"
                  ? state.flowName
                    ? `Preview: ${state.flowName}`
                    : "Preview"
                  : ""}
          </span>
        </span>

        {/* Model + alias */}
        {state.resolvedModel && (
          <span className="text-[10px] text-[var(--text-muted)] shrink-0">
            {state.resolvedModel.split("/").pop()}
            {state.modelAlias?.startsWith("@") && (
              <span className="text-[var(--text-tertiary)] ml-0.5">
                {state.modelAlias}
              </span>
            )}
          </span>
        )}

        {/* Iteration badge */}
        {state.iteration > 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400">
            Iteration {state.iteration}
          </span>
        )}

        {/* Mode badge */}
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border ${
            state.architectMode === "edit"
              ? "border-yellow-500/30 text-yellow-400"
              : "border-purple-500/30 text-purple-400"
          }`}
        >
          {state.architectMode === "edit" ? "Edit" : "New"}
        </span>

        {/* Abort button */}
        {(isActive || isPreview || state.pendingPrompt) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAbort();
            }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
            title="Abort architect"
          >
            Abort
          </button>
        )}
      </div>

      {/* Content — always shown, flat layout */}
      <div className={`group-collapse ${collapsed ? "collapsed" : "expanded"}`}>
        <div>
          {/* Loading indicator when active but no content yet */}
          {isActive &&
            state.dagSteps.length === 0 &&
            customAgents.length === 0 &&
            state.recentTools.length === 0 && (
              <div className="flex items-center gap-2 py-3 text-[var(--text-muted)]">
                <Icon
                  path={mdiLoading}
                  size={0.55}
                  className="text-purple-400 animate-spin"
                />
                <span className="text-[11px]">
                  {state.phase === "context"
                    ? "Generating session summary..."
                    : "Initializing architect agent..."}
                </span>
              </div>
            )}

          {/* Flow graph + view YAML icon (only when file exists) */}
          {state.dagSteps.length > 0 && (
            <div>
              <FlowGraph steps={architectStepsToGraphSteps(state.dagSteps)} />
              <div className="flex items-center gap-2 mt-1">
                {firstFlow && (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {firstFlow.steps.length} steps · max{" "}
                    {firstFlow.maxConcurrent}
                  </span>
                )}
                {state.flowWriteStatus && (
                  <span
                    className={`text-[11px] ${state.flowWriteStatus === "validation-error" ? "text-red-400" : "text-green-400"}`}
                    title={
                      state.flowWriteStatus === "validation-error"
                        ? "Flow has validation errors"
                        : "Flow is valid"
                    }
                  >
                    Flow:{" "}
                    {state.flowWriteStatus === "validation-error" ? "✗" : "✓"}
                  </span>
                )}
                {state.flowYamlContent && (
                  <ViewFilePopoverButton
                    title="View flow YAML"
                    content={state.flowYamlContent}
                    filename={state.flowName ? `${state.flowName}.yaml` : "flow.yaml"}
                    language="yaml"
                  />
                )}
              </div>
            </div>
          )}

          {/* Agent cards grid with view-source icon per card */}
          {customAgents.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-[var(--text-muted)] mb-1">
                Created Agents · new:{" "}
                {customAgents.filter((a) => a.status === "done").length}
              </div>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(180px, 1fr))`,
                }}
              >
                {customAgents.map((agent) => (
                  <ArchitectAgentCard key={agent.name} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {/* Process status + view detail icon */}
          <div className="mt-2">
            {state.catalogSummary && (
              <div className="text-[10px] text-[var(--text-muted)]">
                {state.catalogSummary}
              </div>
            )}
            <div className="space-y-0 mt-0.5">
              {state.recentTools.map((tool, i) => (
                <div
                  key={i}
                  className="text-[10px] text-[var(--text-tertiary)] truncate"
                >
                  {i === state.recentTools.length - 1 ? "▸" : "·"}{" "}
                  {tool.toolName} {tool.inputPreview}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <button
                type="button"
                onClick={handlePopout}
                disabled={!popoutEnabled}
                data-testid="flow-architect-popout-button"
                className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
                  popoutEnabled
                    ? "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-purple-400 hover:border-purple-400/40 hover:bg-purple-400/10"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                }`}
                title={popoutEnabled ? "Open Flow Architect in new tab" : "Popout unavailable (no session context)"}
              >
                <Icon path={mdiOpenInNew} size={0.55} />
                <span className="text-[10px]">Popout</span>
              </button>
              <button
                ref={detailButtonRef}
                type="button"
                onClick={() => setDetailOpen((prev) => !prev)}
                className={`transition-colors px-1.5 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border ${
                  detailOpen
                    ? "text-purple-400 bg-purple-400/10 border-purple-400/40"
                    : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-purple-400 hover:border-purple-400/40 hover:bg-purple-400/10"
                }`}
                title={detailOpen ? "Close architect detail" : "View full architect detail"}
              >
                <Icon path={detailOpen ? mdiEyeOffOutline : mdiEyeOutline} size={0.55} />
                <span className="text-[10px]">Details</span>
              </button>
            </div>
            {detailOpen && detailButtonRef.current && (
              <Popover
                anchorEl={detailButtonRef.current}
                onDismiss={() => setDetailOpen(false)}
              >
                {/* `overflow-hidden` on the wrapper + the inner MinimalChatView's
                    `overflow-y-auto` body produces an inner scrollbar (not an
                    outer one). See change: fix-flows-plugin-polish (scrollbar fix). */}
                <div className="w-[640px] max-w-[90vw] h-[70vh] overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-xl">
                  <FlowArchitectDetail
                    state={state}
                    onBack={() => setDetailOpen(false)}
                    sessionId={sessionId}
                  />
                </div>
              </Popover>
            )}
          </div>
        </div>
      </div>

      {/* Inline prompt (Save/Replan/Cancel etc.) */}
      {state.pendingPrompt && onPromptRespond && (
        <ArchitectPromptInline
          prompt={state.pendingPrompt}
          onRespond={(answer) =>
            onPromptRespond(state.pendingPrompt!.id, answer)
          }
        />
      )}

      {/* Error display */}
      {state.error && (
        <div className="text-[11px] text-red-400 mt-1.5 px-1">
          ⚠ {state.error}
        </div>
      )}
    </div>
  );
}

/**
 * Slot-consumer wrapper for the `content-header-sticky` claim.
 * Self-derives architect state and dispatches via pluginContext.send.
 * Returns null when no architect is active. See change:
 * pluginize-flows-via-registry.
 */
export function FlowArchitectClaim({ session }: { session: DashboardSession }) {
  const { architectState } = useFlowsSessionState(session.id);
  const send = usePluginSend();

  if (!architectState) return null;

  return (
    <FlowArchitect
      state={architectState}
      sessionId={session.id}
      onAbort={() =>
        send({ type: "flow_control", sessionId: session.id, action: "abort" })
      }
      onPromptRespond={(promptId, answer) =>
        send({ type: "architect_prompt_response", sessionId: session.id, promptId, answer })
      }
    />
  );
}
