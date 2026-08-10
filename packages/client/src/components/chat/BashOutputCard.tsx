import { mdiConsole } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { TRUNCATION_MARKER_PREFIX, truncateOutputForDisplay } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  command: string;
  output: string;
  exitCode: number;
  excludeFromContext: boolean;
  /**
   * "slash-exec" when this output came from an executable-mode slash template
   * (`executable: bash`). Triggers the "ran locally — LLM not invoked" footer.
   * Absent for `!` / `!!`. See change: add-dashboard-slash-commands.
   */
  source?: "slash-exec";
  timestamp?: number;
}

export function BashOutputCard({ command, output, exitCode, excludeFromContext, source }: Props) {
  const isSuccess = exitCode === 0;
  const ranLocally = source === "slash-exec";

  // Show-full-output affordance, mirroring ToolCallStep. The full output is
  // already in client state (user `!bash`), so the toggle is purely local —
  // no server fetch. See change: adopt-pi-071-072-073-features.
  const [showFull, setShowFull] = useState(false);
  const truncated = truncateOutputForDisplay(output);
  const isTruncated = truncated.startsWith(TRUNCATION_MARKER_PREFIX);
  const displayOutput = showFull ? output : truncated;

  return (
    <div className="mt-2 mb-2">
      <div className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden max-w-[90%]">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-secondary)]">
          <Icon path={mdiConsole} size={0.6} className="text-[var(--text-tertiary)]" />
          <code className="text-xs font-mono text-[var(--text-primary)] flex-1 truncate">
            {excludeFromContext ? "!!" : "!"}{command}
          </code>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              isSuccess
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            exit {exitCode}
          </span>
          {excludeFromContext && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">
              silent
            </span>
          )}
        </div>
        {/* Output */}
        {output && (
          <pre className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap break-all">
            {displayOutput}
          </pre>
        )}
        {isTruncated && (
          <div className="px-3 pb-2 text-xs">
            <button
              onClick={() => setShowFull((v) => !v)}
              className="text-[var(--accent)] hover:underline"
              data-testid="bash-show-full-output"
            >
              {showFull
                ? i18nT("common.collapseOutput", undefined, "Collapse output")
                : i18nT("common.showFullOutput", undefined, "Show full output")}
            </button>
          </div>
        )}
        {/* Discoverability footer: only for executable-mode slash templates.
            Signals the operation was free (no LLM call). Absent for ! / !!.
            See change: add-dashboard-slash-commands. */}
        {ranLocally && (
          <div className="px-3 py-1 text-[10px] text-[var(--text-tertiary)] border-t border-[var(--border-secondary)]">
            ℹ ran locally — LLM not invoked
          </div>
        )}
      </div>
    </div>
  );
}
