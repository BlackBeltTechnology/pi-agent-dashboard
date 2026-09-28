/**
 * Settings-nav promotion resolver: decides which plugin settings pages the
 * host promotes into a nav group (today only `models`), under what label, in
 * what order. Pure; owns the whole "is this plugin promoted" decision.
 *
 * Gate (all must hold): a `settings-section` claim carries a `nav` hint; its
 * `group` is allowlisted; the row is `firstParty` (server-computed npm scope,
 * never re-derived here); the folded label is not RESERVED. First eligible
 * claim per plugin wins; across plugins a folded-label collision keeps the
 * hint sorting first by (`order`, plugin id). Placement only: the page stays
 * at `/settings/plugins/<id>`.
 *
 * See change: promote-model-roles-settings (design D2).
 */
import { translationsOf } from "./i18n/i18n.js";

/** Groups a plugin may be promoted into. */
export const PROMOTION_GROUP_ALLOWLIST: ReadonlySet<string> = new Set(["models"]);

const DEFAULT_ORDER = 1000;

export interface SettingsPromotion {
  pluginId: string;
  group: string;
  label: string;
  description?: string;
  order: number;
}

/** Minimal row shape the resolver reads (a subset of `PluginRow`). */
export interface PromotionRow {
  id: string;
  firstParty?: boolean;
  claims: ReadonlyArray<{
    slot: string;
    nav?: { group: string; label: string; description?: string; order?: number };
  }>;
}

/** NFKC + trim + case-fold: the comparison key for label collisions. */
export function foldSettingsLabel(label: string): string {
  return label.normalize("NFKC").trim().toLowerCase();
}

/**
 * Built-in settings page + nav group labels as `[i18n key, English source]`.
 * Mirrors the `navGroups` table in `SettingsPanel.tsx` (English lives at call
 * sites; the drift guard is a SettingsPanel test asserting every rendered rail
 * label is reserved).
 */
const BUILT_IN_SETTINGS_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["settings.groupModels", "Models"],
  ["settings.groupDashboard", "Dashboard"],
  ["settings.groupNetwork", "Network"],
  ["settings.groupExtensions", "Extensions"],
  ["settings.groupResources", "Resources"],
  ["settings.groupAdvanced", "Advanced"],
  ["settings.general", "General"],
  ["common.server", "Server"],
  ["settings.sessions", "Sessions"],
  ["settings.remoteServers", "Remote Servers"],
  ["settings.gateway", "Gateway"],
  ["settings.security", "Security"],
  ["settings.access", "Access"],
  ["settings.providers", "Providers"],
  ["settings.packages", "Packages"],
  ["settings.plugins", "Plugins"],
  ["settings.openspec", "OpenSpec"],
  ["common.skills", "Skills"],
  ["common.agents", "Agents"],
  ["packages.extensions", "Extensions"],
  ["session.prompts", "Prompts"],
  ["common.themes", "Themes"],
  ["settings.developer", "Developer"],
  ["common.instructions", "Instructions"],
];

/**
 * STATIC reserved-label set: every built-in label in English and in every
 * shipped locale, folded. Built once, independent of the active language, and
 * never from the live nav (which would contain promoted entries).
 */
export const RESERVED_SETTINGS_LABELS: ReadonlySet<string> = new Set(
  BUILT_IN_SETTINGS_LABELS.flatMap(([key, en]) => [en, ...translationsOf(key)]).map(foldSettingsLabel),
);

/**
 * Resolve honoured promotions. The returned Map iterates in DISPLAY order:
 * `order` ascending, then `label`, then plugin id.
 */
export function resolveSettingsPromotions(
  rows: ReadonlyArray<PromotionRow>,
  reservedLabels: ReadonlySet<string>,
): Map<string, SettingsPromotion> {
  const candidates: SettingsPromotion[] = [];
  for (const row of rows) {
    if (row.firstParty !== true) continue;
    for (const claim of row.claims) {
      const nav = claim.nav;
      if (claim.slot !== "settings-section" || !nav) continue;
      if (!PROMOTION_GROUP_ALLOWLIST.has(nav.group)) continue;
      if (reservedLabels.has(foldSettingsLabel(nav.label))) continue;
      candidates.push({
        pluginId: row.id,
        group: nav.group,
        label: nav.label,
        ...(nav.description ? { description: nav.description } : {}),
        order: typeof nav.order === "number" ? nav.order : DEFAULT_ORDER,
      });
      break;
    }
  }

  // Cross-plugin label de-dupe: earlier (order, id) wins.
  candidates.sort((a, b) => a.order - b.order || cmp(a.pluginId, b.pluginId));
  const seen = new Set<string>();
  const kept = candidates.filter((c) => {
    const key = foldSettingsLabel(c.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  kept.sort((a, b) => a.order - b.order || cmp(a.label, b.label) || cmp(a.pluginId, b.pluginId));
  return new Map(kept.map((p) => [p.pluginId, p]));
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
