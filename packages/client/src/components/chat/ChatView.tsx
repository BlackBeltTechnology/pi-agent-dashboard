import { isWidgetBarPrompt } from "@blackbelt-technology/dashboard-plugin-runtime";
import { EmptyState } from "@blackbelt-technology/pi-dashboard-client-utils/EmptyState";
import { Skeleton } from "@blackbelt-technology/pi-dashboard-client-utils/Skeleton";
import {
  isNotifyRowVisible,
  toolCallPrefKey,
} from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { mdiAlertCircleOutline, mdiCheck, mdiChevronDown, mdiChevronUp, mdiClose, mdiContentCopy, mdiLoading, mdiSourceFork, mdiTextBox } from "@mdi/js";
import { Icon } from "@mdi/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useActiveChatSelection } from "../../hooks/useActiveChatSelection.js";
import { isDebugTool } from "../../hooks/useDebugToolsVisible.js";
import { useDisplayPrefs } from "../../hooks/useDisplayPrefs.js";
import { useFxVisibility } from "../../hooks/useFxVisibility.js";
import { useMobile } from "../../hooks/useMobile.js";
import { attachmentOriginalUrl } from "../../lib/chat/attachment-original-url.js";
import { buildSelectionClipboardText } from "../../lib/chat/chat-selection-copy.js";
import { buildTurnToFirstRowIndex, computeRowTextChars, estimateVirtualRowSize, extendRangeWithSelection, isBurst, isGroup, rangeToRowIndexSpan, type SelectionRowSpan, virtualRowKey } from "../../lib/chat/chat-virtual-rows.js";
import { findActiveInteractiveToolResultIds, findRetriedErrorIds, findSurfaceSuppressedErrorIds } from "../../lib/chat/collapse-retried-errors.js";
// RetryBanner + ErrorBanner replaced by the unified SessionBanner mounted
// in App.tsx (sticky above the command input). See change:
// unify-status-banner-and-terminal-limit-stop.
import type { ChatImage, InteractiveUiRequest, SessionState } from "../../lib/chat/event-reducer.js";
import { type BurstItem, groupToolBursts, type ToolBurstGroup as ToolBurstGroupData } from "../../lib/chat/group-tool-bursts.js";
import type { ToolCallGroup } from "../../lib/chat/group-tool-calls.js";
import {
  type HistoryGapState,
  HISTORY_GAP_ROW_ID,
  isHeadFree,
  SETTLE_MS,
  shouldAutoLoadHistory,
} from "../../lib/chat/history-gap.js";
import { computeAnchorCorrection } from "../../lib/chat/selection-anchor.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { REPLAY_PILL_DELAY_MS } from "../../lib/replay/loading-history.js";
import { formatMessageTime } from "../../lib/util/format.js";
import { buildTurnSummaries, type TurnSummary } from "../../lib/util/lineDelta.js";
import { isOutOfCwd, normalizeUnderCwd } from "../../lib/util/normalize-path.js";
import { ChangeSummaryBlock } from "../diff/ChangeSummaryBlock.js";
import { getInteractiveRenderer } from "../interactive-renderers/registry.js";
import { derivePendingFreeFloating } from "../../lib/chat/pending-free-floating.js";
import { MultiAskPanel } from "./MultiAskPanel.js";
import { FilePreviewHost, FilePreviewProvider } from "../preview/FilePreviewContext.js";
import { ImageLightbox } from "../preview/ImageLightbox.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { RetriedErrorBadge } from "../session/RetriedErrorBadge.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { InlineTerminalCard } from "../terminal/InlineTerminalCard.js";
import type { ToolContext } from "../tool-renderers/index.js";
import { withDefaultFileLink } from "../tool-renderers/make-tool-context.js";
import { BashOutputCard } from "./BashOutputCard.js";
import { CollapsedToolGroup } from "./CollapsedToolGroup.js";
import { CommandFeedbackCard } from "./CommandFeedbackCard.js";
import { HistoryGapDivider } from "./HistoryGapDivider.js";
import { MissingToolInlineError } from "./MissingToolInlineError.js";
import { RawEventCard } from "./RawEventCard.js";
import { CustomEntryCard } from "./CustomEntryCard.js";
import { SkillInvocationCard } from "./SkillInvocationCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolBurstGroup } from "./ToolBurstGroup.js";
import { ToolCallStep } from "./ToolCallStep.js";

interface Props {
  sessionId?: string;
  state: SessionState;
  toolContext: ToolContext;
  // onCancelPending removed — pi exposes no queue-mutation API, so the
  // cancel-pending callback was always a shadow-only lie. See change:
  // honest-mid-turn-queue-surface.
  onRespondToUi?: (requestId: string, result?: unknown, cancelled?: boolean) => void;
  onAbort?: () => void;
  onForceKill?: () => void;
  onForkFromMessage?: (entryId: string) => void;
  /**
   * Close a live inline terminal card (sends close_inline_terminal). The
   * parent binds the owning sessionId. See change: add-inline-terminal-card.
   */
  onCloseInlineTerminal?: (terminalId: string) => void;
  // onDismissError / onRetryAfterError moved to App.tsx → SessionBanner.
  // See change: unify-status-banner-and-terminal-limit-stop.
  /**
   * Pending steer messages from `Session.pendingQueues.steering`. Rendered
   * inline at the bottom of the chat list as user-style bubbles with a
   * "STEERING" header + spinner + ✕ cancel. Once pi drains them on
   * `turn_end`, the bridge clears the shadow and the chat naturally shows
   * the real user message via `message_end`. See change: add-followup-edit-and-steer-cancel.
   */
  pendingSteering?: string[];
  /**
   * Selected session's "history loading" flag. When true and the chat is
   * empty, render a loading indicator instead of the "No messages yet"
   * placeholder — distinguishes history-in-flight from a genuinely empty
   * session. See change: show-chat-history-loading-indicator.
   */
  loadingHistory?: boolean;
  /**
   * Selected session's "replay in flight" flag. Unlike `loadingHistory` it
   * stays true until the TERMINAL replay batch lands, so it covers the window
   * where partial history is already painted but the transcript is still
   * filling in. Renders an indeterminate pill after `REPLAY_PILL_DELAY_MS`.
   * See change: show-replay-in-flight-indicator.
   */
  replayInFlight?: boolean;
  /**
   * Selected session's windowed-replay gap, when its replay was bounded by
   * `maxReplayEvents`. Drives the interstitial gap divider.
   * See change: lazy-load-session-history.
   */
  historyGap?: HistoryGapState;
  /** Request the gap slice adjacent to the TAIL. See change: fix-lazy-history-backfill-ux (D2). */
  onLoadEarlier?: () => void;
  /**
   * Bumped once per successful backfill splice. Keys the splice-commit
   * suppression latch — deliberately not `messages.length`, which a live event
   * also changes and which the final splice can leave unchanged.
   * See change: fix-lazy-history-backfill-ux (D6).
   */
  historySpliceRev?: number;
  /**
   * Client-only signal: the user manually collapsed the LIVE streaming
   * reasoning block. Sets `streamingThinkingCollapsed` on the session state so
   * the collapse survives the streaming→committed swap (committed block stays
   * collapsed, no hold-open timer). No server round-trip.
   * See change: reasoning-auto-collapse-timer.
   */
  onCollapseStreamingThinking?: () => void;
  // onCancelSteering / onCancelPending omitted: pi exposes no queue-mutation
  // API. Steering bubbles render display-only; cancellation requires upstream
  // pi support (tracked separately). See change: honest-mid-turn-queue-surface.
  /**
   * Send the per-session display-prefs override. Optional — omit when the
   * menu should not render (e.g. archived/dataUnavailable views).
   * See change: configurable-chat-display.
   */
  /** Current sparse override for the session, or `undefined`. */
}

