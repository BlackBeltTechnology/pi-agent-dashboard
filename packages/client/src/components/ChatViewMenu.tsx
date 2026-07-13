/**
 * ChatViewMenu — Discord-style "⚙ View ▾" popover for per-session
 * display overrides. Lives in the ChatView toolbar; sends
 * `setSessionDisplayPrefs` WS messages.
 *
 * See change: configurable-chat-display.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Icon } from "@mdi/react";
import { mdiCog, mdiCircleSmall } from "@mdi/js";
import {
  type DisplayPrefs,
  type PartialDisplayPrefs,
} from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { useDisplayPrefs } from "../hooks/useDisplayPrefs.js";
import { usePopoverFlip } from "../hooks/usePopoverFlip.js";
import { useDisplayPrefsContext } from "../lib/DisplayPrefsContext.js";
import { t as i18nT } from "../lib/i18n";

type ToolCallPatch = Partial<DisplayPrefs["toolCalls"]>;
type DisplayPrefsPatch =
  Partial<Omit<DisplayPrefs, "toolCalls">> & { toolCalls?: ToolCallPatch };

interface Props {
  sessionId: string;
  /** WS send function (from App via prop drilling / shared `send`). */
  send: (msg: {
    type: "setSessionDisplayPrefs";
    sessionId: string;
    override: PartialDisplayPrefs | null;
  }) => void;
  /**
   * Current sparse override on the session (`session.displayPrefsOverride`).
   * Used to compute the deep-merged override on each toggle (so partial
   * fields accumulate rather than replacing each other).
   */
  currentOverride: PartialDisplayPrefs | undefined;
}

