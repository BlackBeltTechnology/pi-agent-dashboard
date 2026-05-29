/**
 * Inline action menu rendered inside the WORKSPACE subcard for sessions
 * with `session.gitWorktree`. Four actions:
 *   - Push           → POST /api/git/worktree/push
 *   - Open / View PR → POST /api/git/worktree/pr  (or link to existing PR)
 *   - Merge          → opens MergeConfirmDialog
 *   - Close worktree → opens CloseWorktreeDialog
 *
 * On mobile (`useMobile() === true`) collapses to a single `⋯` button
 * opening an inline action sheet listing the same four actions.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import React, { useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiArrowUpBoldOutline,
  mdiSourcePull,
  mdiSourceMerge,
  mdiCloseBoxOutline,
  mdiDotsHorizontal,
} from "@mdi/js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { pushWorktreeBranch, createWorktreePR } from "../lib/git-api.js";
import { fetchTool } from "../lib/tools-api.js";
import { CloseWorktreeDialog } from "./CloseWorktreeDialog.js";
import { MergeConfirmDialog } from "./MergeConfirmDialog.js";
import { useMobile } from "../hooks/useMobile.js";

/**
 * Module-level cache of `gh` availability — one fetch per page load,
 * shared across every WorktreeActionsMenu instance. `undefined` = pending,
 * `true` / `false` = resolved. See change: add-worktree-lifecycle-actions.
 */
let ghAvailableCache: boolean | undefined;
let ghAvailablePromise: Promise<boolean> | undefined;
/** Test-only: clear the module-level cache. */
export function __resetGhAvailableCache(): void {
  ghAvailableCache = undefined;
  ghAvailablePromise = undefined;
}
function probeGhAvailable(): Promise<boolean> {
  if (ghAvailableCache !== undefined) return Promise.resolve(ghAvailableCache);
  if (ghAvailablePromise) return ghAvailablePromise;
  ghAvailablePromise = fetchTool("gh")
    .then((r) => {
      ghAvailableCache = r.ok === true;
      return ghAvailableCache;
    })
    .catch(() => {
      ghAvailableCache = false;
      return false;
    });
  return ghAvailablePromise;
}

interface Props {
  session: DashboardSession;
  /** Live session list — used by the close dialog to render active-session names. */
  allSessions: DashboardSession[];
  onShutdownSession: (sessionId: string) => void;
  /**
   * External disable signal. When true, every action button renders
   * disabled regardless of internal `busy` state. Used by the composer
   * strip to gate all actions while the session is streaming.
   * See change: redesign-session-card-and-composer (statusbar-disable-on-streaming).
   */
  disabled?: boolean;
}

interface ToastMsg {
  level: "info" | "error" | "success";
  text: string;
  /** Optional captured stderr (gh / git output) rendered in a collapsible `<details>` block. */
  stderr?: string;
}

/**
 * Human-readable label for a stable error code returned by the server
 * lifecycle endpoints. Falls back to the raw code when unknown.
 * See change: add-worktree-lifecycle-actions.
 */
function labelForCode(code: string): string {
  switch (code) {
    case "no_remote":            return "no `origin` remote configured";
    case "auth_failed":          return "git auth failed";
    case "non_fast_forward":     return "remote has commits you don't have — pull first";
    case "gh_not_found":         return "`gh` CLI not installed";
    case "gh_not_authed":        return "`gh` not authenticated — run `gh auth login`";
    case "pr_exists":            return "PR already exists for this branch";
    case "base_not_found":       return "base branch not found on origin";
    case "pushed_but_pr_failed": return "branch pushed, but `gh pr create` failed";
    default:                     return code;
  }
}

