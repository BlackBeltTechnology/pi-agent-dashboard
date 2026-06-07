import React from "react";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { PathPicker } from "./PathPicker.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { inferPlatform } from "../lib/session-grouping.js";

interface Props {
  onPin: (path: string) => void;
  onCancel: () => void;
}

export function PinDirectoryDialog({ onPin, onCancel }: Props) {
  return (
    <Dialog open onClose={onCancel} title="Pin Directory" size="lg" testId="pin-directory-dialog">
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
        />
    </Dialog>
  );
}
