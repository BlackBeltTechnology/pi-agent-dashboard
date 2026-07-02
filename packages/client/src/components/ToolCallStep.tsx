import React, { useState, type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiCheck, mdiAlertCircle, mdiChevronRight, mdiChevronDown, mdiStop, mdiAlert, mdiHelpCircleOutline } from "@mdi/js";
import { getToolRenderer, type ToolContext } from "./tool-renderers/index.js";
import type { ChatImage } from "../lib/event-reducer.js";
import { TRUNCATION_MARKER_PREFIX } from "../lib/event-reducer.js";
import { useToolFullResult } from "../hooks/useToolFullResult.js";
import { useMobile } from "../hooks/useMobile.js";
import { ElapsedBadge } from "./ElapsedBadge.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { forToolName, CurrentPluginLayer, type ClaimEntry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { t as i18nT } from "../lib/i18n";

/**
 * Evaluate a `tool-renderer` claim's optional `shouldRender`. Absent or truthy
 * → render. Returns false → fall through. Throws → fail closed (false) + warn.
 * See change: wire-tool-renderer-slot.
 */
function claimShouldRender(claim: ClaimEntry, toolName: string): boolean {
  if (!claim.shouldRender) return true;
  try {
    // tool-renderer claims take no predicate input (SlotPredicateInput = never);
    // some claims read a sync cache. Pass undefined.
    return (claim.shouldRender as (input?: unknown) => boolean)(undefined) !== false;
  } catch (err) {
    console.warn(
      `[tool-renderer] shouldRender threw for plugin "${claim.pluginId}" toolName "${toolName}"; treating as false (fail-closed)`,
      err,
    );
    return false;
  }
}

type StopState = "idle" | "aborting" | "killing";

interface Props {
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: string;
  images?: ChatImage[];
  context: ToolContext;
  startedAt?: number;
  duration?: number;
  toolDetails?: Record<string, unknown>;
  /**
   * When `false`, the tool-result body is omitted but the header (name +
   * status + elapsed) still renders. Defaults to `true` for back-compat.
   * Used by `ChatView` to honour `displayPrefs.toolResults`.
   * `ask_user` is never gated by callers — they always pass `true`.
   * See change: configurable-chat-display.
   */
  showResultBody?: boolean;
  /**
   * When true, the leading status glyph (status/`ask_user` icon) is omitted.
   * Defaults to `false` (icon shown) so the main chat is unchanged; flow agent
   * detail views opt in via MinimalChatView's `hideToolStatusIcon`.
   * See change: improve-flow-ui.
   */
  hideStatusIcon?: boolean;
  onAbort?: () => void;
  onForceKill?: () => void;
}

const toolSummaries: Record<string, (args?: Record<string, unknown>) => string> = {
  read: (args) => `Read ${args?.path ?? "file"}`,
  bash: (args) => `$ ${String(args?.command ?? "")}`,
  edit: (args) => `Edit ${args?.path ?? "file"}`,
  write: (args) => `Write ${args?.path ?? "file"}`,
  grep: (args) => `Grep ${args?.pattern ?? ""}`,
  find: (args) => `Find ${args?.glob ?? ""}`,
  ls: (args) => `ls ${args?.path ?? "."}`,
  ask_user: (args) => `${String(args?.title ?? "ask_user")}`,
  Agent: (args) => `${args?.subagent_type ?? "Agent"}: ${String(args?.description ?? "")}`,
  get_subagent_result: (args) => `Get result: ${String(args?.agent_id ?? "")}`,
  steer_subagent: (args) => `Steer: ${String(args?.agent_id ?? "")}`,
  ctx_execute: (args) => `ctx_execute ${String(args?.language ?? "")}`.trim(),
  ctx_execute_file: (args) => `ctx_execute_file ${String(args?.path ?? "")}`.trim(),
  ctx_batch_execute: (args) => `ctx_batch_execute ${Array.isArray(args?.commands) ? `${args.commands.length} cmds` : ""}`.trim(),
  ctx_search: (args) => `ctx_search ${Array.isArray(args?.queries) ? `${args.queries.length} queries` : ""}`.trim(),
  ctx_index: (args) => `ctx_index ${String(args?.source ?? args?.path ?? "")}`.trim(),
  ctx_fetch_and_index: (args) => `ctx_fetch_and_index ${String(args?.url ?? args?.source ?? "")}`.trim(),
  ctx_insight: () => `ctx_insight`,
};

function getSummary(toolName: string, args?: Record<string, unknown>): string {
  const fn = toolSummaries[toolName];
  if (fn) return fn(args);
  return toolName;
}

const statusIcons: Record<string, ReactNode> = {
  running: <Icon path={mdiLoading} size={0.55} spin />,
  complete: <Icon path={mdiCheck} size={0.55} />,
  error: <Icon path={mdiAlertCircle} size={0.55} />,
};