export function WorktreeActionsMenu({ session, allSessions, onShutdownSession, disabled: externalDisabled }: Props) {
  const [busy, setBusy] = useState<null | "push" | "pr">(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ghAvailable, setGhAvailable] = useState<boolean | undefined>(ghAvailableCache);
  const isMobile = useMobile();

  useEffect(() => {
    if (ghAvailable !== undefined) return;
    let cancelled = false;
    probeGhAvailable().then((v) => { if (!cancelled) setGhAvailable(v); });
    return () => { cancelled = true; };
  }, [ghAvailable]);

  if (!session.gitWorktree) return null;

  // PR button visibility:
  //   - If session already has a PR (`gitPrNumber` set), always show the
  //     "View PR" link (just opens the URL — doesn't need gh).
  //   - Otherwise only show "Open PR" when `gh` is resolvable.
  const showPrButton = session.gitPrNumber != null || ghAvailable === true;

  const onPush = async () => {
    setBusy("push");
    setToast(null);
    const result = await pushWorktreeBranch({ cwd: session.cwd });
    setBusy(null);
    if (result.ok) setToast({ level: "success", text: "Pushed." });
    else setToast({ level: "error", text: `push failed: ${labelForCode(result.code)}`, stderr: result.stderr });
  };

  const onOpenPr = async () => {
    if (session.gitPrUrl) {
      window.open(session.gitPrUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setBusy("pr");
    setToast(null);
    const result = await createWorktreePR({ cwd: session.cwd });
    setBusy(null);
    if (result.ok && result.data?.url) {
      window.open(result.data.url, "_blank", "noopener,noreferrer");
      setToast({ level: "success", text: "PR opened." });
    } else if (!result.ok) {
      setToast({ level: "error", text: `PR failed: ${labelForCode(result.code)}`, stderr: result.stderr });
    }
  };

  type BtnVariant = "warn" | "success" | "danger" | "neutral";
  const buttons: Array<{
    key: string;
    label: string;
    icon: string;
    onClick: () => void;
    title: string;
    disabled?: boolean;
    variant: BtnVariant;
  }> = [
    {
      key: "push",
      label: "Push",
      icon: mdiArrowUpBoldOutline,
      onClick: onPush,
      title: "Push branch to origin",
      disabled: busy !== null,
      variant: "warn",
    },
    ...(showPrButton ? [{
      key: "pr",
      label: session.gitPrNumber != null ? `View PR #${session.gitPrNumber}` : "Open PR",
      icon: mdiSourcePull,
      onClick: onOpenPr,
      title: session.gitPrNumber != null ? `Open PR #${session.gitPrNumber} in browser` : "Open a pull request via gh",
      disabled: busy !== null,
      variant: "warn" as const,
    }] : []),
    {
      key: "merge",
      label: "Merge",
      icon: mdiSourceMerge,
      onClick: () => setMergeOpen(true),
      title: "Merge this branch into its base",
      variant: "success",
    },
    {
      key: "close",
      label: "Close",
      icon: mdiCloseBoxOutline,
      onClick: () => setCloseOpen(true),
      title: "Close (remove) this worktree",
      variant: "danger",
    },
  ];

  // Palette mirrors ComposerSessionActions — keep both surfaces visually
  // consistent. See change: redesign-session-card-and-composer
  // (statusbar-color-vcs-buttons).
  const variantClasses: Record<BtnVariant, string> = {
    warn:    "text-orange-400 border-orange-500/40 bg-orange-500/5 hover:text-orange-300 hover:border-orange-500/70",
    success: "text-green-400 border-green-500/40 bg-green-500/5 hover:text-green-300 hover:border-green-500/70",
    danger:  "text-red-400 border-red-500/40 bg-red-500/5 hover:text-red-300 hover:border-red-500/70",
    neutral: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)]",
  };

  const renderButton = (b: (typeof buttons)[number]) => (
    <button
      key={b.key}
      type="button"
      onClick={b.onClick}
      disabled={b.disabled || externalDisabled}
      title={externalDisabled ? "Session is streaming" : b.title}
      data-testid={`worktree-action-${b.key}`}
      data-variant={b.variant}
      className={`inline-flex items-center px-1.5 py-[1px] rounded border disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[b.variant]}`}
    >
      <Icon path={b.icon} size={0.45} className="inline mr-0.5" />
      {b.label}
    </button>
  );

  return (
    <div data-testid="worktree-actions-menu" className="flex items-center gap-1 text-[10px] flex-wrap">
      {isMobile ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setSheetOpen((s) => !s)}
            title="Worktree actions"
            data-testid="worktree-actions-mobile-trigger"
            className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Icon path={mdiDotsHorizontal} size={0.5} />
          </button>
          {sheetOpen && (
            <div
              data-testid="worktree-actions-mobile-sheet"
              className="absolute top-full right-0 mt-1 z-50 flex flex-col gap-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded p-1 min-w-[140px]"
            >
              {buttons.map(renderButton)}
            </div>
          )}
        </div>
      ) : (
        buttons.map(renderButton)
      )}

      {toast && (
        <span
          data-testid="worktree-actions-toast"
          className={`text-[10px] inline-flex items-center gap-1 ${toast.level === "error" ? "text-red-400" : toast.level === "success" ? "text-green-400" : "text-[var(--text-muted)]"}`}
        >
          <span>{toast.text}</span>
          {toast.stderr && (
            <details className="inline" data-testid="worktree-actions-toast-details">
              <summary className="cursor-pointer text-[var(--text-muted)] underline decoration-dotted">details</summary>
              <pre className="mt-1 text-[10px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap max-w-md max-h-40 overflow-auto">{toast.stderr}</pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="dismiss"
          >×</button>
        </span>
      )}

      {closeOpen && (
        <CloseWorktreeDialog
          cwd={session.cwd}
          allSessions={allSessions}
          onShutdownSession={onShutdownSession}
          onClose={() => setCloseOpen(false)}
        />
      )}
      {mergeOpen && (
        <MergeConfirmDialog
          cwd={session.cwd}
          onClose={() => setMergeOpen(false)}
        />
      )}
    </div>
  );
}
