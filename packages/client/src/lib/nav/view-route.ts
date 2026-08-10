/**
 * Pure mapping from a parsed `/view` `ViewTarget` to the editor-pane deep-link
 * path. `App.onViewLocal` navigates to this instead of sending the retired
 * `inject_view_message`; `SplitRouteSync` bridges the `?file=`/`?url=` param
 * into the split. See change: open-view-command-in-editor-pane (D1).
 */
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function viewTargetToEditorPath(sessionId: string, target: ViewTarget): string {
  return target.kind === "file"
    ? `/session/${sessionId}/editor?file=${encodeURIComponent(target.path)}`
    : `/session/${sessionId}/editor?url=${encodeURIComponent(target.url)}`;
}
