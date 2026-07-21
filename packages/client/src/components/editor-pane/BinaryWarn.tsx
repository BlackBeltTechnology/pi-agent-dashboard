/**
 * Binary tab — non-displayable files. Renders a "binary file" notice. No file
 * content is fetched or rendered.
 *
 * See change: add-internal-monaco-editor-pane, remove-external-editor-integration.
 */
import { useI18n } from "../../lib/i18n/i18n.js";
import type { ViewerProps } from "./types.js";

export default function BinaryWarn({ path }: ViewerProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--text-secondary)]">
      <p className="text-[var(--text-primary)]">{t("editor.binaryFileNotice", undefined, "This file is binary and can't be shown here.")}</p>
      <p className="text-xs text-[var(--text-tertiary)]">{path}</p>
    </div>
  );
}
