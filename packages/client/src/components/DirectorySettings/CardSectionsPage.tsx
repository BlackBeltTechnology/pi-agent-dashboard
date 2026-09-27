/**
 * Directory Settings › Session cards — per-folder session-card section
 * visibility. One tri-state control per section (Default (<global>) / Show /
 * Hide) writing SPARSE overrides (`Default` sends `null` = inherit), grouped
 * Sections / Plugin sections / Card lines, override badges, `Reset to global`,
 * and a synthetic live preview built from the same resolver as the cards.
 * Plugin rows render only when an installed plugin claims the section's slot.
 * Writes apply immediately (server-authoritative, synced to every browser).
 * See change: configurable-session-card-sections (design D9).
 */
import {
  type CardSectionPrefs,
  cardSectionFolderKey,
  getFolderOverride,
  getGlobalValue,
  resolveCardSectionVisible,
} from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type CardSectionGroup, type CardSectionMeta, useOfferedCardSections } from "../../lib/session/card-section-meta.js";
import { useCardSectionActions, useCardSectionPrefs } from "../../lib/state/CardSectionsContext.js";

type TriState = "inherit" | "show" | "hide";

function groupTitle(g: CardSectionGroup): string {
  if (g === "builtin") return i18nT("cardSections.groupSections", undefined, "Sections");
  if (g === "plugin") return i18nT("cardSections.groupPlugin", undefined, "Plugin sections");
  return i18nT("cardSections.groupLines", undefined, "Card lines");
}

