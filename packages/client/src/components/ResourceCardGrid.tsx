/**
 * ResourceCardGrid — a responsive auto-fill grid of `ResourceCard`s for one
 * resource type, drawn from a `PiResourcesResult`. Replaces the per-type
 * `MergedScopeSection` tree on both surfaces:
 *   - Directory Settings → scopes `["local","global"]`, scope filter shown.
 *   - Settings panel      → scopes `["global"]`, scope filter hidden.
 *
 * Flattens loose + package-contributed resources of `type` across the given
 * scopes into cards. A name/description search box filters the grid; the
 * optional `All / Local / Global` segmented control filters by scope badge.
 *
 * See change: resources-card-tabs.
 */

import type { PiResourceScope, PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiMagnify } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useMemo, useState } from "react";
import type { ResourceActivationController } from "../hooks/useResourceActivation.js";
import { t as i18nT } from "../lib/i18n";
import type { ResourceScope } from "../lib/resources-api.js";
import { ResourceCard } from "./ResourceCard.js";

const TYPE_TO_KEY = {
  skill: "skills",
  extension: "extensions",
  prompt: "prompts",
  agent: "agents",
  theme: "themes",
} as const satisfies Record<string, keyof PiResourceScope | "themes">;

export type ResourceType = keyof typeof TYPE_TO_KEY;

/** Count resources of a type across the given scopes (loose + package-contributed). */
export function countResources(data: PiResourcesResult, type: ResourceType, scopes: ResourceScope[]): number {
  return collect(data, type, scopes).length;
}

interface FlatItem {
  scope: ResourceScope;
  packageName?: string;
  packageSource?: string;
  resource: PiResourceScope["skills"][number];
}

function collect(data: PiResourcesResult, type: ResourceType, scopes: ResourceScope[]): FlatItem[] {
  const key = TYPE_TO_KEY[type];
  // `themes` is not part of PiResourceScope today (no scanner) → always empty.
  const fromScope = (s: PiResourceScope): PiResourceScope["skills"] =>
    (key in s ? (s[key as keyof PiResourceScope] as PiResourceScope["skills"]) : []);

  const items: FlatItem[] = [];
  for (const scope of scopes) {
    const loose = scope === "local" ? data.local : data.global;
    for (const resource of fromScope(loose)) items.push({ scope, resource });
    for (const pkg of data.packages) {
      const pkgScope: ResourceScope = pkg.scope ?? "local";
      if (pkgScope !== scope) continue;
      for (const resource of fromScope(pkg.resources)) {
        items.push({ scope, packageName: pkg.name, packageSource: pkg.source, resource });
      }
    }
  }
  return items;
}

interface Props {
  data: PiResourcesResult;
  type: ResourceType;
  /** Scopes to include. `["local","global"]` (Directory Settings) or `["global"]` (Settings). */
  scopes: ResourceScope[];
  /** Show the `All / Local / Global` segmented control (Directory Settings only). */
  showScopeFilter: boolean;
  onView: (filePath: string, title: string) => void;
  activation?: ResourceActivationController;
}

export function ResourceCardGrid({ data, type, scopes, showScopeFilter, onView, activation }: Props) {
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | ResourceScope>("all");

  const items = useMemo(() => collect(data, type, scopes), [data, type, scopes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (showScopeFilter && scopeFilter !== "all" && it.scope !== scopeFilter) return false;
      if (!q) return true;
      const hay = `${it.resource.name} ${it.resource.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, scopeFilter, showScopeFilter]);

  return (
    <div data-testid="resource-card-grid" data-type={type}>
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Icon path={mdiMagnify} size={0.6} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            data-testid="resource-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={i18nT("auto.filter_n_type", { n: String(items.length), type }, `Filter ${items.length} ${type}…`)}
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          />
        </div>
        {showScopeFilter && (
          <div className="flex gap-0.5 p-0.5 rounded-lg bg-[var(--bg-tertiary)]" data-testid="resource-scope-filter" role="tablist">
            {(["all", "local", "global"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scopeFilter === s}
                onClick={() => setScopeFilter(s)}
                className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${
                  scopeFilter === s
                    ? "bg-[var(--bg-primary)] text-[var(--text-primary)] font-semibold shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {i18nT(`auto.${s}`, undefined, s)}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p data-testid="resource-grid-empty" className="text-xs text-[var(--text-muted)] italic py-6 text-center">
          {items.length === 0
            ? i18nT("auto.no_resources_of_type", { type }, `No ${type} resources.`)
            : i18nT("auto.no_matches", undefined, "No matches.")}
        </p>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))" }}>
          {filtered.map((it) => (
            <ResourceCard
              key={`${it.scope}:${it.packageSource ?? "loose"}:${it.resource.filePath}`}
              resource={it.resource}
              scope={it.scope}
              packageName={it.packageName}
              packageSource={it.packageSource}
              onView={() => onView(it.resource.filePath, it.resource.name)}
              activation={activation}
            />
          ))}
        </div>
      )}
    </div>
  );
}
