/**
 * Renders a temporal BURST group: a run of consecutive tool calls collapsed
 * into one unified, progress-aware block. Grouping is universal (threshold 1),
 * so a single tool call renders in the SAME frame as a multi-member run.
 *
 * ONE frame, four data-driven states (change: enhance-tool-call-grouping):
 *   running        ⟳ Working · N done · $ <live command>   shimmer + spin-pulse
 *   done · 1 call  ✓ <tool icon> <summary> · <duration>     completion flash
 *   done · N calls ✓ N tool calls · <icon breakdown> · <dur> [· N failed]
 * The running/done/single/multi paths flow through one `<GroupFrame>` with
 * slots {leftGlyph, title, meta, motionClass, chevron, body} — no four-way
 * branch. Honest counts only: NO fabricated total / progress bar; the running
 * animation is indeterminate.
 *
 * Body grows in DOCUMENT FLOW — no fixed max-height, no inner overflow-y
 * scrollbox (finding: full-height expansion). Absorbed `thinking` renders
 * through the real `<ThinkingBlock>` (labeled, collapsible), identical to a
 * top-level reasoning block; only non-empty `assistant` prose renders as flat
 * narration.
 *
 * Default open state: `expanded = override ?? (toolGroupDefaultCollapsed ?
 * false : isRunning)`. The pref only changes the body's default open state; the
 * live header + animation key off `isRunning`, not `expanded`.
 *
 * See change: enhance-tool-call-grouping (was: group-tool-call-bursts).
 */

import { toolCallPrefKey } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiConsoleLine, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useDisplayPrefs } from "../../hooks/useDisplayPrefs.js";
import { useFxVisibility } from "../../hooks/useFxVisibility.js";
import { useMobile } from "../../hooks/useMobile.js";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import type { ToolBurstGroup as ToolBurstGroupData } from "../../lib/chat/group-tool-bursts.js";
import type { ChatItem, ToolCallGroup } from "../../lib/chat/group-tool-calls.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSummary, getToolIcon } from "../../lib/chat/tool-summary.js";
import { CollapsedToolGroup } from "./CollapsedToolGroup.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCallStep } from "./ToolCallStep.js";
import type { ToolContext } from "../tool-renderers/index.js";

interface Props {
  burst: ToolBurstGroupData;
  toolContext: ToolContext;
}

function isGroup(item: ChatItem): item is ToolCallGroup {
  return (item as ToolCallGroup).type === "group";
}

/** Flatten burst items to their underlying `toolResult` messages (a ×N group → its members). */
function underlyingCalls(items: ChatItem[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const it of items) {
    if (isGroup(it)) out.push(...it.messages);
    else if ((it as ChatMessage).role === "toolResult") out.push(it as ChatMessage);
  }
  return out;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s.toFixed(s < 10 ? 1 : 0)}s`;
}

/** Per-tool-kind icon + count breakdown, insertion-ordered by first appearance. */
function breakdown(members: ChatMessage[]): { name: string; icon: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    const name = m.toolName ?? "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, icon: getToolIcon(name), count }));
}

/** Wall-clock span when timestamps exist, else sum of member durations. */
function totalDuration(members: ChatMessage[]): number {
  const starts = members.map((m) => m.startedAt).filter((v): v is number => v != null);
  const ends = members
    .map((m) => (m.startedAt != null && m.duration != null ? m.startedAt + m.duration : undefined))
    .filter((v): v is number => v != null);
  if (starts.length && ends.length) return Math.max(...ends) - Math.min(...starts);
  return members.reduce((sum, m) => sum + (m.duration ?? 0), 0);
}

/**
 * The single unified frame. Running/done/single/multi differ only in the slots
 * passed in — one visual chrome, no per-state branch.
 */
function GroupFrame({
  leftGlyph,
  title,
  meta,
  motionClass,
  expanded,
  onToggle,
  isRunning,
  children,
}: {
  leftGlyph: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  motionClass: string;
  expanded: boolean;
  onToggle: () => void;
  isRunning: boolean;
  children: ReactNode;
}) {
  const isMobile = useMobile();
  // Pause the header shimmer + spinner pulse while this running group is
  // off-screen. Only running groups are observed (completed groups carry no
  // animation, and a long transcript has thousands of them). See change:
  // reduce-chat-render-cpu-umbrella (Phase 1, task 2.5).
  const fxRef = useFxVisibility<HTMLDivElement>();
  return (
    <div
      ref={isRunning ? fxRef : undefined}
      className={`${isMobile ? "mx-2" : "mx-4"} border-l-2 border-[var(--border-secondary)] pl-3`}
      data-testid="tool-burst-group"
      data-running={isRunning ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] w-full text-left rounded ${motionClass} ${isMobile ? "min-h-[44px] py-2" : ""}`}
        data-testid="tool-burst-header"
      >
        {leftGlyph}
        {title}
        {meta}
        <span className="ml-auto text-[var(--text-muted)] inline-flex shrink-0">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5" data-testid="tool-burst-body">
          {children}
        </div>
      )}
    </div>
  );
}