export function ChatViewMenu({ sessionId, send, currentOverride }: Props): React.ReactElement {
  const { global } = useDisplayPrefsContext();
  const prefs = useDisplayPrefs(sessionId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { flipUp, maxHeight } = usePopoverFlip(triggerRef, { open });

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const patch = useCallback((delta: DisplayPrefsPatch) => {
    const next: PartialDisplayPrefs = {
      ...(currentOverride ?? {}),
      ...delta,
    };
    if (delta.toolCalls) {
      next.toolCalls = { ...(currentOverride?.toolCalls ?? {}), ...delta.toolCalls };
    }
    send({ type: "setSessionDisplayPrefs", sessionId, override: next });
  }, [currentOverride, send, sessionId]);

  const clearOverride = useCallback(() => {
    send({ type: "setSessionDisplayPrefs", sessionId, override: null });
    setOpen(false);
  }, [send, sessionId]);

  const isOverridden = useCallback(
    (key: keyof Omit<DisplayPrefs, "toolCalls">) =>
      currentOverride?.[key] !== undefined && global !== undefined && currentOverride![key] !== global[key],
    [currentOverride, global],
  );
  const isToolCallOverridden = useCallback(
    (key: keyof DisplayPrefs["toolCalls"]) =>
      currentOverride?.toolCalls?.[key] !== undefined &&
      global !== undefined &&
      currentOverride!.toolCalls![key] !== global.toolCalls[key],
    [currentOverride, global],
  );

  const hasAnyOverride = useMemo(
    () => !!currentOverride && Object.keys(currentOverride).length > 0,
    [currentOverride],
  );

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
        title={i18nT("auto.view_options", undefined, "View options")}
      >
        <Icon path={mdiCog} size={0.6} />
        <span>{i18nT("auto.view", undefined, "View")}</span>
        {hasAnyOverride && (
          <span
            data-testid="chat-view-modified-pill"
            className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-medium"
            title={i18nT("auto.this_session_has_its_own_view", undefined, "This session has its own view preferences")}
          >
            modified
          </span>
        )}
      </button>
      {open && (
        <div
          data-testid="chat-view-popover"
          style={{ maxHeight }}
          className={`absolute right-0 z-30 w-64 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg p-2 text-xs ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <Row label={i18nT("auto.token_stats_bar", undefined, "Token stats bar")} value={prefs.tokenStatsBar} marked={isOverridden("tokenStatsBar")} onChange={(v) => patch({ tokenStatsBar: v })} />
          <Row label={i18nT("auto.context_usage_bar", undefined, "Context usage bar")} value={prefs.contextUsageBar} marked={isOverridden("contextUsageBar")} onChange={(v) => patch({ contextUsageBar: v })} />
          <Row label={i18nT("auto.reasoning_blocks", undefined, "Reasoning blocks")} value={prefs.reasoning} marked={isOverridden("reasoning")} onChange={(v) => patch({ reasoning: v })} />
          <Row label={i18nT("auto.keep_reasoning_open_until_turn_ends", undefined, "Keep reasoning open until turn ends")} value={prefs.keepReasoningOpenUntilTurnEnds} marked={isOverridden("keepReasoningOpenUntilTurnEnds")} onChange={(v) => patch({ keepReasoningOpenUntilTurnEnds: v })} />
          <Row label={i18nT("auto.keep_tool_groups_collapsed", undefined, "Keep tool groups collapsed")} value={prefs.toolGroupDefaultCollapsed} marked={isOverridden("toolGroupDefaultCollapsed")} onChange={(v) => patch({ toolGroupDefaultCollapsed: v })} />
          <Row label={i18nT("auto.tool_result_bodies", undefined, "Tool result bodies")} value={prefs.toolResults} marked={isOverridden("toolResults")} onChange={(v) => patch({ toolResults: v })} />
          <Row label={i18nT("auto.turn_metadata", undefined, "Turn metadata")} value={prefs.turnMetadata} marked={isOverridden("turnMetadata")} onChange={(v) => patch({ turnMetadata: v })} />
          <Row label={i18nT("auto.change_summary_table", undefined, "Per-turn change summary")} value={prefs.changeSummaryTable} marked={isOverridden("changeSummaryTable")} onChange={(v) => patch({ changeSummaryTable: v })} />
          <Row label={i18nT("auto.debug_events", undefined, "Debug events")} value={prefs.debugTools} marked={isOverridden("debugTools")} onChange={(v) => patch({ debugTools: v })} />
          <div className="my-2 border-t border-[var(--border-subtle)]" />
          <div className="text-[var(--text-tertiary)] mb-1">{i18nT("auto.tool_calls", undefined, "Tool calls")}</div>
          <Row label={i18nT("auto.read", undefined, "Read")} value={prefs.toolCalls.read} marked={isToolCallOverridden("read")} onChange={(v) => patch({ toolCalls: { read: v } })} />
          <Row label={i18nT("auto.bash", undefined, "Bash")} value={prefs.toolCalls.bash} marked={isToolCallOverridden("bash")} onChange={(v) => patch({ toolCalls: { bash: v } })} />
          <Row label={i18nT("auto.edit_write", undefined, "Edit / Write")} value={prefs.toolCalls.edit} marked={isToolCallOverridden("edit")} onChange={(v) => patch({ toolCalls: { edit: v } })} />
          <Row label={i18nT("auto.agent", undefined, "Agent")} value={prefs.toolCalls.agent} marked={isToolCallOverridden("agent")} onChange={(v) => patch({ toolCalls: { agent: v } })} />
          <Row label={i18nT("auto.other", undefined, "Other")} value={prefs.toolCalls.generic} marked={isToolCallOverridden("generic")} onChange={(v) => patch({ toolCalls: { generic: v } })} />
          <div className="my-2 border-t border-[var(--border-subtle)]" />
          <button
            type="button"
            disabled={!hasAnyOverride}
            onClick={clearOverride}
            className="w-full text-left px-2 py-1 rounded text-blue-400 hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {i18nT("auto.use_global_settings", undefined, "Use global settings")}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  marked,
  onChange,
}: {
  label: string;
  value: boolean;
  marked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer">
      <span className="flex items-center gap-1 text-[var(--text-secondary)]">
        {marked && (
          <span title={i18nT("auto.overrides_global", undefined, "Overrides global")} className="text-amber-400 inline-flex">
            <Icon path={mdiCircleSmall} size={0.7} />
          </span>
        )}
        {label}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500"
      />
    </label>
  );
}