export function ToolCallStep({ toolName, toolCallId, args, status, result, images, context, startedAt, duration, toolDetails, showResultBody = true, hideStatusIcon = false, onAbort, onForceKill }: Props) {
  const isMobile = useMobile();
  const hasImages = images && images.length > 0;
  const isAgentRunning = toolName === "Agent" && status === "running";
  const isAskUser = toolName === "ask_user";
  const isFailedAskUser = isAskUser && status === "error";
  const [expanded, setExpanded] = useState(hasImages || isAgentRunning || (isAskUser && !isFailedAskUser));
  const [stopState, setStopState] = useState<StopState>("idle");
  const Renderer = getToolRenderer(toolName);

  // Show-full-output affordance: when the rendered result carries the
  // truncation marker, offer an on-demand fetch of the full stored result.
  // Collapse re-shows the truncated form. See change:
  // adopt-pi-071-072-073-features.
  // Only offer "Show full output" when both fetch ids are present — without
  // them useToolFullResult skips the request, so flipping to full-output mode
  // would strand a "Collapse output" control over still-truncated text.
  const isTruncated =
    typeof result === "string" &&
    result.startsWith(TRUNCATION_MARKER_PREFIX) &&
    !!context.sessionId &&
    !!toolCallId;
  const [showFull, setShowFull] = useState(false);
  const fullResult = useToolFullResult(context.sessionId, toolCallId);
  const displayResult = showFull && fullResult.result != null ? fullResult.result : result;

  // Resolution chain: plugin `tool-renderer` claim → built-in registry → Generic.
  // One-shot at lookup time; a chosen plugin renderer that throws is caught by
  // the per-tool ErrorBoundary below (no silent fall-through). When no
  // SlotRegistryProvider is mounted (tests/storybook) the lookup is skipped.
  // See change: wire-tool-renderer-slot.
  const registry = useSlotRegistryOrNull();
  const pluginClaim = React.useMemo<ClaimEntry | null>(() => {
    if (!registry) return null;
    const claims = forToolName(registry.getClaims("tool-renderer"), toolName);
    for (const c of claims) {
      if (claimShouldRender(c, toolName)) return c;
    }
    return null;
  }, [registry, toolName]);
  const PluginComponent = pluginClaim?.Component;

  // Reset stop state when tool finishes
  React.useEffect(() => {
    if (status !== "running") setStopState("idle");
  }, [status]);

  // Live tool results attach images at tool_execution_end, AFTER this card
  // mounted at tool_execution_start — so the useState(hasImages) seed above
  // missed them (replay/refresh seed at mount and are unaffected). Auto-expand
  // once when images first arrive; a ref guards against re-expanding a card the
  // user later collapsed. See change: inline-agent-screenshot-artifacts.
  const autoExpandedForImages = React.useRef(false);
  React.useEffect(() => {
    if (hasImages && !autoExpandedForImages.current) {
      autoExpandedForImages.current = true;
      setExpanded(true);
    }
  }, [hasImages]);

  return (
    <div className={`${isMobile ? "mx-2" : "mx-4"} border-l-2 border-[var(--border-secondary)] pl-3`}>
      <button
        onClick={() => setExpanded(!expanded)}
        title={getSummary(toolName, args)}
        className={`flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] w-full text-left ${isMobile ? "min-h-[44px] py-2" : ""}`}
      >
        {!hideStatusIcon && (
          <span className={`inline-flex ${
            status === "error"
              ? "text-red-400"
              : isAskUser
                ? "text-sky-400"
                : status === "complete"
                  ? "text-green-400"
                  : "text-yellow-400"
          }`}>
            {isAskUser && status !== "error" && status !== "running"
              ? <Icon path={mdiHelpCircleOutline} size={0.55} />
              : statusIcons[status]}
          </span>
        )}
        <span className="truncate">{getSummary(toolName, args)}</span>
        <ElapsedBadge startedAt={startedAt} duration={duration} />
        {status === "running" && onAbort && stopState === "idle" && (
          <span
            role="button"
            data-testid="tool-stop-button"
            onClick={(e) => { e.stopPropagation(); onAbort(); if (onForceKill) setStopState("aborting"); }}
            className="ml-1 p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-900/30 inline-flex"
            title={i18nT("auto.stop", undefined, "Stop")}
          >
            <Icon path={mdiStop} size={0.45} />
          </span>
        )}
        {status === "running" && onForceKill && stopState === "aborting" && (
          <span
            role="button"
            data-testid="tool-force-stop-button"
            onClick={(e) => { e.stopPropagation(); onForceKill(); setStopState("killing"); }}
            className="ml-1 p-0.5 rounded text-orange-400 hover:text-orange-300 hover:bg-orange-900/30 animate-pulse inline-flex"
            title={i18nT("auto.force_stop_kill_the_process", undefined, "Force Stop — kill the process")}
          >
            <Icon path={mdiAlert} size={0.45} />
          </span>
        )}
        <span className="ml-auto text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && showResultBody && (
        <div className="mt-1 ml-4 p-2 bg-[var(--bg-secondary)] rounded-xl shadow-md border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] overflow-x-auto">
          <ErrorBoundary>
            {PluginComponent && pluginClaim ? (
              <CurrentPluginLayer pluginId={pluginClaim.pluginId}>
                <PluginComponent
                  toolName={toolName}
                  toolInput={args ?? {}}
                  sessionId={context.sessionId ?? ""}
                  status={status}
                  result={displayResult}
                  images={images}
                  context={context}
                  toolDetails={toolDetails}
                />
              </CurrentPluginLayer>
            ) : (
              <Renderer
                toolName={toolName}
                args={args}
                status={status}
                result={displayResult}
                images={images}
                context={context}
                toolDetails={toolDetails}
              />
            )}
          </ErrorBoundary>
          {isTruncated && (
            <div className="mt-1">
              {fullResult.error ? (
                <span className="text-[var(--text-muted)] italic" data-testid="tool-result-evicted">{fullResult.error}</span>
              ) : showFull ? (
                <button
                  onClick={() => setShowFull(false)}
                  className="text-[var(--accent)] hover:underline"
                  data-testid="tool-collapse-output"
                >
                  {i18nT("auto.collapse_output", undefined, "Collapse output")}
                </button>
              ) : (
                <button
                  onClick={async () => { await fullResult.fetchFull(); setShowFull(true); }}
                  disabled={fullResult.loading}
                  className="text-[var(--accent)] hover:underline disabled:opacity-50"
                  data-testid="tool-show-full-output"
                >
                  {fullResult.loading ? i18nT("auto.loading", undefined, "Loading…") : i18nT("auto.show_full_output", undefined, "Show full output")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
