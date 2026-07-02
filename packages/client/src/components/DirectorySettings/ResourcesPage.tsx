/**
 * Directory Settings → Resources page.
 *
 * Browse-only listing of the skills / extensions / prompts visible to a
 * folder (loose + package-contributed), grouped by Local / Global scope.
 * Clicking a leaf opens the file preview via `onViewFile`. Package
 * install/update/uninstall lives on the Packages page.
 *
 * Reuses the shared <MergedScopeSection> tree and the existing
 * usePiResources hook — same data + render as the legacy PiResourcesView.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { usePiResources } from "../../hooks/usePiResources.js";
import { t as i18nT } from "../../lib/i18n";
import { MergedScopeSection } from "../resource-tree.js";

interface Props {
  cwd: string;
  onViewFile: (filePath: string, title: string) => void;
}

export function ResourcesPage({ cwd, onViewFile }: Props) {
  const { data, isLoading, error, refresh } = usePiResources(cwd);

  const handleView = (resource: PiResource) => {
    onViewFile(resource.filePath, resource.name);
  };

  return (
    <div className="p-3" data-testid="directory-settings-resources">
      <div className="flex justify-end mb-1">
        <button
          type="button"
          onClick={refresh}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          title={i18nT("auto.refresh", undefined, "Refresh")}
          aria-label={i18nT("auto.refresh", undefined, "Refresh")}
          data-testid="directory-settings-resources-refresh"
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
          <MergedScopeSection
            title={i18nT("auto.local", undefined, "Local")}
            scope={data.local}
            packages={data.packages.filter((p) => p.scope === "local" || !p.scope)}
            onView={handleView}
          />
          <MergedScopeSection
            title={i18nT("auto.global", undefined, "Global")}
            scope={data.global}
            packages={data.packages.filter((p) => p.scope === "global")}
            onView={handleView}
          />
        </>
      )}
    </div>
  );
}
