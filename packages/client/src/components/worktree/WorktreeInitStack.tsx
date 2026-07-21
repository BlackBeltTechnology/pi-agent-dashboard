/**
 * Concurrent worktree-init stack (design variant E2).
 *
 * Collapses N in-flight / recently-terminal runs from the cwd-keyed store into
 * ONE corner surface: a summary header (`Initializing N worktrees · M done · K
 * failed`) over up to 4 rows (`+N more` overflow), each an independent `cwd`.
 * The surface renders only when ≥ 2 runs are active; a single run shows via its
 * folder-row chip / session-card sub-state instead. Any `failed` row holds the
 * surface open until cleared (Retry / dismiss).
 *
 * Reads the same store as the per-row chips, so stack + cards stay in sync.
 * See change: friendlier-worktree-init.
 */
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { initStore, useAllInitRuns } from "../../lib/git/worktree-init-store.js";

const MAX_ROWS = 4;

/** Last path segment for the row label. */
function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-amber-400/25 border-t-amber-400 animate-spin flex-none"
      aria-hidden
    />
  );
}

export function WorktreeInitStack() {
  const runs = useAllInitRuns();
  // Only a genuinely concurrent surface — single runs live on their row/card.
  if (runs.length < 2) return null;

  const running = runs.filter((r) => r.phase === "running").length;
  const done = runs.filter((r) => r.phase === "done").length;
  const failed = runs.filter((r) => r.phase === "failed").length;
  const visible = runs.slice(0, MAX_ROWS);
  const overflow = runs.length - visible.length;

  const headParts: string[] = [];
  if (done) headParts.push(i18nT("status.nDone", { count: done }, "{count} done"));
  if (failed) headParts.push(i18nT("status.nFailed", { count: failed }, "{count} failed"));

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] overflow-hidden"
      data-testid="worktree-init-stack"
    >
      <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)]">
        {running > 0 && <Spinner />}
        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
          {i18nT("worktree.initializingCount", { count: running || runs.length, s: (running || runs.length) === 1 ? "" : "s" }, "Initializing {count} worktree{s}")}
        </span>
        {headParts.length > 0 && (
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">{headParts.join(" · ")}</span>
        )}
      </div>
      {visible.map((r) => (
        <div
          key={r.cwd}
          className={`flex items-center gap-2 px-3 py-2 border-b border-[var(--border-subtle)] last:border-b-0 text-[11.5px] ${
            r.phase === "failed" ? "bg-red-500/[0.05]" : ""
          }`}
        >
          {r.phase === "running" && <Spinner />}
          {r.phase === "done" && <span className="w-3.5 text-center text-green-400">✓</span>}
          {r.phase === "failed" && <span className="w-3.5 text-center text-red-400">✕</span>}
          <span className="font-semibold text-[var(--text-primary)] min-w-[74px] truncate">{basename(r.cwd)}</span>
          {r.phase === "running" && (
            <span className="flex-1 text-[var(--text-muted)] font-mono text-[11px] truncate">{r.lastLine ?? "…"}</span>
          )}
          {r.phase === "done" && <span className="flex-1 text-green-400">{i18nT("worktree.initialized", undefined, "Initialized")}</span>}
          {r.phase === "failed" && (
            <span className="flex-1 text-red-400 font-mono text-[10.5px] truncate">{r.code ?? "failed"}</span>
          )}
          {r.phase === "failed" ? (
            <button
              type="button"
              onClick={() => initStore.dismiss(r.cwd)}
              data-testid="worktree-init-stack-dismiss"
              className="text-[11px] px-2 py-0.5 rounded-md border border-amber-500/40 bg-amber-500/[0.06] text-amber-400 hover:text-amber-300"
            >
              {i18nT("common.dismiss", undefined, "Dismiss")}
            </button>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">
              {r.phase === "running" ? `${Math.round((Date.now() - r.startedAt) / 1000)}s` : i18nT("status.fading", undefined, "· fading")}
            </span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-[var(--text-muted)]">{i18nT("common.overflowMore", { count: overflow }, "+{count} more")}</div>
      )}
    </div>
  );
}
