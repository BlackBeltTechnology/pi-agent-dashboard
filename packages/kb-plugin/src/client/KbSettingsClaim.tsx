/**
 * KbSettingsClaim — `shell-overlay-route` claim for `/folder/:encodedCwd/kb`.
 *
 * Takes the host-decoded folder path (`cwd` prop) and renders the per-folder KB
 * settings panel. Same overlay-route pattern as the goals board. Plugin-local;
 * no App.tsx edit. See change: add-kb-folder-slot.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { KbSettingsPanel } from "./KbSettingsPanel.js";

interface KbSettingsClaimProps {
  params: Record<string, string>;
  /** Decoded folder path of the route (host-provided). */
  cwd?: string;
  onBack: () => void;
}

export function KbSettingsClaim({ cwd: routeCwd, onBack }: KbSettingsClaimProps): React.ReactElement {
  const t = useT();
  const cwd = routeCwd ?? "";
  if (!cwd) {
    return (
      <div className="p-4 text-xs text-red-400" data-testid="kb-settings-bad-cwd">
        {t("invalidFolderPath", undefined, "Invalid folder path.")}
      </div>
    );
  }
  return <KbSettingsPanel cwd={cwd} onBack={onBack} />;
}
