import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronRight, mdiChevronDown, mdiHeadLightbulb } from "@mdi/js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ElapsedBadge } from "./ElapsedBadge.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  content: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
  startedAt?: number;
  duration?: number;
}

export function ThinkingBlock({ content, isStreaming, defaultExpanded = false, startedAt, duration }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mx-4 border-l-2 border-purple-500/30 pl-3">
      <button
        onClick={() => setExpanded(!expanded)}
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
        <div className="mt-1 ml-4 p-2 bg-purple-500/5 rounded-xl shadow-md border border-purple-500/10 text-xs text-[var(--text-secondary)] overflow-x-auto max-h-[400px] overflow-y-auto">
          <MarkdownContent content={content} />
          {isStreaming && (
            <span className="inline-block w-1.5 h-3 bg-purple-400/50 animate-pulse ml-0.5" />
          )}
        </div>
      )}
    </div>
  );
}
