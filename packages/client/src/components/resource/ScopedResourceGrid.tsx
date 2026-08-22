/**
 * ScopedResourceGrid — the single wiring for both resource entry points (D7).
 *
 * Ten destinations reach one grid: five global `/settings/<page>` paths and
 * five folder-scoped `/folder/<cwd>/settings/<page>` mirrors. C4 resolved the
 * shape as two entry points into one panel with a scope PRESET, so the URLs
 * stay distinct and the scope is not a user-facing switch — it is read off the
 * matched route.
 *
 * Before this, both call sites hand-assembled the same five props and each kept
 * its OWN page→type map. Two byte-identical maps can drift silently: nothing
 * type-checks one against the other, and a drifted entry renders the wrong
 * resource type under a correct-looking URL. `RESOURCE_PAGE_TYPE` below is now
 * the only copy, and `resource-scope-routes.spec.ts` pins every path against
 * the type its own URL names.
 *
 * The caller still owns the fetch: the folder surface derives its nav count
 * pills from the same `usePiResources` result, so hoisting the fetch in here
 * would either duplicate it or force the counts back out through a callback.
 *
 * See change: add-route-backed-overlay-dialogs (task 7.1).
 */
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useLocation, useRoute } from "wouter";
import type { ResourceActivationController } from "../../hooks/useResourceActivation.js";
import type { ResourceScope } from "../../lib/api/resources-api.js";
import { buildPiResourceFileUrl } from "../../lib/nav/route-builders.js";
// NOTE: two `ResourceType` unions exist in this repo — `resources-api.ts` omits
// "agent". Both former call sites used THIS one; picking the other silently
// breaks the agents page. Flagged, not unified (out of scope here).
import type { ResourceType } from "./ResourceCardGrid.js";
import { ResourceGridPanel } from "./ResourceGridPanel.js";

/** The five resource pages, and the resource type each one renders. */
export const RESOURCE_PAGE_TYPE = {
  skills: "skill",
  agents: "agent",
  extensions: "extension",
  prompts: "prompt",
  themes: "theme",
} as const satisfies Record<string, ResourceType>;

export type ResourcePageId = keyof typeof RESOURCE_PAGE_TYPE;

export function isResourcePage(id: string): id is ResourcePageId {
  return id in RESOURCE_PAGE_TYPE;
}

/** Folder scope shows both tiers and lets the user filter between them. */
const FOLDER_SCOPES: ResourceScope[] = ["local", "global"];
/** The global entry point has exactly one tier, so a filter would be inert. */
const GLOBAL_SCOPES: ResourceScope[] = ["global"];

interface Props {
  page: ResourcePageId;
  data: PiResourcesResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  activation: ResourceActivationController;
}

export function ScopedResourceGrid({ page, data, isLoading, error, refresh, activation }: Props) {
  const [, navigate] = useLocation();
  // The scope PRESET, read off the route rather than passed down, so the two
  // entry points cannot disagree about what "folder scope" means. Inside a
  // route-backed overlay this reads the live URL (the surface is in the dialog,
  // not in the frozen underlay Router), which is the intended location.
  const [isFolderScoped] = useRoute("/folder/:encodedCwd/settings/:page");

  return (
    <ResourceGridPanel
      data={data}
      isLoading={isLoading}
      error={error}
      refresh={refresh}
      activation={activation}
      type={RESOURCE_PAGE_TYPE[page]}
      scopes={isFolderScoped ? FOLDER_SCOPES : GLOBAL_SCOPES}
      showScopeFilter={Boolean(isFolderScoped)}
      globalPill={!isFolderScoped}
      onViewFile={(filePath, title) => navigate(buildPiResourceFileUrl(filePath, title))}
    />
  );
}
