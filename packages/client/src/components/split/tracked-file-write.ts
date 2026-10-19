/**
 * The in-pane markdown writers (`MarkdownViewer`, `EditablePreviewTab`,
 * `MarkupRepairBanner`, `MermaidApplyFix`) post through ONE helper so the
 * editor pane can rebaseline the tab from the write response and the user's own
 * Save never raises the changed-on-disk banner.
 *
 * This module is dependency-light on purpose (no split-workspace import): the
 * preview components sit below the split layer and must not import it. The
 * `SplitWorkspaceProvider` supplies the tracking implementation through the
 * context; outside it (dialogs, standalone previews, the folder pane) the
 * default is a plain `POST /api/file/write`.
 *
 * See change: gate-changed-on-disk-by-content (D3).
 */
import { createContext, useContext } from "react";
import { getApiBase } from "../../lib/api/api-context.js";

/** `path` is the tab's path key (what the pane baselines); `body` is the write payload. */
export type TrackedFileWrite = (path: string, body: Record<string, unknown>) => Promise<Response>;

/** `POST /api/file/write` with no tracking. */
export function plainFileWrite(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${getApiBase()}/api/file/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const TrackedFileWriteContext = createContext<TrackedFileWrite>((_path, body) => plainFileWrite(body));

export const TrackedFileWriteProvider = TrackedFileWriteContext.Provider;

/** The write helper for an in-pane writer: tracked inside a session pane, plain elsewhere. */
export function useTrackedFileWrite(): TrackedFileWrite {
  return useContext(TrackedFileWriteContext);
}
