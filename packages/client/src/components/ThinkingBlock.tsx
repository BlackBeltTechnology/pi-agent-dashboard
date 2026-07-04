import { mdiChevronDown, mdiChevronRight, mdiHeadLightbulb } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../lib/i18n";
import { ElapsedBadge } from "./ElapsedBadge.js";
import { MarkdownContent } from "./MarkdownContent.js";

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
  onUserCollapse,
}: Props) {
  // Live blocks mount expanded (0 disables the TIMER, not the open state);
  // replayed blocks mount collapsed. The streaming block uses defaultExpanded.
  const [expanded, setExpanded] = useState(streamedLive ?? defaultExpanded);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchedRef = useRef(false);
  // autoCollapseMs captured at mount — deliberately NOT an effect dep, so a
  // mid-window pref change never restarts an in-flight timer (W1).
  const msRef = useRef(autoCollapseMs ?? 0);

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
  }, [streamedLive, isStreaming]);

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
          {i18nT("auto.reasoning", undefined, "Reasoning")}
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
