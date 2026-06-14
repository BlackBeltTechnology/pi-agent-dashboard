import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiClose, mdiDownload } from "@mdi/js";
import { t as i18nT } from "../lib/i18n";

const DISMISSED_KEY = "pwa-install-dismissed";

interface Props {
  canInstall: boolean;
  isIOS: boolean;
  isInstalled: boolean;
  prompt: () => void;
}

export function InstallBanner({ canInstall, isIOS, isInstalled, prompt }: Props) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === "true",
  );

  if (isInstalled || dismissed || (!canInstall && !isIOS)) return null;

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  };

  return (
    <div
      data-testid="install-banner"
      className="md:hidden flex items-center gap-2 px-3 py-2 bg-blue-600/90 text-white text-sm"
    >
      <Icon path={mdiDownload} size={0.6} className="flex-shrink-0" />
      <div className="flex-1 min-w-0">
        {isIOS ? (
          <span>
            {i18nT("auto.tap", undefined, "Tap")} <strong>{i18nT("auto.share", undefined, "Share")}</strong> → <strong>{i18nT("auto.add_to_home_screen", undefined, "Add to Home Screen")}</strong> {i18nT("auto.to_install", undefined, "to install")}
          </span>
        ) : (
          <span>{i18nT("auto.install_pi_dashboard_for_quick_access", undefined, "Install PI Dashboard for quick access")}</span>
        )}
      </div>
      {canInstall && (
        <button
          onClick={prompt}
          className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 font-medium flex-shrink-0"
        >
          {i18nT("auto.install", undefined, "Install")}
        </button>
      )}
      <button
        onClick={handleDismiss}
        data-testid="install-banner-dismiss"
        className="flex-shrink-0 hover:bg-white/20 rounded p-0.5"
        aria-label={i18nT("auto.dismiss", undefined, "Dismiss")}
      >
        <Icon path={mdiClose} size={0.5} />
      </button>
    </div>
  );
}
