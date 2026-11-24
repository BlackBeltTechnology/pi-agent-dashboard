/**
 * Component-side wiring for `startDownload`: owns a toast tray (a `fixed`
 * overlay, so it can render anywhere) and returns a `start` bound to it. The
 * caller mounts `tray` in a component that outlives the menu that fired it.
 * See change: add-file-download.
 */
import { useCallback } from "react";
import { Toast, useToast } from "../primitives/Toast.js";
import { startDownload } from "./download.js";

export function useDownload() {
  const { messages, showToast, dismissToast } = useToast();
  const start = useCallback(
    (target: { cwd: string; path: string }, outsideCwd: boolean) =>
      startDownload(target, { outsideCwd, showToast: (text) => showToast(text, "error") }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: showToast only appends via a stable state setter
    [],
  );
  const tray = messages.length > 0 ? <Toast messages={messages} onDismiss={dismissToast} /> : null;
  return { start, tray };
}
