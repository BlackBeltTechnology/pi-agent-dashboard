import { mdiDownload } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  canInstall: boolean;
  isInstalled?: boolean;
  prompt: () => void;
}

export function InstallButton({ canInstall, isInstalled, prompt }: Props) {
  if (!canInstall || isInstalled) return null;

  return (
    <button
      onClick={prompt}
      className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      title={i18nT("packages.installApp", undefined, "Install app")}
      data-testid="install-btn"
    >
      <Icon path={mdiDownload} size={0.6} />
    </button>
  );
}
