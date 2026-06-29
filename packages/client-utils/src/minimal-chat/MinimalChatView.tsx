/**
 * MinimalChatView — shared subagent / agent timeline renderer.
 *
 * Single source of truth for the timeline UI that was previously duplicated
 * across `packages/subagents-plugin/.../SubagentDetailView.tsx` and
 * `packages/flows-plugin/.../FlowAgentDetail.tsx`. Producer plugins wrap this
 * with a thin adapter that maps their state shape into `MinimalChatViewProps`.
 *
 * Modes:
 *   - "inline"  — body capped at max-h-[60vh] (popover / expanded-card usage)
 *   - "popout"  — fills parent (h-full) for dedicated popout pages
 *   - "row"     — single-line summary, no body (panel-row usage)
 *
 * UI primitives (`MarkdownContent`, `formatTokens`, `formatDuration`) are
 * resolved via `useUiPrimitive(UI_PRIMITIVE_KEYS.*)` — tests MUST wrap renders
 * in `withUiPrimitiveProvider` to populate them.
 *
 * See change: extract-minimal-chat-view.
 */
import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiAlertCircle,
  mdiArrowLeft,
  mdiCheckCircle,
  mdiCircle,
  mdiCircleOutline,
  mdiCloseCircle,
} from "@mdi/js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { useUiPrimitive, useUiPrimitiveOrNull } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  MinimalChatEntry,
  MinimalChatStatus,
  MinimalChatViewProps,
} from "./types.js";

// ---- Status visuals ----

/**
 * Resolves the mdi-icon path and tailwind color class for a given status.
 * Centralizing this map is the main reason for the extraction — adding a
 * new status is a one-file change.
 */
export function statusVisualsFor(status: MinimalChatStatus): {
  iconPath: string;
  colorClass: string;
} {
  switch (status) {
    case "complete":
      return { iconPath: mdiCheckCircle, colorClass: "text-green-400" };
    case "error":
      return { iconPath: mdiCloseCircle, colorClass: "text-red-400" };
    case "running":
      return { iconPath: mdiCircle, colorClass: "text-yellow-400" };
    case "blocked":
      return { iconPath: mdiAlertCircle, colorClass: "text-orange-400" };
    case "pending":
      return { iconPath: mdiCircleOutline, colorClass: "text-[var(--text-tertiary)]" };
    default: {
      // Exhaustive check — TS will error if a new MinimalChatStatus branch
      // is missed. The runtime fallback is the same as "pending".
      const _exhaustive: never = status;
      void _exhaustive;
      return { iconPath: mdiCircleOutline, colorClass: "text-[var(--text-tertiary)]" };
    }
  }
}

// ---- Helpers ----

export function extractInputPreview(toolName: string, input: unknown): string {
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
      try {
        return JSON.stringify(input).slice(0, 60);
      } catch {
        return "";
      }
  }
}

// ---- Entry renderers ----

function ToolCallEntry({
  entry,
  index,
  sessionId,
  hideStatusIcon,
}: {
  entry: Extract<MinimalChatEntry, { kind: "tool" }>;
  index: number;
  sessionId?: string;
  hideStatusIcon?: boolean;
}) {
  // Prefer the shell-registered `toolCallStep` primitive for parity with the
  // main chat view (per-tool renderers, collapsible output, status icon).
  // Falls back to a simple inline renderer when the primitive is not
  // registered (e.g. unit tests without the full provider).
  // See change: fix-flows-plugin-polish (chat-view parity).
  const ToolCallStepImpl = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.toolCallStep);
  const args =
    entry.input && typeof entry.input === "object" && !Array.isArray(entry.input)
      ? (entry.input as Record<string, unknown>)
      : { value: entry.input };
  const result =
    entry.output === undefined
      ? undefined
      : typeof entry.output === "string"
        ? entry.output
        : JSON.stringify(entry.output, null, 2);
  if (ToolCallStepImpl) {
    const toolCallId = `minimal-${index}`;
    const status = entry.isError ? "error" : entry.output !== undefined ? "complete" : "running";
    return (
      <ToolCallStepImpl
        toolName={entry.toolName}
        toolCallId={toolCallId}
        args={args}
        status={status}
        result={result}
        sessionId={sessionId}
        hideStatusIcon={hideStatusIcon}
      />
    );
  }

  // Fallback: simple inline renderer.
  const preview = extractInputPreview(entry.toolName, entry.input);
  const hasOutput = entry.output !== undefined;
  return (
    <FallbackToolEntry
      toolName={entry.toolName}
      preview={preview}
      hasOutput={hasOutput}
      result={result}
      isError={entry.isError ?? false}
    />
  );
}

