import { type ClaimEntry, CurrentPluginLayer, forToolName } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { mdiAlert, mdiAlertCircle, mdiCheck, mdiChevronDown, mdiChevronRight, mdiHelpCircleOutline, mdiLoading, mdiStop } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { useToolFullResult } from "../../hooks/useToolFullResult.js";
import type { ChatImage } from "../../lib/chat/event-reducer.js";
import { TRUNCATION_MARKER_PREFIX } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSummary } from "../../lib/chat/tool-summary.js";
import { ElapsedBadge } from "../session/ElapsedBadge.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import { getToolRenderer, type ToolContext } from "../tool-renderers/index.js";

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

const statusIcons: Record<string, ReactNode> = {
  running: <Icon path={mdiLoading} size={0.55} spin />,
  complete: <Icon path={mdiCheck} size={0.55} />,
  error: <Icon path={mdiAlertCircle} size={0.55} />,
};

export function ToolCallStep({ toolName, toolCallId, args, status, result, images, context, startedAt, duration, toolDetails, showResultBody = true, hideStatusIcon = false, onAbort, onForceKill }: Props) {
  const isMobile = useMobile();
  const hasImages = images && images.length > 0;
  const isAgentRunning = toolName === "Agent" && status === "running";
  // Supersede heal: this row was finalized locally because its real result was
  // unrecoverable but a later inference proved it finished. Badge it loudly so
  // a real result loss is never mistaken for a silent bodyless success.
  // See change: fix-stuck-tool-card-superseded-heal.
  const isSuperseded = toolDetails?.healedBy === "superseded";
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
        {isSuperseded && (
          <span
            data-testid="tool-superseded-badge"
            className="ml-1 shrink-0 rounded px-1 text-[10px] leading-4 bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            title={i18nT("common.resultNotCapturedRecovered", undefined, "Result not captured — the tool finished but its output was unrecoverable; recovered from the transcript.")}
          >
            {i18nT("common.recovered", undefined, "recovered")}
          </span>
        )}
        {status === "running" && onAbort && stopState === "idle" && (
          <span
            role="button"
            data-testid="tool-stop-button"
            onClick={(e) => { e.stopPropagation(); onAbort(); if (onForceKill) setStopState("aborting"); }}
            className="ml-1 p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-900/30 inline-flex"
            title={i18nT("common.stop", undefined, "Stop")}
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
            title={i18nT("common.forceStopKillTheProcess", undefined, "Force Stop — kill the process")}
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
                  {i18nT("common.collapseOutput", undefined, "Collapse output")}
                </button>
              ) : (
                <button
                  onClick={async () => { await fullResult.fetchFull(); setShowFull(true); }}
                  disabled={fullResult.loading}
                  className="text-[var(--accent)] hover:underline disabled:opacity-50"
                  data-testid="tool-show-full-output"
                >
                  {fullResult.loading ? i18nT("common.loading2", undefined, "Loading…") : i18nT("common.showFullOutput", undefined, "Show full output")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
