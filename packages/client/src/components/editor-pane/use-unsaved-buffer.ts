/**
 * Publish a built-in editor buffer's `{dirty, save, discard}` to the page-level
 * unsaved store under `unsavedKey(sessionId, tabPath)`. One registration per tab
 * (unregistered on unmount / key change); a `dirty` change re-publishes the
 * entry, a keystroke that keeps the buffer dirty does not. `save` / `discard`
 * are read through a ref so their identity never churns the store.
 *
 * See change: fix-file-link-editor-routing (D3, task 4.20).
 */
import { useEffect, useRef } from "react";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { registerUnsaved, unregisterUnsaved, unsavedKey } from "./unsaved-store.js";

const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || p;

export function useUnsavedBuffer(path: string, dirty: boolean, save: () => Promise<boolean>, discard: () => void): void {
  // Session pane → session id; folder pane → its folder key (both ride the same provider).
  const key = unsavedKey(useOptionalSplitWorkspace()?.sessionId ?? "", path);
  const live = useRef({ save, discard });
  live.current = { save, discard };
  useEffect(() => () => unregisterUnsaved(key), [key]);
  useEffect(() => {
    registerUnsaved(key, {
      label: basename(path),
      dirty,
      save: () => live.current.save(),
      discard: () => live.current.discard(),
    });
  }, [key, path, dirty]);
}
