/**
 * ResourceGridPanel — the loading/error/refresh chrome + reload banner around a
 * `ResourceCardGrid` for one resource type. Shared by both browse surfaces:
 *   - Directory Settings → scopes `["local","global"]`, scope filter shown.
 *   - Settings panel      → scopes `["global"]`, filter hidden, static `◇ global` pill.
 *
 * The caller owns the `usePiResources` fetch (so a single fetch backs the nav
 * count pills too) and passes the result + activation controller in.
 *
 * On the folder surface the panel also carries the consequences of a
 * folder-scope write: the repository-scope notice (the file is tracked and
 * shared), the failure banner, and the project-trust dialog.
 *
 * See change: resources-card-tabs, project-scope-disable-global-resources.
 */

import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ResourceActivationController } from "../../hooks/useResourceActivation.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { ResourceScope } from "../../lib/api/resources-api.js";
import { ResourceCardGrid } from "./ResourceCardGrid.js";
import { ResourceTrustDialog } from "./ResourceTrustDialog.js";
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
  // The folder surface is the only one whose writes land in a tracked file.
  const isFolderSurface = scopes.includes("local");
  return (
    <div className="p-3" data-testid="resource-grid-panel" data-type={type}>
      <div className="flex items-center justify-end gap-2 mb-2">
        {globalPill && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/12 text-[var(--accent-purple,#9333ea)]" data-testid="resource-global-pill">
            ◇ {i18nT("common.global", undefined, "global")}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          title={i18nT("common.refresh", undefined, "Refresh")}
          aria-label={i18nT("common.refresh", undefined, "Refresh")}
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
            {i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      )}

      {isFolderSurface && (
        <p
          data-testid="resource-repo-scope-notice"
          className="mb-2 text-[11px] leading-snug text-[var(--text-tertiary)]"
        >
          {i18nT(
            "resources.repoScopeNotice",
            undefined,
            "Changes here are written to this repository's tracked .pi/settings.json and are shared with everyone who checks it out. pi rewrites the whole file, so each toggle produces a whole-file diff.",
          )}
        </p>
      )}

      {activation.error && (
        <div
          data-testid="resource-toggle-error"
          data-kind={activation.error.kind}
          role="alert"
          className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10"
        >
          <span className="flex-1 text-[11.5px] leading-snug text-red-400">
            {activation.error.kind === "network"
              ? i18nT(
                  "resources.toggleNetworkError",
                  { message: activation.error.message },
                  `The request did not reach the server: ${activation.error.message}`,
                )
              : activation.error.message}
          </span>
          <button
            type="button"
            onClick={activation.clearError}
            data-testid="resource-toggle-error-dismiss"
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {i18nT("common.dismiss", undefined, "Dismiss")}
          </button>
        </div>
      )}

      {activation.trustPrompt && (
        <ResourceTrustDialog
          cwd={activation.trustPrompt.cwd}
          message={activation.trustPrompt.message}
          options={activation.trustPrompt.options}
          onChoose={activation.resolveTrust}
          onDismiss={activation.dismissTrust}
        />
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
