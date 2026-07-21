import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";
import { FilePreviewOverlay } from "./FilePreviewOverlay.js";

/** Target file for the in-dashboard preview overlay. */
export interface FilePreviewTarget {
  cwd: string;
  path: string;
  line?: number;
}

export interface FilePreviewContextValue {
  /** Currently-open preview target, or `null` when nothing is open. */
  target: FilePreviewTarget | null;
  /** Open the preview overlay for the given target (replaces any open one). */
  open: (target: FilePreviewTarget) => void;
  /** Close the preview overlay. */
  close: () => void;
}

/**
 * Null when no provider is mounted. Consumers rendered outside `ChatView`
 * (e.g. `PackageReadmeDialog`, `MarkdownPreviewView`) fall back to leaf-local
 * preview state — see `useFileOpenRouting`. Inside `ChatView` the provider is
 * present and owns the hoisted, churn-surviving state.
 */
export const FilePreviewContext = createContext<FilePreviewContextValue | null>(null);

/**
 * Owns the file-preview open-state above the chat message list so the overlay
 * survives message churn (streaming tokens, react-markdown reparses,
 * streaming→committed branch swaps, new messages). The previous design held
 * this state at the leaf `FileLink`, where any remount reset it to `null`.
 *
 * See change: fix-file-preview-survives-message-churn.
 */
export function FilePreviewProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<FilePreviewTarget | null>(null);
  const value = useMemo<FilePreviewContextValue>(
    () => ({
      target,
      open: (t) => setTarget(t),
      close: () => setTarget(null),
    }),
    [target],
  );
  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>;
}

/** Access the file-preview controls. Throws if used outside the provider. */
export function useFilePreview(): FilePreviewContextValue {
  const ctx = useContext(FilePreviewContext);
  if (!ctx) {
    throw new Error("useFilePreview must be used within a FilePreviewProvider");
  }
  return ctx;
}

/**
 * Renders the single `FilePreviewOverlay` instance from the provider's
 * `target`. Mount once, inside the provider, above the churning message list.
 */
export function FilePreviewHost() {
  const { target, close } = useFilePreview();
  if (!target) return null;
  return (
    <FilePreviewOverlay cwd={target.cwd} path={target.path} line={target.line} onClose={close} />
  );
}
