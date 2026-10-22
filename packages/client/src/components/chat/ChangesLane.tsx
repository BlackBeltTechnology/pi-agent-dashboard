/**
 * Changes lane adapter for the composer dock.
 *
 * `useChangesLane` builds the lane's `DockLane` from `session` (worktree
 * identity, `gitStatus`) and `useDockDiff` (the session-diff endpoint behind a
 * coalescing scheduler). The lane exists for a worktree session or when the
 * session has changed files; only the identity segment and the worktree
 * actions are worktree-gated.
 *
 * - Worktree header: `GitIdentity` (branch, `← base`, drift or the
 *   no-local-changes marker) then `N files +A −D`; main checkout reads
 *   `N files changed`. Without totals (non-git) only the count shows; exactly
 *   the server cap (200) reads `200+`.
 * - Actions are siblings of the disclosure control: Review (opens the diff
 *   view) and `WorktreeActionsMenu`. Merge emphasis is decided once by the
 *   caller (`mergeIsPrimary`).
 * - Body (mounted only while expanded; mounting refetches under the
 *   coalescing rule): one row per in-cwd file with its line delta (sign glyph
 *   as well as colour) and a `via bash` mark; a `N other changes` footer; one
 *   inline `Couldn't refresh changes` line with Retry while the last good list stays.
 * - Row targets (in-cwd rows only, visible without hover, only when the caller passes
 *   the handlers): **Open** (and the file name) → `onOpenFile(rel)` opens the file itself
 *   in the editor pane; **Diff** → `onOpenDiff(rel)` opens its `diff:` tab. Out-of-cwd
 *   rows carry no target. Review is lane-level. Activating any of them ends a dock peek.
 *
 * See change: add-composer-dock (tasks 4.1, 4.2; design D5, D6).
 * See change: composer-dock-collapse-and-file-open (D6).
 */
import { ComposerDockRow, SettingsActionError } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiFileCompare, mdiFileOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId } from "react";
import { type DockDiff, type DockDiffTotals, useDockDiff } from "../../hooks/useDockDiff.js";
import { t } from "../../lib/i18n/i18n.js";
import { GitIdentity } from "../worktree/GitIdentity.js";
import { WorktreeActionsMenu } from "../worktree/WorktreeActionsMenu.js";
import { type DockLane, dockLaneLabel } from "./composer-dock-model.js";
import { useDockPeek } from "./dock-peek-context.js";

export interface ChangesLaneInput {
  /** Bound session; `undefined` → no lane. */
  session: DashboardSession | undefined;
  /** `isComposerWorking(status, retrying)`: gates the worktree actions and drives the diff refetch edge. */
  working: boolean;
  /** Sessions the worktree menu needs (shutdown targets). */
  allSessions?: readonly DashboardSession[];
  onShutdownSession?: (sessionId: string) => void;
  /** Decided ONCE per dock (`isMergePrimary`) and shared with the OpenSpec lane. */
  mergeIsPrimary: boolean;
  /** Open the diff view (Review). */
  onReview?: () => void;
  /** Open one changed file itself (cwd-relative path) in the editor pane. */
  onOpenFile?: (path: string) => void;
  /** Open one changed file's diff tab (cwd-relative path). */
  onOpenDiff?: (path: string) => void;
  /** Show the unclaimed working-tree changes (defaults to `onReview`). */
  onShowOtherChanges?: () => void;
}

const ACTION_BUTTON =
  "focus-ring inline-flex min-h-6 min-w-6 shrink-0 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:min-w-11 max-md:justify-center";

const NO_SESSIONS: readonly DashboardSession[] = [];
const noopShutdown = () => {};

/** `+64 −20`: both values carry their sign glyph as well as their colour. */
function Delta({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="tabular-nums" data-testid="composer-dock-delta">
      <span className="text-[var(--accent-green-text)]">+{additions}</span>{" "}
      <span className="text-[var(--accent-red-text)]">{`\u2212${deletions}`}</span>
    </span>
  );
}

function fileCountText(count: number, capped: boolean, changed: boolean): string {
  const shown = capped ? `${count}+` : count;
  const plural = capped || count !== 1;
  if (changed) {
    return plural
      ? t("dock.changes.filesChangedOther", { count: shown }, "{count} files changed")
      : t("dock.changes.filesChangedOne", { count: shown }, "{count} file changed");
  }
  return plural
    ? t("dock.changes.filesOther", { count: shown }, "{count} files")
    : t("dock.changes.filesOne", { count: shown }, "{count} file");
}

