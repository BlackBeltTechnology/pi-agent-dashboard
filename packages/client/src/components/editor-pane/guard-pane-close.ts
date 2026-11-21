/**
 * Leave guard for the owned "close the editor pane" exits (pane ✕, the layout
 * switch's Chat segment): a dirty built-in buffer in `openFiles` asks
 * Save / Discard / Cancel first, `proceed` runs only on Save / Discard; a clean
 * pane proceeds synchronously. Handler tabs have their own guards.
 *
 * See change: fix-file-link-editor-routing (D3, task 4.20).
 */
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import { confirmLeave, unsavedKey, unsavedStore } from "./unsaved-store.js";

export function guardPaneClose(sessionId: string, openFiles: readonly OpenFile[], proceed: () => void): void {
  const keys = openFiles.filter((f) => !f.handlerMode).map((f) => unsavedKey(sessionId, f.path));
  if (!unsavedStore.hasUnsaved(keys)) return proceed();
  void confirmLeave(keys).then((ok) => ok && proceed());
}
