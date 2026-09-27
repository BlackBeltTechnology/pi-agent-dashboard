/**
 * Settings › General › Session card sections — global on/off default per
 * session-card section, each row showing how many folders override it (so a
 * global flip never silently fails to take effect somewhere). Applies
 * immediately over WS (like the card legend menu), outside the unified Save
 * draft. Turning a section back ON sends `null` (inherit the built-in
 * visible default) so the global map stays sparse.
 * See change: configurable-session-card-sections (design D9).
 */
import { countFolderOverrides, getGlobalValue } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { useId } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type CardSectionMeta, useOfferedCardSections } from "../../lib/session/card-section-meta.js";
import { useCardSectionActions, useCardSectionPrefs } from "../../lib/state/CardSectionsContext.js";

export function CardSectionsSection() {
  const prefs = useCardSectionPrefs();
  const actions = useCardSectionActions();
  const offered = useOfferedCardSections();

  return (
    <div data-testid="card-sections-settings">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("cardSections.globalTitle", undefined, "Session card sections")}
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        {i18nT(
          "cardSections.globalLead",
          undefined,
          "Default for all folders. Folders can override each section in Directory Settings › Session cards. Changes apply immediately.",
        )}
      </p>
      <div className="space-y-3">
        {offered.map((m) => (
          <GlobalRow
            key={m.id}
            meta={m}
            visible={getGlobalValue(prefs, m.id) ?? true}
            overrides={countFolderOverrides(prefs, m.id)}
            onToggle={(next) => actions.setVisibility(undefined, m.id, next ? null : false)}
          />
        ))}
      </div>
    </div>
  );
}

function GlobalRow({
  meta,
  visible,
  overrides,
  onToggle,
}: {
  meta: CardSectionMeta;
  visible: boolean;
  overrides: number;
  onToggle: (next: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-center justify-between gap-3" data-testid={`card-sections-global-${meta.id}`}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-[var(--text-secondary)]">
          {meta.label()}
        </label>
        <p id={hintId} className="text-xs text-[var(--text-tertiary)]" data-testid={`card-sections-global-count-${meta.id}`}>
          {overrides > 0
            ? i18nT("cardSections.folderOverrideCount", { count: overrides }, "{count} folder(s) override this")
            : i18nT("cardSections.noFolderOverrides", undefined, "No folder overrides")}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={visible}
        aria-describedby={hintId}
        onClick={() => onToggle(!visible)}
        className={`relative shrink-0 w-10 h-5 rounded-full transition-colors focus-ring ${visible ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"}`}
      >
        <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${visible ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}