function ImageAttachments({
  images,
  onImageLoad,
  sessionId,
}: {
  images: ChatImage[];
  /** Owning session — scopes the full-resolution originals request. */
  sessionId?: string;
  /**
   * Fired when an attached `<img>` finishes decoding. In the virtualized
   * transcript the owning row is first measured pre-decode (img ~0px); this
   * signal lets ChatView re-measure the row at its true post-decode height so
   * the message cannot stay collapsed and overlap its neighbour (issue #267).
   */
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}) {
  const [lightboxSrc, setLightboxSrc] = useState<
    { src: string; alt: string; fallbackSrc?: string } | null
  >(null);
  // Track decoded images so the reserved loading box is dropped once the real
  // intrinsic size is known (a bounded box avoids the near-zero pre-decode
  // measurement without distorting small decoded images).
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
  return (
    <>
      <div className="flex gap-2 flex-wrap mb-2">
        {images.map((img, i) => {
          // Two-phase attachment render: the row is delivered before its fitted
          // image exists, so a block may be pending (no bytes yet) or failed.
          // Rendering a data URL for those would show a broken-image glyph.
          // See change: fit-attachments-for-display (D3/D12, test-plan #F1 #F3).
          if (img.attachmentState === "pending") {
            return (
              <div
                key={i}
                data-testid="attachment-pending"
                // `aria-label` on a roleless generic is ignored by assistive
                // tech. `role="img"` makes this stand-in for the image expose
                // its name, matching the real <img> it will become.
                role="img"
                className="min-w-[80px] min-h-[80px] w-[120px] h-[80px] rounded border border-white/20 bg-white/5 animate-pulse flex items-center justify-center text-[10px] text-white/40"
                aria-label={`Attachment ${i + 1} loading`}
              >
                loading
              </div>
            );
          }
          if (img.attachmentState === "failed") {
            return (
              <div
                key={i}
                data-testid="attachment-failed"
                className="min-w-[80px] min-h-[80px] w-[120px] h-[80px] rounded border border-red-500/40 bg-red-500/5 flex items-center justify-center text-[10px] text-red-300/70 text-center px-1"
                role="img"
                aria-label={`Attachment ${i + 1} failed to load`}
              >
                image unavailable
              </div>
            );
          }
          const src = `data:${img.mimeType};base64,${img.data}`;
          const reserve = !loaded.has(i) ? "min-w-[80px] min-h-[80px]" : "";
          return (
            // A real <button>, not a click handler on the <img>: zoom is the
            // ONLY route to the full-resolution original, and a bare img is
            // mouse-only — no tab stop, no Enter/Space, nothing for a screen
            // reader to announce. A native button gets all three from the user
            // agent, so there is no hand-rolled key handling to keep correct.
            <button
              key={i}
              type="button"
              aria-label={`Zoom attachment ${i + 1}`}
              className="p-0 border-0 bg-transparent cursor-pointer leading-none"
              onClick={() => {
                // Zoom shows the ORIGINAL when one is recoverable; the inline
                // image is only a 768 px display derivative. Falls back to that
                // derivative if the original cannot be served, so a failure
                // degrades the zoom alone (test-plan #F5 #F6).
                const original = attachmentOriginalUrl(sessionId, img.attachmentId);
                setLightboxSrc({
                  src: original ?? src,
                  alt: `Attachment ${i + 1}`,
                  fallbackSrc: original ? src : undefined,
                });
              }}
            >
              <img
                src={src}
                data-testid="attachment-image"
                // Empty alt on purpose: the button above already carries the
                // accessible name, so a described img would make AT announce
                // the same control twice.
                alt=""
                className={`max-w-[300px] max-h-[300px] ${reserve} rounded border border-white/20 object-contain`}
                onLoad={(e) => {
                  setLoaded((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
                  onImageLoad?.(e);
                }}
              />
            </button>
          );
        })}
      </div>
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          alt={lightboxSrc.alt}
          fallbackSrc={lightboxSrc.fallbackSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}

/**
 * Inline badge on a user bubble showing how pi delivered the message when it
 * arrived mid-stream (pi 0.77+ `InputEvent.streamingBehavior`). "steer" =
 * interrupted the current turn; "followUp" = queued for after it. Absent for
 * idle / non-interactive inputs. See change: surface-input-streaming-behavior.
 */
function StreamingBehaviorBadge({ behavior }: { behavior: "steer" | "followUp" }) {
  const isSteer = behavior === "steer";
  return (
    <span
      className="inline-flex items-center self-end mb-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300/80"
      title={
        isSteer
          ? "Interrupted and steered the current turn"
          : "Queued — delivered after the current turn ends"
      }
    >
      {isSteer ? "steered" : "queued"}
    </span>
  );
}

function MessageBubble({ content, className, timestamp, entryId, onFork, context }: { content: string; className: string; timestamp?: number; entryId?: string; onFork?: (entryId: string) => void; context?: ToolContext }) {
  const contentRef = useRef<HTMLDivElement>(null);

  const getPlainText = useCallback(() => {
    return contentRef.current?.innerText ?? content;
  }, [content]);

  return (
    <div className={className}>
      <div ref={contentRef}>
        <MarkdownContent content={content} context={context} />
      </div>
      <div className="border-t border-[var(--border-secondary)] mt-2 pt-1.5 flex justify-end items-center gap-0.5 opacity-50 hover:opacity-100 transition-opacity">
        {timestamp != null && (
          <span className="text-[10px] text-[var(--text-tertiary)] mr-auto">{formatMessageTime(timestamp)}</span>
        )}
        <CopyButton getText={() => content} icon={<Icon path={mdiContentCopy} size={0.6} />} title={i18nT("common.copyAsMarkdown", undefined, "Copy as Markdown")} />
        <CopyButton getText={getPlainText} icon={<Icon path={mdiTextBox} size={0.6} />} title={i18nT("common.copyAsPlainText", undefined, "Copy as plain text")} />
        {entryId && onFork && (
          <button
            onClick={() => onFork(entryId)}
            title={i18nT("session.forkFromHere", undefined, "Fork from here")}
            className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
          >
            <Icon path={mdiSourceFork} size={0.6} />
          </button>
        )}
      </div>
    </div>
  );
}

function InteractiveUiCard({ request, onRespondToUi }: {
  request: InteractiveUiRequest;
  onRespondToUi?: (requestId: string, result?: unknown, cancelled?: boolean) => void;
}) {
  const Renderer = getInteractiveRenderer(request.method);
  return (
    <Renderer
      requestId={request.requestId}
      method={request.method}
      params={request.params}
      status={request.status}
      result={request.result}
      onRespond={(result) => onRespondToUi?.(request.requestId, result)}
      onCancel={() => onRespondToUi?.(request.requestId, undefined, true)}
    />
  );
}

/** Check if markdown content contains a mermaid code block */
function hasMermaid(content: string): boolean {
  return /```mermaid\b/.test(content);
}

const SCROLL_THRESHOLD = 50;

// Retained-row ceiling for an active selection (change:
// preserve-chat-selection-during-churn, D3). The `rangeExtractor` keeps up to
// this many selection-intersecting rows mounted; past it the view actively
// clears the selection rather than force-mounting the span. Device-aware: rows
// carry heavy subtrees (Prism/xterm/mermaid/SubagentDetailView) + one
// ResizeObserver each, so mobile drag stays bounded lower. Coarse interim
// units pending a measured pixel/node budget.
const SELECTION_RETAIN_CAP_DESKTOP = 100;
const SELECTION_RETAIN_CAP_MOBILE = 40;

// Per-session scroll state, persisted across session switches
const scrollStateMap = new Map<string, { anchorRowId: string | null; offset: number; nearBottom: boolean }>();

export interface ChatViewHandle {
  scrollToTurn: (turnIndex: number) => void;
}

const ChatViewInner = forwardRef<ChatViewHandle, Props>(function ChatView({ sessionId, state, toolContext: suppliedToolContext, onRespondToUi, onAbort, onForceKill, onForkFromMessage, onCloseInlineTerminal, pendingSteering, loadingHistory, replayInFlight, historyGap, onLoadEarlier, historySpliceRev, onCollapseStreamingThinking }, ref) {
  // `ToolContext` is a published surface (re-exported from `chat-embed`), so an
  // external embedder builds one by hand and would carry no `fileLink` —
  // silently losing file-mention linkification with no type error. Merge a
  // default here, ONCE, and pass the merged value to every consumer below.
  //
  // `useMemo` is required, not cosmetic: `MarkdownContent` is `React.memo`'d, so
  // an inline merge would hand it a fresh `context` reference on every render
  // and defeat the memo. See change: cleanup-import-cycles (D4b).
  const toolContext = useMemo(() => withDefaultFileLink(suppliedToolContext), [suppliedToolContext]);
  // Show-delay for the replay-in-flight pill: paint only once the flag has
  // been true for REPLAY_PILL_DELAY_MS, so a fast replay never flashes an
  // indicator. Deliberately NOT conditioned on replay-cache state.
  // See change: show-replay-in-flight-indicator.
  //
  // The visible bit stores the SESSION the pill belongs to, not a bare boolean.
  // `<ChatView>` is rendered without a `key` and is React.memo'd, so the
  // instance is reused across session switches, and an effect-based reset runs
  // only AFTER the new session's first render — session B would briefly paint
  // A's pill. Requiring `pillForSession === sessionId` AT RENDER TIME closes
  // that frame without reaching for `useLayoutEffect`.
  const [pillForSession, setPillForSession] = useState<string | null>(null);
  // `sessionId` is optional on the published embed surface; an undefined id can
  // never match a recorded one, so the pill stays down for it.
  const showReplayPill = pillForSession !== null && pillForSession === sessionId;
  const replayPillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!replayInFlight) {
      // Cancel a pending timer AND reset the visible bit: a replay that
      // resolves at 250ms must not leave a timer that paints the pill after.
      if (replayPillTimerRef.current) {
        clearTimeout(replayPillTimerRef.current);
        replayPillTimerRef.current = null;
      }
      setPillForSession(null);
      return;
    }
    replayPillTimerRef.current = setTimeout(() => {
      replayPillTimerRef.current = null;
      setPillForSession(sessionId ?? null);
    }, REPLAY_PILL_DELAY_MS);
    return () => {
      if (replayPillTimerRef.current) {
        clearTimeout(replayPillTimerRef.current);
        replayPillTimerRef.current = null;
      }
    };
  }, [replayInFlight, sessionId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * ONE suppression window shared by EVERY programmatic `scrollTop` /
   * `scrollToIndex` writer in this file, rather than a list of per-writer refs.
   *
   * Enumerating the writers is how the previous revision failed: the list grows
   * and each omission is a silent auto-fetch. A writer stamps this immediately
   * before it writes, and the trigger ignores any edge inside the window — one
   * mechanism, closed to future writers by convention.
   * See change: add-tail-only-replay-window (D7).
   */
  const programmaticScrollUntilRef = useRef(0);
  /**
   * Suppress the scroll events a programmatic write is about to emit.
   *
   * `invalidateIntent` splits two genuinely different kinds of write, and the
   * distinction is load-bearing in both directions:
   *
   *  - A JUMP RELOCATES the user (`scrollToBottom`, `scrollToTurn`, restore,
   *    the bottom-pin). Any intent recorded before it is now about a position
   *    the user is no longer at, so it must be dropped. Without that,
   *    `scrollToBottom`'s `behavior: "smooth"` emits scroll events for
   *    300-500ms against a 120ms stamp, so a DOWNWARD scroll latches "asked to
   *    go up" and the next jump that lands `nearTop` fetches unbidden.
   *
   *  - A CORRECTION PRESERVES the user's position (the D7a splice anchor). It
   *    must still suppress its own events, but wiping intent here would eat a
   *    gesture the user really did make: the anchor runs ~20 frames after every
   *    splice, so an invalidating correction silently discards any scroll
   *    started during that window and the walk stalls until they scroll again.
   *
   * Callers that ARE intent (`scrollToTop`) must stamp FIRST, then set the flag.
   * See change: add-tail-only-replay-window (D7).
   */
  const stampProgrammaticScroll = useCallback((invalidateIntent = true) => {
    programmaticScrollUntilRef.current = Date.now() + SETTLE_MS;
    if (invalidateIntent) pendingUserIntentRef.current = false;
  }, []);
  /**
   * The user has asked to go UP since the last request. Tracks INTENT, not
   * position: `scrollTop` clamps at 0, so a user parked on the loading head
   * produces no further upward delta, and a splice smaller than the proximity
   * band produces no new rising edge either. Cleared on issue, at mount, and on
   * session change. See change: add-tail-only-replay-window (D7).
   */
  const pendingUserIntentRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyGapRef = useRef(historyGap);
  historyGapRef.current = historyGap;

  /**
   * The D7a anchor's target: the first previously-loaded row, plus the viewport
   * `top` it held when the backfill was REQUESTED.
   *
   * Captured at request time because a layout effect cannot supply it — layout
   * effects run after the DOM mutation, so by then the spliced rows are already
   * in place and the row has already moved. `null` when no request is in
   * flight, which is also what makes the anchor fire ONLY for a splice this
   * component asked for.
   *
   * An ELEMENT, deliberately, not a `scrollHeight` delta. A height-delta anchor
   * absorbs ALL growth, including rows below the viewport remeasuring away from
   * their estimates — growth that does not move the reading position and must
   * not be corrected for. Measured directly against the harness: it
   * over-corrected by ~2300px on a 33000px splice. Anchoring on the row states
   * the invariant D7a actually makes ("the first previously-loaded row holds its
   * viewport position") instead of a proxy for it.
   *
   * Element identity is SOUND here because `getItemKey` returns the row's
   * message id, so a row keeps its DOM node across a splice that changes its
   * index. A detached anchor (unmounted by virtualization) stops the correction
   * rather than correcting against a stale rect.
   * See change: add-tail-only-replay-window (D7a).
   */
  const anchorKeyRef = useRef<string | null>(null);
  const anchorTopRef = useRef<number | null>(null);

  /**
   * The first previously-loaded row: the mounted virtual row with the smallest
   * `data-index` STRICTLY BELOW the gap divider's own row. Returns `null` when
   * the divider is not mounted, which is the case where there is nothing to
   * anchor anyway.
   */
  const captureSpliceAnchor = useCallback((): void => {
    const el = scrollRef.current;
    anchorKeyRef.current = null;
    anchorTopRef.current = null;
    if (!el) return;
    const containerTop = el.getBoundingClientRect().top;
    const dividerRow = el
      .querySelector('[data-testid="history-gap-divider"]')
      ?.closest<HTMLElement>("[data-index]");
    if (!dividerRow) return;
    const dividerIndex = Number(dividerRow.dataset.index);
    if (!Number.isFinite(dividerIndex)) return;
    let best: HTMLElement | null = null;
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const node of el.querySelectorAll<HTMLElement>("[data-index]")) {
      const i = Number(node.dataset.index);
      if (Number.isFinite(i) && i > dividerIndex && i < bestIndex) {
        best = node;
        bestIndex = i;
      }
    }
    if (!best?.dataset.rowKey) return;
    anchorKeyRef.current = best.dataset.rowKey;
    // CONTAINER-relative, not viewport-relative: the correction below computes
    // a target `scrollTop` from the row's offset in SCROLL space, and mixing in
    // the container's own viewport position would bake in an unrelated offset.
    anchorTopRef.current = best.getBoundingClientRect().top - containerTop;
  }, []);

  /**
   * Whether the load in flight came from the TRIGGER rather than from the user
   * pressing the affordance.
   *
   * The announcement is scoped to AUTOMATIC loads in a head-free window
   * (F16/F21): a user who pressed "Load earlier" already knows what they asked
   * for, so announcing it is redundant chatter, and a `head-tail` user who
   * never opted into this change must observe nothing new.
   * See change: add-tail-only-replay-window (D6).
   */
  const lastLoadWasAutoRef = useRef(false);
  /** Rows added by the most recent AUTOMATIC splice. `null` announces nothing. */
  const [autoLoadedCount, setAutoLoadedCount] = useState<number | null>(null);
  const messagesLenRef = useRef(state.messages.length);

  const handleLoadEarlier = useCallback(() => {
    // Clearing on ISSUE is what bounds this to one request per expression of
    // intent, for the button and the trigger alike.
    pendingUserIntentRef.current = false;
    lastLoadWasAutoRef.current = false;
    captureSpliceAnchor();
    onLoadEarlier?.();
  }, [onLoadEarlier, captureSpliceAnchor]);

  /** The trigger's issue path: identical, but marks the load automatic. */
  const autoLoadEarlier = useCallback(() => {
    pendingUserIntentRef.current = false;
    lastLoadWasAutoRef.current = true;
    captureSpliceAnchor();
    onLoadEarlier?.();
  }, [onLoadEarlier, captureSpliceAnchor]);

  /**
   * Produce the announcement from the SPLICE, not from the response.
   *
   * The row count is what the user is told about, and it is not the response's
   * event count: a backfilled segment reduces to fewer rows than it carries
   * events (a `message_start`/`update`/`end` trio is one row). Measuring the
   * rendered delta keeps the announced number equal to what actually appeared.
   */
  useEffect(() => {
    const prev = messagesLenRef.current;
    const now = state.messages.length;
    messagesLenRef.current = now;
    const added = now - prev;
    if (added > 0 && lastLoadWasAutoRef.current) {
      lastLoadWasAutoRef.current = false;
      setAutoLoadedCount(added);
    }
  }, [state.messages.length]);

  /**
   * Evaluate the auto-load trigger. Called at the SETTLE timer's expiry and at
   * the suppression window's expiry — never per scroll event: momentum is a
   * stream of scroll events, each restarting the timer, so evaluating at expiry
   * runs this exactly once when inertia stops.
   *
   * A SUPPRESSED evaluation changes NO state — it is deferred, not consumed —
   * and re-schedules itself for when the stamp lapses. That is what makes the
   * scroll-to-top landing deterministic regardless of how many frames the
   * ascent took. See change: add-tail-only-replay-window (D7).
   */
  const evaluateAutoLoad = useCallback(() => {
    const el = scrollRef.current;
    const gap = historyGapRef.current;
    if (!el || !gap) return;
    const now = Date.now();
    const suppressedUntil = programmaticScrollUntilRef.current;
    if (now < suppressedUntil) {
      // Defer: re-evaluate when the stamp lapses, consuming nothing.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(evaluateAutoLoad, suppressedUntil - now + 1);
      return;
    }
    const fire = shouldAutoLoadHistory({
      headFree: isHeadFree(gap),
      nearTop: el.scrollTop <= SCROLL_THRESHOLD,
      pendingUserIntent: pendingUserIntentRef.current,
      suppressed: false,
      armed: gap.armed,
      pending: gap.pending,
      failed: gap.failed,
      unservable: gap.unservable,
      atFloor: gap.atFloor,
    });
    if (fire) autoLoadEarlier();
  }, [autoLoadEarlier]);

  // Intent never survives a mount or a session switch: a restored transcript
  // can land at `scrollTop === 0` with no intent ever recorded, and `nearTop`
  // alone must never fire. See change: add-tail-only-replay-window (D7).
  useEffect(() => {
    pendingUserIntentRef.current = false;
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    };
  }, []);
  useEffect(() => {
    pendingUserIntentRef.current = false;
  }, [sessionId]);
  /**
   * Backfill splice scroll ownership (D6): the correct invariant is ABSOLUTE
   * `scrollTop`, and it needs no correction at all.
   *
   * Events now splice BELOW the divider, and the divider is by definition in
   * the viewport (the user just clicked it), so nothing above the reading
   * position moves. The old distance-to-bottom anchor is not merely
   * unnecessary here, it is WRONG-SIGNED: it would add the full inserted
   * height to `scrollTop` and scroll the divider out of view on every splice.
   * It is deleted rather than made more elaborate.
   *
   * "Leave `scrollTop` alone" is NOT "nothing writes `scrollTop`". Deleting the
   * layout effect removed the only splice-time hook, so the two remaining
   * writers — the virtualizer grow-pin and the selection-anchor compensator —
   * need an explicit owner instead of inheriting the commit by accident. This
   * latch is that owner. It is armed on the splice revision (bumped exactly
   * once per successful splice, and the only signal that survives BOTH a live
   * event arriving mid-flight and the final splice whose net row count is
   * unchanged) and released one frame later, after the virtualizer has
   * measured the spliced rows. Disarming at click would be insufficient:
   * `handleScroll` can re-arm stick-to-bottom mid-flight.
   * See change: fix-lazy-history-backfill-ux (D6).
   */
  const spliceSuppressRef = useRef(false);
  /**
   * D7a — in `tail-only` the reasoning above INVERTS, and the two modes must
   * not share this branch.
   *
   * D6's premise is that events splice BELOW the divider, so nothing above the
   * reading position moves. That holds while the divider is mid-transcript. In
   * `tail-only` the divider is the FIRST row: the spliced rows land between the
   * loading head and everything else, so leaving `scrollTop` alone pins the
   * user to the head while the content they asked for accumulates below — and,
   * because the trigger is rising-edge, proximity never lapses and the walk
   * STALLS.
   *
   * So in this mode the splice preserves the viewport position of the first
   * previously-loaded row: `scrollTop` absorbs the inserted height, the older
   * messages occupy the space above it, and the loading head scrolls out of
   * proximity — which re-arms the rising edge for free, because scrolling up
   * again is what asks for more.
   *
   * APPROXIMATELY, not exactly. With `overflowAnchor: "none"` and a virtualizer
   * whose spliced rows carry ESTIMATED sizes until measured, the height at
   * commit is an estimate. The anchor therefore keeps correcting across
   * subsequent commits until measurement settles, rather than being consumed by
   * one layout pass — the same failure `fix-lazy-history-backfill-ux`
   * diagnosed in the head-first splice. `anchorBaselineRef` holds the
   * `scrollHeight` the last correction was computed against, so each pass
   * corrects only the NEW growth and the corrections telescope instead of
   * compounding.
   *
   * The selection-anchor compensator is deliberately NOT suppressed here: in
   * this mode the rows land ABOVE a held selection and genuinely displace it,
   * which is precisely the case the compensator exists for. Suppressing it (as
   * `head-tail` must) would let the selection slide by the full spliced height.
   * See change: add-tail-only-replay-window (D7a).
   */
  const headFreeGap = !!historyGap && isHeadFree(historyGap);
  const headFreeGapRef = useRef(headFreeGap);
  headFreeGapRef.current = headFreeGap;
  useLayoutEffect(() => {
    if (!historySpliceRev) return;
    const el = scrollRef.current;
    // `head-tail` keeps D6's behaviour verbatim: suppress the other writers for
    // one frame and correct nothing.
    if (!headFreeGapRef.current || !el) {
      spliceSuppressRef.current = true;
      const id = requestAnimationFrame(() => {
        spliceSuppressRef.current = false;
      });
      return () => {
        cancelAnimationFrame(id);
        spliceSuppressRef.current = false;
      };
    }

    /**
     * `tail-only`: hold the captured row at the viewport `top` it had when the
     * slice was requested, and KEEP holding it as the spliced rows remeasure
     * away from their estimates.
     *
     * The grow-pin is suppressed for the first frame (a splice IS content
     * growth, and the pin would otherwise yank to the bottom); the selection
     * compensator is released as soon as this effect's own write has landed,
     * per the docblock above.
     *
     * Correcting on the ROW's rect rather than on `scrollHeight` is what makes
     * this ignore remeasurement BELOW the reading position, which does not move
     * the row and must not be absorbed.
     */
    // `tail-only`: the grow-pin still has to be suppressed for the first frame
    // (a splice IS content growth, and the pin would yank to the bottom), but
    // the CORRECTION itself is owned by `useTailOnlySpliceAnchor` below — it
    // needs the virtualizer, which is not in scope this early in the component.
    // The selection compensator is released immediately, per the docblock.
    spliceSuppressRef.current = true;
    const id = requestAnimationFrame(() => {
      spliceSuppressRef.current = false;
    });
    return () => {
      cancelAnimationFrame(id);
      spliceSuppressRef.current = false;
    };
  }, [historySpliceRev]);
  // True when the user wants the chat to chase new content. Flips to false on
  // any real scroll-up gesture, on explicit navigation (scrollToTurn), and on
  // session restore when the saved position was away from the bottom. Re-arms
  // when the user clicks the scroll-to-bottom button or scrolls back to the end.
  const stickToBottomRef = useRef(true);
  // Last observed scroll height, used to distinguish content growth (legit
  // re-pin) from a user scroll (must NOT re-pin) in the virtualizer onChange.
  const lastScrollHeightRef = useRef(0);
  // True while a scroll-to-bottom descent is in flight. Under virtualization
  // the below-viewport rows are ESTIMATED; as the smooth scroll descends they
  // mount + measure and scrollHeight grows past the click-time target, so the
  // intermediate scroll events see nearBottom=false. Without this latch those
  // events cleared stickToBottomRef and the descent stalled short — the button
  // had to be clicked repeatedly. The latch holds the pin until arrival and is
  // cancelled by real user input (wheel / touch). See change:
  // virtualize-chat-transcript-tanstack (scroll-to-bottom regression fix).
  const descendingRef = useRef(false);
  // True while a scroll-to-TOP ascent is in flight (Decision 3, change:
  // fix-chat-scroll-to-top-estimate-drift). `scrollToIndex(0)` is BOUNDED
  // (maxAttempts=10) and a late async image-load remeasure can bump the view
  // off index 0 after the retries exhaust; this latch (a) re-issues
  // scrollToIndex(0) from `onChange` when a measurement grows the total size,
  // and (b) stops `handleScroll` re-arming the bottom-pin mid-flight (the
  // re-arm race: starting the ascent from the bottom would otherwise flip
  // stickToBottomRef back to true and yank the view down). Cleared on arrival
  // at the top or on real user input (wheel / touch), mirroring descendingRef.
  const ascendingRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollTopButton, setShowScrollTopButton] = useState(false);
  // Streaming-tail selection preservation (change: preserve-streaming-tail-selection).
  // While a selection is anchored inside the live tail, the tail renders from
  // this frozen snapshot instead of the growing `state.streamingText`, so
  // MarkdownContent's memo skips re-rendering and the committed Text nodes under
  // the selection are never replaced on a chunk append. The snapshot is held
  // across `message_end` too (the committed twin is hidden — see displayRows)
  // so the anchored node is not detached at turn completion. Cleared on the
  // selection's collapse → the tail flushes to the latest streamed text.
  const tailContainerRef = useRef<HTMLDivElement>(null);
  const [frozenTailText, setFrozenTailText] = useState<string | null>(null);
  const frozenTailTextRef = useRef<string | null>(null);
  // Mirror of the live streamingText read by the freeze effect (keyed on
  // isSelecting only) so per-chunk changes do not re-run the snapshot.
  const streamingTextRef = useRef("");
  streamingTextRef.current = state.streamingText;
  // Effective display prefs for this session (configurable-chat-display).
  const prefs = useDisplayPrefs(sessionId);
  const showDebugTools = prefs.debugTools;

  // Per-turn change-summary blocks (change: add-change-summary-table). Derived
  // client-side from the raw (unfiltered) Edit/Write events so counts are
  // independent of tool-call display filters; gated on the `changeSummaryTable`
  // display pref. Memoized on message identity (performance-optimization).
  const splitWs = useOptionalSplitWorkspace();
  const cwd = splitWs?.cwd;
  // Normalize an absolute-under-cwd path to the relative-posix key the
  // server's session-diff endpoint uses, so the diff tab resolves the file
  // instead of blanking. See change: fix-session-diff-open-nongit-and-preview.
  const openDiffFile = useCallback(
    (path: string) => splitWs?.openDiffTab(normalizeUnderCwd(path, cwd)),
    [splitWs, cwd],
  );
  const turnSummaries = useMemo(() => {
    if (!prefs.changeSummaryTable) return [];
    const raw = buildTurnSummaries(state.messages);
    // Normalize file paths at the source so the displayed row and the
    // diff-open lookup share the relative key and can never diverge. Files this
    // session wrote OUTSIDE cwd are suppressed unless the opt-in pref is on
    // (opt-in-out-of-cwd-session-diffs); totals recompute over the kept files.
    return raw.map((s) => {
      const files = s.files
        .filter((f) => prefs.showOutOfCwdSessionDiffs || !isOutOfCwd(f.path, cwd))
        .map((f) => ({ ...f, path: normalizeUnderCwd(f.path, cwd) }));
      const totalAdditions = files.reduce((n, f) => n + f.additions, 0);
      const totalDeletions = files.reduce((n, f) => n + f.deletions, 0);
      return { ...s, files, totalAdditions, totalDeletions };
    });
  }, [state.messages, prefs.changeSummaryTable, prefs.showOutOfCwdSessionDiffs, cwd]);
  const { anchoredSummaries, tailSummary } = useMemo(() => {
    const anchored = new Map<string, TurnSummary>();
    let tail: TurnSummary | null = null;
    for (const s of turnSummaries) {
      if (s.boundaryUserMessageId) anchored.set(s.boundaryUserMessageId, s);
      else tail = s;
    }
    return { anchoredSummaries: anchored, tailSummary: tail };
  }, [turnSummaries]);
  const prevSessionRef = useRef(sessionId);
  const isMobile = useMobile();
  // Pause the streaming bubble's glow/shimmer when it scrolls off-screen.
  // See change: reduce-chat-render-cpu-umbrella (Phase 1, task 2.5).
  const streamFxRef = useFxVisibility<HTMLDivElement>();
  const bubbleMax = isMobile ? "max-w-[95%]" : "max-w-[80%]";
  /** Force wide when message contains a mermaid diagram */
  const bubbleWide = isMobile ? "w-[95%]" : "w-[95%]";

  // Group consecutive repeated tool calls for cleaner display.
  // Also drop user messages flagged `retriedFrom` (manual Retry button
  // produced a duplicate of the prior user bubble after an error). See
  // change: unify-status-banner-and-terminal-limit-stop.
  const filteredMessages = useMemo(() => {
    const base = showDebugTools
      ? state.messages
      : state.messages.filter((m) => m.role !== "toolResult" || !isDebugTool(m.toolName ?? ""));
    return base.filter((m) => !m.retriedFrom);
  }, [state.messages, showDebugTools]);
  const retriedErrorIds = useMemo(() => findRetriedErrorIds(filteredMessages), [filteredMessages]);
  const hiddenToolResultIds = useMemo(() => findActiveInteractiveToolResultIds(filteredMessages), [filteredMessages]);
  // toolCallIds owned by live `interactiveUi` messages still in the list. The
  // paired `ask_user` tool card is redundant with the interactive card (both
  // render title + message), so it is suppressed while the interactive card
  // lives — regardless of pending/resolved status or adjacency (unlike
  // hiddenToolResultIds, which is pending + adjacency only). On history reload
  // an answered prompt has NO interactiveUi row, so the set misses and the tool
  // card renders as the sole record. The reducer stamps `toolCallId` top-level
  // on the interactiveUi row (event-reducer addInteractiveRequest); `requestId`
  // (in args) is the defensive fallback. See change: fix-ask-user-card-duplication.
  const interactiveToolCallIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of filteredMessages) {
      if (m.role !== "interactiveUi") continue;
      const key = m.toolCallId ?? (m.args as { requestId?: string } | undefined)?.requestId;
      if (key) ids.add(key);
    }
    return ids;
  }, [filteredMessages]);
  // Concurrently-pending free-floating asks (no `toolCallId`, not widget-bar)
  // are pulled out of the inline stream and grouped into one MultiAskPanel
  // below. Tool-paired asks keep their inline placement; notifies never enter
  // `interactiveRequests` so they are excluded here by construction.
  // `toolCallId` lives on the pushed `interactiveUi` row, so map requestId →
  // toolCallId off `state.messages`. See change: surface-concurrent-ask-user-prompts.
  const pendingFreeFloating = useMemo(
    () => derivePendingFreeFloating(state.messages, state.interactiveRequests),
    [state.messages, state.interactiveRequests],
  );
  const panelRequestIds = useMemo(
    () => new Set(pendingFreeFloating.map((r) => r.requestId)),
    [pendingFreeFloating],
  );
  // Drop the redundant `ask_user` tool card BEFORE tool-burst grouping (every
  // toolResult is wrapped in a burst — threshold 1 — so post-group row filtering
  // never reaches it). The interactive card is the single render while its
  // interactiveUi row lives; on history reload (no pair) the tool card stays.
  // See change: fix-ask-user-card-duplication.
  const groupedMessages = useMemo(() => {
    const forGrouping = filteredMessages.filter(
      (m) =>
        !(m.role === "toolResult" && m.toolName === "ask_user" && interactiveToolCallIds.has(m.toolCallId ?? m.id)),
    );
    return groupToolBursts(forGrouping);
  }, [filteredMessages, interactiveToolCallIds]);
  // Single-red-surface: while the error-lifecycle surface (SessionBanner) owns
  // a failure, collapse the trailing inline failed-tool card so red isn't
  // shown twice. See change: unify-error-retry-lifecycle.
  const surfaceActive = !!(state.lastError || state.retryState);
  const surfaceSuppressedIds = useMemo(
    () => findSurfaceSuppressedErrorIds(filteredMessages, surfaceActive),
    [filteredMessages, surfaceActive],
  );

  // Prefs-gated / suppressed rows (the render's ~7 `return null` sites) are
  // filtered OUT here so the virtualizer's `count === displayRows.length` and
  // no index reserves empty spacer space (CR-5). getItemKey, the turn map, and
  // per-session persistence all key off displayRows.
  const isRowVisible = useCallback(
    (item: BurstItem): boolean => {
      if (isBurst(item) || isGroup(item)) return true;
      const msg = item as import("../../lib/chat/event-reducer.js").ChatMessage;
      switch (msg.role) {
        case "turnSeparator":
          return prefs.turnMetadata;
        // The gap disclosure is never prefs-gated: hiding it would make a
        // windowed replay indistinguishable from data loss.
        case "historyGap":
          return true;
        case "thinking":
          return prefs.reasoning;
        case "toolResult": {
          if (!showDebugTools && isDebugTool(msg.toolName ?? "")) return false;
          const kindKey = toolCallPrefKey(msg.toolName ?? "");
          if (kindKey !== null && !prefs.toolCalls[kindKey]) return false;
          if (hiddenToolResultIds.has(msg.id)) return false;
          return true;
        }
        case "interactiveUi": {
          const args = msg.args as Record<string, unknown> | undefined;
          // Pending free-floating asks render in the grouped MultiAskPanel, not
          // inline. See change: surface-concurrent-ask-user-prompts.
          const rid = args?.requestId as string | undefined;
          if (rid && panelRequestIds.has(rid)) return false;
          const cmp = (args?.params as Record<string, unknown> | undefined)?._promptBusComponent as
            | { type?: string }
            | undefined;
          if (cmp?.type && isWidgetBarPrompt(cmp.type)) return false;
          // Notify rows are gated by level; blocking asks never are. The shared
          // predicate fails open on anything it cannot positively identify as a
          // notify. Mirrored in the render branch below (D3).
          // See change: gate-notify-rows-by-level.
          return isNotifyRowVisible(
            {
              content: msg.content,
              method: args?.method,
              level: (args?.params as Record<string, unknown> | undefined)?.level,
            },
            prefs.notifyMinLevel,
          );
        }
        case "rawEvent":
          return showDebugTools;
        case "custom":
          // Render-time gate only (rawEvent precedent): rows stay in state, so
          // toggling never replays anything. See change:
          // render-inline-reasoning-and-custom-entries (D7).
          return prefs.customEntryFallback;
        default:
          return true;
      }
    },
    [prefs, showDebugTools, hiddenToolResultIds, panelRequestIds],
  );
  const displayRows = useMemo(() => {
    const rows = groupedMessages.filter(isRowVisible);
    // While a tail selection is frozen ACROSS turn completion, the committed
    // assistant twin has appeared as the last row while the frozen tail still
    // shows the same text. Hide the twin (view-only; it is never dropped from
    // state.messages) so the text is not shown twice, until the selection
    // collapses. See change: preserve-streaming-tail-selection.
    if (frozenTailText && !state.streamingText && rows.length > 0) {
      const last = rows[rows.length - 1];
      if (!isBurst(last) && !isGroup(last)) {
        const lastMsg = last as import("../../lib/chat/event-reducer.js").ChatMessage;
        if (lastMsg.role === "assistant" && lastMsg.content.startsWith(frozenTailText)) {
          return rows.slice(0, -1);
        }
      }
    }
    return rows;
  }, [groupedMessages, isRowVisible, frozenTailText, state.streamingText]);
  // Precompute each row's aggregate rendered text length ONCE per displayRows
  // rebuild (task 2.1), so `estimateSize` stays O(1) per scroll pass and never
  // walks content blocks. Feeds the content-aware estimate (Decision 1).
  const rowTextChars = useMemo(() => displayRows.map(computeRowTextChars), [displayRows]);
  const turnToFirstRowIndex = useMemo(() => buildTurnToFirstRowIndex(displayRows), [displayRows]);

  // --- Active-selection preservation (change: preserve-chat-selection-during-churn) ---
  // Row count + device-aware retained-row ceiling read as refs so the stable
  // `mapChatRange` closure and the virtualizer `rangeExtractor` always see the
  // latest values without re-subscribing.
  const rowCountRef = useRef(0);
  rowCountRef.current = displayRows.length;
  const selectionCapRef = useRef(SELECTION_RETAIN_CAP_DESKTOP);
  selectionCapRef.current = isMobile ? SELECTION_RETAIN_CAP_MOBILE : SELECTION_RETAIN_CAP_DESKTOP;

  const mapChatRange = useCallback((range: Range): SelectionRowSpan | null => {
    const el = scrollRef.current;
    if (!el) return null;
    const span = rangeToRowIndexSpan(range, el, rowCountRef.current);
    if (span && span.max - span.min + 1 > selectionCapRef.current) {
      // Past the retained-row ceiling (notably Select-All): ACTIVELY clear the
      // selection so the outcome is visible, NOT a silently-truncated copy.
      // Passive non-extension does not collapse a Range whose endpoints sit in
      // two different removed rows — it persists with garbage offsets. See D3.
      window.getSelection()?.removeAllRanges();
      return null;
    }
    return span;
  }, []);

  const { isSelecting, isSelectingRef, selectionSpanRef, selectionAnchorRef } = useActiveChatSelection(
    scrollRef,
    mapChatRange,
  );

  /**
   * Remap the retained-selection span across a backfill splice.
   *
   * `selectionSpanRef` holds a row INDEX span, and `rangeExtractor` unions it
   * into the mounted range so the selected rows are never unmounted. A splice
   * inserts rows BELOW the divider, which shifts the index of every row after
   * it — so the stored span silently comes to designate DIFFERENT rows. The
   * selected row then falls outside the retained union, the virtualizer
   * unmounts it, and the Range collapses: the selection is destroyed outright,
   * not merely displaced.
   *
   * Measured in a real browser against `tail-only`, where a ~500-row splice
   * lands above the reading position: a triple-click selection came back as the
   * empty string. It is a PRE-EXISTING defect that `tail-only` exposes rather
   * than causes — `head-tail` shifts indices too, just by less, and its own
   * gate missed it by installing a programmatic `Range` (which never populates
   * this span) over a splice that does not move `scrollTop`.
   *
   * DURING RENDER, deliberately, not in a layout effect: `rangeExtractor` is
   * consulted while the virtualizer computes its range, so by the time any
   * effect could run the rows are already gone and the selection with them.
   * Render-time ref writes are an established pattern in this component
   * (`rowCountRef`, `headFreeGapRef`).
   *
   * Only spans strictly BELOW the gap row shift. A `head-tail` selection ABOVE
   * the divider keeps its indices, and shifting it would corrupt a span that
   * was correct.
   * See change: add-tail-only-replay-window (D7a, test-plan F18).
   */
  const prevSpliceRevRef = useRef(historySpliceRev);
  const prevRowCountRef = useRef(displayRows.length);
  if (historySpliceRev !== prevSpliceRevRef.current) {
    const delta = displayRows.length - prevRowCountRef.current;
    const span = selectionSpanRef.current;
    if (delta > 0 && span) {
      const gapIndex = displayRows.findIndex(
        (row) => (row as { id?: string }).id === HISTORY_GAP_ROW_ID,
      );
      // `gapIndex < 0` means the divider was spliced out entirely by this same
      // update (the two-sided exhaustion path). Everything that was below it
      // still shifted, so the span still needs the correction.
      if (gapIndex < 0 || span.min > gapIndex) {
        selectionSpanRef.current = { min: span.min + delta, max: span.max + delta };
      }
    }
    prevSpliceRevRef.current = historySpliceRev;
  }
  prevRowCountRef.current = displayRows.length;
  // Freeze/flush the streaming tail around an anchored selection (change:
  // preserve-streaming-tail-selection). On the isSelecting false→true edge, if
  // the selection sits inside the live tail, snapshot streamingText so the tail
  // stops re-rendering per chunk (buffer). On the true→false edge, clear the
  // snapshot to flush the latest text. Keyed on isSelecting only — the snapshot
  // value comes from a ref so per-chunk streamingText changes do not re-run it.
  useLayoutEffect(() => {
    if (isSelecting) {
      if (frozenTailTextRef.current == null && streamingTextRef.current) {
        const sel = typeof window !== "undefined" ? window.getSelection() : null;
        const tailEl = tailContainerRef.current;
        const inTail = !!(
          sel &&
          tailEl &&
          ((sel.anchorNode && tailEl.contains(sel.anchorNode)) ||
            (sel.focusNode && tailEl.contains(sel.focusNode)))
        );
        if (inTail) {
          frozenTailTextRef.current = streamingTextRef.current;
          setFrozenTailText(streamingTextRef.current);
        }
      }
    } else if (frozenTailTextRef.current != null) {
      frozenTailTextRef.current = null;
      setFrozenTailText(null);
    }
  }, [isSelecting]);

  // Rebuild clipboard text from the active selection (change:
  // chat-copy-fidelity-intercept). Intercept the container `copy` so partial
  // rows copy exactly the selected characters and capping renderers that opt in
  // via `data-copy-text` copy their full text — never what happens to be
  // mounted. Skip selections that don't touch the transcript so the browser's
  // native copy still owns cross-boundary drags.
  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const container = scrollRef.current;
    const sel = window.getSelection();
    if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const text = buildSelectionClipboardText(range, container);
    if (!text) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  }, []);
  // Anchor-shift compensation state (change:
  // anchor-chat-selection-against-row-growth). `isSelectingRef` now comes from
  // the hook, published synchronously inside the `selectionchange` listener
  // (D6) — the old render-time mirror `isSelectingRef.current = isSelecting`
  // lagged by a microtask AND a render, so a chunk landing on the first frame
  // of a drag still hit the bottom-pin.
  //
  // `anchorPrevTopRef` / `anchorPrevScrollTopRef` are the anchor row's
  // viewport-relative top and the container's scrollTop at the last baseline;
  // null means "not baselined yet" (first frame of a drag). The pair is all the
  // compensator needs — D2's veto is derived from their geometry, NOT from a
  // scroll-event flag, which could not tell the virtualizer's programmatic
  // `scrollToFn` write from a user gesture and went stale.
  const anchorPrevTopRef = useRef<number | null>(null);
  const anchorPrevScrollTopRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateVirtualRowSize(displayRows[i], rowTextChars[i]),
    getItemKey: (i) => virtualRowKey(displayRows[i], i),
    overscan: 6,
    // Union any active selection's row span into the mounted range (D3), so
    // rows the selection intersects stay mounted, positioned, and measured by
    // the virtualizer itself. Runs on EVERY recompute before the unmount
    // decision; reading the proactively-tracked span ref here keeps selected
    // rows from ever unmounting (avoids the synchronous Range-mutation race).
    // `getTotalSize()` may change as a retained row measures — accepted normal
    // virtualizer behavior. Past the device-aware ceiling the span ref is null
    // (mapChatRange cleared the selection) so the default range is returned.
    rangeExtractor: (range) =>
      extendRangeWithSelection(
        defaultRangeExtractor(range),
        selectionSpanRef.current,
        selectionCapRef.current,
        range.count,
      ),
    // Re-pin the bottom on measurement-driven size changes while following.
    // Bottom-pin stays DOM-measured (CR-1): getTotalSize() excludes the live
    // tail siblings, so pin to the real scrollHeight, not the virtual total.
    //
    // onChange fires on EVERY scroll (range recompute), not only on growth.
    // Guard the pin on an actual scrollHeight change so a small user scroll-up
    // inside the near-bottom band is NOT yanked back to the bottom (the
    // ping-pong bug). A pin sets scrollTop, not scrollHeight, so the next
    // onChange sees no growth and the loop cannot sustain itself.
    onChange: () => {
      const el = scrollRef.current;
      if (!el) return;
      const grew = el.scrollHeight !== lastScrollHeightRef.current;
      lastScrollHeightRef.current = el.scrollHeight;
      // Suspend the bottom-pin while a transcript selection is held (D2) so the
      // selected row is not scrolled out of its overscan band. stickToBottomRef
      // is NOT cleared — follow resumes on collapse.
      // A backfill splice grows the content from ABOVE the reading position, so
      // any user inside the near-bottom band would be yanked to the bottom (D6).
      if (grew && stickToBottomRef.current && !isSelectingRef.current && !spliceSuppressRef.current) {
        stampProgrammaticScroll();
        el.scrollTop = el.scrollHeight;
      }
      // Ascending: re-target index 0 whenever a measurement grows the total
      // size (an above-viewport row mounting/measuring, INCLUDING the async
      // image-load remeasure). scrollToIndex is bounded to maxAttempts frames,
      // so without this a late remeasure would leave the view off index 0.
      if (ascendingRef.current) {
        if (el.scrollTop <= 0) ascendingRef.current = false;
        else if (grew) {
          stampProgrammaticScroll();
          virtualizer.scrollToIndex(0, { align: "start" });
        }
      }
    },
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  /**
   * D7a — the `tail-only` splice anchor's CORRECTION half.
   *
   * Lives here, after the virtualizer, because it corrects in SCROLL SPACE
   * rather than against a DOM rect, and that is not an optimisation — it is the
   * only formulation that works. Two DOM-based attempts were measured against
   * the harness and both failed for the same structural reason:
   *
   *   1. `Δ scrollHeight` — absorbs growth from rows BELOW the viewport
   *      remeasuring away from their estimates, which moves nothing the user is
   *      looking at. Over-corrected by ~3200px on a 34000px splice.
   *   2. anchor row's `getBoundingClientRect()` — the row is displaced by the
   *      full spliced height BEFORE any correction runs, so the virtualizer has
   *      already UNMOUNTED it and there is no rect to read. Corrected 0px.
   *
   * The virtualizer's measurement cache has neither problem: a row's `start`
   * offset is defined whether or not it is mounted, and it moves only when rows
   * ABOVE it change size. Holding `scrollTop` at `start - anchorTop` therefore
   * states D7a's invariant directly — the first previously-loaded row keeps the
   * viewport position it had when the slice was requested.
   *
   * Re-run across ~20 frames because the spliced rows carry ESTIMATED sizes
   * until measured, so `start` keeps moving; D7a requires the anchor to keep
   * correcting until measurement settles rather than being consumed by one
   * layout pass. Bounded, so it cannot become a second permanent scroll owner.
   * See change: add-tail-only-replay-window (D7a).
   */
  useLayoutEffect(() => {
    if (!historySpliceRev || !headFreeGapRef.current) return;
    const key = anchorKeyRef.current;
    const anchorTop = anchorTopRef.current;
    if (key === null || anchorTop === null) return;

    let frames = 0;
    let raf = 0;
    /**
     * Resolved ONCE, not per frame. `displayRows` is deliberately captured for
     * the whole correction window, so the index cannot change across it; on a
     * post-splice transcript of ~10k rows, re-scanning on each of 20 frames
     * costs ~200k comparisons on exactly the frame budget this is protecting.
     */
    const idx = displayRows.findIndex((row, i) => virtualRowKey(row, i) === key);
    // The anchor row left the transcript entirely (event trim, session switch).
    // Stop rather than correct against a row that is not there.
    if (idx < 0) return;
    const correct = (): void => {
      const node = scrollRef.current;
      if (!node) return;
      const start = virtualizer.measurementsCache[idx]?.start;
      if (typeof start === "number") {
        const target = start - anchorTop;
        // Sub-pixel drift is measurement noise, not displacement; writing for
        // it would fight the virtualizer every frame for no visible benefit.
        if (Math.abs(node.scrollTop - target) > 0.5) {
          // PRESERVES position — suppress our own events, keep the user's intent.
          stampProgrammaticScroll(false);
          node.scrollTop = target;
        }
      }
      if (++frames < 20) raf = requestAnimationFrame(correct);
    };
    raf = requestAnimationFrame(correct);
    return () => {
      cancelAnimationFrame(raf);
    };
    // `displayRows` and `virtualizer` are deliberately NOT dependencies: this
    // effect must run once per SPLICE, and `displayRows` changes identity on
    // every render (including the ones this effect's own scroll writes
    // provoke), which would restart the correction window indefinitely.
    //
    // Staleness is not a hazard here. The effect runs AFTER the splice commit,
    // so the captured `displayRows` already contains the spliced rows and the
    // anchor's index in it is the post-splice one. `virtualizer` is a stable
    // mutable instance, so `measurementsCache` is read LIVE on every frame —
    // which is what lets the loop track measurement convergence.
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the splice revision by design
  }, [historySpliceRev]);

  // Streaming-tail content: the frozen snapshot while a tail selection is held
  // (buffers chunks; survives the message_end unmount), else the live text.
  // See change: preserve-streaming-tail-selection.
  const streamingTailText = frozenTailText ?? state.streamingText;

  // Async image-decode re-measure (issue #267). A base64 data-URL decodes after
  // mount, so an image-bearing row is first measured near-zero. The reused
  // (not remounted) ChatView + no-op ResizeObserver paths can leave that stale
  // collapsed height cached, overlapping the next row. Each `<img onLoad>` asks
  // us to re-measure its owning virtual row (the `[data-index]` ancestor that
  // already carries `ref={virtualizer.measureElement}`). Coalesce to one
  // measure per row per animation frame so a many-image message can't storm.
  const pendingRowMeasure = useRef<Map<number, HTMLElement>>(new Map());
  const rowMeasureRaf = useRef<number | null>(null);
  const requestRowMeasure = useCallback(
    (from: HTMLElement | null) => {
      const row = from?.closest?.("[data-index]") as HTMLElement | null;
      if (!row) return;
      pendingRowMeasure.current.set(Number(row.getAttribute("data-index")), row);
      if (rowMeasureRaf.current != null) return;
      rowMeasureRaf.current = requestAnimationFrame(() => {
        rowMeasureRaf.current = null;
        for (const node of pendingRowMeasure.current.values()) virtualizer.measureElement(node);
        pendingRowMeasure.current.clear();
      });
    },
    [virtualizer],
  );
  useLayoutEffect(
    () => () => {
      if (rowMeasureRaf.current != null) cancelAnimationFrame(rowMeasureRaf.current);
    },
    [],
  );

  // Real user input (wheel / touch) cancels an in-flight descent so the user
  // can always escape mid-flight.
  const cancelDescent = useCallback(() => {
    descendingRef.current = false;
    // Real user input also escapes an in-flight scroll-to-top ascent so the
    // onChange re-issue cannot fight the user scrolling back down.
    ascendingRef.current = false;
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    const nearTop = el.scrollTop <= SCROLL_THRESHOLD;
    if (descendingRef.current) {
      // In-flight descent: hold the pin through intermediate (not-yet-bottom)
      // scroll events; clear the latch on arrival.
      if (nearBottom) descendingRef.current = false;
      stickToBottomRef.current = true;
      setShowScrollButton(false);
    } else if (ascendingRef.current) {
      // In-flight ascent: hold scroll-lock and NEVER re-arm the bottom-pin,
      // even if an early frame reads nearBottom (starting from the bottom).
      // Clear the latch on arrival at the top.
      if (nearTop) ascendingRef.current = false;
      stickToBottomRef.current = false;
      setShowScrollButton(true);
    } else {
      stickToBottomRef.current = nearBottom;
      setShowScrollButton(!nearBottom);
    }
    setShowScrollTopButton(!nearTop);
    // Persist scroll position for this session in VIRTUAL coordinates (CR-6):
    // the first below-the-fold row's stable id + its intra-row offset. Raw
    // scrollTop is meaningless once total size is an estimate across a remount.
    if (sessionId) {
      const items = virtualizer.getVirtualItems();
      const anchor = items.find((vi) => vi.start + vi.size > el.scrollTop) ?? items[0];
      scrollStateMap.set(sessionId, {
        anchorRowId: anchor ? String(anchor.key) : null,
        offset: anchor ? el.scrollTop - anchor.start : el.scrollTop,
        nearBottom,
      });
    }
    /**
     * Trigger bookkeeping ONLY — this never evaluates the predicate. An edge
     * inside the suppression window is a programmatic scroll and records no
     * intent; anything else is the user asking to move. The settle timer is
     * restarted on every event, so the evaluation happens once, when motion
     * stops. See change: add-tail-only-replay-window (D7).
     */
    if (Date.now() >= programmaticScrollUntilRef.current) {
      pendingUserIntentRef.current = true;
    }
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(evaluateAutoLoad, SETTLE_MS);
  }, [sessionId, virtualizer, evaluateAutoLoad]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Smooth when quiet, instant when streaming/tool output is active so the
    // animation cannot race with incoming chunks and re-introduce jumps.
    const isStreaming = Boolean(state.streamingText || state.streamingThinking || pendingSteering?.length);
    descendingRef.current = true;
    stampProgrammaticScroll();
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? "instant" : "smooth" });
    stickToBottomRef.current = true;
    setShowScrollButton(false);
    if (sessionId) {
      scrollStateMap.set(sessionId, { anchorRowId: null, offset: 0, nearBottom: true });
    }
  }, [sessionId, state.streamingText, state.streamingThinking, pendingSteering]);

  // Scroll-to-top (Decision 3). Latch suppression FIRST, then scroll: escape
  // sticky-bottom so streaming can't pull the view back down, mark the ascent
  // so handleScroll won't re-arm the pin and onChange re-issues on remeasure,
  // then target index 0 top-aligned. `scrollToIndex` mounts the first row if
  // unmounted and (for index 0) self-corrects toward offset 0.
  const scrollToTop = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    descendingRef.current = false;
    ascendingRef.current = true;
    stickToBottomRef.current = false;
    setShowScrollButton(true);
    /**
     * ACTIVATION is intent, even though the motion it causes is programmatic:
     * the user asked to go to the top, and the loading head is what they land
     * on. The stamp suppresses the ascent's own scroll events; the intent flag
     * set here is what the post-ascent evaluation reads.
     * See change: add-tail-only-replay-window (D7).
     */
    // Stamp FIRST: the stamp clears intent, and this activation IS intent.
    stampProgrammaticScroll();
    pendingUserIntentRef.current = true;
    virtualizer.scrollToIndex(0, { align: "start" });
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(evaluateAutoLoad, SETTLE_MS);
  }, [virtualizer, stampProgrammaticScroll, evaluateAutoLoad]);

  // Save scroll state when leaving, restore when arriving. Layout effect keeps
  // the restored position synchronized with the first paint so there is no flash.
  // Restore runs ONLY on session switch; displayRows/virtualizer are read via
  // the current-render closure. Listing them would re-run restore on every row
  // change (CR-6), so the dep list is intentionally [sessionId] only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional session-switch-only restore; see comment above.
  useLayoutEffect(() => {
    if (sessionId !== prevSessionRef.current) {
      // Outgoing scroll state is kept fresh by handleScroll (persists the
      // virtual anchor on every scroll), so no re-capture here — re-capturing
      // now would read the INCOMING session's virtualizer (CR-6).
      prevSessionRef.current = sessionId;

      // Restore incoming session scroll state in virtual coordinates.
      const saved = sessionId ? scrollStateMap.get(sessionId) : undefined;
      if (saved && !saved.nearBottom && saved.anchorRowId) {
        // Scroll-locked: resolve the saved row id → current index, scroll it to
        // the top, then re-apply the intra-row offset once the row measures.
        descendingRef.current = false;
        stickToBottomRef.current = false;
        setShowScrollButton(true);
        const anchorId = saved.anchorRowId;
        const idx = displayRows.findIndex((r, i) => virtualRowKey(r, i) === anchorId);
        if (idx >= 0) {
          // A session restored to the TOP drives `scrollTop → 0` on first
          // paint. Unstamped, that is an unlatched ascent and a silent
          // auto-fetch. See change: add-tail-only-replay-window (D7).
          stampProgrammaticScroll();
          virtualizer.scrollToIndex(idx, { align: "start" });
          const off = saved.offset;
          requestAnimationFrame(() => {
            const el = scrollRef.current;
            stampProgrammaticScroll();
            if (el) el.scrollTop += off;
          });
        } else {
          stampProgrammaticScroll();
          scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
        }
      } else {
        // Near bottom or first visit: scroll to end and follow new content.
        stickToBottomRef.current = true;
        setShowScrollButton(false);
        stampProgrammaticScroll();
        scrollRef.current?.scrollTo(0, scrollRef.current!.scrollHeight);
      }
    }
  }, [sessionId]);

  // Auto-scroll on new content when the user has not escaped the bottom.
  // Layout effect keeps the DOM and scroll position synchronized before paint,
  // eliminating the per-line jumps caused by async scrollTo calls.
  //
  // Suspended while a transcript selection is held (D2) WITHOUT clearing
  // stickToBottomRef, so the selected row is not scrolled out of its overscan
  // band. `isSelecting` is in the dep array so the `→ false` edge re-fires the
  // pin even when no content arrived after collapse (else the user is stranded
  // at a stale position). On that edge lastScrollHeightRef is resynced so the
  // next onChange does not read a stale height and fire a spurious pin.
  const wasSelectingRef = useRef(false);
  // `isSelectingRef` is read for its CURRENT value at commit time and must NOT
  // become a dependency — that is the render-time mirror D6 deleted, and it
  // re-opens the first-frame hole. The listed deps are deliberate TRIGGERS (new
  // content, and the `isSelecting` → false edge that resumes follow).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are read at commit time, never dependencies
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Read BOTH clocks (D6). The `isSelecting` STATE crosses a queueMicrotask
    // AND a render, so on the first frame of a drag it is still false while the
    // synchronous ref already knows — and a chunk landing in that window would
    // otherwise execute `el.scrollTop = el.scrollHeight` and yank the selection
    // away. The state is still required for the dep array: it is what re-runs
    // this effect on the → false edge so follow resumes with no new content.
    if (isSelecting || isSelectingRef.current) {
      wasSelectingRef.current = true;
      return;
    }
    const resumedFromSelection = wasSelectingRef.current;
    wasSelectingRef.current = false;
    if (resumedFromSelection && el) lastScrollHeightRef.current = el.scrollHeight;
    if (stickToBottomRef.current && el) {
      stampProgrammaticScroll();
      el.scrollTop = el.scrollHeight;
      lastScrollHeightRef.current = el.scrollHeight;
    }
  }, [state.messages.length, state.streamingText, state.pendingPrompt, state.streamingThinking, pendingSteering, isSelecting]);

  // Anchor the viewport to the selection's drag-origin row while a selection is
  // held (change: anchor-chat-selection-against-row-growth, D1/D3/D5).
  //
  // NO dependency array on purpose (D3): every mutation that can shift a row
  // routes through a React commit (measureElement → resizeItem →
  // measurementsCache setState → render; tool_execution_end → reducer → render;
  // insert/reorder → render), so "after every commit" covers the whole trigger
  // table without enumerating it. A layout effect runs after DOM mutation and
  // BEFORE paint, the only window where a correction is invisible; useEffect
  // would show the jump and then undo it.
  //
  // Runs DOWNSTREAM of TanStack's own above-viewport `resizeItem` correction, so
  // a resize it already handled presents as ~0 residual and writes nothing (D1)
  // — the double-move that `fix-chat-scroll-to-top-estimate-drift` decision (2)
  // forbids is avoided by ordering, not by re-implementing its predicate.
  //
  // Reads exactly one rect and performs at most one scrollTop write per commit,
  // and only while selecting; with no selection it early-returns before touching
  // the DOM, so the idle render cost is unchanged.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchorEl = selectionAnchorRef.current;
    // A detached anchor (rangeExtractor bug, or a selection past the retain cap)
    // must STOP compensation, never correct against a stale rect.
    if (!el || !isSelectingRef.current || !anchorEl?.isConnected) {
      anchorPrevTopRef.current = null;
      return;
    }

    const nextTop = anchorEl.getBoundingClientRect().top;
    const nextScrollTop = el.scrollTop;
    const prevTop = anchorPrevTopRef.current;
    const prevScrollTop = anchorPrevScrollTopRef.current;

    /**
     * A backfill splice above a held selection displaces the anchor row, which
     * this compensator would read as drift and "correct" — writing scrollTop on
     * the one commit that must not move. Re-baseline instead of correcting.
     *
     * `head-tail` ONLY (D7a). In `tail-only` the spliced rows land ABOVE the
     * selection and genuinely displace it, which is exactly the displacement
     * this compensator exists to cancel; suppressing it there would let the
     * selected content slide by the full spliced height. The gate is on the
     * ANNOUNCED window shape, never on a sentinel, so the two modes cannot
     * collapse into one branch.
     * See change: fix-lazy-history-backfill-ux (D6), add-tail-only-replay-window (D7a).
     */
    if (spliceSuppressRef.current && !headFreeGapRef.current) {
      anchorPrevTopRef.current = nextTop;
      anchorPrevScrollTopRef.current = nextScrollTop;
      return;
    }

    // First commit of this drag: establish the baseline, correct nothing.
    if (prevTop === null) {
      anchorPrevTopRef.current = nextTop;
      anchorPrevScrollTopRef.current = nextScrollTop;
      return;
    }

    const correction = computeAnchorCorrection({ prevTop, nextTop, prevScrollTop, nextScrollTop });
    if (correction === 0) {
      anchorPrevTopRef.current = nextTop;
      anchorPrevScrollTopRef.current = nextScrollTop;
      return;
    }

    // The selection-anchor compensator writes `scrollTop`, so it stamps like
    // every other writer. See change: add-tail-only-replay-window (D7).
    stampProgrammaticScroll();
    el.scrollTop = nextScrollTop + correction;
    // Re-baseline immediately after the write, inside the same effect, so the
    // next commit does not observe our own correction as new drift (the feedback
    // loop in the design's Risks section).
    //
    // Derived, NOT re-measured: a second `getBoundingClientRect()` here would be
    // a second forced reflow per commit. The anchor's new viewport top is
    // `nextTop - applied` by construction, and reading back `scrollTop` (rather
    // than trusting `correction`) keeps that exact when the browser CLAMPS the
    // write to [0, scrollHeight - clientHeight].
    const applied = el.scrollTop - nextScrollTop;
    anchorPrevTopRef.current = nextTop - applied;
    anchorPrevScrollTopRef.current = el.scrollTop;
  });

  useImperativeHandle(ref, () => ({
    scrollToTurn(turnIndex: number) {
      // Map the turn to its first display-row index and scroll there. Unlike
      // the old querySelector([data-turn]) path this works for OFF-SCREEN
      // (unmounted) turns — scrollToIndex scrolls, THEN the row mounts.
      const rowIndex = turnToFirstRowIndex.get(turnIndex);
      if (rowIndex == null) return;
      // Escape sticky bottom so streaming does not pull the user off the turn.
      descendingRef.current = false;
      stickToBottomRef.current = false;
      setShowScrollButton(true);
      // `scrollToTurn` to an early turn drives the view near the top with no
      // ascent latch of its own — the design's named unlatched ascent source.
      // See change: add-tail-only-replay-window (D7, test-plan F19).
      stampProgrammaticScroll();
      virtualizer.scrollToIndex(rowIndex, { align: "start" });
    },
  }), [turnToFirstRowIndex, virtualizer, stampProgrammaticScroll]);

  return (
    // Key by sessionId so switching sessions (ChatView is reused, not remounted)
    // resets the hoisted preview — a preview open in session A never leaks into B.
    <FilePreviewProvider key={sessionId}>
    <div className="flex-1 relative overflow-hidden flex flex-col">
    {/* overflowAnchor:"none" is load-bearing: TanStack's built-in above-viewport
        correction (resizeItem) drives scroll compensation itself, so browser
        scroll-anchoring must stay OFF (it would double-move). Do NOT add
        `scroll-behavior: smooth` here or on an ancestor — smooth would animate
        each synchronous measurement correction and race the next, reintroducing
        the scroll-to-top drift. See change: fix-chat-scroll-to-top-estimate-drift. */}
    <div ref={scrollRef} onScroll={handleScroll} onCopy={handleCopy} onWheel={cancelDescent} onTouchMove={cancelDescent} style={{ overflowAnchor: "none" }} data-testid="chat-scroll-container" className={`chat-cv h-full overflow-y-auto ${isMobile ? "p-2" : "p-4"}`}>
      {/* Windowed historical rows (TanStack Virtual): only viewport + overscan
          are mounted. The spacer reserves getTotalSize(); each row is absolutely
          positioned + re-measured on mount. chat-cv-skip keeps Step A's
          content-visibility off the spacer (windowing supersedes it). Bottom-pin
          + scroll-lock stay on the DOM scroll machine (CR-1). See change:
          virtualize-chat-transcript-tanstack. */}
      <div className="chat-cv-skip" style={{ position: "relative", width: "100%", height: totalSize }}>
        {virtualItems.map((vi) => {
          const item: BurstItem = displayRows[vi.index];
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              /* Stable per-ROW handle: `getItemKey` returns the row's message
                 id, so this survives a splice that shifts every `data-index`.
                 The D7a anchor re-locates its row through this after the
                 coarse correction remounts it — `data-index` cannot serve,
                 because the same index denotes a DIFFERENT row post-splice.
                 See change: add-tail-only-replay-window (D7a). */
              data-row-key={vi.key}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
            >
              {((): React.ReactNode => {
        // Temporal burst group of heterogeneous tool calls (carries collapse
        // state → key by first-member id, NOT positional idx, so event-trim
        // head churn cannot bleed one burst's state into another (finding 3).
        if ((item as ToolBurstGroupData).type === "burst") {
          const burst = item as ToolBurstGroupData;
          return <ToolBurstGroup key={burst.id} burst={burst} toolContext={toolContext} />;
        }
        // Bare semantic ×N group (sub-threshold burst that still folded a poll).
        if ((item as ToolCallGroup).type === "group") {
          const group = item as ToolCallGroup;
          return <CollapsedToolGroup key={group.messages[0]?.id ?? group.toolName} group={group} toolContext={toolContext} />;
        }

        const msg = item as import("../../lib/chat/event-reducer.js").ChatMessage;

        // (The retired `/view` inline PreviewCard row is gone — `/view` now
        // opens the editor pane. See change: open-view-command-in-editor-pane.)

        if (msg.role === "turnSeparator") {
          if (!prefs.turnMetadata) return null;
          return <div key={msg.id} className="mx-4 my-2 border-t border-[var(--border-subtle)]" />;
        }

        if (msg.role === "historyGap") {
          if (!historyGap) return null;
          return (
            <HistoryGapDivider
              key={msg.id}
              gap={historyGap}
              onLoadEarlier={handleLoadEarlier}
            />
          );
        }

        if (msg.role === "user") {
          // Per-turn change block for the turn that ENDS at this user message
          // (change: add-change-summary-table). Renders above the bubble that
          // starts the next turn; the in-progress turn renders at the tail.
          const changeBlock = anchoredSummaries.get(msg.id) ? (
            <ChangeSummaryBlock summary={anchoredSummaries.get(msg.id)!} onOpenFile={openDiffFile} />
          ) : null;
          // Skill invocations render as a distinct collapsible card so chat
          // doesn't show walls of expanded skill body. Plain user messages
          // continue to render as the existing blue bubble.
          // See change: render-skill-invocations-collapsibly.
          if (msg.skill) {
            return (
              <React.Fragment key={msg.id}>
              {changeBlock}
              <div className="mt-4 mb-4 flex flex-col items-end" {...(msg.turnIndex != null ? { "data-turn": msg.turnIndex } : {})}>
                {msg.streamingBehavior && <StreamingBehaviorBadge behavior={msg.streamingBehavior} />}
                <div className={bubbleMax}>
                  {msg.images && msg.images.length > 0 && (
                    <div className="mb-2">
                      <ImageAttachments images={msg.images} sessionId={sessionId} onImageLoad={(e) => requestRowMeasure(e.currentTarget)} />
                    </div>
                  )}
                  <SkillInvocationCard
                    skill={msg.skill}
                    rawContent={msg.content}
                    timestamp={msg.timestamp}
                    entryId={msg.entryId}
                    onFork={onForkFromMessage}
                  />
                </div>
              </div>
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={msg.id}>
            {changeBlock}
            <div className="mt-4 mb-4 flex flex-col items-end" {...(msg.turnIndex != null ? { "data-turn": msg.turnIndex } : {})}>
              {msg.streamingBehavior && <StreamingBehaviorBadge behavior={msg.streamingBehavior} />}
              <div className={`bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax}`}>
                {msg.images && msg.images.length > 0 && (
                  <ImageAttachments images={msg.images} sessionId={sessionId} onImageLoad={(e) => requestRowMeasure(e.currentTarget)} />
                )}
                {msg.content && (
                  <MessageBubble
                    content={msg.content}
                    className=""
                    timestamp={msg.timestamp}
                    entryId={msg.entryId}
                    onFork={onForkFromMessage}
                  />
                )}
              </div>
            </div>
            </React.Fragment>
          );
        }

        if (msg.role === "thinking") {
          if (!prefs.reasoning) return null;
          return (
            <ThinkingBlock
              key={msg.id}
              content={msg.content}
              startedAt={msg.startedAt}
              duration={msg.duration}
              streamedLive={msg.streamedLive}
              autoCollapseMs={prefs.reasoningAutoCollapseMs}
              keepOpenUntilTurnEnds={prefs.keepReasoningOpenUntilTurnEnds}
              turnActive={state.status === "streaming"}
              inlineFlow={prefs.reasoningInlineFlow}
            />
          );
        }

        if (msg.role === "toolResult") {
          if (!showDebugTools && isDebugTool(msg.toolName ?? "")) return null;
          // Gate by tool-kind preference. `ask_user` is non-hidable
          // (toolCallPrefKey returns null → always render).
          const kindKey = toolCallPrefKey(msg.toolName ?? "");
          if (kindKey !== null && !prefs.toolCalls[kindKey]) return null;
          if (hiddenToolResultIds.has(msg.id)) return null;
          if (retriedErrorIds.has(msg.id) || surfaceSuppressedIds.has(msg.id)) {
            return (
              <RetriedErrorBadge
                key={msg.id}
                toolName={msg.toolName ?? "unknown"}
                toolCallId={msg.toolCallId ?? msg.id}
                args={msg.args}
                result={msg.result}
                context={toolContext}
                startedAt={msg.startedAt}
                duration={msg.duration}
                toolDetails={msg.toolDetails}
              />
            );
          }
          return (
            <ToolCallStep
              key={msg.id}
              toolName={msg.toolName ?? "unknown"}
              toolCallId={msg.toolCallId ?? msg.id}
              args={msg.args}
              status={msg.toolStatus ?? "running"}
              result={msg.result}
              images={msg.images}
              context={toolContext}
              startedAt={msg.startedAt}
              duration={msg.duration}
              toolDetails={msg.toolDetails}
              showResultBody={prefs.toolResults || msg.toolName === "ask_user"}
              onAbort={msg.toolStatus === "running" ? onAbort : undefined}
              onForceKill={msg.toolStatus === "running" ? onForceKill : undefined}
            />
          );
        }

        if (msg.role === "bashOutput") {
          const args = msg.args as any;
          // Missing shell binary: render the actionable inline error with a
          // deep-link into Settings → Tools instead of the output card.
          // See change: register-bash-and-tool-install-help.
          if (args?.missingTool?.kind === "missing-tool") {
            return (
              <MissingToolInlineError key={msg.id} toolName={args.missingTool.toolName} />
            );
          }
          return (
            <BashOutputCard
              key={msg.id}
              command={args?.command ?? ""}
              output={msg.content}
              exitCode={args?.exitCode ?? 0}
              excludeFromContext={args?.excludeFromContext ?? false}
              source={args?.source}
              timestamp={msg.timestamp}
            />
          );
        }

        if (msg.role === "inlineTerminal") {
          const args = msg.args as any;
          return (
            <InlineTerminalCard
              key={msg.id}
              terminalId={args?.terminalId ?? ""}
              closed={args?.closed ?? false}
              transcript={msg.content}
              onClose={(tid) => onCloseInlineTerminal?.(tid)}
            />
          );
        }

        if (msg.role === "commandFeedback") {
          const args = msg.args as any;
          return (
            <CommandFeedbackCard
              key={msg.id}
              command={args?.command ?? ""}
              status={args?.status ?? "started"}
              message={msg.content || undefined}
            />
          );
        }

        if (msg.role === "interactiveUi") {
          const args = msg.args as any;
          // Suppress widget-bar-placed prompts from chat. A widget-bar slot
          // owns the render (e.g. the flow plugin's FlowQuestionCard). The
          // shell uses the placement primitive only — no plugin-specific
          // component-type literals. See change: fix-flows-plugin-polish (B2).
          const cmp = (args?.params as Record<string, unknown> | undefined)?._promptBusComponent as
            | { type?: string }
            | undefined;
          if (cmp?.type && isWidgetBarPrompt(cmp.type)) {
            return null;
          }
          // Second gate site, mirroring the `rawEvent` precedent below: the
          // filter above already drops sub-floor notifies, so this is the
          // defensive half of the D3 pair — it must never disagree with it.
          // See change: gate-notify-rows-by-level.
          if (
            !isNotifyRowVisible(
              {
                content: msg.content,
                method: args?.method,
                level: (args?.params as Record<string, unknown> | undefined)?.level,
              },
              prefs.notifyMinLevel,
            )
          ) {
            return null;
          }
          const request: InteractiveUiRequest = {
            requestId: args.requestId,
            method: args.method,
            params: args.params,
            status: args.status,
            result: args.result,
          };
          return (
            <InteractiveUiCard
              key={msg.id}
              request={request}
              onRespondToUi={onRespondToUi}
            />
          );
        }

        if (msg.role === "custom") {
          // Mirrored gate (isRowVisible already filters; render branch keeps
          // the branch safe if reached via another path). See change:
          // render-inline-reasoning-and-custom-entries (D7).
          if (!prefs.customEntryFallback) return null;
          return (
            <CustomEntryCard
              key={msg.id}
              customType={msg.customType ?? "custom"}
              body={msg.content}
              timestamp={msg.timestamp}
            />
          );
        }

        if (msg.role === "rawEvent") {
          if (!showDebugTools) return null;
          return (
            <RawEventCard
              key={msg.id}
              eventType={msg.toolName ?? "unknown"}
              content={msg.content}
              timestamp={msg.timestamp}
            />
          );
        }

        // assistant
        const bMax = hasMermaid(msg.content) ? bubbleWide : bubbleMax;
        return (
          <div key={msg.id} className="mt-4 mb-4 flex justify-start">
            <MessageBubble
              content={msg.content}
              className={`bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-md px-4 py-2 ${bMax}`}
              timestamp={msg.timestamp}
              entryId={msg.entryId}
              onFork={onForkFromMessage}
              context={toolContext}
            />
          </div>
        );
              })()}
            </div>
          );
        })}
      </div>

      {/* Streaming thinking. `chat-cv-skip` opts the live tail out of the
          content-visibility optimization so it is never skipped. See change:
          reduce-chat-render-cpu-umbrella (Phase 2, task 4.2). */}
      {state.streamingThinking && prefs.reasoning && (
        <div className="chat-cv-skip">
          <ThinkingBlock
            content={state.streamingThinking}
            isStreaming
            defaultExpanded
            startedAt={state.thinkingStartedAt}
            onUserCollapse={onCollapseStreamingThinking}
            inlineFlow={prefs.reasoningInlineFlow}
          />
        </div>
      )}

      {/* Streaming text — carries the same liveness cue as a running group
          (edge-pulse glow + shimmer sweep) while the turn is alive. Settles
          static the instant streaming ends. See change: enhance-tool-call-grouping.
          `streamingTailText` is the frozen snapshot while a tail selection is
          held (buffering chunks + surviving the message_end unmount), else the
          live streamingText. See change: preserve-streaming-tail-selection. */}
      {streamingTailText && (
        <div ref={tailContainerRef} className="flex justify-start chat-cv-skip">
          <div ref={streamFxRef} className={`chat-stream-live bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-md px-4 py-2 ${hasMermaid(streamingTailText) ? bubbleWide : bubbleMax}`}>
            <MarkdownContent content={streamingTailText} context={toolContext} />
            {state.streamingText && (
              <span className="inline-block w-1.5 h-4 bg-[var(--bg-surface)] animate-pulse ml-0.5" />
            )}
          </div>
        </div>
      )}

      {/* Retry banner + Error banner replaced by the unified SessionBanner
          mounted in App.tsx, sticky above the command input. Race overlap
          between yellow + red is impossible by construction — the selector
          picks exactly one variant. See change:
          unify-status-banner-and-terminal-limit-stop. */}

      {/* In-progress turn change summary (change: add-change-summary-table):
          the final turn has no following user message to anchor above, so its
          block renders at the stream tail. */}
      {tailSummary && (
        <div className="mx-4">
          <ChangeSummaryBlock summary={tailSummary} onOpenFile={openDiffFile} />
        </div>
      )}

      {/* Inline-chat steering: pending steer entries render here as user-style
          bubbles, positioned at the bottom of the chat list. Once pi drains
          the entry on turn_end, the bridge splices the shadow (drain-by-
          matcher), the bubble disappears, and the chat shows the prompt as a
          regular user message via the subsequent `message_end`. Display only
          — pi exposes no queue-mutation API to extensions. See change:
          honest-mid-turn-queue-surface. */}
      {pendingSteering && pendingSteering.length > 0 && pendingSteering.map((steerText, idx) => (
        <div key={`pending-steer-${idx}-${steerText.slice(0, 16)}`} data-testid="pending-steer-card" className="mt-4 mb-4 flex justify-end chat-cv-skip">
          <div className={`relative bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax}`}>
            <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-blue-400/80 font-medium">
              <Icon path={mdiLoading} size={0.45} className="animate-spin" />
              {i18nT("session.steering", undefined, "Steering")}
            </div>
            <MarkdownContent content={steerText} />
          </div>
        </div>
      ))}

      {/* Grouped multi-ask panel: concurrently-pending free-floating asks
          render here as one cohesive stack, each answering its own requestId.
          Hidden inline (isRowVisible) while pending; reappears inline as an
          answered/history card once resolved. See change:
          surface-concurrent-ask-user-prompts. */}
      <MultiAskPanel requests={pendingFreeFloating} onRespondToUi={onRespondToUi} />

      {/* Optimistic pending-prompt card (idle-scoped). Re-wired write site in
          useSessionActions.handleSend / handleSendPromptToSession. Two progress
          states keyed off `pendingPrompt.status`, sharing identical bubble
          geometry with a server-sourced user card so confirmation causes zero
          layout shift. No queue-text suppression: idle-scoping guarantees the
          card can never co-exist with a mid-turn queue chip.
          See change: optimistic-prompt-progress. */}
      {state.pendingPrompt && (
        <div data-testid="pending-prompt-card" data-status={state.pendingPrompt.status} className="mt-4 mb-4 flex justify-end">
          <div className={`bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax} ${state.pendingPrompt.status === "sending" ? "opacity-60 prompt-sending-fx prompt-edge-pulse" : ""}`}>
            {state.pendingPrompt.images && state.pendingPrompt.images.length > 0 && (
              <ImageAttachments images={state.pendingPrompt.images} sessionId={sessionId} />
            )}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <MarkdownContent content={state.pendingPrompt.text} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                {state.pendingPrompt.status === "sending" ? (
                  <>
                    <Icon path={mdiLoading} size={0.7} className="animate-spin text-blue-400" />
                    <span className="text-[10px] text-blue-400/70 font-medium">sending</span>
                  </>
                ) : state.pendingPrompt.status === "failed" ? (
                  /* Failed arm: the prompt text is preserved so the user can
                     retry; never the emerald success tick.
                     See change: fix-optimistic-prompt-stuck-sending. */
                  <>
                    <Icon path={mdiAlertCircleOutline} size={0.7} className="text-red-400" />
                    <span className="text-[10px] text-red-400/80 font-medium" data-testid="pending-prompt-failed">not sent</span>
                  </>
                ) : (
                  <>
                    <Icon path={mdiCheck} size={0.7} className="text-emerald-400 prompt-tick-in" />
                    <span className="text-[10px] text-emerald-400/80 font-medium" data-testid="pending-prompt-sent">sent</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        3-way empty state (see change: show-chat-history-loading-indicator):
        loading spinner while history is in flight, "No messages yet" for a
        genuinely-empty session, else nothing (bubbles render above).
      */}
      {state.messages.length === 0 && !state.streamingText && !state.pendingPrompt && !(pendingSteering && pendingSteering.length > 0) && (
        loadingHistory ? (
          <div
            className="flex flex-col gap-3 px-4 py-3"
            aria-busy="true"
            role="status"
            aria-label={i18nT("status.loadingConversation", undefined, "Loading conversation…")}
            data-testid="chat-history-skeleton"
          >
            <Skeleton variant="bubble" count={3} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title={i18nT("session.noMessagesYet", undefined, "No messages yet")}
              body={i18nT(
                "session.noMessagesYetBody",
                undefined,
                "Send a prompt below to start the conversation.",
              )}
            />
          </div>
        )
      )}
    </div>
    {/*
      Auto-load announcement. Lives HERE, outside the virtualized list, because
      a live region only announces if it is in the DOM when its text changes —
      and the gap divider is a virtualized row that the virtualizer unmounts
      once a splice pushes it out of the overscan band.

      POLITE, never assertive: content inserted above the reading position is
      not urgent and must not interrupt reading. The splice never moves focus.
      Scoped to AUTOMATIC loads (see `autoLoadedCount`), so a user who pressed
      the affordance, or any head-tail user, observes nothing new.
      See change: add-tail-only-replay-window (test-plan F16, F21).
    */}
    <div aria-live="polite" className="sr-only" data-testid="history-gap-live-region">
      {autoLoadedCount != null && autoLoadedCount > 0
        ? i18nT(
            "chat.historyGap.announced",
            { count: autoLoadedCount.toLocaleString() },
            `${autoLoadedCount.toLocaleString()} earlier messages loaded`,
          )
        : ""}
    </div>
    {/*
      Replay-in-flight indicator: a decorative tail scrim + a centred label.
      Both OVERLAY the list (absolutely positioned siblings, like the scroll
      buttons) rather than inserting a row or trailing padding, so they cannot
      perturb scroll anchoring. Indeterminate by design — no count, total, or
      percentage. Mutually exclusive with the loading skeleton, which only
      renders while the message list is empty.

      Both are rendered under the SAME condition so a scrim can never be left
      dimming the transcript after its label has gone. The label sits at 64px
      (`bottom-16`); the scroll-to-bottom button is `bottom-4` + `p-2` around a
      0.8 icon, so it spans roughly 16..51px — ~13px of clearance, separated by
      LAYOUT, not paint order. Both are centred (`left-1/2 -translate-x-1/2`),
      so the clearance is purely vertical and therefore identical at every
      viewport width rather than lucky at one. Do NOT reposition the
      scroll controls below: their resting position must not depend on replay
      state. See change: fix-replay-pill-a11y-and-collision.
    */}
    {showReplayPill && state.messages.length > 0 && (
      <>
        <div
          data-testid="replay-in-flight-scrim"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-28 bg-gradient-to-t from-[var(--bg-primary)] to-transparent"
        />
        <div
          data-testid="replay-in-flight-pill"
          role="status"
          aria-busy="true"
          className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-strong)] px-3 py-1 shadow-lg"
        >
          <Icon path={mdiLoading} size={0.6} className="animate-spin text-[var(--text-primary)]" />
          <span className="text-[11px] text-[var(--text-primary)]">
            {i18nT("status.loadingHistoryInFlight", undefined, "Loading earlier messages…")}
          </span>
        </div>
      </>
    )}
    {showScrollTopButton && (
      <button
        data-testid="scroll-to-top"
        onClick={scrollToTop}
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-full p-2 shadow-lg hover:bg-[var(--bg-surface)] transition-colors"
        title={i18nT("common.scrollToTop", undefined, "Scroll to top")}
      >
        <Icon path={mdiChevronUp} size={0.8} className="text-[var(--text-secondary)]" />
      </button>
    )}
    {showScrollButton && (
      <button
        data-testid="scroll-to-bottom"
        onClick={scrollToBottom}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-full p-2 shadow-lg hover:bg-[var(--bg-surface)] transition-colors"
        title={i18nT("common.scrollToBottom", undefined, "Scroll to bottom")}
      >
        <Icon path={mdiChevronDown} size={0.8} className="text-[var(--text-secondary)]" />
      </button>
    )}
    </div>
    <FilePreviewHost />
    </FilePreviewProvider>
  );
});

// Memoized so keystrokes into the command input (which re-render App) do not
// re-render the full transcript. Prerequisite for honest Phase 3 batching
// measurement — un-memoized renders otherwise mask the gains.
// See change: reduce-chat-render-cpu-umbrella (Phase 4).
// Props are stabilized at the call site (App.tsx): the 4 previously-unstable
// props (onForkFromMessage, onCloseInlineTerminal, onCollapseStreamingThinking,
// pendingSteering) are now referentially stable via useCallback / EMPTY const.
export const ChatView = React.memo(ChatViewInner);