export function ToolBurstGroup({ burst, toolContext }: Props) {
  const prefs = useDisplayPrefs();

  // Gate members by tool-kind toggle (mirrors CollapsedToolGroup). `ask_user`
  // is never gated (toolCallPrefKey → null). Count/render reflect VISIBLE only.
  const isVisible = (name: string | undefined) => {
    const key = toolCallPrefKey(name ?? "");
    return key === null || prefs.toolCalls[key];
  };
  const visibleMembers = underlyingCalls(burst.items).filter((m) => isVisible(m.toolName));

  const [override, setOverride] = useState<boolean | null>(null); // null = follow auto
  const isRunning = visibleMembers.some((m) => m.toolStatus === "running");
  // Pref only changes the body's default open state; the live header keys off
  // isRunning, not expanded. Manual override always wins.
  const autoOpen = prefs.toolGroupDefaultCollapsed ? false : isRunning;
  const expanded = override ?? autoOpen;

  // One-shot completion flash on the running→done flip.
  const prevRunning = useRef(isRunning);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 200);
      prevRunning.current = isRunning;
      return () => clearTimeout(t);
    }
    // Re-running before the 200ms flash window elapsed: clear any lingering
    // flash so a done→running→done cycle can't bleed the cue into the next flip.
    if (isRunning) setFlash(false);
    prevRunning.current = isRunning;
  }, [isRunning]);

  if (visibleMembers.length === 0) return null;

  const total = visibleMembers.length;
  const doneCount = visibleMembers.filter((m) => m.toolStatus !== "running").length;
  const failedCount = visibleMembers.filter((m) => m.toolStatus === "error").length;
  const runningMember = visibleMembers.find((m) => m.toolStatus === "running");
  const liveCommand = runningMember ? getSummary(runningMember.toolName ?? "unknown", runningMember.args) : "";
  const durationMs = totalDuration(visibleMembers);
  const single = total === 1;
  const soleMember = visibleMembers[0];

  // ── Slots ────────────────────────────────────────────────────────────────
  const leftGlyph = (
    <span
      className={`inline-flex ${isRunning ? "text-yellow-400 tool-group-spin-pulse" : "text-green-400"} ${flash ? "tool-group-flash" : ""}`}
    >
      <Icon
        path={isRunning ? mdiLoading : single ? getToolIcon(soleMember.toolName ?? "unknown") : mdiCheck}
        size={0.55}
        spin={isRunning}
      />
    </span>
  );

  const { title, meta } = headerSlots({
    isRunning,
    single,
    total,
    doneCount,
    failedCount,
    liveCommand,
    durationMs,
    soleMember,
    members: visibleMembers,
  });
  const motionClass = isRunning ? "tool-group-shimmer" : "";

  return (
    <GroupFrame
      leftGlyph={leftGlyph}
      title={title}
      meta={meta}
      motionClass={motionClass}
      expanded={expanded}
      onToggle={() => setOverride(!expanded)}
      isRunning={isRunning}
    >
      {burst.items.map((it) => (
        <BurstBodyItem
          key={isGroup(it) ? it.messages[0]?.id : (it as ChatMessage).id}
          item={it}
          toolContext={toolContext}
          // Burst-SCOPED, not session-scoped: absorbed reasoning is "live for the
          // turn" only while THIS group runs. Passing the session-wide streaming
          // status would let an older completed burst's ThinkingBlocks re-open
          // during a later turn.
          turnActive={isRunning}
          isVisible={isVisible}
        />
      ))}
    </GroupFrame>
  );
}

