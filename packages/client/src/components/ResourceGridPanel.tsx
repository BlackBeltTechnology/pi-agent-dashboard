/**
 * ResourceGridPanel — the loading/error/refresh chrome + reload banner around a
 * `ResourceCardGrid` for one resource type. Shared by both browse surfaces:
 *   - Directory Settings → scopes `["local","global"]`, scope filter shown.
 *   - Settings panel      → scopes `["global"]`, filter hidden, static `◇ global` pill.
 *
 * The caller owns the `usePiResources` fetch (so a single fetch backs the nav
 * count pills too) and passes the result + activation controller in.
 *
 * See change: resources-card-tabs.
 */

import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ResourceActivationController } from "../hooks/useResourceActivation.js";
import { t as i18nT } from "../lib/i18n";
import type { ResourceScope } from "../lib/resources-api.js";
import { ResourceCardGrid } from "./ResourceCardGrid.js";
import { ResourceReloadBanner } from "./resource-tree.js";

type ResourceType = "skill" | "agent" | "extension" | "prompt" | "theme";

interface Props {
  data: PiResourcesResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  activation: ResourceActivationController;
  type: ResourceType;
  scopes: ResourceScope[];
  showScopeFilter: boolean;
  /** Render a static `◇ global` pill (global-scope Settings surface). */
  globalPill?: boolean;
  onViewFile: (filePath: string, title: string) => void;
}

export function ResourceGridPanel({ data, isLoading, error, refresh, activation, type, scopes, showScopeFilter, globalPill, onViewFile }: Props) {
  return (
    <div className="p-3" data-testid="resource-grid-panel" data-type={type}>
      <div className="flex items-center justify-end gap-2 mb-2">
        {globalPill && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/12 text-[var(--accent-purple,#9333ea)]" data-testid="resource-global-pill">
            ◇ {i18nT("auto.global", undefined, "global")}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          title={i18nT("auto.refresh", undefined, "Refresh")}
          aria-label={i18nT("auto.refresh", undefined, "Refresh")}
          data-testid="resource-grid-refresh"
        >
          <Icon path={mdiRefresh} size={0.6} />
        </button>
      </div>

      {isLoading && !data && (
        <div className="flex items-center justify-center py-8">
          <Icon path={mdiLoading} size={1} className="text-[var(--text-muted)] animate-spin" />
        </div>
      )}

      {error && !data && (
        <div className="text-center py-8">
          <p className="text-sm text-red-400 mb-2">{error}</p>
          <button type="button" onClick={refresh} className="text-xs text-[var(--accent-primary)] hover:underline">
            {i18nT("auto.retry", undefined, "Retry")}
          </button>
        </div>
      )}

      {data && (
        <>
          <ResourceReloadBanner activation={activation} />
          <ResourceCardGrid
            data={data}
            type={type}
            scopes={scopes}
            showScopeFilter={showScopeFilter}
            onView={onViewFile}
            activation={activation}
          />
        </>
      )}
    </div>
  );
}
