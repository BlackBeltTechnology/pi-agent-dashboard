/**
 * Fallback mounted instead of a rich viewer when the opened file exceeds
 * `MAX_PREVIEW_BYTES` (D7). Shows a short notice + an **Open raw** affordance
 * that streams the untransformed bytes from `/api/file/raw`, so a huge file is
 * never rendered uncapped in the pane.
 *
 * See change: open-view-command-in-editor-pane (D7).
 */
import { MAX_PREVIEW_BYTES } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiFileAlertOutline, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@mdi/react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  path: string;
  /** Actual file size in bytes, for the human-readable notice. */
  size?: number;
}

const MB = 1024 * 1024;

export function TooLargePreview({ cwd, path, size }: Props) {
  const { t } = useI18n();
  const rawHref = `${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  const capMb = Math.round(MAX_PREVIEW_BYTES / MB);
  const sizeMb = typeof size === "number" ? (size / MB).toFixed(1) : null;
  return (
    <div
      data-testid="too-large-preview"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--text-tertiary)]"
    >
      <Icon path={mdiFileAlertOutline} size={1.4} className="text-[var(--accent-yellow)]" />
      <div>
        {sizeMb
          ? t(
              "editor.tooLargeToPreviewSized",
              { size: sizeMb, cap: capMb },
              `This file is ${sizeMb} MB — too large to preview (limit ${capMb} MB).`,
            )
          : t("editor.tooLargeToPreview", { cap: capMb }, `File too large to preview (limit ${capMb} MB).`)}
      </div>
      <a
        href={rawHref}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="too-large-open-raw"
        className="flex items-center gap-1 rounded bg-[var(--accent-blue)] px-3 py-1 text-white"
      >
        <Icon path={mdiOpenInNew} size={0.6} />
        <span>{t("editor.openRaw", undefined, "Open raw")}</span>
      </a>
    </div>
  );
}
