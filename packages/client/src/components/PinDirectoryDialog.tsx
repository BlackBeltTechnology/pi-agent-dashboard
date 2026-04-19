import React from "react";
import { PathPicker } from "./PathPicker.js";
import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { inferPlatform } from "../lib/session-grouping.js";

interface Props {
  onPin: (path: string) => void;
  onCancel: () => void;
}

export function PinDirectoryDialog({ onPin, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-[60]">
      <div className="bg-[var(--bg-secondary)] rounded-lg p-6 w-full max-w-lg border border-[var(--border-secondary)]">
        <h3 className="text-lg font-semibold mb-4">Pin Directory</h3>

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
      </div>
    </div>
  );
}
