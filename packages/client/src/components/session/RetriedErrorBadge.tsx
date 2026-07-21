/**
 * Compact badge rendered in place of a full ToolCallStep when a tool's
 * error result was immediately followed by a successful retry of the
 * same tool. Click to expand and see the original error details.
 *
 * See change: collapse `ask_user` (and other) error→retry pairs into a
 * single line so the chat view does not look like a duplicated message.
 */

import { mdiAlertCircleOutline, mdiChevronDown, mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ToolCallStep } from "../chat/ToolCallStep.js";
import type { ToolContext } from "../tool-renderers/index.js";

interface Props {
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
  result?: string;
  context: ToolContext;
  startedAt?: number;
  duration?: number;
  toolDetails?: Record<string, unknown>;
}

export function RetriedErrorBadge({
  toolName,
  toolCallId,
  args,
  result,
  context,
  startedAt,
  duration,
  toolDetails,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="my-1">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] mb-1"
        >
          <Icon path={mdiChevronDown} size={0.6} />
          <span>{i18nT("status.hideFailedAttempt", undefined, "Hide failed attempt")}</span>
        </button>
        <ToolCallStep
          toolName={toolName}
          toolCallId={toolCallId}
          args={args}
          status="error"
          result={result}
          context={context}
          startedAt={startedAt}
          duration={duration}
          toolDetails={toolDetails}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title={`${toolName} failed and was retried — click to view error`}
      className="my-1 inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded-md bg-[var(--bg-tertiary)]/40 hover:bg-[var(--bg-tertiary)]"
    >
      <Icon path={mdiAlertCircleOutline} size={0.6} className="text-red-400/80" />
      <span>
        <span className="font-mono">{toolName}</span> {i18nT("status.failedRetried", undefined, "failed — retried")}
      </span>
      <Icon path={mdiChevronRight} size={0.55} />
    </button>
  );
}
