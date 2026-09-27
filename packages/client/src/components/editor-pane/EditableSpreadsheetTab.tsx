/**
 * Editable spreadsheet tab — the `.csv` Preview/Edit toggle (D4): Preview is the
 * `SpreadsheetPreview` grid, Edit is the raw CSV text (shared `EditablePreviewTab`).
 *
 * Only `.csv` reaches this tab today (the sole `editable` spreadsheet); binary
 * `.xlsx`/`.xls` render the read-only grid directly.
 *
 * See change: open-view-command-in-editor-pane (D4).
 */
import { SpreadsheetPreview } from "../preview/SpreadsheetPreview.js";
import { EditablePreviewTab } from "./EditablePreviewTab.js";
import type { ViewerProps } from "./types.js";

export default function EditableSpreadsheetTab({ cwd, path }: ViewerProps) {
  return (
    <EditablePreviewTab
      cwd={cwd}
      path={path}
      testIdPrefix="csv"
      preview={<SpreadsheetPreview target={{ kind: "file", cwd, path }} />}
    />
  );
}
