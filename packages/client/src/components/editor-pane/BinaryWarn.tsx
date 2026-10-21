/**
 * Binary tab — non-displayable files. Renders a "binary file" notice. No file
 * content is fetched or rendered. When enabled file-handler claims match the
 * file, the notice offers each mode as a button (same label and action as the
 * mode switcher), so files without a built-in viewer are not a dead end.
 *
 * See change: add-internal-monaco-editor-pane, remove-external-editor-integration,
 * extend-craft-web-to-all-apps (D11 A4).
 */
import { useI18n } from "../../lib/i18n/i18n.js";
import { useFileModeOffers } from "./file-handler/file-mode-offers.js";
import type { ViewerProps } from "./types.js";

const BTN =
  "focus-ring inline-flex items-center justify-center rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[32px] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

export default function BinaryWarn({ path }: ViewerProps) {
  const { t } = useI18n();
  const offers = useFileModeOffers();
  const claims = offers?.claims ?? [];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--text-secondary)]">
      <p className="text-[var(--text-primary)]">{t("editor.binaryFileNotice", undefined, "This file is binary and can't be shown here.")}</p>
      {offers && claims.length > 0 && (
        <div className="flex flex-col items-center gap-2" data-testid="binary-mode-offers">
          <span>{t("editor.binaryOpenWith", undefined, "It can be opened with a plugin:")}</span>
          <div className="flex flex-wrap justify-center gap-2">
            {claims.map((c) => (
              <button key={c.key} type="button" className={BTN} data-testid={`binary-mode-${c.key}`} onClick={() => offers.onSelect(c.key)}>
                {c.meta.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-[var(--text-tertiary)]">{path}</p>
    </div>
  );
}