function FallbackToolEntry({
  toolName,
  preview,
  hasOutput,
  result,
  isError,
}: {
  toolName: string;
  preview: string;
  hasOutput: boolean;
  result?: string;
  isError: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className={`border-l-2 pl-3 py-1.5 ${isError ? "border-red-500/50" : "border-blue-500/30"}`}>
      <div
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <span className={`text-xs font-mono ${isError ? "text-red-400" : "text-blue-400"}`}>
          {toolName}
        </span>
        <span className="text-xs text-[var(--text-tertiary)] truncate">{preview}</span>
        {hasOutput && (
          <span className="text-[10px] text-[var(--text-muted)] ml-auto flex-shrink-0">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </div>
      {expanded && hasOutput && result !== undefined && (
        <pre className="text-[11px] text-[var(--text-secondary)] mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words bg-[var(--bg-tertiary)] rounded p-2">
          {result}
        </pre>
      )}
    </div>
  );
}

function TextEntry({ text }: { text: string }) {
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  return (
    <div className="py-1.5 pl-3">
      <MarkdownContent content={text} />
    </div>
  );
}

function ThinkingEntry({ text }: { text: string }) {
  // Prefer the shell-registered `thinkingBlock` primitive for parity with
  // the main chat view. Falls back to a simple inline rendition when the
  // primitive is not registered.
  // See change: fix-flows-plugin-polish (chat-view parity).
  const ThinkingBlockImpl = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.thinkingBlock);
  if (ThinkingBlockImpl) {
    return <ThinkingBlockImpl content={text} />;
  }
  return <FallbackThinkingEntry text={text} />;
}

function FallbackThinkingEntry({ text }: { text: string }) {
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

function ErrorEntry({ text }: { text: string }) {
  return <div className="py-1.5 pl-3 text-sm text-red-400">{text}</div>;
}

// ---- Main component ----

export function MinimalChatView({
  title,
  subtitle,
  status,
  entries,
  meta,
  hideToolStatusIcon,
  mode = "inline",
  onBack,
  emptyMessage,
  footer,
  activity,
  sessionId,
}: MinimalChatViewProps) {
  // Soft-read formatters — fall back to identity formatting when the
  // primitive registry is partially populated (matches the spec’s
  // "header meta renders only when present" requirement: missing
  // formatters degrade gracefully rather than throw).
  const formatTokensImpl = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.formatTokens);
  const formatDurationImpl = useUiPrimitiveOrNull(UI_PRIMITIVE_KEYS.formatDuration);
  const formatTokens = formatTokensImpl ?? ((n: number) => String(n));
  const formatDuration = formatDurationImpl ?? ((ms: number) => `${ms}ms`);
  const { iconPath, colorClass } = statusVisualsFor(status);

  // Row mode: single-line summary, no body. No footer, no header chrome.
  if (mode === "row") {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className={`${colorClass} inline-flex flex-shrink-0`}>
          <Icon path={iconPath} size={0.5} />
        </span>
        <span className="text-xs font-medium text-[var(--text-primary)] truncate">{title}</span>
        {activity && (
          <span className="text-[10px] text-[var(--text-tertiary)] truncate ml-1">{activity}</span>
        )}
      </div>
    );
  }

  const showMeta =
    !!meta &&
    (meta.modelName !== undefined ||
      meta.durationMs !== undefined ||
      (meta.tokens !== undefined && (meta.tokens.input !== undefined || meta.tokens.output !== undefined)));

  const hasTokensOrDuration =
    !!meta && (meta.tokens !== undefined || meta.durationMs !== undefined);

  // Header (inline + popout share)
  const header = (
    <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2 flex-shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Back"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
      )}
      <span className={`${colorClass} inline-flex`}>
        <Icon path={iconPath} size={0.6} />
      </span>
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{title}</span>
        {subtitle && (
          <span
            className="text-[10px] font-mono text-[var(--text-tertiary)] truncate"
            title={subtitle}
          >
            {subtitle}
          </span>
        )}
        {activity && status === "running" && (
          <span className="text-[10px] text-[var(--text-tertiary)] truncate">{activity}</span>
        )}
      </div>
      {showMeta && meta?.modelName && (
        <span className="text-[11px] text-[var(--text-tertiary)] truncate flex-shrink-0">
          {meta.modelName}
        </span>
      )}
      {showMeta && hasTokensOrDuration && (
        <span className="text-[11px] text-[var(--text-muted)] ml-auto whitespace-nowrap">
          {meta?.tokens && (
            <>
              ↑{formatTokens(meta.tokens.input ?? 0)} ↓{formatTokens(meta.tokens.output ?? 0)}
              {meta.durationMs !== undefined && " · "}
            </>
          )}
          {meta?.durationMs !== undefined && formatDuration(meta.durationMs)}
        </span>
      )}
    </div>
  );

  // Inline mode uses a STABLE height (`h-[60vh]`, not `max-h-[60vh]`) so
  // the container doesn't bounce as content streams in. The body's
  // `flex-1 min-h-0 overflow-y-auto` (below) gives it a consistent
  // scroll surface regardless of content size.
  //
  // See change: fix-flows-plugin-polish (stable inline height).
  const containerClasses =
    mode === "popout"
      ? "flex flex-col h-full overflow-hidden"
      : "flex flex-col h-[60vh] overflow-hidden";

  const defaultEmpty = "No activity yet";
  const empty = emptyMessage ?? defaultEmpty;

  // `min-h-0` is the canonical Tailwind/flexbox fix for `overflow-y-auto`:
  // without it, flex children default to `min-height: auto` (= content
  // height), which prevents the body from being shorter than its content,
  // which prevents the scrollbar from appearing. The eye-button popover
  // (max-h-[70vh] parent) and the popout page (h-full parent) both rely
  // on this so the body scrolls instead of overflowing the chrome.
  // See change: fix-flows-plugin-polish (scrollbar fix).
  const body = (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
      {entries.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)] py-4 text-center">{empty}</div>
      ) : (
        entries.map((entry, i) => {
          switch (entry.kind) {
            case "tool":
              return <ToolCallEntry key={i} entry={entry} index={i} sessionId={sessionId} hideStatusIcon={hideToolStatusIcon} />;
            case "text":
              return <TextEntry key={i} text={entry.text} />;
            case "thinking":
              return <ThinkingEntry key={i} text={entry.text} />;
            case "error":
              return <ErrorEntry key={i} text={entry.text} />;
            default:
              return null;
          }
        })
      )}
      {footer}
    </div>
  );

  return (
    <div className={containerClasses}>
      {header}
      {body}
    </div>
  );
}
