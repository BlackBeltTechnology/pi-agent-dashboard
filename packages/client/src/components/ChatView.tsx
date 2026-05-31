import React, { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { Icon } from "@mdi/react";
import { mdiContentCopy, mdiTextBox, mdiLoading, mdiChevronDown, mdiSourceFork, mdiClose } from "@mdi/js";
// RetryBanner + ErrorBanner replaced by the unified SessionBanner mounted
// in App.tsx (sticky above the command input). See change:
// unify-status-banner-and-terminal-limit-stop.
import type { SessionState, ChatImage, InteractiveUiRequest } from "../lib/event-reducer.js";
import type { ToolContext } from "./tool-renderers/index.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { CopyButton } from "./CopyButton.js";
import { ToolCallStep } from "./ToolCallStep.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { BashOutputCard } from "./BashOutputCard.js";
import { CommandFeedbackCard } from "./CommandFeedbackCard.js";
import { RawEventCard } from "./RawEventCard.js";
import { formatMessageTime } from "../lib/format.js";
import { useMobile } from "../hooks/useMobile.js";
import { isDebugTool } from "../hooks/useDebugToolsVisible.js";
import { useDisplayPrefs } from "../hooks/useDisplayPrefs.js";
import { toolCallPrefKey } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { getInteractiveRenderer } from "./interactive-renderers/registry.js";
import { isWidgetBarPrompt } from "@blackbelt-technology/dashboard-plugin-runtime";
import { groupConsecutiveToolCalls, type ChatItem, type ToolCallGroup } from "../lib/group-tool-calls.js";
import { CollapsedToolGroup } from "./CollapsedToolGroup.js";
import { findRetriedErrorIds, findActiveInteractiveToolResultIds } from "../lib/collapse-retried-errors.js";
import { RetriedErrorBadge } from "./RetriedErrorBadge.js";
import { ImageLightbox } from "./ImageLightbox.js";
import { SkillInvocationCard } from "./SkillInvocationCard.js";
import { PreviewCard } from "./PreviewCard.js";
import { ChatViewMenu } from "./ChatViewMenu.js";
import type { DisplayPrefs, PartialDisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

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
  // onDismissError / onRetryAfterError moved to App.tsx → SessionBanner.
  // See change: unify-status-banner-and-terminal-limit-stop.
  /**
   * Texts currently in the bridge-owned mid-turn queue. When `pendingPrompt.text`
   * matches an entry, the optimistic card is suppressed in favour of the
   * queue chip rendered by `QueuePanel`. See modified `optimistic-prompt`
   * capability + change `surface-mid-turn-prompt-queue`.
   */
  queuedTexts?: string[];
  /**
   * Pending steer messages from `Session.pendingQueues.steering`. Rendered
   * inline at the bottom of the chat list as user-style bubbles with a
   * "STEERING" header + spinner + ✕ cancel. Once pi drains them on
   * `turn_end`, the bridge clears the shadow and the chat naturally shows
   * the real user message via `message_end`. See change: add-followup-edit-and-steer-cancel.
   */
  pendingSteering?: string[];
  // onCancelSteering / onCancelPending omitted: pi exposes no queue-mutation
  // API. Steering bubbles render display-only; cancellation requires upstream
  // pi support (tracked separately). See change: honest-mid-turn-queue-surface.
  /**
   * Send the per-session display-prefs override. Optional — omit when the
   * menu should not render (e.g. archived/dataUnavailable views).
   * See change: configurable-chat-display.
   */
  onSetDisplayPrefs?: (override: PartialDisplayPrefs | null) => void;
  /** Current sparse override for the session, or `undefined`. */
  displayPrefsOverride?: PartialDisplayPrefs;
}

function ImageAttachments({ images }: { images: ChatImage[] }) {
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; alt: string } | null>(null);
  return (
    <>
      <div className="flex gap-2 flex-wrap mb-2">
        {images.map((img, i) => {
          const src = `data:${img.mimeType};base64,${img.data}`;
          return (
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1}`}
              className="max-w-[300px] max-h-[300px] rounded border border-white/20 object-contain cursor-pointer"
              onClick={() => setLightboxSrc({ src, alt: `Attachment ${i + 1}` })}
            />
          );
        })}
      </div>
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc.src} alt={lightboxSrc.alt} onClose={() => setLightboxSrc(null)} />
      )}
    </>
  );
}

function MessageBubble({ content, className, timestamp, entryId, onFork }: { content: string; className: string; timestamp?: number; entryId?: string; onFork?: (entryId: string) => void }) {
  const contentRef = useRef<HTMLDivElement>(null);

  const getPlainText = useCallback(() => {
    return contentRef.current?.innerText ?? content;
  }, [content]);

  return (
    <div className={className}>
      <div ref={contentRef}>
        <MarkdownContent content={content} />
      </div>
      <div className="border-t border-[var(--border-secondary)] mt-2 pt-1.5 flex justify-end items-center gap-0.5 opacity-50 hover:opacity-100 transition-opacity">
        {timestamp != null && (
          <span className="text-[10px] text-[var(--text-tertiary)] mr-auto">{formatMessageTime(timestamp)}</span>
        )}
        <CopyButton text={content} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy as Markdown" />
        <CopyButton text={getPlainText()} icon={<Icon path={mdiTextBox} size={0.6} />} title="Copy as plain text" />
        {entryId && onFork && (
          <button
            onClick={() => onFork(entryId)}
            title="Fork from here"
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

// Per-session scroll state, persisted across session switches
const scrollStateMap = new Map<string, { scrollTop: number; nearBottom: boolean }>();

export interface ChatViewHandle {
  scrollToTurn: (turnIndex: number) => void;
}

export const ChatView = forwardRef<ChatViewHandle, Props>(function ChatView({ sessionId, state, toolContext, onRespondToUi, onAbort, onForceKill, onForkFromMessage, queuedTexts, pendingSteering, onSetDisplayPrefs, displayPrefsOverride }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);
  const programmaticScroll = useRef(false);
  // Race-safe across multi-batch event_replay: when ChatView itself initiates a
  // scroll, the resulting onScroll can fire after another replay batch has grown
  // scrollHeight, making handleScroll misread the geometry as "user scrolled up".
  // markProgrammatic() raises programmaticScroll for ~150ms so handleScroll
  // ignores any onScroll attributable to our own scrollTo call.
  const programmaticTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markProgrammatic = useCallback(() => {
    programmaticScroll.current = true;
    if (programmaticTimeout.current) clearTimeout(programmaticTimeout.current);
    programmaticTimeout.current = setTimeout(() => {
      programmaticScroll.current = false;
      programmaticTimeout.current = null;
    }, 150);
  }, []);
  useEffect(() => () => {
    if (programmaticTimeout.current) clearTimeout(programmaticTimeout.current);
  }, []);
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Effective display prefs for this session (configurable-chat-display).
  const prefs = useDisplayPrefs(sessionId);
  const showDebugTools = prefs.debugTools;
  const prevSessionRef = useRef(sessionId);
  const isMobile = useMobile();
  const bubbleMax = isMobile ? "max-w-[95%]" : "max-w-[80%]";
  /** Force wide when message contains a mermaid diagram */
  const bubbleWide = isMobile ? "w-[95%]" : "w-[95%]";

  const handleScroll = useCallback(() => {
    // Suppress scroll measurements caused by our own programmatic scrollTo. The
    // onScroll event lags scrollTo and can fire after the next replay batch has
    // grown scrollHeight; measuring then would falsely conclude the user scrolled
    // away from the bottom. Only real user gestures should reach this code path.
    if (programmaticScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD;
    isNearBottom.current = nearBottom;
    setShowScrollButton(!nearBottom);
    // Persist scroll position for this session
    if (sessionId) {
      scrollStateMap.set(sessionId, { scrollTop: el.scrollTop, nearBottom });
    }
  }, [sessionId]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    isNearBottom.current = true;
    setShowScrollButton(false);
    if (sessionId) {
      scrollStateMap.set(sessionId, { scrollTop: el.scrollHeight, nearBottom: true });
    }
  }, [sessionId]);

  // Save scroll state when leaving, restore when arriving
  useEffect(() => {
    if (sessionId !== prevSessionRef.current) {
      // Save outgoing session scroll position
      const prevId = prevSessionRef.current;
      if (prevId && scrollRef.current) {
        scrollStateMap.set(prevId, {
          scrollTop: scrollRef.current.scrollTop,
          nearBottom: isNearBottom.current,
        });
      }
      prevSessionRef.current = sessionId;

      // Restore incoming session scroll state
      const saved = sessionId ? scrollStateMap.get(sessionId) : undefined;
      if (saved && !saved.nearBottom) {
        // Scroll-locked: restore exact position
        isNearBottom.current = false;
        setShowScrollButton(true);
        requestAnimationFrame(() => {
          markProgrammatic();
          scrollRef.current?.scrollTo(0, saved.scrollTop);
        });
      } else {
        // Near bottom or first visit: scroll to end
        isNearBottom.current = true;
        setShowScrollButton(false);
        requestAnimationFrame(() => {
          markProgrammatic();
          scrollRef.current?.scrollTo(0, scrollRef.current!.scrollHeight);
        });
      }
    }
  }, [sessionId]);

  // Auto-scroll on new content when near bottom. We deliberately do NOT gate on
  // programmaticScroll here — repeated replay batches must keep chasing the tail.
  // The flag is only consulted inside handleScroll to ignore the spurious onScroll
  // events that follow each scrollTo. scrollToTurn opts out by setting
  // isNearBottom.current = false, which still gates this effect.
  useEffect(() => {
    if (isNearBottom.current) {
      requestAnimationFrame(() => {
        markProgrammatic();
        scrollRef.current?.scrollTo(0, scrollRef.current!.scrollHeight);
      });
    }
  }, [state.messages.length, state.streamingText, state.pendingPrompt, markProgrammatic]);

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
  const groupedMessages = useMemo(() => groupConsecutiveToolCalls(filteredMessages), [filteredMessages]);
  const retriedErrorIds = useMemo(() => findRetriedErrorIds(filteredMessages), [filteredMessages]);
  const hiddenToolResultIds = useMemo(() => findActiveInteractiveToolResultIds(filteredMessages), [filteredMessages]);

  useImperativeHandle(ref, () => ({
    scrollToTurn(turnIndex: number) {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-turn="${turnIndex}"]`) as HTMLElement | null;
      if (!el) return;
      // Suppress auto-scroll during programmatic navigation
      programmaticScroll.current = true;
      isNearBottom.current = false;
      setShowScrollButton(true);
      // Use getBoundingClientRect for reliable position calculation
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetTop = container.scrollTop + (elRect.top - containerRect.top);
      container.scrollTo({ top: targetTop, behavior: "instant" });
      // Re-enable auto-scroll after a delay
      setTimeout(() => { programmaticScroll.current = false; }, 200);
    },
  }), []);

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col">
    {/* Top toolbar: per-session view menu (configurable-chat-display) */}
    {sessionId && onSetDisplayPrefs && (
      <div className="flex items-center justify-end px-2 py-1 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/50">
        <ChatViewMenu
          sessionId={sessionId}
          send={(msg) => onSetDisplayPrefs(msg.override)}
          currentOverride={displayPrefsOverride}
        />
      </div>
    )}
    <div ref={scrollRef} onScroll={handleScroll} className={`h-full overflow-y-auto ${isMobile ? "p-2" : "p-4"} space-y-1`}>
      {groupedMessages.map((item, idx) => {
        // Collapsed group of repeated tool calls
        if ((item as ToolCallGroup).type === "group") {
          const group = item as ToolCallGroup;
          return <CollapsedToolGroup key={`group-${idx}`} group={group} toolContext={toolContext} />;
        }

        const msg = item as import("../lib/event-reducer.js").ChatMessage;

        // `/view` preview rows render as a `PreviewCard` regardless of role.
        // Filtered out of the pi-bound message stream by the bridge so the
        // agent never observes them. See change: render-file-previews.
        if (msg.view) {
          return (
            <div key={msg.id} className="mt-4 mb-4 flex justify-end" {...(msg.turnIndex != null ? { "data-turn": msg.turnIndex } : {})}>
              <div className={bubbleMax}>
                <PreviewCard target={msg.view} />
              </div>
            </div>
          );
        }

        if (msg.role === "turnSeparator") {
          if (!prefs.turnMetadata) return null;
          return <div key={msg.id} className="mx-4 my-2 border-t border-[var(--border-subtle)]" />;
        }

        if (msg.role === "user") {
          // Skill invocations render as a distinct collapsible card so chat
          // doesn't show walls of expanded skill body. Plain user messages
          // continue to render as the existing blue bubble.
          // See change: render-skill-invocations-collapsibly.
          if (msg.skill) {
            return (
              <div key={msg.id} className="mt-4 mb-4 flex justify-end" {...(msg.turnIndex != null ? { "data-turn": msg.turnIndex } : {})}>
                <div className={bubbleMax}>
                  {msg.images && msg.images.length > 0 && (
                    <div className="mb-2">
                      <ImageAttachments images={msg.images} />
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
            );
          }
          return (
            <div key={msg.id} className="mt-4 mb-4 flex justify-end" {...(msg.turnIndex != null ? { "data-turn": msg.turnIndex } : {})}>
              <div className={`bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax}`}>
                {msg.images && msg.images.length > 0 && (
                  <ImageAttachments images={msg.images} />
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
          if (retriedErrorIds.has(msg.id)) {
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
          return (
            <BashOutputCard
              key={msg.id}
              command={args?.command ?? ""}
              output={msg.content}
              exitCode={args?.exitCode ?? 0}
              excludeFromContext={args?.excludeFromContext ?? false}
              timestamp={msg.timestamp}
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
            />
          </div>
        );
      })}

      {/* Streaming thinking */}
      {state.streamingThinking && prefs.reasoning && (
        <ThinkingBlock
          content={state.streamingThinking}
          isStreaming
          defaultExpanded
          startedAt={state.thinkingStartedAt}
        />
      )}

      {/* Streaming text */}
      {state.streamingText && (
        <div className="flex justify-start">
          <div className={`bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-md px-4 py-2 ${hasMermaid(state.streamingText) ? bubbleWide : bubbleMax}`}>
            <MarkdownContent content={state.streamingText} />
            <span className="inline-block w-1.5 h-4 bg-[var(--bg-surface)] animate-pulse ml-0.5" />
          </div>
        </div>
      )}

      {/* Retry banner + Error banner replaced by the unified SessionBanner
          mounted in App.tsx, sticky above the command input. Race overlap
          between yellow + red is impossible by construction — the selector
          picks exactly one variant. See change:
          unify-status-banner-and-terminal-limit-stop. */}

      {/* Inline-chat steering: pending steer entries render here as user-style
          bubbles, positioned at the bottom of the chat list. Once pi drains
          the entry on turn_end, the bridge splices the shadow (drain-by-
          matcher), the bubble disappears, and the chat shows the prompt as a
          regular user message via the subsequent `message_end`. Display only
          — pi exposes no queue-mutation API to extensions. See change:
          honest-mid-turn-queue-surface. */}
      {pendingSteering && pendingSteering.length > 0 && pendingSteering.map((steerText, idx) => (
        <div key={`pending-steer-${idx}-${steerText.slice(0, 16)}`} data-testid="pending-steer-card" className="mt-4 mb-4 flex justify-end">
          <div className={`relative bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax}`}>
            <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-blue-400/80 font-medium">
              <Icon path={mdiLoading} size={0.45} className="animate-spin" />
              Steering
            </div>
            <MarkdownContent content={steerText} />
          </div>
        </div>
      ))}

      {/* Legacy optimistic pending prompt card. Write site removed in v2;
          this block stays dead-code so existing fixtures keep validating.
          See change: surface-mid-turn-prompt-queue. */}
      {state.pendingPrompt && !(queuedTexts?.includes(state.pendingPrompt.text)) && (
        <div data-testid="pending-prompt-card" className="mt-4 mb-4 flex justify-end">
          <div className={`bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md px-4 py-2 ${bubbleMax}`}>
            {state.pendingPrompt.images && state.pendingPrompt.images.length > 0 && (
              <ImageAttachments images={state.pendingPrompt.images} />
            )}
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <MarkdownContent content={state.pendingPrompt.text} />
              </div>
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                {state.pendingPrompt.delivery === "steer" ? (
                  <span className="text-[10px] text-blue-400/70 font-medium">steering</span>
                ) : state.pendingPrompt.delivery === "followUp" ? (
                  <span className="text-[10px] text-amber-400/70 font-medium">follow-up</span>
                ) : null}
                <Icon path={mdiLoading} size={0.7} className="animate-spin text-blue-400" />
              </div>
            </div>
          </div>
        </div>
      )}

      {state.messages.length === 0 && !state.streamingText && !(state.pendingPrompt && !(queuedTexts?.includes(state.pendingPrompt.text))) && !(pendingSteering && pendingSteering.length > 0) && (
        <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
          <p>No messages yet</p>
        </div>
      )}
    </div>
    {showScrollButton && (
      <button
        data-testid="scroll-to-bottom"
        onClick={scrollToBottom}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-full p-2 shadow-lg hover:bg-[var(--bg-surface)] transition-colors"
        title="Scroll to bottom"
      >
        <Icon path={mdiChevronDown} size={0.8} className="text-[var(--text-secondary)]" />
      </button>
    )}
    </div>
  );
});
