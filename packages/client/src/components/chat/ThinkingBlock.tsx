import { mdiChevronDown, mdiChevronRight, mdiHeadLightbulb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ElapsedBadge } from "../session/ElapsedBadge.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

interface Props {
  content: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
  startedAt?: number;
  duration?: number;
  /**
   * True when this persisted block was streamed live in the current view.
   * Live blocks mount expanded and arm the auto-collapse timer; replayed
   * blocks (falsy) mount collapsed with no timer.
   * See change: reasoning-auto-collapse-timer.
   */
  streamedLive?: boolean;
  /**
   * Milliseconds to hold a live-streamed block open before auto-collapsing.
   * `0` (or absent) = never auto-collapse. Captured at mount; a mid-window
   * change does NOT restart the timer.
   * See change: reasoning-auto-collapse-timer.
   */
  autoCollapseMs?: number;
  /**
   * When true, a live-streamed block stays expanded for the whole active turn
   * (the `autoCollapseMs` timer is suppressed) and collapses on the turn-end
   * edge (`turnActive` true→false). When false, `autoCollapseMs` governs.
   * See change: keep-reasoning-open-until-turn-ends.
   */
  keepOpenUntilTurnEnds?: boolean;
  /**
   * True while the session turn is streaming. Only consulted when
   * `keepOpenUntilTurnEnds` is set. See change: keep-reasoning-open-until-turn-ends.
   */
  turnActive?: boolean;
  /**
   * Called when the user manually collapses the LIVE streaming block. Lets the
   * parent lift the collapse into session state so it survives the swap.
   * See change: reasoning-auto-collapse-timer.
   */
  onUserCollapse?: () => void;
}

export function ThinkingBlock({
  content,
  isStreaming,
  defaultExpanded = false,
  startedAt,
  duration,
  streamedLive,
  autoCollapseMs,
  keepOpenUntilTurnEnds,
  turnActive,
  onUserCollapse,
}: Props) {
  // Live blocks mount expanded (0 disables the TIMER, not the open state);
  // replayed blocks mount collapsed. The streaming block uses defaultExpanded.
  const [expanded, setExpanded] = useState(streamedLive ?? defaultExpanded);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchedRef = useRef(false);
  // Per-block latch for the turn-scoped hold: set once this block collapses on
  // its OWN turn-end edge. `turnActive` is session-wide in ChatView, so without
  // this latch a later turn (turnActive false→true again) would reopen every
  // untouched historical block. Once latched, the hold never reopens the block.
  // See change: collapse-tool-calls-across-narration.
  const turnEndedRef = useRef(false);
  // autoCollapseMs captured at mount — deliberately NOT an effect dep, so a
  // mid-window pref change never restarts an in-flight timer (W1).
  const msRef = useRef(autoCollapseMs ?? 0);

  // Effect 1 — per-block ms auto-collapse timer + demotion (original behavior).
  // Governs ONLY when the turn-scoped hold is OFF. `turnActive` is deliberately
  // NOT a dep here: when keepOpenUntilTurnEnds is false, a turn-end status
  // change must not clear+re-arm an in-flight timer (that would reset the
  // collapse countdown to fire relative to turn-end instead of when the block
  // finished). See change: keep-reasoning-open-until-turn-ends.
  useEffect(() => {
    // The live streaming block is user-controlled only: no timer, no demotion.
    // Auto-collapse applies solely to the persisted role="thinking" block.
    if (isStreaming) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // User owns the block after any manual toggle — never auto-touch.
    if (touchedRef.current) return;
    // Demotion (C2): a block that was live but is now replay (reconnect
    // re-replay) collapses instead of hanging open forever.
    if (!streamedLive) {
      setExpanded(false);
      return;
    }
    // Turn-scoped hold governs instead; ms timer suppressed (effect 2 owns it).
    if (keepOpenUntilTurnEnds) return;
    if (msRef.current > 0) {
      timerRef.current = setTimeout(() => {
        if (!touchedRef.current) setExpanded(false);
      }, msRef.current);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [streamedLive, isStreaming, keepOpenUntilTurnEnds]);

  // Effect 2 — turn-scoped hold. Active ONLY when keepOpenUntilTurnEnds. Keeps a
  // live block expanded while turnActive, collapses on the true→false edge.
  // Demotion (!streamedLive) and the manual-toggle freeze are handled by
  // effect 1 / touchedRef. See change: keep-reasoning-open-until-turn-ends.
  useEffect(() => {
    if (!keepOpenUntilTurnEnds) return;
    if (isStreaming) return;
    if (touchedRef.current) return;
    if (!streamedLive) return;
    // Latched: this block already handled its own turn-end collapse; a later
    // session-wide turn must not reopen it.
    if (turnEndedRef.current) return;
    if (turnActive) {
      setExpanded(true);
    } else {
      turnEndedRef.current = true;
      setExpanded(false);
    }
  }, [keepOpenUntilTurnEnds, turnActive, streamedLive, isStreaming]);

  const onToggle = () => {
    touchedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setExpanded((v) => {
      const nextExpanded = !v;
      if (!nextExpanded) onUserCollapse?.();
      return nextExpanded;
    });
  };

  return (
    <div className="mx-4 border-l-2 border-purple-500/30 pl-3" data-testid="reasoning-block">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] w-full text-left"
      >
        <span className="inline-flex text-purple-400">
          <Icon path={mdiHeadLightbulb} size={0.55} />
        </span>
        <span className="truncate">
          {i18nT("session.reasoning", undefined, "Reasoning")}
          {isStreaming && <span className="ml-1 animate-pulse">…</span>}
        </span>
        <ElapsedBadge startedAt={startedAt} duration={duration} />
        <span className="ml-auto text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && (
        <div data-testid="reasoning-body" className="mt-1 ml-4 p-2 bg-purple-500/5 rounded-xl shadow-md border border-purple-500/10 text-xs text-[var(--text-secondary)] overflow-x-auto max-h-[400px] overflow-y-auto">
          <MarkdownContent content={content} />
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-purple-400/50 animate-pulse ml-0.5" />
          )}
        </div>
      )}
    </div>
  );
}
