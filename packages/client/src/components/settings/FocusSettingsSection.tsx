/**
 * Settings › Sessions › Focus — on/off, profile label (Built-in / Custom),
 * `Save current as my focus profile`, `Reset to default`, and per-row profile
 * editing (`Not set` / `Show` / `Hide`) behind a collapsed `Customize profile`
 * disclosure. Focus is an overlay: nothing here edits the normal settings.
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { defaultFocusValue } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { useId } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useOfferedCardSections } from "../../lib/session/card-section-meta.js";
import { useFocusActions, useFocusState } from "../../lib/state/CardSectionsContext.js";

type RowValue = "unset" | "show" | "hide";

export function FocusSettingsSection() {
  const focus = useFocusState();
  const actions = useFocusActions();
  const offered = useOfferedCardSections();
  const ids = offered.map((m) => m.id);
  const switchId = useId();

  const rowValue = (id: string): RowValue => {
    const v = focus.profile ? focus.profile.sections?.[id] : defaultFocusValue(id);
    return v === undefined ? "unset" : v ? "show" : "hide";
  };
  const mode = (focus.profile ?? { folderListMode: "accordion" as const }).folderListMode;

  return (
    <div className="mb-6" data-testid="focus-settings">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("focus.title", undefined, "Focus mode")}
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-3">
        {i18nT(
          "focus.lead",
          undefined,
          "A one-click minimal sidebar. Focus overlays a profile on top of your normal settings and never changes them; turning it off restores everything.",
        )}
      </p>
      <div className="flex items-center justify-between gap-3 mb-3">
        <label htmlFor={switchId} className="text-sm text-[var(--text-secondary)]">
          {i18nT("focus.enable", undefined, "Focus mode")}
        </label>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={focus.enabled}
          disabled={!actions.canWrite}
          data-testid="focus-settings-switch"
          onClick={() => actions.setEnabled(!focus.enabled)}
          className={`relative shrink-0 w-10 h-5 rounded-full transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${focus.enabled ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"}`}
        >
          <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${focus.enabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          data-testid="focus-profile-label"
          className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        >
          {focus.custom
            ? i18nT("focus.profileCustom", undefined, "Profile: Custom")
            : i18nT("focus.profileBuiltin", undefined, "Profile: Built-in")}
        </span>
        <button
          type="button"
          data-testid="focus-save-current"
          disabled={!actions.canWrite}
          onClick={() => actions.saveCurrent(ids)}
          className="text-xs px-2.5 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 focus-ring"
        >
          {i18nT("focus.saveCurrent", undefined, "Save current as my focus profile")}
        </button>
        <button
          type="button"
          data-testid="focus-reset"
          disabled={!actions.canWrite || !focus.custom}
          onClick={() => actions.reset()}
          className="text-xs px-2.5 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 focus-ring"
        >
          {i18nT("focus.reset", undefined, "Reset to default")}
        </button>
      </div>
      <details data-testid="focus-customize" className="rounded-lg border border-[var(--border-subtle)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] focus-ring">
          {i18nT("focus.customize", undefined, "Customize profile")}
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <ProfileRow
            id="folderListMode"
            label={i18nT("focus.folderListMode", undefined, "Folder list")}
            value={mode === "classic" ? "show" : "hide"}
            options={[
              { v: "show", text: i18nT("focus.modeClassic", undefined, "Classic") },
              { v: "hide", text: i18nT("focus.modeAccordion", undefined, "Accordion") },
            ]}
            disabled={!actions.canWrite}
            onChange={(v) => actions.setFolderListMode(v === "show" ? "classic" : "accordion", ids)}
          />
          {offered.map((m) => (
            <ProfileRow
              key={m.id}
              id={m.id}
              label={m.label()}
              value={rowValue(m.id)}
              options={[
                { v: "unset", text: i18nT("focus.notSet", undefined, "Not set") },
                { v: "show", text: i18nT("cardSections.show", undefined, "Show") },
                { v: "hide", text: i18nT("cardSections.hide", undefined, "Hide") },
              ]}
              disabled={!actions.canWrite}
              onChange={(v) => actions.setRow(m.id, v === "unset" ? null : v === "show", ids)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function ProfileRow({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { v: string; text: string }[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3" data-testid={`focus-row-${id}`}>
      <span className="text-sm text-[var(--text-secondary)] min-w-0 truncate">{label}</span>
      <fieldset aria-label={label} className="inline-flex rounded-md border border-[var(--border-secondary)] overflow-hidden shrink-0">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            disabled={disabled}
            data-testid={`focus-row-${id}-${o.v}`}
            onClick={() => {
              if (value !== o.v) onChange(o.v);
            }}
            className={`px-2 min-h-[26px] text-[11px] border-l first:border-l-0 border-[var(--border-secondary)] focus-ring disabled:opacity-50 ${
              value === o.v ? "bg-blue-600/15 text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {o.text}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
