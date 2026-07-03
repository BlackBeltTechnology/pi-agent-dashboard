/**
 * KbSettingsClaim — `shell-overlay-route` claim for `/folder/:encodedCwd/kb`.
 *
 * Decodes the folder path from the route param and renders the per-folder KB
 * settings panel. Same overlay-route pattern as the goals board. Plugin-local;
 * no App.tsx edit. See change: add-kb-folder-slot.
 */
import type React from "react";
import { KbSettingsPanel } from "./KbSettingsPanel.js";
import { decodeFolderPath } from "./kb-api.js";

export interface KbSettingsClaimProps {
  params: Record<string, string>;
  onBack: () => void;
}

export function KbSettingsClaim({ params, onBack }: KbSettingsClaimProps): React.ReactElement {
  const cwd = decodeFolderPath(params.encodedCwd ?? "") ?? "";
  if (!cwd) {
    return (
      <div className="p-4 text-xs text-red-400" data-testid="kb-settings-bad-cwd">
        Invalid folder path.
      </div>
    );
  }
  return <KbSettingsPanel cwd={cwd} onBack={onBack} />;
}