function totalsText(totals: DockDiffTotals): string {
  return `+${totals.additions} \u2212${totals.deletions}`;
}

function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? { name: path, dir: "" } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/** Open / Diff buttons of one in-cwd row (each only when its handler exists). */
function FileTargets({ path, open, diff }: { path: string; open?: () => void; diff?: () => void }) {
  return (
    <>
      {open && (
        <button
          type="button"
          data-testid="composer-dock-file-open"
          onClick={open}
          aria-label={t("dock.changes.openFile", { path }, "Open {path} in editor")}
          className={ACTION_BUTTON}
        >
          {t("dock.changes.open", undefined, "Open")}
        </button>
      )}
      {diff && (
        <button
          type="button"
          data-testid="composer-dock-file-diff"
          onClick={diff}
          aria-label={t("dock.changes.openDiff", { path }, "Open diff of {path}")}
          className={ACTION_BUTTON}
        >
          {t("dock.changes.diff", undefined, "Diff")}
        </button>
      )}
    </>
  );
}

function FileRow({
  file,
  onOpen,
  onDiff,
}: {
  file: FileDiffEntry;
  onOpen?: (path: string) => void;
  onDiff?: (path: string) => void;
}) {
  const { endPeek } = useDockPeek();
  const { name, dir } = splitPath(file.path);
  const hasDelta = file.additions !== undefined || file.deletions !== undefined;
  const viaBash = file.detectedVia === "bash-artifact";
  const meta =
    hasDelta || viaBash ? (
      <span className="inline-flex items-center gap-2">
        {viaBash && (
          <span data-testid="composer-dock-via-bash" title={file.producedBy}>
            {t("dock.changes.viaBash", undefined, "via bash")}
          </span>
        )}
        {hasDelta && <Delta additions={file.additions ?? 0} deletions={file.deletions ?? 0} />}
      </span>
    ) : undefined;
  // Targets exist only for in-cwd rows whose handler the live dock provided; each also ends a dock peek.
  const inCwd = file.previewable !== false;
  const target = (handler?: (path: string) => void) =>
    inCwd && handler
      ? () => {
          handler(file.path);
          endPeek();
        }
      : undefined;
  const open = target(onOpen);
  const diff = target(onDiff);
  return (
    <ComposerDockRow
      icon={<Icon path={mdiFileOutline} size={0.6} />}
      title={name}
      detail={dir || undefined}
      meta={meta}
      onTitleActivate={open}
      titleLabel={open ? t("dock.changes.openFile", { path: file.path }, "Open {path} in editor") : undefined}
      actions={(open || diff) && <FileTargets path={file.path} open={open} diff={diff} />}
    />
  );
}

