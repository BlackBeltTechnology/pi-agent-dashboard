/**
 * ChangesRailSection — slim summary bar pinned atop the editor-pane rail
 * (change: collapse-diff-file-tree). Replaces the old standalone `DiffFileTree`
 * section: shows `Changes (N) · +X −Y`, the `summed` badge for non-git
 * sessions, and the `this session only` toggle (rail-local state owned by
 * `EditorPane`, D3 — NOT lifted to context, which would break the
 * `FileDiffView` takeover). The per-file changed rows now live inline in
 * `EditorFileTree`. Absent when the session has no changes.
 */
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CountBadges } from "../session/CountBadges.js";
import { useOptionalSessionDiff } from "../diff/SessionDiffContext.js";

export function ChangesRailSection({
  sessionOnly,
  onSessionOnlyChange,
}: {
  sessionOnly: boolean;
  onSessionOnlyChange: (v: boolean) => void;
}) {
  const diff = useOptionalSessionDiff();
  const files = diff?.data?.files ?? [];
  const otherChanges = diff?.data?.otherChanges ?? [];
  if (files.length === 0 && otherChanges.length === 0) return null;

  const isGitRepo = diff?.data?.isGitRepo ?? false;
  const totalAdditions = diff?.data?.totalAdditions;
  const totalDeletions = diff?.data?.totalDeletions;
  const hasTotals = totalAdditions !== undefined || totalDeletions !== undefined;
  const summed = !isGitRepo && totalAdditions !== undefined;
  const hasOther = otherChanges.length > 0;

  return (
    <div
      data-testid="changes-rail-section"
      className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] px-2 py-1 text-xs text-[var(--text-tertiary)]"
    >
      <span className="font-medium text-[var(--text-secondary)]">
        {i18nT("common.changes", undefined, "Changes")}
      </span>
      <span>({files.length})</span>
      {hasTotals && (
        <>
          <span>·</span>
          <CountBadges additions={totalAdditions ?? 0} deletions={totalDeletions ?? 0} />
        </>
      )}
      {summed && (
        <span
          title={i18nT("common.summedBadgeHint", undefined, "Summed per-turn deltas (non-git), not git-net")}
          className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          {i18nT("common.summed", undefined, "summed")}
        </span>
      )}
      {hasOther && (
        <label
          data-testid="session-only-toggle"
          className="ml-auto flex cursor-pointer select-none items-center gap-1"
          title={i18nT("diff.sessionOnlyHint", undefined, "Hide working-tree changes this session did not make")}
        >
          <input
            type="checkbox"
            checked={sessionOnly}
            onChange={(e) => onSessionOnlyChange(e.target.checked)}
            className="h-3 w-3"
          />
          <span>{i18nT("diff.sessionOnly", undefined, "this session only")}</span>
        </label>
      )}
    </div>
  );
}
