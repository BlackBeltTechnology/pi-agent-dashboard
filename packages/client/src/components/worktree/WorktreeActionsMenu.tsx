/**
 * Inline action menu rendered inside the WORKSPACE subcard for sessions
 * with `session.gitWorktree`. A PR status segment (link) followed by the
 * PR-state-dependent actions:
 *   - Push           → POST /api/git/worktree/push
 *   - Open PR        → POST /api/git/worktree/pr (no PR / closed PR only)
 *   - Merge          → opens MergeConfirmDialog (not once merged)
 *   - Close worktree → opens CloseWorktreeDialog (always last, separated)
 *
 * On mobile (`useMobile() === true`) collapses to a single `⋯` button
 * opening an inline action sheet listing the same items.
 *
 * See changes: add-worktree-lifecycle-actions, redesign-composer-session-strip (D6).
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
import { usePopoverBoundary } from "../../lib/state/PopoverBoundaryContext.js";
import { createWorktreePR, pushWorktreeBranch } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { fetchTool } from "../../lib/api/tools-api.js";
import { CloseWorktreeDialog } from "./CloseWorktreeDialog.js";
import { MergeConfirmDialog } from "./MergeConfirmDialog.js";
import { logRejection } from "../../lib/report-error.js";

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
/** Exported for the guard-precedence tests. See change: cleanup-client-plugin-promises. */
export function probeGhAvailable(): Promise<boolean> {
  if (ghAvailableCache !== undefined) return Promise.resolve(ghAvailableCache);
  // Explicit nullish check — a `Promise` is always truthy, so the bare guard was
  // correct only by accident. Declared type is `| undefined`, so `!== undefined`
  // (not `!== null`) is the narrowing. See change: cleanup-client-plugin-promises (D6).
  if (ghAvailablePromise !== undefined) return ghAvailablePromise;
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
  /**
   * Merge is this surface's ONE filled primary (`isMergePrimary`, evaluated
   * once per surface by the caller). Ignored while disabled — a disabled
   * Merge is never filled. See change: redesign-composer-session-strip (D6).
   */
  mergeIsPrimary?: boolean;
  /**
   * `chips` (session card, default): bordered chips. `segments` (composer
   * Git `ToolbarGroup`): borderless segments; the root renders
   * `display:contents` so each item is a direct child of the group content.
   */
  appearance?: "chips" | "segments";
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

/** Glyph + state word for the PR segment (never colour-only). */
function prSegmentParts(session: DashboardSession): {
  glyph: string;
  word?: string;
  checks?: { glyph: string; word: string };
  tone: string;
  aria: string;
} | null {
  const n = session.gitPrNumber;
  if (n == null) return null;
  const st = session.gitPrState;
  const prLabel = i18nT("worktree.prAria", { number: n }, "Pull request {number}");
  if (st == null) return { glyph: "", tone: "text-[var(--text-secondary)]", aria: prLabel };
  const checksWord: Record<string, string> = {
    passing: i18nT("worktree.prChecksPassing", undefined, "passing"),
    failing: i18nT("worktree.prChecksFailing", undefined, "failing"),
    pending: i18nT("worktree.prChecksPending", undefined, "pending"),
  };
  const checksGlyph: Record<string, string> = { passing: "✓", failing: "✕", pending: "…" };
  if (st === "merged") {
    const word = i18nT("worktree.prMerged", undefined, "merged");
    return { glyph: "⑂", word, tone: "text-purple-400", aria: `${prLabel}, ${word}` };
  }
  if (st === "closed") {
    const word = i18nT("worktree.prClosed", undefined, "closed");
    return { glyph: "⊘", word, tone: "text-[var(--text-muted)]", aria: `${prLabel}, ${word}` };
  }
  const draft = session.gitPrDraft === true;
  const word = draft ? i18nT("worktree.prDraft", undefined, "draft") : i18nT("worktree.prOpen", undefined, "open");
  const c = session.gitPrChecks;
  const checks = c && c !== "none" ? { glyph: checksGlyph[c]!, word: checksWord[c]! } : undefined;
  const tone = draft
    ? "text-[var(--text-secondary)]"
    : c === "failing"
      ? "text-red-400"
      : c === "pending"
        ? "text-orange-400"
        : "text-green-400";
  const aria = checks
    ? `${prLabel}, ${word}, ${i18nT("worktree.prChecksAria", { state: checks.word }, "checks {state}")}`
    : `${prLabel}, ${word}`;
  return { glyph: draft ? "◌" : "●", word, checks, tone, aria };
}

/**
 * PR status segment: number, state (draft/open/merged/closed) and, for an
 * open PR, the CI checks summary. Links to the PR when a URL is known; plain
 * text otherwise. Legacy bridges (number only) render `#N` alone.
 * See change: redesign-composer-session-strip (D6).
 */
function PrSegment({ session, className }: { session: DashboardSession; className: string }) {
  const parts = prSegmentParts(session);
  if (!parts) return null;
  const body = (
    <>
      {parts.glyph && <span aria-hidden="true">{parts.glyph}</span>}
      <span className="tabular-nums">#{session.gitPrNumber}</span>
      {parts.word && <span aria-hidden="true">{parts.word}</span>}
      {parts.checks && (
        <span aria-hidden="true" data-testid="worktree-pr-checks" data-checks={session.gitPrChecks ?? undefined}>
          · {parts.checks.glyph} {parts.checks.word}
        </span>
      )}
    </>
  );
  const common = {
    "data-testid": "worktree-pr-segment",
    "data-pr-state": session.gitPrState ?? undefined,
    "aria-label": parts.aria,
    title: parts.aria,
    className: `inline-flex items-center gap-1 ${parts.tone} ${className}`,
  };
  return session.gitPrUrl ? (
    <a {...common} href={session.gitPrUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      {body}
    </a>
  ) : (
    <span {...common}>{body}</span>
  );
}

export function WorktreeActionsMenu({ session, allSessions, onShutdownSession, disabled: externalDisabled, mergeIsPrimary = false, appearance = "chips" }: Props) {
  const [busy, setBusy] = useState<null | "push" | "pr">(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ghAvailable, setGhAvailable] = useState<boolean | undefined>(ghAvailableCache);
  const isMobile = useMobile();
  const sheetTriggerRef = React.useRef<HTMLButtonElement>(null);
  // The `right-0` sheet can render in a slim, offset session-card rail; measure
  // against that pane when a provider supplies it (else viewport). See change:
  // fix-popover-container-clip.
  const boundaryRef = usePopoverBoundary();
  const {
    flipUp: sheetFlipUp,
    maxHeight: sheetMaxHeight,
    minHeight: sheetMinHeight,
    anchorRight: sheetAnchorRight,
    maxWidth: sheetMaxWidth,
  } = usePopoverFlip(sheetTriggerRef, { open: sheetOpen, estimatedWidth: 140, boundaryRef });

  useEffect(() => {
    if (ghAvailable !== undefined) return;
    let cancelled = false;
    void probeGhAvailable()
      .then((v) => { if (!cancelled) setGhAvailable(v); })
      .catch(logRejection("WorktreeActionsMenu.probeGhAvailable"));
    return () => { cancelled = true; };
  }, [ghAvailable]);

  if (!session.gitWorktree) return null;

  // PR-state-dependent action set (design D6):
  //   no PR / closed → Push, Open PR (gh-gated), Merge
  //   open / draft (and legacy number-only) → Push, Merge
  //   merged → Push only when ahead, no Merge
  // Close is always last, after a separator. The PR itself is the status
  // segment (a link), not a "View PR #N" button.
  const prState = session.gitPrNumber == null ? "none" : (session.gitPrState ?? "open");
  const noOpenPr = prState === "none" || prState === "closed";
  const showPrButton = noOpenPr && ghAvailable === true;
  const showPush = prState !== "merged" || (session.gitStatus?.ahead ?? 0) > 0;
  const showMerge = prState !== "merged";

  const onPush = async () => {
    setBusy("push");
    setToast(null);
    const result = await pushWorktreeBranch({ cwd: session.cwd });
    setBusy(null);
    if (result.ok) setToast({ level: "success", text: i18nT("worktree.pushed", undefined, "Pushed.") });
    else setToast({ level: "error", text: i18nT("worktree.pushFailed", { reason: labelForCode(result.code) }, "push failed: {reason}"), stderr: result.stderr });
  };

  const onOpenPr = async () => {
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
    emphasis?: "filled" | "outlined";
  }> = [
    ...(showPush ? [{
      key: "push",
      label: i18nT("worktree.push", undefined, "Push"),
      icon: mdiArrowUpBoldOutline,
      onClick: onPush,
      title: i18nT("worktree.pushBranchToOrigin", undefined, "Push branch to origin"),
      disabled: busy !== null,
      variant: "warn" as const,
    }] : []),
    ...(showPrButton ? [{
      key: "pr",
      label: i18nT("worktree.openPr", undefined, "Open PR"),
      icon: mdiSourcePull,
      onClick: onOpenPr,
      title: i18nT("worktree.openPrViaGh", undefined, "Open a pull request via gh"),
      disabled: busy !== null,
      variant: "warn" as const,
    }] : []),
    ...(showMerge ? [{
      key: "merge",
      label: i18nT("worktree.merge", undefined, "Merge"),
      icon: mdiSourceMerge,
      onClick: () => setMergeOpen(true),
      title: i18nT("worktree.mergeBranchIntoBase", undefined, "Merge this branch into its base"),
      variant: "success" as const,
      emphasis: (mergeIsPrimary && !externalDisabled ? "filled" : "outlined") as "filled" | "outlined",
    }] : []),
  ];
  const closeButton: (typeof buttons)[number] = {
    key: "close",
    label: i18nT("worktree.close", undefined, "Close"),
    icon: mdiCloseBoxOutline,
    onClick: () => setCloseOpen(true),
    title: i18nT("worktree.closeRemoveWorktree", undefined, "Close (remove) this worktree"),
    variant: "danger",
  };

  // Palette mirrors ComposerSessionActions — keep both surfaces visually
  // consistent. See change: redesign-session-card-and-composer
  // (statusbar-color-vcs-buttons).
  const variantClasses: Record<BtnVariant, string> = {
    warn:    "text-orange-400 border-orange-500/40 bg-orange-500/5 hover:text-orange-300 hover:border-orange-500/70",
    success: "text-green-400 border-green-500/40 bg-green-500/5 hover:text-green-300 hover:border-green-500/70",
    danger:  "text-red-400 border-red-500/40 bg-red-500/5 hover:text-red-300 hover:border-red-500/70",
    neutral: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)]",
  };
  const segmentText: Record<BtnVariant, string> = {
    warn: "text-orange-400 hover:text-orange-300",
    success: "text-green-400 hover:text-green-300",
    danger: "text-red-400 hover:text-red-300",
    neutral: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  };
  const segments = appearance === "segments";
  // Segments render inside a `display:contents` root, so the group's
  // direct-child hairline rule cannot reach them — each segment draws its own
  // leading hairline. See change: redesign-composer-session-strip (review r1).
  const segmentEdge = "border-l border-[var(--border-subtle)]";
  const itemBase = segments
    ? `inline-flex items-center gap-0.5 px-2 min-h-6 min-w-6 self-stretch bg-transparent hover:bg-[var(--bg-hover)] ${segmentEdge}`
    : "inline-flex items-center px-1.5 py-[1px] rounded border";
  const streamingTip = i18nT("session.sessionIsStreaming", undefined, "Session is streaming");

  const renderButton = (b: (typeof buttons)[number]) => {
    const filled = b.emphasis === "filled";
    return (
      <button
        key={b.key}
        type="button"
        onClick={() => { if (!externalDisabled) b.onClick(); }}
        disabled={b.disabled}
        // Working (streaming ∨ retrying): inert but focusable, reason kept
        // reachable (design D9). `busy` stays a native disable.
        aria-disabled={externalDisabled ? "true" : undefined}
        title={externalDisabled ? streamingTip : b.title}
        data-testid={`worktree-action-${b.key}`}
        data-variant={b.variant}
        data-emphasis={b.emphasis}
        className={`${itemBase} disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ${
          segments ? segmentText[b.variant] : variantClasses[b.variant]
        }${filled ? " font-semibold !bg-[var(--accent-soft)] !text-[var(--text-primary)]" : ""}${
          // The explicit separator already draws Close's leading line.
          segments && b.key === "close" ? " !border-l-0" : ""
        }`}
      >
        <Icon path={b.icon} size={0.45} className="inline mr-0.5" />
        {b.label}
      </button>
    );
  };
  const separator = (
    <span
      key="sep"
      aria-hidden="true"
      data-testid="worktree-actions-separator"
      className={segments ? "w-px self-stretch bg-[var(--border-secondary)]" : "inline-block h-3 w-px bg-[var(--border-secondary)] mx-0.5"}
    />
  );
  const prSegment = (
    <PrSegment
      key="pr-seg"
      session={session}
      className={segments ? `px-2 min-h-6 self-stretch no-underline hover:underline ${segmentEdge}` : "px-1 hover:underline"}
    />
  );
  const items = [prSegment, ...buttons.map(renderButton), separator, renderButton(closeButton)];

  return (
    <div data-testid="worktree-actions-menu" className={segments ? "contents text-[10px]" : "flex items-center gap-1 text-[10px] flex-wrap"}>
      {isMobile ? (
        <div className="relative">
          <button
            ref={sheetTriggerRef}
            type="button"
            onClick={() => setSheetOpen((s) => !s)}
            title={i18nT("worktree.worktreeActions", undefined, "Worktree actions")}
            data-testid="worktree-actions-mobile-trigger"
            className="inline-flex items-center justify-center min-h-6 min-w-6 px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Icon path={mdiDotsHorizontal} size={0.5} />
          </button>
          {sheetOpen && (
            <div
              data-testid="worktree-actions-mobile-sheet"
              style={{ maxHeight: sheetMaxHeight, minHeight: sheetMinHeight, maxWidth: sheetMaxWidth }}
              className={`absolute z-50 flex flex-col gap-1 overflow-y-auto bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded p-1 min-w-[140px] ${
                sheetAnchorRight ? "right-0" : "left-0"
              } ${sheetFlipUp ? "bottom-full mb-1" : "top-full mt-1"}`}
            >
              {items}
            </div>
          )}
        </div>
      ) : (
        items
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
          prNumber={session.gitPrNumber ?? undefined}
          prState={session.gitPrState ?? undefined}
          prChecks={session.gitPrChecks ?? undefined}
          prCheckedAt={session.gitPrCheckedAt ?? undefined}
        />
      )}
    </div>
  );
}
