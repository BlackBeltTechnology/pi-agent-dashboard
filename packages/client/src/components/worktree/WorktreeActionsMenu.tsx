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

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArrowUpBoldOutline,
  mdiCloseBoxOutline,
  mdiDotsHorizontal,
  mdiSourceMerge,
  mdiSourcePull,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { createWorktreePR, pushWorktreeBranch } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { fetchTool } from "../../lib/api/tools-api.js";
import { CloseWorktreeDialog } from "./CloseWorktreeDialog.js";
import { MergeConfirmDialog } from "./MergeConfirmDialog.js";

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
    case "no_remote":            return i18nT("worktree.errNoRemote", undefined, "no `origin` remote configured");
    case "auth_failed":          return i18nT("worktree.errAuthFailed", undefined, "git auth failed");
    case "non_fast_forward":     return i18nT("worktree.errNonFastForward", undefined, "remote has commits you don't have — pull first");
    case "gh_not_found":         return i18nT("worktree.errGhNotFound", undefined, "`gh` CLI not installed");
    case "gh_not_authed":        return i18nT("worktree.errGhNotAuthed", undefined, "`gh` not authenticated — run `gh auth login`");
    case "pr_exists":            return i18nT("worktree.errPrExists", undefined, "PR already exists for this branch");
    case "base_not_found":       return i18nT("worktree.errBaseNotFound", undefined, "base branch not found on origin");
    case "pushed_but_pr_failed": return i18nT("worktree.errPushedButPrFailed", undefined, "branch pushed, but `gh pr create` failed");
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
  const sheetTriggerRef = React.useRef<HTMLButtonElement>(null);
  const { flipUp: sheetFlipUp, maxHeight: sheetMaxHeight } = usePopoverFlip(sheetTriggerRef, { open: sheetOpen });

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
    if (result.ok) setToast({ level: "success", text: i18nT("worktree.pushed", undefined, "Pushed.") });
    else setToast({ level: "error", text: i18nT("worktree.pushFailed", { reason: labelForCode(result.code) }, "push failed: {reason}"), stderr: result.stderr });
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
      setToast({ level: "success", text: i18nT("worktree.prOpened", undefined, "PR opened.") });
    } else if (!result.ok) {
      setToast({ level: "error", text: i18nT("worktree.prFailed", { reason: labelForCode(result.code) }, "PR failed: {reason}"), stderr: result.stderr });
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
      label: i18nT("worktree.push", undefined, "Push"),
      icon: mdiArrowUpBoldOutline,
      onClick: onPush,
      title: i18nT("worktree.pushBranchToOrigin", undefined, "Push branch to origin"),
      disabled: busy !== null,
      variant: "warn",
    },
    ...(showPrButton ? [{
      key: "pr",
      label: session.gitPrNumber != null ? i18nT("worktree.viewPrNumber", { number: session.gitPrNumber }, "View PR #{number}") : i18nT("worktree.openPr", undefined, "Open PR"),
      icon: mdiSourcePull,
      onClick: onOpenPr,
      title: session.gitPrNumber != null ? i18nT("worktree.openPrNumberInBrowser", { number: session.gitPrNumber }, "Open PR #{number} in browser") : i18nT("worktree.openPrViaGh", undefined, "Open a pull request via gh"),
      disabled: busy !== null,
      variant: "warn" as const,
    }] : []),
    {
      key: "merge",
      label: i18nT("worktree.merge", undefined, "Merge"),
      icon: mdiSourceMerge,
      onClick: () => setMergeOpen(true),
      title: i18nT("worktree.mergeBranchIntoBase", undefined, "Merge this branch into its base"),
      variant: "success",
    },
    {
      key: "close",
      label: i18nT("worktree.close", undefined, "Close"),
      icon: mdiCloseBoxOutline,
      onClick: () => setCloseOpen(true),
      title: i18nT("worktree.closeRemoveWorktree", undefined, "Close (remove) this worktree"),
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
      title={externalDisabled ? i18nT("session.sessionIsStreaming", undefined, "Session is streaming") : b.title}
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
            ref={sheetTriggerRef}
            type="button"
            onClick={() => setSheetOpen((s) => !s)}
            title={i18nT("worktree.worktreeActions", undefined, "Worktree actions")}
            data-testid="worktree-actions-mobile-trigger"
            className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Icon path={mdiDotsHorizontal} size={0.5} />
          </button>
          {sheetOpen && (
            <div
              data-testid="worktree-actions-mobile-sheet"
              style={{ maxHeight: sheetMaxHeight }}
              className={`absolute right-0 z-50 flex flex-col gap-1 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded p-1 min-w-[140px] ${
                sheetFlipUp ? "bottom-full mb-1" : "top-full mt-1"
              }`}
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
              <summary className="cursor-pointer text-[var(--text-muted)] underline decoration-dotted">{i18nT("common.details", undefined, "details")}</summary>
              <pre className="mt-1 text-[10px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap max-w-md max-h-40 overflow-auto">{toast.stderr}</pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title={i18nT("common.dismiss", undefined, "dismiss")}
          >×</button>
        </span>
      )}

      {closeOpen && (
        <CloseWorktreeDialog
          cwd={session.cwd}
          allSessions={allSessions}
          onShutdownSession={onShutdownSession}
          onClose={() => setCloseOpen(false)}
          onRemoved={() => setToast({ level: "success", text: i18nT("worktree.worktreeRemoved", undefined, "Worktree removed.") })}
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
