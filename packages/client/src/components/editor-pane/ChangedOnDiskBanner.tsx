/**
 * Per-tab "changed on disk" banner. Shown when an open editor-pane file changed
 * on disk (agent edit / external change). Offers **Refresh** (re-fetch via the
 * existing manual-refresh path) but never auto-reloads — dismissing leaves the
 * cached (stale) view in place, preserving scroll position.
 *
 * See change: split-editor-workspace.
 */

import { mdiAlertOutline, mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../lib/i18n/i18n.js";

interface Props {
  fileName: string;
  onRefresh: () => void;
  onDismiss: () => void;
}

export function ChangedOnDiskBanner({ fileName, onRefresh, onDismiss }: Props) {
  const { t } = useI18n();
  return (
    <div
      data-testid="changed-on-disk-banner"
      className="flex shrink-0 items-center gap-2 border-b border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/10 px-3 py-1.5 text-xs text-[var(--text-secondary)]"
    >
      <Icon path={mdiAlertOutline} size={0.65} className="shrink-0 text-[var(--accent-orange)]" />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-mono">{fileName}</b> {t("editor.changedOnDiskStale", undefined, "changed on disk. Cached view is stale.")}
      </span>
      <button
        type="button"
        data-testid="changed-refresh"
        onClick={onRefresh}
        className="shrink-0 rounded border border-[var(--border-secondary)] px-2 py-0.5 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {t("common.refresh", undefined, "Refresh")}
      </button>
      <button
        type="button"
        data-testid="changed-dismiss"
        onClick={onDismiss}
        className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        title={t("editor.dismissKeepStale", undefined, "Dismiss (keep stale view)")}
      >
        <Icon path={mdiClose} size={0.6} />
      </button>
    </div>
  );
}