/** Render one body item: a nested ×N group, absorbed reasoning/narration, or a tool step. */
function BurstBodyItem({
  item,
  toolContext,
  turnActive,
  isVisible,
}: {
  item: ChatItem;
  toolContext: ToolContext;
  turnActive?: boolean;
  isVisible: (name: string | undefined) => boolean;
}) {
  const prefs = useDisplayPrefs();
  if (isGroup(item)) {
    return <CollapsedToolGroup group={item} toolContext={toolContext} />;
  }
  const msg = item as ChatMessage;
  // Absorbed reasoning renders through the real ThinkingBlock (labeled,
  // collapsible) — identical to a top-level reasoning row. Honours the
  // reasoning display preference.
  if (msg.role === "thinking" && msg.content.trim() !== "") {
    if (!prefs.reasoning) return null;
    return (
      <ThinkingBlock
        content={msg.content}
        startedAt={msg.startedAt}
        duration={msg.duration}
        streamedLive={msg.streamedLive}
        autoCollapseMs={prefs.reasoningAutoCollapseMs}
        keepOpenUntilTurnEnds={prefs.keepReasoningOpenUntilTurnEnds}
        turnActive={turnActive}
      />
    );
  }
  // Non-empty assistant prose is NOT reasoning — flat narration.
  if (msg.role === "assistant" && msg.content.trim() !== "") {
    return (
      <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]" data-testid="tool-burst-narration">
        <MarkdownContent content={msg.content} context={toolContext} />
      </div>
    );
  }
  if (msg.role !== "toolResult") return null; // skip empty/separator rows
  if (!isVisible(msg.toolName)) return null;
  return (
    <ToolCallStep
      toolName={msg.toolName ?? "unknown"}
      toolCallId={msg.toolCallId ?? msg.id}
      args={msg.args}
      status={msg.toolStatus ?? "complete"}
      result={msg.result}
      images={msg.images}
      context={toolContext}
      startedAt={msg.startedAt}
      duration={msg.duration}
      toolDetails={msg.toolDetails}
      showResultBody={prefs.toolResults || msg.toolName === "ask_user"}
    />
  );
}

/**
 * Compute the {title, meta} header slots for the three states. Standalone so the
 * component body stays flat (one frame, data-driven slots).
 */
function headerSlots(p: {
  isRunning: boolean;
  single: boolean;
  total: number;
  doneCount: number;
  failedCount: number;
  liveCommand: string;
  durationMs: number;
  soleMember: ChatMessage;
  members: ChatMessage[];
}): { title: ReactNode; meta: ReactNode } {
  if (p.isRunning) {
    return {
      title: <span className="font-medium text-[var(--text-secondary)]">{i18nT("status.working", undefined, "Working")}</span>,
      meta: (
        <>
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[10px] font-medium">
            {p.doneCount} done
          </span>
          {p.liveCommand && (
            <span className="ml-1.5 flex items-center gap-1 min-w-0 text-[var(--text-muted)]">
              <Icon path={mdiConsoleLine} size={0.5} />
              <span className="truncate max-w-[240px]" data-testid="tool-burst-live-command">
                {p.liveCommand}
              </span>
            </span>
          )}
        </>
      ),
    };
  }
  if (p.single) {
    // Single completed call: tool icon (in leftGlyph) + its own summary + duration.
    return {
      title: (
        <span className="truncate text-[var(--text-secondary)]" data-testid="tool-burst-summary">
          {getSummary(p.soleMember.toolName ?? "unknown", p.soleMember.args)}
        </span>
      ),
      meta: (
        <>
          {p.durationMs > 0 && <span className="ml-1.5 text-[var(--text-muted)]">{formatDuration(p.durationMs)}</span>}
          {p.failedCount > 0 && <FailedBadge n={p.failedCount} />}
        </>
      ),
    };
  }
  return {
    title: <span className="font-medium text-[var(--text-secondary)] shrink-0">{p.total} tool calls</span>,
    meta: (
      <span
        className="ml-1.5 flex items-center gap-2 flex-wrap min-w-0 text-[var(--text-muted)]"
        data-testid="tool-burst-breakdown"
      >
        {breakdown(p.members).map((b) => (
          <span key={b.name} className="inline-flex items-center gap-0.5" title={b.name}>
            <Icon path={b.icon} size={0.5} />
            <span className="tabular-nums text-[var(--text-tertiary)]">{b.count}</span>
          </span>
        ))}
        {p.durationMs > 0 && <span className="tabular-nums">· {formatDuration(p.durationMs)}</span>}
        {p.failedCount > 0 && <FailedBadge n={p.failedCount} />}
      </span>
    ),
  };
}

/** `N failed` badge in the error color, shown when any member errored. */
function FailedBadge({ n }: { n: number }) {
  return (
    <span
      className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 text-[10px] font-semibold"
      data-testid="tool-burst-failed-badge"
    >
      {n} failed
    </span>
  );
}
