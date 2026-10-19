/**
 * Mode switcher above the built-in viewer: "Preview" (the built-in view) then one
 * button per enabled plugin claim matching the file's extension. Shown only when
 * at least one claim matches. Files outside the session cwd show the modes
 * unavailable ("outside the session folder"): a snapshot must never be taken
 * that cannot be saved.
 *
 * See change: add-editor-pane-file-handlers (D2).
 */
import { useI18n } from "../../../lib/i18n/i18n.js";
import type { HandlerClaim } from "./file-handler-logic.js";

export interface FileModeSwitcherProps {
  claims: readonly HandlerClaim[];
  /** Selected claim `ref`, or `undefined` = built-in Preview. */
  selected: string | undefined;
  /** `true` → handler modes are shown disabled (file outside the session folder). */
  outside: boolean;
  onSelect: (ref: string | undefined) => void;
}

const base = "rounded px-2 py-0.5 text-xs font-medium";
const on = "bg-[var(--bg-selected)] text-[var(--text-primary)]";
const off = "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:hover:bg-transparent";

export function FileModeSwitcher({ claims, selected, outside, onSelect }: FileModeSwitcherProps) {
  const { t } = useI18n();
  if (claims.length === 0) return null;
  return (
    <div
      data-testid="file-mode-switcher"
      className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-3 py-1"
    >
      <button
        type="button"
        data-testid="file-mode-preview"
        aria-pressed={selected === undefined || outside}
        className={`${base} ${selected === undefined || outside ? on : off}`}
        onClick={() => onSelect(undefined)}
      >
        {t("fileHandler.preview", undefined, "Preview")}
      </button>
      {claims.map((c) => (
        <button
          key={c.ref}
          type="button"
          data-testid={`file-mode-${c.ref}`}
          aria-pressed={!outside && selected === c.ref}
          disabled={outside}
          title={outside ? t("fileHandler.outsideSession", undefined, "outside the session folder") : undefined}
          className={`${base} ${!outside && selected === c.ref ? on : off}`}
          onClick={() => onSelect(c.ref)}
        >
          {c.label}
        </button>
      ))}
      {outside && (
        <span data-testid="file-mode-outside" className="ml-2 text-xs text-[var(--text-muted)]">
          {t("fileHandler.outsideSession", undefined, "outside the session folder")}
        </span>
      )}
    </div>
  );
}
