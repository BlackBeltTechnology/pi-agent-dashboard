/**
 * Shared `+adds −dels` line-count badges (change: add-change-summary-table).
 * Used by the per-turn ChangeSummaryBlock and the DiffFileTree rows/header so
 * the two surfaces render identical count styling.
 */

export function CountBadges({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="font-mono tabular-nums whitespace-nowrap">
      {additions > 0 && <span className="text-[var(--accent-green)]">+{additions}</span>}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && <span className="text-[var(--accent-red)]">−{deletions}</span>}
      {additions === 0 && deletions === 0 && <span className="text-[var(--text-tertiary)]">±0</span>}
    </span>
  );
}
