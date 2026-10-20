/**
 * Compact transcript row for a durable `supervised-tool-decision` custom entry
 * ("Approved / Denied by <surface>"), plus the entry-type constants `CustomEntryRow` routes on.
 *
 * The bridge appends one entry per gate decision (`{ tool, summary, outcome, answeredSurface,
 * via }`); the generic custom-entry card would show it as raw JSON. A malformed payload returns
 * `null` from `parseSupervisedDecision` so the caller keeps the generic fallback. The sibling
 * `supervised-mode` entry (internal flip log) is hidden by the caller.
 *
 * See change: add-supervised-tool-approval (design D11).
 */
import { mdiAccountEyeOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export const SUPERVISED_MODE_ENTRY = "supervised-mode";
export const SUPERVISED_DECISION_ENTRY = "supervised-tool-decision";

type DecisionOutcome = "approved" | "denied" | "dismissed" | "timeout" | "aborted" | "error";
const OUTCOMES: ReadonlySet<string> = new Set<DecisionOutcome>(["approved", "denied", "dismissed", "timeout", "aborted", "error"]);

export interface SupervisedDecision {
  tool: string;
  summary: string;
  outcome: DecisionOutcome;
  answeredSurface: string;
}

export function parseSupervisedDecision(content: string): SupervisedDecision | null {
  try {
    const d = JSON.parse(content) as Record<string, unknown>;
    if (typeof d.outcome !== "string" || !OUTCOMES.has(d.outcome)) return null;
    return {
      tool: typeof d.tool === "string" ? d.tool : "",
      summary: typeof d.summary === "string" ? d.summary : "",
      outcome: d.outcome as DecisionOutcome,
      answeredSurface: typeof d.answeredSurface === "string" ? d.answeredSurface : "",
    };
  } catch {
    return null;
  }
}

const label = (o: DecisionOutcome): string => {
  switch (o) {
    case "approved":
      return i18nT("supervised.decision.approved", undefined, "Approved");
    case "denied":
      return i18nT("supervised.decision.denied", undefined, "Denied");
    case "timeout":
      return i18nT("supervised.decision.timeout", undefined, "Denied, no answer in time");
    case "aborted":
      return i18nT("supervised.decision.aborted", undefined, "Blocked, turn aborted");
    case "error":
      return i18nT("supervised.decision.error", undefined, "Blocked, approval check failed");
    default:
      return i18nT("supervised.decision.dismissed", undefined, "Blocked, closed without an answer");
  }
};

export function SupervisedDecisionRow({ decision }: { decision: SupervisedDecision }) {
  const { tool, summary, outcome, answeredSurface } = decision;
  return (
    <div
      data-testid="supervised-decision-row"
      data-outcome={outcome}
      className="mx-4 my-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)]"
    >
      <Icon path={mdiAccountEyeOutline} size={0.55} className="shrink-0" />
      <span className={outcome === "approved" ? "text-[var(--severity-success-fg)]" : "text-[var(--severity-warning-fg)]"}>{label(outcome)}</span>
      {answeredSurface && outcome !== "timeout" && (
        <span>{i18nT("supervised.decision.by", { surface: answeredSurface }, "by {surface}")}</span>
      )}
      {tool && <span className="font-mono">{tool}</span>}
      {summary && <code className="font-mono truncate max-w-full">{summary}</code>}
    </div>
  );
}
