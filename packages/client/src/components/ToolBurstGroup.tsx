/**
 * Renders a temporal BURST group: a run of heterogeneous consecutive tool
 * calls collapsed into one progress-aware block.
 *
 * Lifecycle (design finding 4): auto-expanded while any member runs (keeps the
 * live tool visible), auto-collapsed once the turn's boundary is reached. A
 * single nullable `override` cell expresses "follow auto UNLESS the user
 * toggled" — `expanded = override ?? isRunning` is derived, so it re-collapses
 * on the running→done flip yet pins a manual choice thereafter. No effect.
 *
 * Header — honest counts, NO fabricated total / progress bar (finding 1):
 *   running: ⟳ Working · N done · $ <live command>
 *   done:    ✓ N tool calls · <breakdown> · <duration>
 * All counts are over UNDERLYING tool calls (a nested ×N contributes N);
 * only formation threshold counts post-semantic members (helper, finding 5).
 *
 * Body: fixed-max-height scrollbox rendering every visible member via
 * `ToolCallStep`, with nested `×N` runs as `CollapsedToolGroup`. One collapse
 * level, no inner windowing (finding 3).
 *
 * See change: group-tool-call-bursts.
 */

import { toolCallPrefKey } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { mdiCheck, mdiChevronDown, mdiChevronRight, mdiConsoleLine, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { useDisplayPrefs } from "../hooks/useDisplayPrefs.js";
import { useMobile } from "../hooks/useMobile.js";
import type { ChatMessage } from "../lib/event-reducer.js";
import type { ToolBurstGroup as ToolBurstGroupData } from "../lib/group-tool-bursts.js";
import type { ChatItem, ToolCallGroup } from "../lib/group-tool-calls.js";
import { getSummary } from "../lib/tool-summary.js";
import { CollapsedToolGroup } from "./CollapsedToolGroup.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolCallStep } from "./ToolCallStep.js";
import type { ToolContext } from "./tool-renderers/index.js";

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

/** `9× grep · 8× read · 1× git` from a count over `toolName`. */
function breakdown(members: ChatMessage[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const name = m.toolName ?? "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => `${n}× ${name}`)
    .join(" · ");
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

export function ToolBurstGroup({ burst, toolContext }: Props) {
  const isMobile = useMobile();
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
  const expanded = override ?? isRunning;

  if (visibleMembers.length === 0) return null;

  const total = visibleMembers.length;
  const doneCount = visibleMembers.filter((m) => m.toolStatus !== "running").length;
  const runningMember = visibleMembers.find((m) => m.toolStatus === "running");
  const liveCommand = runningMember ? getSummary(runningMember.toolName ?? "unknown", runningMember.args) : "";
  const durationMs = totalDuration(visibleMembers);

  return (
    <div
      className={`${isMobile ? "mx-2" : "mx-4"} border-l-2 border-[var(--border-secondary)] pl-3`}
      data-testid="tool-burst-group"
      data-running={isRunning ? "true" : "false"}
    >
      <button
        type="button"
        onClick={() => setOverride(!expanded)}
        className={`flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] w-full text-left ${isMobile ? "min-h-[44px] py-2" : ""}`}
        data-testid="tool-burst-header"
      >
        <span className={`inline-flex ${isRunning ? "text-yellow-400" : "text-green-400"}`}>
          <Icon path={isRunning ? mdiLoading : mdiCheck} size={0.55} spin={isRunning} />
        </span>
        {isRunning ? (
          <>
            <span className="font-medium text-[var(--text-secondary)]">Working</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[10px] font-medium">
              {doneCount} done
            </span>
            {liveCommand && (
              <span className="ml-1.5 flex items-center gap-1 min-w-0 text-[var(--text-muted)]">
                <Icon path={mdiConsoleLine} size={0.5} />
                <span className="truncate max-w-[240px]" data-testid="tool-burst-live-command">
                  {liveCommand}
                </span>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-medium text-[var(--text-secondary)]">{total} tool calls</span>
            <span className="ml-1.5 truncate text-[var(--text-muted)]" data-testid="tool-burst-breakdown">
              {breakdown(visibleMembers)}
              {durationMs > 0 ? ` · ${formatDuration(durationMs)}` : ""}
            </span>
          </>
        )}
        <span className="ml-auto text-[var(--text-muted)] inline-flex shrink-0">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && (
        <div
          className="mt-1 space-y-0.5 max-h-[190px] overflow-y-auto"
          data-testid="tool-burst-body"
        >
          {burst.items.map((it) => {
            if (isGroup(it)) {
              return <CollapsedToolGroup key={it.messages[0]?.id} group={it} toolContext={toolContext} />;
            }
            const msg = it as ChatMessage;
            // Absorbed narration renders interleaved with the burst's members.
            if ((msg.role === "thinking" || msg.role === "assistant") && msg.content.trim() !== "") {
              return (
                <div
                  key={msg.id}
                  className="px-2 py-1 text-xs text-[var(--text-tertiary)]"
                  data-testid="tool-burst-narration"
                >
                  <MarkdownContent content={msg.content} context={toolContext} />
                </div>
              );
            }
            if (msg.role !== "toolResult") return null; // skip empty/separator rows
            if (!isVisible(msg.toolName)) return null;
            return (
              <ToolCallStep
                key={msg.id}
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
          })}
        </div>
      )}
    </div>
  );
}
