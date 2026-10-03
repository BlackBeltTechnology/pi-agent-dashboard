/**
 * Nested tool calls (pi codemode / `ctx.executeTool`) rendered inside their
 * root tool card. Collapsed by default to a count; expanded, each entry is
 * indented by its `parentId` depth. `unfinished` renders neutral (neither
 * spinner nor error). An incomplete pi record shows a generic notice — it
 * never claims calls were dropped (pi's `complete:false` does not say which).
 *
 * See change: render-nested-tool-calls (D1).
 */
import { mdiAlertCircle, mdiCheck, mdiChevronDown, mdiChevronRight, mdiLoading, mdiMinusCircleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { useToolFullResult } from "../../hooks/useToolFullResult.js";
import { TRUNCATION_MARKER_PREFIX } from "../../lib/chat/event-reducer.js";
import { type NestedCallState, nestedDepth } from "../../lib/chat/nested-tool-calls.js";
import { getSummary } from "../../lib/chat/tool-summary.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  rootId: string;
  nested: NestedCallState[];
  /** `false` when pi's nested-call record says it is incomplete. */
  complete?: boolean;
  sessionId?: string;
}

const STATUS_ICON: Record<NestedCallState["status"], string> = {
  running: mdiLoading,
  complete: mdiCheck,
  error: mdiAlertCircle,
  unfinished: mdiMinusCircleOutline,
};

const STATUS_CLASS: Record<NestedCallState["status"], string> = {
  running: "text-yellow-400",
  complete: "text-green-400",
  error: "text-[var(--severity-error-fg)]",
  unfinished: "text-[var(--text-muted)]",
};

const INDENT_PX = 12;

function NestedCallRow({ entry, depth, sessionId }: { entry: NestedCallState; depth: number; sessionId?: string }) {
  const [open, setOpen] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const full = useToolFullResult(sessionId, entry.id);
  const truncated = typeof entry.result === "string" && entry.result.startsWith(TRUNCATION_MARKER_PREFIX) && !!sessionId;
  const body = showFull && full.result != null ? full.result : entry.result;
  const hasBody = body !== undefined || entry.error !== undefined;
  const summary = getSummary(entry.name, entry.args);

  return (
    <li
      data-testid="nested-call"
      data-nested-id={entry.id}
      data-nested-status={entry.status}
      data-nested-depth={depth}
      style={{ paddingLeft: `${(depth - 1) * INDENT_PX}px` }}
    >
      <button
        type="button"
        onClick={() => hasBody && setOpen(!open)}
        aria-expanded={hasBody ? open : undefined}
        title={summary}
        className="w-full min-w-0 flex items-center gap-1.5 text-left text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        <span className={`inline-flex shrink-0 ${STATUS_CLASS[entry.status]}`} data-testid="nested-call-status">
          <Icon path={STATUS_ICON[entry.status]} size={0.5} spin={entry.status === "running"} />
        </span>
        <span className="truncate">{summary}</span>
        {entry.status === "unfinished" && (
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
            {i18nT("chat.tool.nested.unfinished", undefined, "unfinished")}
          </span>
        )}
        {entry.argumentsBytes !== undefined && (
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]" data-testid="nested-call-args-omitted">
            {i18nT(
              "chat.tool.nested.argsOmitted",
              { bytes: entry.argumentsBytes },
              `arguments omitted (${entry.argumentsBytes} bytes)`,
            )}
          </span>
        )}
      </button>
      {open && hasBody && (
        <div className="mt-0.5 ml-4">
          {entry.error !== undefined && (
            <pre className="whitespace-pre-wrap break-words text-[var(--severity-error-fg)]">{entry.error}</pre>
          )}
          {body !== undefined && <pre className="whitespace-pre-wrap break-words">{body}</pre>}
          {truncated &&
            (full.error ? (
              <span className="text-[var(--text-muted)] italic">{full.error}</span>
            ) : showFull ? (
              <button type="button" onClick={() => setShowFull(false)} className="text-[var(--accent-text)] hover:underline">
                {i18nT("common.collapseOutput", undefined, "Collapse output")}
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await full.fetchFull();
                  setShowFull(true);
                }}
                disabled={full.loading}
                className="text-[var(--accent-text)] hover:underline disabled:opacity-50"
              >
                {full.loading
                  ? i18nT("common.loading2", undefined, "Loading…")
                  : i18nT("common.showFullOutput", undefined, "Show full output")}
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

export function NestedToolCallList({ rootId, nested, complete, sessionId }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (nested.length === 0) return null;
  return (
    <div className="ml-4 mt-0.5 text-xs" data-testid="nested-call-list">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        data-testid="nested-call-toggle"
      >
        <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.5} />
        <span data-testid="nested-call-count">
          {i18nT("chat.tool.nested.count", { count: nested.length }, `${nested.length} nested calls`)}
        </span>
      </button>
      {expanded && (
        <>
          <ul className="mt-0.5 space-y-0.5">
            {nested.map((entry) => (
              <NestedCallRow
                key={entry.id}
                entry={entry}
                depth={nestedDepth(nested, entry, rootId)}
                sessionId={sessionId}
              />
            ))}
          </ul>
          {complete === false && (
            <div className="mt-0.5 italic text-[var(--text-muted)]" data-testid="nested-call-incomplete">
              {i18nT("chat.tool.nested.incomplete", undefined, "nested-call record incomplete")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
