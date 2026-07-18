/**
 * Friendly worktree-init status chip (design variant A / D1).
 *
 * Renders one of three states from a `ClientInitRun`, replacing the old raw
 * `<pre>` wall:
 *   - running → `⚙ Initializing… · {elapsed}` + slim indeterminate bar +
 *     muted ghost of the last log line + collapsed `<details>` log.
 *   - done    → green `✓ Initialized · {elapsed}` flash (parent collapses it).
 *   - failed  → red `✕ Init failed · exit{code} · {short cmd}` + Retry +
 *     opt-in log; sticky (never auto-dismiss).
 *
 * Purely presentational; the run state + timers live in `worktree-init-store`.
 * See change: friendlier-worktree-init.
 */
import { mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { ClientInitRun } from "../../lib/git/worktree-init-store.js";

/** Label prefix — "Initializing" (manual/folder) vs "Auto-init" (spawn). */
type Variant = "manual" | "auto";

interface Props {
  run: ClientInitRun;
  variant?: Variant;
  /** Retry handler for the failed state. */
  onRetry?: () => void;
  /** Optional compact padding for session-card sub-state. */
  compact?: boolean;
}

function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-amber-400/25 border-t-amber-400 animate-spin flex-none"
      aria-hidden
    />
  );
}

function LogDisclosure({ label, body }: { label: string; body: string }) {
  return (
    <details className="group mt-1.5 max-w-[460px]" data-testid="worktree-init-log">
      <summary className="list-none cursor-pointer text-[11px] text-[var(--text-tertiary)] inline-flex items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
        <Icon path={mdiChevronRight} size={0.5} className="transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <pre className="mt-1.5 bg-[var(--bg-code,var(--bg-tertiary))] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 max-h-[200px] overflow-auto text-[10.5px] leading-relaxed text-[var(--text-tertiary)] whitespace-pre-wrap font-mono">
        {body}
      </pre>
    </details>
  );
}

/** Short command hint from a failure code / message. */
function shortSummary(run: ClientInitRun): string {
  const parts: string[] = [];
  if (run.code) parts.push(run.code);
  if (run.message && run.message !== run.code) parts.push(run.message);
  return parts.join(" · ") || i18nT("worktree.initFailedShort", undefined, "init failed");
}

export function WorktreeInitChip({ run, variant = "manual", onRetry, compact }: Props) {
  const elapsed = useElapsed(run.startedAt, run.phase === "running");
  const pad = compact ? "px-2 py-1" : "px-2.5 py-1.5";
  const runningLabel = variant === "auto" ? i18nT("worktree.autoInitializing", undefined, "Auto-initializing…") : i18nT("worktree.initializing", undefined, "Initializing…");
  const failedLabel = variant === "auto" ? i18nT("worktree.autoInitFailed", undefined, "Auto-init failed") : i18nT("err.initFailed", undefined, "Init failed");

  if (run.phase === "running") {
    return (
      <div className="inline-flex flex-col min-w-[240px] max-w-[420px]" data-testid="worktree-init-chip">
        <span className={`inline-flex items-center gap-2 text-[11.5px] rounded-lg ${pad} border border-amber-500/35 bg-amber-500/[0.06] text-amber-400`}>
          <Spinner />
          <span className="font-semibold">{runningLabel}</span>
          <span className="text-[var(--text-muted)]">· {elapsed}s</span>
        </span>
        <div className="h-[3px] rounded bg-amber-500/15 overflow-hidden mt-1.5">
          <i className="block h-full w-2/5 rounded bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-[wtinit-slide_1.4s_ease-in-out_infinite]" />
        </div>
        {run.lastLine && (
          <div className="text-[11px] text-[var(--text-muted)] font-mono mt-1.5 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-[420px]" data-testid="worktree-init-ghost">
            {run.lastLine}
          </div>
        )}
        {run.logTail && <LogDisclosure label={i18nT("common.viewLog", undefined, "View log")} body={run.logTail} />}
      </div>
    );
  }

  if (run.phase === "done") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11.5px] rounded-lg ${pad} border border-green-500/35 bg-green-500/[0.06] text-green-400`}
        data-testid="worktree-init-chip"
      >
        ✓ <span className="font-semibold">{i18nT("worktree.initialized", undefined, "Initialized")}</span>
        <span className="text-[var(--text-muted)]">· {elapsed}s</span>
      </span>
    );
  }

  // failed — sticky
  return (
    <div className="inline-flex flex-col max-w-[460px]" data-testid="worktree-init-chip">
      <span className={`inline-flex items-center gap-1.5 text-[11.5px] rounded-lg ${pad} border border-red-500/40 bg-red-500/[0.07] text-red-400`} data-testid="worktree-init-error">
        ✕ <span className="font-semibold">{failedLabel}</span>
        <span className="text-[var(--text-muted)] font-mono text-[10.5px]">· {shortSummary(run)}</span>
        {onRetry && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            data-testid="worktree-init-retry"
            className="ml-2 text-[11px] px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] text-amber-400 hover:text-amber-300"
          >
            ↻ {i18nT("common.retry", undefined, "Retry")}
          </button>
        )}
      </span>
      {run.stderr && <LogDisclosure label={i18nT("common.viewLog", undefined, "View log")} body={run.stderr} />}
    </div>
  );
}
