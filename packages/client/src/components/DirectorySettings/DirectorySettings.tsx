/**
 * Directory Settings page — a per-folder settings surface that mirrors the
 * global <SettingsPanel> layout (back-arrow header + left nav rail that
 * degrades to a horizontal scroller on mobile + page content area).
 *
 * Three pages: instructions (placeholder for now), packages, resources.
 * The active page is URL-driven (`/folder/:cwd/settings/:page`); selecting a
 * nav item navigates via wouter so the page is bookmarkable / back-able.
 *
 * Reuses the global settings layout primitives/tokens (md:w-56 rail,
 * bg-blue-600/15 active state) so the two surfaces look identical.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import { mdiArrowLeft, mdiFileDocumentOutline, mdiPackageVariant, mdiViewListOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n";
import { buildFolderSettingsUrl } from "../../lib/route-builders.js";
import { InstructionsPage } from "./InstructionsPage.js";
import { PackagesPage } from "./PackagesPage.js";
import { ResourcesPage } from "./ResourcesPage.js";

export type DirectorySettingsPage = "instructions" | "packages" | "resources";

interface Props {
  cwd: string;
  page: DirectorySettingsPage;
  onBack: () => void;
  onViewFile: (filePath: string, title: string) => void;
}

export function DirectorySettings({ cwd, page, onBack, onViewFile }: Props) {
  const [, navigate] = useLocation();

  const navItems: { id: DirectorySettingsPage; label: string; icon: string }[] = [
    { id: "instructions", label: i18nT("auto.instructions", undefined, "Instructions"), icon: mdiFileDocumentOutline },
    { id: "packages", label: i18nT("auto.packages", undefined, "Packages"), icon: mdiPackageVariant },
    { id: "resources", label: i18nT("auto.resources", undefined, "Resources"), icon: mdiViewListOutline },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" data-testid="directory-settings">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-[var(--border-primary)] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={i18nT("auto.back", undefined, "Back")}
          data-testid="directory-settings-back"
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h1 className="text-lg font-bold text-[var(--text-primary)]">
          {i18nT("auto.directory_settings", undefined, "Directory Settings")}
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
          aria-label={i18nT("auto.directory_settings", undefined, "Directory Settings")}
          className="shrink-0 w-full md:w-56 flex md:flex-col gap-0.5 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border-primary)] p-2"
        >
          <div className="hidden md:block px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
            {i18nT("auto.directory", undefined, "Directory")}
          </div>
          {navItems.map((item) => {
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
              </button>
            );
          })}
        </nav>

        {/* Page content */}
        <div data-testid="directory-settings-content" className="flex-1 overflow-y-auto min-w-0">
          {page === "instructions" && <InstructionsPage cwd={cwd} />}
          {page === "packages" && <PackagesPage cwd={cwd} />}
          {page === "resources" && <ResourcesPage cwd={cwd} onViewFile={onViewFile} />}
        </div>
      </div>
    </div>
  );
}
