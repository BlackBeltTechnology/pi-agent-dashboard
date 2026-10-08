import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { UiPathPickerDialogProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { useState } from "react";
import { browseDirectory } from "../../lib/api/browse-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform } from "../../lib/session/session-grouping.js";
import { PathPicker } from "./PathPicker.js";

/**
 * Host implementation of the `ui:path-picker` plugin primitive: `Dialog` +
 * single-select `PathPicker` (same composition as `PinDirectoryDialog`).
 * PathPicker also confirms a TYPED path, so the choice is verified to be a
 * directory via the guarded `/api/browse` before `onSelect` fires.
 * See change: improve-kb-settings-sources-and-search.
 */
export function PathPickerDialog({ open, initialPath, title, onSelect, onCancel }: UiPathPickerDialogProps) {
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const confirm = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const path = normalizePath(trimmed, inferPlatform([trimmed]));
    try {
      await browseDirectory(path); // rejects for a file / missing path
    } catch {
      setError(i18nT("pathPicker.notDirectory", undefined, "Not a directory. Choose an existing folder."));
      return;
    }
    setError(null);
    onSelect(path);
  };

  return (
    <Dialog open onClose={onCancel} title={title ?? i18nT("pathPicker.title", undefined, "Choose folder")} size="lg" testId="path-picker-dialog">
      <PathPicker initialPath={initialPath} onSelect={(p) => void confirm(p)} onCancel={onCancel} rows={8} />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500" data-testid="path-picker-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
