/**
 * Mode switcher above a claimed file's body: the built-in view first ("Preview"),
 * then each claiming plugin's mode (the caller passes them already ordered by
 * plugin priority → plugin id → claim id). Rendered only when ≥1 enabled claim
 * matches the file. For a file outside the session folder the modes are shown
 * unavailable. See change: add-editor-pane-file-handlers (D2, task 3.2).
 */
import { useI18n } from "../../../lib/i18n/i18n.js";
import type { FileHandlerClaim } from "./file-handler-claims.js";

export interface FileModeSwitcherProps {
  /** Claims matching the file, in display order. */
  claims: readonly FileHandlerClaim[];
  /** Selected claim key, or `undefined` for the built-in view. */
  selected: string | undefined;
  onSelect: (mode: string | undefined) => void;
  /** Modes cannot be offered (file outside the session cwd). */
  outsideCwd?: boolean;
}

const BTN = "rounded px-2 py-0.5 text-xs font-medium";
const ON = "bg-[var(--bg-selected)] text-[var(--text-primary)]";
const OFF = "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";

export function FileModeSwitcher({ claims, selected, onSelect, outsideCwd }: FileModeSwitcherProps) {
  const { t } = useI18n();
  if (claims.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t("fileHandler.modeSwitcher", undefined, "View mode")}
      data-testid="file-mode-switcher"
      className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-3 py-1"
    >
      <button
        type="button"
        data-testid="file-mode-builtin"
        aria-pressed={selected === undefined}
        onClick={() => onSelect(undefined)}
        className={`${BTN} ${selected === undefined ? ON : OFF}`}
      >
        {t("fileHandler.preview", undefined, "Preview")}
      </button>
      {outsideCwd ? (
        <span data-testid="file-mode-unavailable" className="text-xs text-[var(--text-tertiary)]">
          {t("fileHandler.outsideSession", undefined, "Editing is unavailable: outside the session folder")}
        </span>
      ) : (
        claims.map((c) => (
          <button
            key={c.key}
            type="button"
            data-testid={`file-mode-${c.key}`}
            aria-pressed={selected === c.key}
            onClick={() => onSelect(c.key)}
            className={`${BTN} ${selected === c.key ? ON : OFF}`}
          >
            {c.meta.label}
          </button>
        ))
      )}
    </div>
  );
}
