/**
 * Run monitor (shell-overlay-route `/automation/run/:sid`). Resolves the run
 * session by id (slot `sessionParam`) and shows it live: while running it
 * surfaces the run header + status and lets the user open the standard chat
 * (the run is a real session — its live tool calls + messages render via the
 * shell's ChatView). On completion it renders the captured `result.md`.
 *
 * The transcript itself is the shell's ChatView for `session.id` — this
 * overlay adds the automation framing + result findings around it.
 *
 * See change: add-automation-plugin.
 */

import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { useEffect, useState } from "react";
import { getRunResult } from "./api.js";

export interface AutomationRunMonitorProps {
  params?: Record<string, string>;
  /** Run session resolved from the URL's session param. */
  session?: DashboardSession;
  onBack?: () => void;
}

export function AutomationRunMonitor({
  session,
  onBack,
}: AutomationRunMonitorProps): React.ReactElement {
  const t = useT();
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const run = session?.automationRun;
  const [result, setResult] = useState<string | null>(null);

  const ended = session?.status === "ended";

  useEffect(() => {
    let cancelled = false;
    if (!ended || !run?.runId) return;
    getRunResult("folder", session?.cwd, run.runId).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [ended, run?.runId, session?.cwd]);

  return (
    <div data-testid="automation-run-monitor" className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          {t("automationRun", undefined, "Automation run")}{run?.name ? `: ${run.name}` : ""}
        </h2>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {t("back", undefined, "← Back")}
          </button>
        )}
      </div>

      <div className="text-xs text-[var(--text-secondary)]">
        <span data-testid="run-status">{ended ? t("completed", undefined, "completed") : t("running", undefined, "running")}</span>
        {run?.runId && <span className="ml-2 font-mono">{run.runId}</span>}
      </div>

      {!ended && (
        <p className="text-xs text-[var(--text-muted)]" data-testid="run-live-hint">
          {t("runLiveHint", undefined, "This run is live — its tool calls and messages stream in the standard chat view for this session.")}
        </p>
      )}

      {ended && (
        <section data-testid="run-result">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">{t("findings", undefined, "Findings")}</h3>
          {result && result.trim().length > 0 ? (
            <MarkdownContent content={result} />
          ) : (
            <p className="text-xs text-[var(--text-muted)]" data-testid="run-result-empty">
              {t("noFindings", undefined, "No findings (auto-archived).")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
