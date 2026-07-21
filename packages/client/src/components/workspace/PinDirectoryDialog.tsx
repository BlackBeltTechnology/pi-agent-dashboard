import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { inferPlatform } from "../../lib/session/session-grouping.js";
import { PathPicker } from "../primitives/PathPicker.js";

interface Props {
  onPin: (path: string) => void;
  onCancel: () => void;
  /** Forwarded to PathPicker's network-denied surface (Settings → Servers). */
  onOpenServers?: () => void;
}

export function PinDirectoryDialog({ onPin, onCancel, onOpenServers }: Props) {
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
            onPin(normalizePath(trimmed, platform));
          }}
          onCancel={onCancel}
          rows={8}
          onOpenServers={onOpenServers}
        />
    </Dialog>
  );
}
