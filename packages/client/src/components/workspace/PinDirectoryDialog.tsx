import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform } from "../../lib/session/session-grouping.js";
import { PiTrustCheckbox, usePiTrustChoice } from "../access-grant/PiTrustCheckbox.js";
import { PathPicker } from "../primitives/PathPicker.js";

interface Props {
  /** `piTrust`: the "Also trust this folder in pi" choice stored with the pin (only meaningful with `showPiTrust`). */
  onPin: (path: string, piTrust?: boolean) => void;
  /**
   * Show the "Also trust this folder in pi" checkbox. Off when the dialog is only
   * a folder PICKER (e.g. a move target) and nothing is pinned.
   */
  showPiTrust?: boolean;
  onCancel: () => void;
  /** Forwarded to PathPicker's network-denied surface (Settings → Servers). */
  onOpenServers?: () => void;
}

export function PinDirectoryDialog({ onPin, onCancel, onOpenServers, showPiTrust = false }: Props) {
  const [piTrust, setPiTrust] = usePiTrustChoice("pinned");
  return (
    <Dialog open onClose={onCancel} title={i18nT("folders.pinDirectory", undefined, "Pin Directory")} size="lg" testId="pin-directory-dialog">
        <PathPicker
          onSelect={(p) => {
            const trimmed = p.trim();
            if (!trimmed) return;
            // Normalize OS-correctly instead of the old Unix-only strip.
            // Infer platform from the input itself — backslash / drive
            // letter = Windows, otherwise POSIX.
            const platform = inferPlatform([trimmed]);
            if (showPiTrust) onPin(normalizePath(trimmed, platform), piTrust);
            else onPin(normalizePath(trimmed, platform));
          }}
          onCancel={onCancel}
          rows={8}
          onOpenServers={onOpenServers}
        />
        {showPiTrust && (
          <div className="mt-3">
            <PiTrustCheckbox checked={piTrust} onChange={setPiTrust} testId="pin-pi-trust" />
          </div>
        )}
    </Dialog>
  );
}
