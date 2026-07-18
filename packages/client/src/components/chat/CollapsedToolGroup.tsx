/**
 * Renders a collapsed group of repeated tool calls.
 * Shows a count badge and summary; expands to reveal all individual calls.
 */

import { toolCallPrefKey } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { mdiChevronDown, mdiChevronRight, mdiRepeat } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { useDisplayPrefs } from "../../hooks/useDisplayPrefs.js";
import { useMobile } from "../../hooks/useMobile.js";
import type { ToolCallGroup } from "../../lib/chat/group-tool-calls.js";
import { getSummary } from "../../lib/chat/tool-summary.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { ToolCallStep } from "./ToolCallStep.js";
import type { ToolContext } from "../tool-renderers/index.js";

interface Props {
  group: ToolCallGroup;
  toolContext: ToolContext;
}

export function CollapsedToolGroup({ group, toolContext }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useMobile();
  const prefs = useDisplayPrefs();
  // Filter members by tool-kind toggle; `ask_user` is never gated.
  // Hide the entire group only if every member is gated off.
  // See change: configurable-chat-display.
  const visibleMessages = group.messages.filter((m) => {
    const key = toolCallPrefKey(m.toolName ?? "");
    return key === null || prefs.toolCalls[key];
  });
  if (visibleMessages.length === 0) return null;
  const lastMsg = group.messages[group.messages.length - 1];
  const firstArgs = group.messages[0]?.args;

  return (
    <div className={`${isMobile ? "mx-2" : "mx-4"} border-l-2 border-[var(--border-secondary)] pl-3`}>
      <button
        onClick={() => setExpanded(!expanded)}
        title={getSummary(group.toolName, firstArgs)}
        className={`flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] w-full text-left ${isMobile ? "min-h-[44px] py-2" : ""}`}
        data-testid="collapsed-group"
      >
        <span className="inline-flex text-[var(--text-muted)]">
          <Icon path={mdiRepeat} size={0.55} />
        </span>
        <span className="truncate">{getSummary(group.toolName, firstArgs)}</span>
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[10px] font-medium">
          ×{visibleMessages.length}
        </span>
        <span className="ml-auto text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {group.rendered.map((row) => {
            // Absorbed narration renders interleaved with its tool calls.
            // thinking / non-empty assistant prose → lightweight inline text;
            // empty assistant / separators / rawEvent / commandFeedback → skip.
            if (row.role === "toolResult") {
              const key = toolCallPrefKey(row.toolName ?? "");
              if (key !== null && !prefs.toolCalls[key]) return null;
              return (
                <ToolCallStep
                  key={row.id}
                  toolName={row.toolName ?? "unknown"}
                  toolCallId={row.toolCallId ?? row.id}
                  args={row.args}
                  status={row.toolStatus ?? "complete"}
                  result={row.result}
                  images={row.images}
                  context={toolContext}
                  startedAt={row.startedAt}
                  duration={row.duration}
                  showResultBody={prefs.toolResults || row.toolName === "ask_user"}
                />
              );
            }
            if ((row.role === "thinking" || row.role === "assistant") && row.content.trim() !== "") {
              return (
                <div
                  key={row.id}
                  className="px-2 py-1 text-xs text-[var(--text-tertiary)]"
                  data-testid="collapsed-group-narration"
                >
                  <MarkdownContent content={row.content} context={toolContext} />
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
