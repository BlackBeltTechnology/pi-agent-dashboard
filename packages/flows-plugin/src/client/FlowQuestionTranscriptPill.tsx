/**
 * FlowQuestionTranscriptPill — collapsed pill rendering an answered or
 * cancelled flow-question prompt in the FlowDashboard upper-slot
 * transcript. The pending head is rendered by FlowQuestionCard; this
 * pill covers everything else (resolved / cancelled / dismissed).
 *
 * See change: fix-flows-plugin-polish (C3).
 */
import React from "react";
import { Icon } from "@mdi/react";
import { mdiCheckCircle, mdiCloseCircle, mdiHelpCircleOutline } from "@mdi/js";

export interface FlowQuestionTranscriptPillProps {
  question: string;
  /** Resolved answer (string for non-multiselect, JSON array for multiselect). */
  answer?: string;
  status: "resolved" | "cancelled" | "dismissed" | "pending";
}

export function FlowQuestionTranscriptPill({
  question,
  answer,
  status,
}: FlowQuestionTranscriptPillProps) {
  const { iconPath, color } =
    status === "resolved"
      ? { iconPath: mdiCheckCircle, color: "text-green-400" }
      : status === "cancelled" || status === "dismissed"
        ? { iconPath: mdiCloseCircle, color: "text-[var(--text-muted)]" }
        : { iconPath: mdiHelpCircleOutline, color: "text-purple-400" };

  const displayAnswer = (() => {
    if (typeof answer !== "string") return null;
    // For multiselect answers stored as JSON array, render compactly.
    try {
      const parsed = JSON.parse(answer);
      if (Array.isArray(parsed)) return parsed.join(", ");
    } catch {
      // fall through
    }
    return answer;
  })();

  return (
    <div
      data-testid="flow-question-transcript-pill"
      className="mt-1 px-2 py-1 border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] rounded text-[11px] flex items-center gap-2"
    >
      <Icon path={iconPath} size={0.45} className={`${color} flex-shrink-0`} />
      <span className="text-[var(--text-secondary)] truncate flex-1 min-w-0">{question}</span>
      {displayAnswer && (
        <span className={`${color} font-medium truncate flex-shrink-0 max-w-[40%]`}>
          → {displayAnswer}
        </span>
      )}
    </div>
  );
}
