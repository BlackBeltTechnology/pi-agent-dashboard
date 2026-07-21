/**
 * Directory Settings page — a per-folder settings surface that mirrors the
 * global <SettingsPanel> layout (back-arrow header + left nav rail that
 * degrades to a horizontal scroller on mobile + page content area).
 *
 * Pages: instructions, packages, and a `RESOURCES` group of per-type card
 * pages — Skills / Agents / Extensions / Prompts / Themes. Each resource page
 * renders a <ResourceGridPanel> (card grid across local+global scope with a
 * search + `All/Local/Global` scope filter). The active page is URL-driven
 * (`/folder/:cwd/settings/:page`).
 *
 * See change: directory-settings-page-and-scoped-md-editing,
 * resources-card-tabs.
 */

import { mdiArrowLeft, mdiBookOpenPageVariant, mdiFileDocumentOutline, mdiPackageVariant, mdiPalette, mdiPuzzleOutline, mdiRobotOutline, mdiTextBoxOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { usePiResources } from "../../hooks/usePiResources.js";
import { useResourceActivation } from "../../hooks/useResourceActivation.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { countResources, type ResourceType } from "../resource/ResourceCardGrid.js";
import { ResourceGridPanel } from "../resource/ResourceGridPanel.js";
import { InstructionsPage } from "./InstructionsPage.js";
import { PackagesPage } from "./PackagesPage.js";

export type DirectorySettingsResourcePage = "skills" | "agents" | "extensions" | "prompts" | "themes";
export type DirectorySettingsPage = "instructions" | "packages" | DirectorySettingsResourcePage;

/** Resource-page id → the singular `PiResource.type` its grid renders. */
const RESOURCE_PAGE_TYPE: Record<DirectorySettingsResourcePage, ResourceType> = {
  skills: "skill",
  agents: "agent",
  extensions: "extension",
  prompts: "prompt",
  themes: "theme",
};

const ALL_SCOPES = ["local", "global"] as const;

interface Props {
  cwd: string;
  page: DirectorySettingsPage;
  onBack: () => void;
  onViewFile: (filePath: string, title: string) => void;
}

export function DirectorySettings({ cwd, page, onBack, onViewFile }: Props) {
  const [, navigate] = useLocation();
  const { data, isLoading, error, refresh } = usePiResources(cwd);
  const activation = useResourceActivation(cwd);

  const counts = useMemo(() => {
    const empty: Record<DirectorySettingsResourcePage, number> = { skills: 0, agents: 0, extensions: 0, prompts: 0, themes: 0 };
    if (!data) return empty;
    for (const id of Object.keys(RESOURCE_PAGE_TYPE) as DirectorySettingsResourcePage[]) {
      empty[id] = countResources(data, RESOURCE_PAGE_TYPE[id], [...ALL_SCOPES]);
    }
    return empty;
  }, [data]);

  const topItems: { id: DirectorySettingsPage; label: string; icon: string }[] = [
    { id: "instructions", label: i18nT("common.instructions", undefined, "Instructions"), icon: mdiFileDocumentOutline },
    { id: "packages", label: i18nT("packages.packages", undefined, "Packages"), icon: mdiPackageVariant },
  ];
  const resourceItems: { id: DirectorySettingsResourcePage; label: string; icon: string }[] = [
    { id: "skills", label: i18nT("common.skills", undefined, "Skills"), icon: mdiBookOpenPageVariant },
    { id: "agents", label: i18nT("common.agents", undefined, "Agents"), icon: mdiRobotOutline },
    { id: "extensions", label: i18nT("packages.extensions", undefined, "Extensions"), icon: mdiPuzzleOutline },
    { id: "prompts", label: i18nT("session.prompts", undefined, "Prompts"), icon: mdiTextBoxOutline },
    { id: "themes", label: i18nT("common.themes", undefined, "Themes"), icon: mdiPalette },
  ];

  const navButton = (item: { id: DirectorySettingsPage; label: string; icon: string }, count?: number) => {
    const active = page === item.id;
    return (
      <button
        type="button"
        key={item.id}
        onClick={() => navigate(buildFolderSettingsUrl(cwd, item.id))}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
          active
            ? "bg-blue-600/15 text-[var(--text-primary)] font-semibold"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-secondary)]"
        }`}
      >
        <Icon path={item.icon} size={0.65} />
        {item.label}
        {count !== undefined && (
          <span
            data-testid={`nav-count-${item.id}`}
            className={`ml-auto text-[11px] px-1.5 rounded-full ${active ? "bg-blue-600/20 text-[var(--accent-primary)]" : "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"}`}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" data-testid="directory-settings">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-[var(--border-primary)] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={i18nT("common.back2", undefined, "Back")}
          data-testid="directory-settings-back"
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">
          {i18nT("folders.directorySettings", undefined, "Directory Settings")}
        </h1>
        <span
          className="text-xs font-mono text-[var(--text-muted)] truncate"
          title={cwd}
        >
          {cwd}
        </span>
      </div>

      {/* Body: left nav rail + page content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <nav
          data-testid="directory-settings-nav"
          aria-label={i18nT("folders.directorySettings", undefined, "Directory Settings")}
          className="shrink-0 w-full md:w-56 flex md:flex-col gap-0.5 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border-primary)] p-2"
        >
          <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
            {i18nT("folders.directory", undefined, "Directory")}
          </div>
          {topItems.map((item) => navButton(item))}
          <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
            {i18nT("common.resources", undefined, "Resources")}
          </div>
          {resourceItems.map((item) => navButton(item, counts[item.id]))}
        </nav>

        {/* Page content */}
        {/* flex flex-col min-h-0 gives the Instructions tree/editor split a
            resolvable height (parity with global `settings-content`); overflow-y-auto
            preserves Packages/Resources scroll. See change: directory-settings-tree-and-resize. */}
        <div
          data-testid="directory-settings-content"
          className="flex-1 flex flex-col min-h-0 overflow-y-auto min-w-0"
        >
          {page === "instructions" && <InstructionsPage cwd={cwd} />}
          {page === "packages" && <PackagesPage cwd={cwd} />}
          {page in RESOURCE_PAGE_TYPE && (
            <ResourceGridPanel
              data={data}
              isLoading={isLoading}
              error={error}
              refresh={refresh}
              activation={activation}
              type={RESOURCE_PAGE_TYPE[page as DirectorySettingsResourcePage]}
              scopes={[...ALL_SCOPES]}
              showScopeFilter
              onViewFile={onViewFile}
            />
          )}
        </div>
      </div>
    </div>
  );
}