export function CardSectionsPage({ cwd }: { cwd: string }) {
  const prefs = useCardSectionPrefs();
  const actions = useCardSectionActions();
  const [, navigate] = useLocation();
  const offered = useOfferedCardSections();
  const key = cardSectionFolderKey(cwd);
  const overrideCount = Object.keys(prefs.folders?.[key] ?? {}).length;

  const row = (m: CardSectionMeta) => {
    const override = getFolderOverride(prefs, key, m.id);
    const globalVisible = getGlobalValue(prefs, m.id) ?? true;
    const value: TriState = override === null ? "inherit" : override ? "show" : "hide";
    const label = m.label();
    const options: { v: TriState; text: string; send: boolean | null }[] = [
      {
        v: "inherit",
        text: globalVisible
          ? i18nT("cardSections.defaultShow", undefined, "Default (Show)")
          : i18nT("cardSections.defaultHide", undefined, "Default (Hide)"),
        send: null,
      },
      { v: "show", text: i18nT("cardSections.show", undefined, "Show"), send: true },
      { v: "hide", text: i18nT("cardSections.hide", undefined, "Hide"), send: false },
    ];
    return (
      <div
        key={m.id}
        data-testid={`card-section-row-${m.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 border-b last:border-b-0 border-[var(--border-subtle)]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            {label}
            {override !== null && (
              <span
                data-testid={`card-section-overridden-${m.id}`}
                className="text-[10px] font-medium px-1.5 rounded-full bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]"
              >
                {i18nT("cardSections.overridden", undefined, "overridden")}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {m.description()}
            {m.id === "openspec" && (
              <>
                {" "}
                {i18nT("cardSections.openspecNotDisabled", undefined, "Hiding does not disable OpenSpec.")}{" "}
                <button
                  type="button"
                  data-testid="card-section-openspec-optout-link"
                  onClick={() => navigate("/settings/openspec")}
                  className="underline text-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                >
                  {i18nT("cardSections.openspecOptOutLink", undefined, "Manage OpenSpec opt-outs…")}
                </button>
              </>
            )}
          </p>
        </div>
        <fieldset
          aria-label={label}
          className="inline-flex rounded-md border border-[var(--border-secondary)] overflow-hidden"
        >
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              aria-pressed={value === o.v}
              data-testid={`card-section-${m.id}-${o.v}`}
              onClick={() => {
                if (value !== o.v) actions.setVisibility(cwd, m.id, o.send);
              }}
              className={`px-2.5 min-h-[28px] text-xs border-l first:border-l-0 border-[var(--border-secondary)] focus-ring ${
                value === o.v
                  ? "bg-blue-600/15 text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              {o.text}
            </button>
          ))}
        </fieldset>
      </div>
    );
  };

  const groups: CardSectionGroup[] = ["builtin", "plugin", "lines"];

  return (
    <div className="p-4 md:p-6 flex flex-col lg:flex-row gap-6" data-testid="card-sections-page">
      <div className="flex-1 min-w-0 max-w-2xl">
        <h2 className="text-base font-bold text-[var(--text-primary)]">
          {i18nT("cardSections.pageTitle", undefined, "Session cards")}
        </h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 mb-4">
          {i18nT(
            "cardSections.pageLead",
            { folder: cwd },
            "Choose which sections appear on session cards in {folder} (and its worktrees). Applies on every device. Sections with nothing to show still hide automatically.",
          )}
        </p>

        <div className="flex items-center gap-3 px-3 py-2.5 mb-4 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
          <span className="flex-1 text-xs text-[var(--text-secondary)]" data-testid="card-sections-override-summary">
            {overrideCount === 0
              ? i18nT("cardSections.noOverrides", undefined, "Using global defaults — no overrides for this folder.")
              : i18nT("cardSections.overrideCount", { count: overrideCount }, "{count} override(s) for this folder; everything else follows global defaults.")}
          </span>
          <button
            type="button"
            data-testid="card-sections-reset"
            disabled={overrideCount === 0}
            onClick={() => actions.resetFolder(cwd)}
            className="text-xs px-2.5 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
          >
            {i18nT("cardSections.resetToGlobal", undefined, "Reset to global")}
          </button>
        </div>

        {groups.map((g) => {
          const items = offered.filter((m) => m.group === g);
          if (items.length === 0 && g !== "lines") return null;
          return (
            <section
              key={g}
              aria-label={groupTitle(g)}
              className="mb-4 rounded-lg border border-[var(--border-subtle)]"
              data-testid={`card-sections-group-${g}`}
            >
              <h3 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                {groupTitle(g)}
              </h3>
              {items.map(row)}
              {g === "lines" && (
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5" data-testid="card-section-row-context-bar">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {i18nT("settings.contextUsageBar", undefined, "Context usage bar")}
                    </div>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {i18nT("cardSections.contextBarNote", undefined, "Governed by the global chat display preference.")}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="card-section-context-bar-link"
                    onClick={() => navigate("/settings/general")}
                    className="text-xs underline text-[var(--accent-primary)] hover:text-[var(--text-primary)]"
                  >
                    {i18nT("cardSections.openDisplaySettings", undefined, "Open display settings")}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <CardSectionsPreview prefs={prefs} folderKey={key} offered={offered} />
    </div>
  );
}

/**
 * Static synthetic "everything populated" card — shows exactly which sections
 * this folder's cards would render, independent of any live session.
 */
function CardSectionsPreview({
  prefs,
  folderKey,
  offered,
}: {
  prefs: CardSectionPrefs;
  folderKey: string;
  offered: readonly CardSectionMeta[];
}) {
  const on = (id: string) => resolveCardSectionVisible(prefs, folderKey, id);
  const capsules = offered.filter((m) => m.group !== "lines" && on(m.id));
  return (
    <aside className="lg:w-72 shrink-0" aria-label={i18nT("cardSections.previewTitle", undefined, "Live preview")}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
        {i18nT("cardSections.previewTitle", undefined, "Live preview")}
      </h3>
      <div
        data-testid="card-sections-preview"
        aria-hidden="true"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-2 text-[11px]"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="font-semibold text-[var(--text-primary)] flex-1 truncate">
            {i18nT("cardSections.previewSession", undefined, "Example session")}
          </span>
        </div>
        {on("spawn") && (
          <div className="flex gap-1 mt-1" data-testid="card-sections-preview-spawn">
            <span className="text-[9px] px-1 rounded border border-green-500/30 text-green-400">+ {i18nT("session.session", undefined, "Session")}</span>
            <span className="text-[9px] px-1 rounded border border-orange-500/30 text-orange-400">+ {i18nT("worktree.worktree", undefined, "Worktree")}</span>
          </div>
        )}
        {on("tags") && (
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]" data-testid="card-sections-preview-tags">#ui #apply</div>
        )}
        {capsules.map((m) => (
          <div
            key={m.id}
            data-testid={`card-sections-preview-${m.id}`}
            className="relative mt-2 rounded-lg border border-[var(--border-subtle)] px-2 pt-2 pb-1 text-[var(--text-tertiary)]"
          >
            <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[9px] font-semibold uppercase tracking-wider leading-none">
              {m.label()}
            </span>
            <span className="block h-1.5 w-2/3 rounded bg-[var(--bg-tertiary)]" />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
        {i18nT("cardSections.previewNote", undefined, "Synthetic session with every section populated. Real cards still hide empty sections.")}
      </p>
    </aside>
  );
}
