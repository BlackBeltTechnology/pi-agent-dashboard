import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronRight, mdiCodeJson } from "@mdi/js";
import { formatMessageTime } from "../../lib/util/format.js";

interface Props {
  eventType: string;
  content: string;
  timestamp: number;
}

export function RawEventCard({ eventType, content, timestamp }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1 mx-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
      >
        <Icon
          path={mdiChevronRight}
          size={0.55}
          className={`text-[var(--text-tertiary)] transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Icon path={mdiCodeJson} size={0.55} className="text-orange-400" />
        <span className="font-mono text-orange-400">{eventType}</span>
        <span className="ml-auto text-[var(--text-tertiary)]">
          {formatMessageTime(timestamp)}
        </span>
      </button>
      {expanded && (
        <pre className="px-3 pb-2 pt-1 overflow-x-auto text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {content}
        </pre>
      )}
    </div>
  );
}
