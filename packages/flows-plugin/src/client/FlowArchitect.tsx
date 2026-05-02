import React, { useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiChevronRight,
  mdiChevronDown,
  mdiLoading,
  mdiArrowLeft,
  mdiFileDocumentOutline,
  mdiEyeOutline,
  mdiEyeOffOutline,
} from "@mdi/js";
import type {
  ArchitectState,
  ArchitectPrompt,
  ArchitectAgentEntry,
  FlowDetailEntry,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { MarkdownContent } from "../../../client/src/components/MarkdownContent.js";
import { FlowGraph, architectStepsToGraphSteps } from "./FlowGraph.js";
import { AgentCardShell } from "../../../client/src/components/AgentCardShell.js";

// ── Detail view (reuses same patterns as FlowAgentDetail) ─────────

function extractInputPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const inp = input as Record<string, unknown>;
  switch (toolName.toLowerCase()) {
    case "read":
    case "write":
    case "edit":
      return String(inp.file_path || inp.path || "");
    case "bash":
      return String(inp.command || "").slice(0, 80);
    case "grep":
      return String(inp.pattern || "").slice(0, 40);
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}

function ToolCallEntry({
  entry,
}: {
  entry: FlowDetailEntry & { kind: "tool" };
}) {
  const preview = extractInputPreview(entry.toolName, entry.input);
  const hasOutput = entry.output !== undefined;
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div
      className={`border-l-2 pl-3 py-1.5 ${entry.isError ? "border-red-500/50" : "border-purple-500/30"}`}
    >
      <div
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <span
          className={`text-xs font-mono ${entry.isError ? "text-red-400" : "text-purple-400"}`}
        >
          {entry.toolName}
        </span>
        <span className="text-xs text-[var(--text-tertiary)] truncate">
          {preview}
        </span>
        {hasOutput && (
          <span className="text-[10px] text-[var(--text-muted)] ml-auto flex-shrink-0">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </div>
      {expanded && hasOutput && (
        <pre className="text-[11px] text-[var(--text-secondary)] mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words bg-[var(--bg-tertiary)] rounded p-2">
          {typeof entry.output === "string"
            ? entry.output
            : JSON.stringify(entry.output, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TextEntry({ text }: { text: string }) {
  return (
    <div className="py-1.5 pl-3">
      <MarkdownContent content={text} />
    </div>
  );
}

function ThinkingEntry({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="py-1 pl-3">
      <div
        className="flex items-center gap-1 cursor-pointer text-[11px] text-purple-400/70"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>Thinking</span>
      </div>
      {expanded && (
        <pre className="text-[11px] text-[var(--text-muted)] mt-1 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {text}
        </pre>
      )}
    </div>
  );
}

export function FlowArchitectDetail({
  state,
  onBack,
}: {
  state: ArchitectState;
  onBack: () => void;
}) {
  const isActive = state.phase === "context" || state.phase === "designing";
  const detailRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new entries arrive
  React.useEffect(() => {
    if (detailRef.current) {
      detailRef.current.scrollTop = detailRef.current.scrollHeight;
    }
  }, [state.detailHistory.length]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        {isActive ? (
          <Icon
            path={mdiLoading}
            size={0.55}
            className="text-purple-400 animate-spin"
          />
        ) : (
          <span className="text-purple-400">◇</span>
        )}
        <span className="text-sm font-medium text-[var(--text-primary)]">
          Flow Architect
        </span>
        {state.flowName && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {state.flowName}
          </span>
        )}
        <span className="text-[11px] text-[var(--text-muted)] ml-auto">
          {state.architectMode === "edit" ? "Edit" : "New"}
          {state.iteration > 1 && ` · Iteration ${state.iteration}`}
        </span>
      </div>

      {/* Detail history */}
      <div
        ref={detailRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5"
      >
        {state.detailHistory.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] py-4 text-center">
            {isActive ? "Working..." : "No activity yet"}
          </div>
        ) : (
          state.detailHistory.map((entry, i) => {
            switch (entry.kind) {
              case "tool":
                return <ToolCallEntry key={i} entry={entry} />;
              case "text":
                return <TextEntry key={i} text={entry.text} />;
              case "thinking":
                return <ThinkingEntry key={i} text={entry.text} />;
              case "error":
                return (
                  <div key={i} className="py-1.5 pl-3 text-sm text-red-400">
                    {entry.text}
                  </div>
                );
              default:
                return null;
            }
          })
        )}
      </div>
    </div>
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
  onViewSource,
}: {
  agent: ArchitectAgentEntry;
  onViewSource?: () => void;
}) {
  return (
    <AgentCardShell
      name={agent.name}
      status={AGENT_STATUS_MAP[agent.status] || "pending"}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--text-muted)] truncate">
          {agent.type === "custom" ? "custom agent" : agent.type}
        </span>
        {onViewSource && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewSource();
            }}
            className="text-[var(--text-tertiary)] hover:text-purple-400 transition-colors p-0.5 rounded hover:bg-[var(--bg-surface)]"
            title={`View ${agent.name} source`}
          >
            <Icon path={mdiFileDocumentOutline} size={0.5} />
          </button>
        )}
      </div>
    </AgentCardShell>
  );
}

/** Small icon button for viewing files (YAML, agent source, etc.) */
function ViewFileButton({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[var(--text-tertiary)] hover:text-purple-400 transition-colors p-0.5 rounded hover:bg-[var(--bg-surface)] inline-flex items-center"
      title={title}
    >
      <Icon path={mdiFileDocumentOutline} size={0.5} />
    </button>
  );
}

// ── Card (shown in the sticky header bar) ─────────────────────────

export function FlowArchitect({
  state,
  onAbort,
  onClick,
  isDetailOpen,
  onPromptRespond,
  onViewYaml,
  onViewAgentSource,
}: {
  state: ArchitectState;
  onAbort: () => void;
  onClick?: () => void;
  isDetailOpen?: boolean;
  onPromptRespond?: (promptId: string, answer: string) => void;
  onViewYaml?: () => void;
  onViewAgentSource?: (agentName: string, source: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
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
          Flow Architect
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
                {onViewYaml && state.flowYamlContent && (
                  <ViewFileButton title="View flow YAML" onClick={onViewYaml} />
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
                  <ArchitectAgentCard
                    key={agent.name}
                    agent={agent}
                    onViewSource={
                      agent.source && onViewAgentSource
                        ? () => onViewAgentSource(agent.name, agent.source!)
                        : undefined
                    }
                  />
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
            <div className="flex items-center gap-2 mt-1">
              {onClick && (
                <button
                  onClick={onClick}
                  className={`transition-colors p-0.5 rounded inline-flex items-center ${
                    isDetailOpen
                      ? "text-purple-400 bg-purple-400/10"
                      : "text-[var(--text-tertiary)] hover:text-purple-400 hover:bg-[var(--bg-surface)]"
                  }`}
                  title={isDetailOpen ? "Close architect detail" : "View full architect detail"}
                >
                  <Icon path={isDetailOpen ? mdiEyeOffOutline : mdiEyeOutline} size={0.5} />
                </button>
              )}
            </div>
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
