/**
 * Directory Settings → Packages page.
 *
 * Install / update / uninstall packages scoped to a folder. Reuses the
 * existing <PackageBrowser> (which renders the installed-packages manage
 * section above search) plus the install-confirm + README dialogs — same
 * surface as the legacy PiResourcesView "Packages" tab.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useState } from "react";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { PackageBrowser } from "../packages/PackageBrowser.js";
import { PackageInstallConfirmDialog } from "../packages/PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "../packages/PackageReadmeDialog.js";

interface Props {
  cwd: string;
}

export function PackagesPage({ cwd }: Props) {
  const installed = useInstalledPackages("local", cwd);
  const operations = usePackageOperations("local", cwd, installed.refresh);
  const [confirmInstall, setConfirmInstall] = useState<{ source: string; pkg?: NpmPackageResult; scope: "global" | "local" } | null>(null);
  const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

  const handleConfirmInstall = (source: string, pkg?: NpmPackageResult) => {
    // Default to LOCAL scope (matches the folder surface); the dialog exposes
    // a radio so the user can switch to global.
    setConfirmInstall({ source, pkg, scope: "local" });
  };

  const doInstall = () => {
    if (!confirmInstall) return;
    operations.install(confirmInstall.source, confirmInstall.scope);
    setConfirmInstall(null);
  };

  return (
    <div className="p-3" data-testid="directory-settings-packages">
      <PackageBrowser
        scope="local"
        cwd={cwd}
        onViewReadme={setReadmePkg}
        onConfirmInstall={handleConfirmInstall}
      />

      {confirmInstall && (
        <PackageInstallConfirmDialog
          source={confirmInstall.source}
          packageName={confirmInstall.pkg?.name}
          scope={confirmInstall.scope}
          onScopeChange={(s) => setConfirmInstall((prev) => prev ? { ...prev, scope: s } : prev)}
          onConfirm={doInstall}
          onCancel={() => setConfirmInstall(null)}
        />
      )}
      {readmePkg && (
        <PackageReadmeDialog
          pkg={readmePkg}
          installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
          onInstall={() => { handleConfirmInstall(`npm:${readmePkg.name}`, readmePkg); setReadmePkg(null); }}
          onUninstall={() => { operations.remove(`npm:${readmePkg.name}`); setReadmePkg(null); }}
          onClose={() => setReadmePkg(null)}
        />
      )}
    </div>
  );
}
