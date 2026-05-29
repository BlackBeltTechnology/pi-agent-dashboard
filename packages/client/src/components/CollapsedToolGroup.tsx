/**
 * Renders a collapsed group of repeated tool calls.
 * Shows a count badge and summary; expands to reveal all individual calls.
 */
import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronRight, mdiChevronDown, mdiRepeat } from "@mdi/js";
import { ToolCallStep } from "./ToolCallStep.js";
import type { ToolCallGroup } from "../lib/group-tool-calls.js";
import type { ToolContext } from "./tool-renderers/index.js";
import { useMobile } from "../hooks/useMobile.js";

interface Props {
  group: ToolCallGroup;
  toolContext: ToolContext;
}

const toolSummaries: Record<string, (args?: Record<string, unknown>) => string> = {
  bash: (args) => `$ ${String(args?.command ?? "")}`,
  read: (args) => `Read ${args?.path ?? "file"}`,
  edit: (args) => `Edit ${args?.path ?? "file"}`,
  write: (args) => `Write ${args?.path ?? "file"}`,
};

function getSummary(toolName: string, args?: Record<string, unknown>): string {
  const fn = toolSummaries[toolName];
  if (fn) return fn(args);
  return toolName;
}

export function CollapsedToolGroup({ group, toolContext }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useMobile();
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
          ×{group.messages.length}
        </span>
        <span className="ml-auto text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {group.messages.map((msg) => (
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
