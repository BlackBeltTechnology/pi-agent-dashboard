import { type ClaimEntry, CurrentPluginLayer, forToolName, useSlotClaimsVersion, useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { mdiAlertCircle, mdiCheck, mdiChevronDown, mdiChevronRight, mdiClockOutline, mdiHelpCircleOutline, mdiLoading, mdiMinusCircleOutline, mdiStopCircleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { useToolFullResult } from "../../hooks/useToolFullResult.js";
import { CHAT_CUE_CLASS, CHAT_ENTER_CLASS, useCompletionCue, useToolEntering } from "../../lib/chat/chat-motion-context.js";
import type { ChatImage } from "../../lib/chat/event-reducer.js";
import { TRUNCATION_MARKER_PREFIX } from "../../lib/chat/event-reducer.js";
import type { NestedCallState } from "../../lib/chat/nested-tool-calls.js";
import { getSummary } from "../../lib/chat/tool-summary.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import { ElapsedBadge } from "../session/ElapsedBadge.js";
import { getToolRenderer, type ToolContext } from "../tool-renderers/index.js";
import { NestedToolCallList } from "./NestedToolCallList.js";
import { type StopController, ToolStopControl, useToolStopState } from "./ToolStopControl.js";

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

/**
 * Evaluate a `tool-renderer` claim's optional `resultPending` predicate (the
 * "result never reached this browser" badge). Absent → false. Throws → false + warn.
 * See change: decouple-plugins-from-core (design D5 item 7).
 */
function claimResultPending(claim: ClaimEntry | null, toolName: string, toolDetails: Record<string, unknown> | undefined, session: unknown): boolean {
  if (!claim?.resultPending) return false;
  try {
    return claim.resultPending(toolDetails, session) === true;
  } catch (err) {
    console.warn(
      `[tool-renderer] resultPending threw for plugin "${claim.pluginId}" toolName "${toolName}"; treating as false`,
      err,
    );
    return false;
  }
}

/** Row-status override a claim's `rowStatus` may return. */
type ToolRowStatus = NonNullable<ReturnType<NonNullable<ClaimEntry["rowStatus"]>>>;

/** One warning per plugin+hook, so a throwing claim fn cannot flood the console on every render. */
const warnedClaimHooks = new Set<string>();
function warnClaimOnce(claim: ClaimEntry, hook: string, toolName: string, err: unknown): void {
  const key = `${claim.pluginId}:${hook}`;
  if (warnedClaimHooks.has(key)) return;
  warnedClaimHooks.add(key);
  console.warn(`[tool-renderer] ${hook} threw for plugin "${claim.pluginId}" toolName "${toolName}"; ignoring`, err);
}

/** Test seam: forget which claim hooks already warned. */
export function __resetClaimWarningsForTests(): void {
  warnedClaimHooks.clear();
}

/**
 * Evaluate a `tool-renderer` claim's optional `rowStatus` and keep only an
 * override the row's own status allows: `queued` on a running row, `stopped`
 * on a complete row. Error / elided rows are never overridden. Throws →
 * undefined + one warning. See change: subagent-queue-visibility (design D2).
 */
function claimRowStatus(
  claim: ClaimEntry | null,
  toolName: string,
  status: Props["status"],
  toolDetails: Record<string, unknown> | undefined,
  session: unknown,
): ToolRowStatus | undefined {
  if (!claim?.rowStatus) return undefined;
  let rs: ToolRowStatus | undefined;
  try {
    rs = claim.rowStatus(toolDetails, session);
  } catch (err) {
    warnClaimOnce(claim, "rowStatus", toolName, err);
    return undefined;
  }
  if (rs?.state === "queued" && status === "running") return rs;
  if (rs?.state === "stopped" && status === "complete") return rs;
  return undefined;
}

/**
 * Put a claim's per-row `stop` in front of the existing stop path (own abort or
 * enclosing burst controller). `true` consumes the click; `false` / a throw
 * fall through to the existing path. See change: subagent-queue-visibility (D2).
 * A consumed click calls `onConsumed` (the row expands so the claim's own
 * feedback is visible). See change: drop-subagent-card-stop-button (D3).
 */
function withClaimStop(
  base: StopController | null,
  claim: ClaimEntry | null,
  toolName: string,
  input: { sessionId: string | undefined; toolCallId: string; toolDetails: Record<string, unknown> | undefined },
  onConsumed: () => void,
): StopController | null {
  const claimStop = claim?.stop;
  if (!base || !claim || !claimStop) return base;
  return {
    ...base,
    stop: () => {
      if (base.state === "idle") {
        try {
          if (claimStop(input) === true) {
            onConsumed();
            return;
          }
        } catch (err) {
          warnClaimOnce(claim, "stop", toolName, err);
        }
      }
      base.stop();
    },
  };
}

/** Claim-supplied accessible label for the row stop. Throws/absent → undefined. */
function claimStopLabel(claim: ClaimEntry | null, toolName: string, toolDetails: Record<string, unknown> | undefined): string | undefined {
  if (!claim?.stopLabel) return undefined;
  try {
    const label = claim.stopLabel(toolDetails);
    return typeof label === "string" && label ? label : undefined;
  } catch (err) {
    warnClaimOnce(claim, "stopLabel", toolName, err);
    return undefined;
  }
}

interface Props {
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
  /**
   * `elided` = the result is not loadable (a backfill segment orphaned this
   * call). Terminal and neutral: no spinner, no error styling.
   * See change: fix-lazy-history-backfill-ux (D5).
   */
  status: "running" | "complete" | "error" | "elided";
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
  /**
   * Shared stop state owned by an enclosing `ToolBurstGroup`. When given, it
   * wins over this row's own `onAbort`/`onForceKill`.
   * See change: fix-chat-burst-tool-stop.
   */
  stopController?: StopController | null;
  /** Nested calls this tool made (codemode). See change: render-nested-tool-calls. */
  nested?: NestedCallState[];
  /** `false` when pi's nested-call record is incomplete. */
  nestedComplete?: boolean;
  /**
   * The row is rendered inside a group that is itself entering in this commit:
   * the group's entry covers it, so the row must not animate a second time.
   * See change: add-fluid-chat-motion (D2).
   */
  enterSuppressed?: boolean;
}

const statusIcons: Record<string, ReactNode> = {
  running: <Icon path={mdiLoading} size={0.55} spin />,
  complete: <Icon path={mdiCheck} size={0.55} />,
  error: <Icon path={mdiAlertCircle} size={0.55} />,
  // Neutral, static, non-error. See change: fix-lazy-history-backfill-ux (D5).
  elided: <Icon path={mdiMinusCircleOutline} size={0.55} />,
};

export function ToolCallStep({ toolName, toolCallId, args, status, result, images, context, startedAt, duration, toolDetails, showResultBody = true, hideStatusIcon = false, onAbort, onForceKill, stopController, nested, nestedComplete, enterSuppressed = false }: Props) {
  const isMobile = useMobile();
  // Live-arrival entry + in-instance completion cue (both inert unless ChatView
  // supplies a ChatMotionContext). See change: add-fluid-chat-motion.
  const entering = useToolEntering(toolCallId) && !enterSuppressed;
  const completionCue = useCompletionCue(status);
  const hasImages = images && images.length > 0;
  // Supersede heal: this row was finalized locally because its real result was
  // unrecoverable but a later inference proved it finished. Badge it loudly so
  // a real result loss is never mistaken for a silent bodyless success.
  // See change: fix-stuck-tool-card-superseded-heal.
  const isSuperseded = toolDetails?.healedBy === "superseded";
  // Eviction heal: the server vouched the real end was trimmed from its store.
  // See change: distinguish-tool-result-pending-vs-gone (D4).
  const isEvicted = toolDetails?.healedBy === "result_evicted";
  const isAskUser = toolName === "ask_user";
  const isFailedAskUser = isAskUser && status === "error";

  // Resolution chain: plugin `tool-renderer` claim → built-in registry → Generic.
  // One-shot at lookup time; a chosen plugin renderer that throws is caught by
  // the per-tool ErrorBoundary below (no silent fall-through). When no
  // SlotRegistryProvider is mounted (tests/storybook) the lookup is skipped.
  // Resolved BEFORE the expand state: the claim's `expandWhileRunning` seeds it.
  // See change: wire-tool-renderer-slot, decouple-plugins-from-core.
  // `claimsVersion` is a memo dep: a runtime plugin registering a late `tool-renderer` claim
  // bumps it, so an already-mounted Generic row re-resolves (unchanged version → reuse).
  const claimsVersion = useSlotClaimsVersion();
  const registry = useSlotRegistryOrNull();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `claimsVersion` is an invalidation key, not a value read inside
  const pluginClaim = React.useMemo<ClaimEntry | null>(() => {
    if (!registry) return null;
    const claims = forToolName(registry.getClaims("tool-renderer"), toolName);
    for (const c of claims) {
      if (claimShouldRender(c, toolName)) return c;
    }
    return null;
  }, [registry, toolName, claimsVersion]);
  const PluginComponent = pluginClaim?.Component;
  // The claim, not the shell, says a running row starts expanded and when its
  // result never arrived (the plugin owns both notions).
  const expandsWhileRunning = pluginClaim?.expandWhileRunning === true && status === "running";
  const resultNotReceived = claimResultPending(pluginClaim, toolName, toolDetails, context.session);
  const [expanded, setExpanded] = useState(hasImages || expandsWhileRunning || (isAskUser && !isFailedAskUser) || toolName === "canvas");
  // Hook always called (rules of hooks); inactive when a burst controller is supplied.
  const ownStop = useToolStopState({ active: status === "running" && !stopController, onAbort, onForceKill });
  const stop = withClaimStop(stopController ?? ownStop, pluginClaim, toolName, { sessionId: context.sessionId, toolCallId, toolDetails }, () => setExpanded(true));
  const stopLabel = claimStopLabel(pluginClaim, toolName, toolDetails);
  const rowStatus = claimRowStatus(pluginClaim, toolName, status, toolDetails, context.session);
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

  // Live tool results attach images at tool_execution_end, AFTER this card
  // mounted at tool_execution_start — so the useState(hasImages) seed above
  // missed them (replay/refresh seed at mount and are unaffected). Auto-expand
  // once when images first arrive; a ref guards against re-expanding a card the
  // user later collapsed. See change: inline-agent-screenshot-artifacts.
  // A plugin re-enabled (or a claim registered late) while the row is still running: the
  // `useState` seed above ran without the claim, so expand once when `expandWhileRunning`
  // first becomes true. The ref makes it one-shot: a later user collapse sticks.
  const autoExpandedForClaim = React.useRef(expandsWhileRunning);
  React.useEffect(() => {
    if (expandsWhileRunning && !autoExpandedForClaim.current) {
      autoExpandedForClaim.current = true;
      setExpanded(true);
    }
  }, [expandsWhileRunning]);
  const autoExpandedForImages = React.useRef(false);
  React.useEffect(() => {
    if (hasImages && !autoExpandedForImages.current) {
      autoExpandedForImages.current = true;
      setExpanded(true);
    }
  }, [hasImages]);

  return (
    <div data-testid="tool-call-step" data-tool-name={toolName} className={`${isMobile ? "mx-2" : "mx-4"} border-l-2 border-[var(--border-secondary)] pl-3${entering ? ` ${CHAT_ENTER_CLASS}` : ""}`}>
      <div className="flex items-center">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        title={getSummary(toolName, args)}
        className={`flex-1 min-w-0 flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] text-left ${isMobile ? "min-h-[44px] py-2" : ""}`}
      >
        {!hideStatusIcon && (
          <span data-testid={rowStatus ? `tool-row-status-${rowStatus.state}` : undefined} className={`inline-flex ${
            rowStatus
              ? "text-[var(--text-muted)]"
              : status === "error"
              ? "text-[var(--severity-error-fg)]"
              : status === "elided"
                ? "text-[var(--text-muted)]"
                : isAskUser
                  ? "text-sky-400"
                  : status === "complete"
                    ? "text-green-400"
                    : "text-yellow-400"
          }`}>
            {(() => {
              const icon = rowStatus
                ? <Icon path={rowStatus.state === "queued" ? mdiClockOutline : mdiStopCircleOutline} size={0.55} />
                : isAskUser && status !== "error" && status !== "running" && status !== "elided"
                  ? <Icon path={mdiHelpCircleOutline} size={0.55} />
                  : statusIcons[status];
              // Completion cue: a freshly mounted, keyed wrapper so @starting-style
              // plays on the running→done/error flip only. No height transition.
              return completionCue
                ? <span key={status} data-testid="tool-completion-cue" className={`inline-flex ${CHAT_CUE_CLASS}`}>{icon}</span>
                : icon;
            })()}
          </span>
        )}
        <span className="truncate">{getSummary(toolName, args)}</span>
        {rowStatus?.state === "queued" ? (
          // A queued call has not run yet: its elapsed time since the call IS the
          // wait, so the counter stays (marked as wait) next to the waiting glyph.
          <span data-testid="tool-row-wait-time" className="inline-flex">
            <ElapsedBadge startedAt={startedAt} duration={duration} />
          </span>
        ) : (
          <ElapsedBadge startedAt={startedAt} duration={duration} />
        )}
        {rowStatus?.label && (
          <span data-testid="tool-row-status-label" className="ml-1 shrink-0 text-[10px] text-[var(--text-muted)]">
            {rowStatus.label}
          </span>
        )}
        {isSuperseded && (
          <span
            data-testid="tool-superseded-badge"
            className="ml-1 shrink-0 rounded px-1 text-[10px] leading-4 bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            title={i18nT("common.resultNotCapturedRecovered", undefined, "Result not captured — the tool finished but its output was unrecoverable; recovered from the transcript.")}
          >
            {i18nT("common.recovered", undefined, "recovered")}
          </span>
        )}
        {resultNotReceived && (
          <span
            data-testid="tool-recovered-badge"
            className="ml-1 shrink-0 rounded px-1 text-[10px] leading-4 bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            title={i18nT("chat.tool.subagentResultNotReceived", undefined, "Result not received — the subagent stopped but its result never reached this browser.")}
          >
            {i18nT("common.recovered", undefined, "recovered")}
          </span>
        )}
        {isEvicted && (
          <span
            data-testid="tool-evicted-badge"
            className="ml-1 shrink-0 rounded px-1 text-[10px] leading-4 bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            title={i18nT("chat.tool.evictedHint", undefined, "Result not captured — the tool finished, but the server no longer holds its output.")}
          >
            {i18nT("chat.tool.evicted", undefined, "result evicted")}
          </span>
        )}
        {status === "elided" && (
          <span
            data-testid="tool-elided-badge"
            className="ml-1 shrink-0 rounded px-1 text-[10px] leading-4 bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
            title={i18nT("chat.tool.elidedHint", undefined, "This tool's result is outside the loaded history and cannot be loaded.")}
          >
            {i18nT("chat.tool.elided", undefined, "result not loaded")}
          </span>
        )}
        <span className="ml-auto text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {status === "running" && <ToolStopControl controller={stop} testIdPrefix="tool" idleLabel={stopLabel} />}
      </div>
      {((nested && nested.length > 0) || nestedComplete === false) && (
        <NestedToolCallList rootId={toolCallId} nested={nested ?? []} complete={nestedComplete} sessionId={context.sessionId} />
      )}
      {expanded && showResultBody && (
        <div className={`mt-1 ml-4 p-2 bg-[var(--bg-secondary)] rounded-xl shadow-md border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] overflow-x-auto${completionCue ? ` ${CHAT_ENTER_CLASS}` : ""}`}>
          <ErrorBoundary>
            {PluginComponent && pluginClaim ? (
              <React.Suspense fallback={null}>
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
              </React.Suspense>
            ) : (
              <Renderer
                toolName={toolName}
                toolCallId={toolCallId}
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
                  className="text-[var(--accent-text)] hover:underline"
                  data-testid="tool-collapse-output"
                >
                  {i18nT("common.collapseOutput", undefined, "Collapse output")}
                </button>
              ) : (
                <button
                  onClick={async () => { await fullResult.fetchFull(); setShowFull(true); }}
                  disabled={fullResult.loading}
                  className="text-[var(--accent-text)] hover:underline disabled:opacity-50"
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
