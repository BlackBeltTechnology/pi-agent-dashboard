/**
 * ResourceCard — a single pi-resource rendered as a card (replaces the legacy
 * `resource-tree.tsx` row). The tree encoded scope/source by nesting position;
 * the card carries them explicitly as badges:
 *   - scope  → `⬡ local` (green) / `◇ global` (purple)
 *   - source → `loose` / `📦 <package-name>` (orange)
 *   - path   → monospace line at the card bottom
 *   - toggle → activation switch, top-right (omitted for agents — pi has no
 *              activation dimension for `.pi/agents/*.md`)
 *
 * Type-specific treatments:
 *   - agent → `◆ model` + `🔧 tools` badges
 *   - theme → palette swatch strip replaces the description row
 *
 * See change: resources-card-tabs.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiBookOpenPageVariant, mdiPalette, mdiPuzzleOutline, mdiRobotOutline, mdiTextBoxOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ResourceActivationController } from "../../hooks/useResourceActivation.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { ResourceScope } from "../../lib/api/resources-api.js";
import { ActivationToggle } from "./resource-tree.js";

const TYPE_ICON: Record<PiResource["type"], string> = {
  skill: mdiBookOpenPageVariant,
  extension: mdiPuzzleOutline,
  prompt: mdiTextBoxOutline,
  theme: mdiPalette,
  agent: mdiRobotOutline,
};

interface Props {
  resource: PiResource;
  /** Scope this card belongs to — drives the scope badge and the toggle target. */
  scope: ResourceScope;
  /** Package name when package-contributed; undefined → loose. */
  packageName?: string;
  /** Raw package source string (pi settings key) used by the activation write. */
  packageSource?: string;
  onView: () => void;
  activation?: ResourceActivationController;
}

export function ResourceCard({ resource, scope, packageName, packageSource, onView, activation }: Props) {
  const isAgent = resource.type === "agent";
  const isTheme = resource.type === "theme";
  // Agents have no pi activation dimension → no toggle, never dimmed.
  const enabled = isAgent ? true : activation ? activation.isEnabled(resource) : resource.enabled;
  const showToggle = !isAgent && !!activation;

  return (
    <div
      data-testid="resource-card"
      data-type={resource.type}
      className={`flex flex-col gap-2 p-3.5 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] cursor-pointer transition-colors hover:border-[var(--border-secondary)] hover:bg-[var(--bg-hover)] ${!enabled ? "opacity-55" : ""}`}
      onClick={onView}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onView(); } }}
    >
      <div className="flex items-start gap-2">
        <Icon path={TYPE_ICON[resource.type]} size={0.62} className="shrink-0 text-[var(--text-secondary)] mt-0.5" />
        <span className="flex-1 min-w-0 text-[13.5px] font-semibold text-[var(--text-primary)] break-words">{resource.name}</span>
        {showToggle && (
          <ActivationToggle
            resource={resource}
            enabled={enabled}
            onToggle={() => activation?.toggle(resource, scope, packageSource)}
          />
        )}
      </div>

      {isTheme && resource.colors && resource.colors.length > 0 ? (
        <div data-testid="resource-card-swatch" className="flex h-6 rounded-md overflow-hidden border border-[var(--border-primary)]">
          {resource.colors.map((c, i) => (
            <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} />
          ))}
        </div>
      ) : (
        resource.description && (
          <p className="text-[11.5px] leading-snug text-[var(--text-tertiary)] line-clamp-2">{resource.description}</p>
        )
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {scope === "local" ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-green-500/12 text-[var(--accent-green,#16a34a)]" data-testid="badge-scope">⬡ {i18nT("common.local", undefined, "local")}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/12 text-[var(--accent-purple,#9333ea)]" data-testid="badge-scope">◇ {i18nT("common.global", undefined, "global")}</span>
        )}
        {packageName ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-orange-500/12 text-[var(--accent-orange,#ea580c)]" data-testid="badge-source">📦 {packageName}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]" data-testid="badge-source">{i18nT("common.loose", undefined, "loose")}</span>
        )}
        {isAgent && resource.model && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-[var(--accent-primary)]" data-testid="badge-model">◆ {resource.model}</span>
        )}
        {isAgent && resource.tools && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-[var(--accent-primary)]" data-testid="badge-tools">🔧 {resource.tools}</span>
        )}
      </div>

      <div className="text-[10px] font-mono text-[var(--text-muted)] truncate" title={resource.filePath}>{resource.filePath}</div>
    </div>
  );
}
