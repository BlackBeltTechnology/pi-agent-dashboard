/**
 * Friendly worktree-init status chip (design variant A / D1).
 *
 * Renders one of three states from a `ClientInitRun`, replacing the old raw
 * `<pre>` wall:
 *   - running → spinner + `Initializing… · {elapsed}` + slim indeterminate bar +
 *     ghost of the last log line + collapsed `<details>` log.
 *   - done    → `mdiCheckCircleOutline Initialized · {elapsed}` flash (parent collapses it).
 *   - failed  → `mdiAlertCircleOutline Init failed` + the failure code on a second
 *     line + Retry on its own row + opt-in log; sticky (never auto-dismiss).
 *
 * Fits its banner: block-level `w-full` column capped at 420/460 px, long
 * tokens wrap (`[overflow-wrap:anywhere]`), the ghost line ellipsizes.
 * Chrome (status label, glyphs, spinner arc, bar, log toggle, Retry) paints
 * `currentColor`, inheriting the banner's `--severity-*-fg`; body copy (elapsed,
 * ghost, failure message, log `<pre>`) uses `--text-secondary` (AA on every
 * severity bg). No `--text-muted` / `--text-tertiary` / palette classes.
 *
 * Purely presentational; the run state + timers live in `worktree-init-store`.
 * See change: friendlier-worktree-init, fix-folder-card-pill-contrast, fix-worktree-init-chip-overflow.
 */
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiChevronRight, mdiReplay } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useState } from "react";
import type { ClientInitRun } from "../../lib/git/worktree-init-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** Label prefix — "Initializing" (manual/folder) vs "Auto-init" (spawn). */
type Variant = "manual" | "auto";

interface Props {
  run: ClientInitRun;
  variant?: Variant;
  /** Retry handler for the failed state. */
  onRetry?: () => void;
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
      className="inline-block w-3 h-3 rounded-full border-2 border-current/25 border-t-current animate-spin flex-none"
      aria-hidden
    />
  );
}

function LogDisclosure({ label, body }: { label: string; body: string }) {
  return (
    <details className="group mt-1.5 max-w-full" data-testid="worktree-init-log">
      <summary className="list-none cursor-pointer text-[12px] underline inline-flex items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
        <Icon path={mdiChevronRight} size={0.5} className="transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <pre className="mt-1.5 bg-[var(--bg-code)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 max-h-[200px] overflow-auto text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap [overflow-wrap:anywhere] font-mono">
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

export function WorktreeInitChip({ run, variant = "manual", onRetry }: Props) {
  const elapsed = useElapsed(run.startedAt, run.phase === "running");
  const runningLabel = variant === "auto" ? i18nT("worktree.autoInitializing", undefined, "Auto-initializing…") : i18nT("worktree.initializing", undefined, "Initializing…");
  const failedLabel = variant === "auto" ? i18nT("worktree.autoInitFailed", undefined, "Auto-init failed") : i18nT("err.initFailed", undefined, "Init failed");

  if (run.phase === "running") {
    return (
      <div className="flex flex-col w-full max-w-[420px]" data-testid="worktree-init-chip">
        <span className="inline-flex items-center gap-2 text-[12px]">
          <Spinner />
          <span className="font-semibold">{runningLabel}</span>
          <span className="font-mono text-[11px] text-[var(--text-secondary)]" data-testid="worktree-init-elapsed">· {elapsed}s</span>
        </span>
        <div className="h-[3px] rounded bg-current/15 overflow-hidden mt-1.5">
          <i className="block h-full w-2/5 rounded bg-gradient-to-r from-transparent via-current to-transparent animate-[wtinit-slide_1.4s_ease-in-out_infinite]" />
        </div>
        {run.lastLine && (
          <div className="text-[11px] font-mono text-[var(--text-secondary)] mt-1.5 pl-0.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-full" data-testid="worktree-init-ghost">
            {run.lastLine}
          </div>
        )}
        {run.logTail && <LogDisclosure label={i18nT("common.viewLog", undefined, "View log")} body={run.logTail} />}
      </div>
    );
  }

  if (run.phase === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px]" data-testid="worktree-init-chip">
        <Icon path={mdiCheckCircleOutline} size={0.6} className="shrink-0" />
        <span className="font-semibold">{i18nT("worktree.initialized", undefined, "Initialized")}</span>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]" data-testid="worktree-init-elapsed">· {elapsed}s</span>
      </span>
    );
  }

  // failed — sticky
  return (
    <div className="flex flex-col gap-1 w-full max-w-[460px]" data-testid="worktree-init-chip">
      <div className="flex flex-col gap-0.5" data-testid="worktree-init-error">
        <div className="flex items-center gap-1.5 text-[12px]">
          <Icon path={mdiAlertCircleOutline} size={0.6} className="shrink-0" />
          <span className="font-semibold">{failedLabel}</span>
        </div>
        <div className="font-mono text-[11px] text-[var(--text-secondary)] [overflow-wrap:anywhere]" data-testid="worktree-init-message">{shortSummary(run)}</div>
      </div>
      {onRetry && (
        <div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            data-testid="worktree-init-retry"
            className="focus-ring inline-flex items-center gap-1 rounded border border-current px-2 py-0.5 text-[12px] font-semibold tap-target hover:bg-current/10"
          >
            <Icon path={mdiReplay} size={0.5} className="shrink-0" />
            {i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      )}
      {run.stderr && <LogDisclosure label={i18nT("common.viewLog", undefined, "View log")} body={run.stderr} />}
    </div>
  );
}
