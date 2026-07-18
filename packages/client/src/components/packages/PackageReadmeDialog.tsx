import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiDownload, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

interface PackageReadmeDialogProps {
  pkg: NpmPackageResult;
  installed: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onClose: () => void;
}

export function PackageReadmeDialog({
  pkg,
  installed,
  onInstall,
  onUninstall,
  onClose,
}: PackageReadmeDialogProps) {
  const [readme, setReadme] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`${getApiBase()}/api/packages/readme?pkg=${encodeURIComponent(pkg.name)}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body.success) {
          setReadme(body.data.readme);
        } else {
          setError(body.error ?? "Failed to fetch README");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [pkg.name]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={pkg.name}
      size="lg"
      testId="package-readme-dialog"
    >
      <div className="flex items-center justify-between -mt-2">
        <span className="text-[10px] text-[var(--text-muted)]">v{pkg.version}</span>
        {installed ? (
          <button
            onClick={onUninstall}
            className="text-[11px] px-3 py-1 rounded text-red-400 border border-red-400/30 hover:bg-red-400/10"
          >
            {i18nT("packages.uninstall", undefined, "Uninstall")}
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="text-[11px] px-3 py-1 rounded bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/80 font-medium"
          >
            <Icon path={mdiDownload} size={0.4} className="inline mr-1" />
            {i18nT("common.install2", undefined, "Install")}
          </button>
        )}
      </div>

      <div>
        {isLoading && (
          <div className="flex justify-center py-8">
            <Icon path={mdiLoading} size={1} className="text-[var(--text-muted)] animate-spin" />
          </div>
        )}
        {error && (
          <p className="text-sm text-red-400 text-center py-4">{error}</p>
        )}
        {readme && (
          <MarkdownContent content={readme} />
        )}
      </div>
    </Dialog>
  );
}