function ChangesLaneBody({
  diff,
  onOpenFile,
  onOpenDiff,
  onShowOtherChanges,
}: {
  diff: DockDiff;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onShowOtherChanges?: () => void;
}) {
  const errorId = useId();
  const { refreshOnExpand } = diff;
  // Mounting is the lane being expanded: refetch under the coalescing rule.
  useEffect(() => {
    refreshOnExpand();
  }, [refreshOnExpand]);
  return (
    <div data-testid="composer-dock-changes-body" className="grid gap-0.5">
      {diff.failed && (
        <SettingsActionError id={errorId} testId="composer-dock-changes-error">
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("dock.changes.refreshFailed", undefined, "Couldn't refresh changes")}
            <button
              type="button"
              data-testid="composer-dock-changes-retry"
              aria-describedby={errorId}
              onClick={diff.retry}
              className={ACTION_BUTTON}
            >
              {t("common.retry", undefined, "Retry")}
            </button>
          </span>
        </SettingsActionError>
      )}
      {diff.files.map((file) => (
        <FileRow key={file.path} file={file} onOpen={onOpenFile} onDiff={onOpenDiff} />
      ))}
      {diff.outOfCwd.map((file) => (
        <FileRow key={`out:${file.path}`} file={file} />
      ))}
      {diff.otherChangesCount > 0 && (
        <div
          data-testid="composer-dock-other-changes"
          className="flex min-h-8 items-center gap-2 pl-1.5 text-xs text-[var(--text-secondary)]"
        >
          <span className="min-w-0 truncate">
            {diff.otherChangesCount === 1
              ? t("dock.changes.otherOne", { count: diff.otherChangesCount }, "{count} other change, not from this session")
              : t("dock.changes.otherOther", { count: diff.otherChangesCount }, "{count} other changes, not from this session")}
          </span>
          {onShowOtherChanges && (
            <button type="button" onClick={onShowOtherChanges} className={ACTION_BUTTON}>
              {t("dock.changes.showOther", undefined, "Show")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Header strings and nodes for the lane (pure over the session and the diff model). */
function headerOf(session: DashboardSession, diff: DockDiff) {
  const worktree = !!session.gitWorktree;
  const withCount = diff.count > 0;
  const countText = fileCountText(diff.count, diff.capped, !worktree);
  const totals = withCount ? diff.totals : null;
  const summaryText = [worktree ? session.gitBranch : undefined, withCount ? countText : undefined, totals ? totalsText(totals) : undefined]
    .filter(Boolean)
    .join(" ");
  const countNode = (
    <span data-testid="composer-dock-changes-count">
      {countText}
      {totals && (
        <>
          {" "}
          <Delta additions={totals.additions} deletions={totals.deletions} />
        </>
      )}
    </span>
  );
  const summary = withCount ? (diff.capped ? `${diff.count}+` : diff.count) : (session.gitBranch ?? dockLaneLabel("changes"));
  return { worktree, withCount, countNode, summary, summaryText: summaryText || dockLaneLabel("changes") };
}

/** Review + worktree actions: siblings of the disclosure control. */
function ChangesActions({
  session,
  working,
  withCount,
  mergeIsPrimary,
  allSessions,
  onShutdownSession,
  onReview,
}: Pick<ChangesLaneInput, "working" | "mergeIsPrimary" | "allSessions" | "onShutdownSession" | "onReview"> & {
  session: DashboardSession;
  withCount: boolean;
}) {
  const { endPeek } = useDockPeek();
  return (
    <>
      {withCount && onReview && (
        <button
          type="button"
          data-testid="composer-dock-review"
          onClick={() => {
            onReview();
            endPeek();
          }}
          className={ACTION_BUTTON}
        >
          {t("dock.changes.review", undefined, "Review")}
        </button>
      )}
      {session.gitWorktree && (
        <div data-testid="composer-git-group" className="flex items-center">
          <WorktreeActionsMenu
            session={session}
            allSessions={(allSessions ?? NO_SESSIONS) as DashboardSession[]}
            onShutdownSession={onShutdownSession ?? noopShutdown}
            disabled={working}
            mergeIsPrimary={mergeIsPrimary}
            appearance="segments"
          />
        </div>
      )}
    </>
  );
}

export function useChangesLane({
  session,
  working,
  allSessions,
  onShutdownSession,
  mergeIsPrimary,
  onReview,
  onOpenFile,
  onOpenDiff,
  onShowOtherChanges,
}: ChangesLaneInput): DockLane | null {
  const diff = useDockDiff({
    sessionId: session?.id,
    working,
    dirtyCount: session?.gitStatus?.dirtyCount,
  });
  if (!session) return null;
  const { worktree, withCount, countNode, summary, summaryText } = headerOf(session, diff);
  if (!worktree && !withCount) return null;
  const expandable = withCount || diff.outOfCwd.length > 0 || diff.otherChangesCount > 0 || diff.failed;

  return {
    key: "changes",
    label: dockLaneLabel("changes"),
    testId: "composer-git-container",
    icon: <Icon path={mdiFileCompare} size={0.7} />,
    title: worktree ? <GitIdentity session={session} /> : countNode,
    meta: worktree && withCount ? countNode : undefined,
    summary,
    summaryText,
    expandable,
    actions: (
      <ChangesActions
        session={session}
        working={working}
        withCount={withCount}
        mergeIsPrimary={mergeIsPrimary}
        allSessions={allSessions}
        onShutdownSession={onShutdownSession}
        onReview={onReview}
      />
    ),
    renderBody: () => (
      <ChangesLaneBody diff={diff} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} onShowOtherChanges={onShowOtherChanges ?? onReview} />
    ),
  };
}
