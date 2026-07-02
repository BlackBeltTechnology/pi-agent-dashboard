/**
 * Presentational editor pane for the Instructions page: file tab, conflict
 * banner, the lazy Monaco markdown buffer, and the dirty-gated Save Bar. Split
 * out of `InstructionsPage` so the container holds the state machine and this
 * holds the (conditional-heavy) view. See change:
 * directory-settings-page-and-scoped-md-editing.
 */
import type { MdCandidate } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiContentSave } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense } from "react";
import { t as i18nT } from "../../lib/i18n";

// Lazy boundary for the heavy Monaco chunk (worker imports + monaco-editor),
// mirroring `MonacoBuffer`'s lazy mount in the viewer-registry. Keeps Monaco
// out of the eager bundle so the Directory Settings shell stays light.
const MarkdownEditor = lazy(() =>
  import("../editor-pane/MarkdownEditor.js").then((m) => ({ default: m.MarkdownEditor })),
);

/** Format a numeric mtime (ms) for the file-tab header. */
function fmtMtime(mtime: number | null): string {
  if (mtime === null) return "";
  try {
    return new Date(mtime).toLocaleString();
  } catch {
    return String(mtime);
  }
}

interface Props {
  selected: MdCandidate;
  dirty: boolean;
  loadedMtime: number | null;
  conflict: boolean;
  saving: boolean;
  loading: boolean;
  readError: string | null;
  errorText: string | null;
  buffer: string;
  editable: boolean;
  onChangeBuffer: (v: string) => void;
  onReload: () => void;
  onOverwrite: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

export function InstructionsEditorPane({
  selected,
  dirty,
  loadedMtime,
  conflict,
  saving,
  loading,
  readError,
  errorText,
  buffer,
  editable,
  onChangeBuffer,
  onReload,
  onOverwrite,
  onDiscard,
  onSave,
}: Props) {
  return (
    <>
      {/* File tab */}
      <div
        data-testid="instructions-file-tab"
        className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] shrink-0 text-sm"
      >
        <span className="font-mono text-[var(--text-primary)] truncate" title={selected.relPath}>
          {selected.relPath}
        </span>
        {dirty && (
          <span
            data-testid="instructions-dirty-dot"
            title={i18nT("auto.unsaved_changes", undefined, "Unsaved changes")}
            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
          />
        )}
        <span className="ml-auto text-[11px] text-[var(--text-muted)] shrink-0">
          {loadedMtime !== null &&
            `${i18nT("auto.loaded_mtime", undefined, "loaded mtime")} ${fmtMtime(loadedMtime)}`}
        </span>
      </div>

      {/* Conflict banner */}
      {conflict && (
        <div
          data-testid="instructions-conflict"
          className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-red-500/40 bg-red-600/15 text-sm text-red-300 shrink-0"
        >
          <span className="flex items-center gap-1.5">
            <Icon path={mdiAlertCircleOutline} size={0.6} />
            {i18nT(
              "auto.file_changed_on_disk",
              undefined,
              "File changed on disk since you loaded it. Resolve to continue.",
            )}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onReload}
            disabled={saving}
            data-testid="instructions-reload-btn"
            className="px-2.5 py-1 rounded text-xs font-medium border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {i18nT("auto.reload_from_disk", undefined, "Reload from disk")}
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            disabled={saving}
            data-testid="instructions-overwrite-btn"
            className="px-2.5 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
          >
            {i18nT("auto.overwrite_anyway", undefined, "Overwrite anyway")}
          </button>
        </div>
      )}

      {/* Error message */}
      {errorText && (
        <div className="px-3 py-2 text-sm bg-red-600/15 text-red-300 shrink-0">{errorText}</div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="p-4 text-sm text-[var(--text-tertiary)]">
            {i18nT("auto.loading", undefined, "Loading…")}
          </div>
        ) : readError ? (
          <div className="p-4 text-sm text-[var(--text-tertiary)]">{readError}</div>
        ) : (
          <Suspense
            fallback={
              <div className="p-4 text-sm text-[var(--text-tertiary)]">
                {i18nT("auto.loading_editor", undefined, "Loading editor…")}
              </div>
            }
          >
            <MarkdownEditor value={buffer} onChange={onChangeBuffer} readOnly={!editable} />
          </Suspense>
        )}
      </div>

      {/* Save Bar */}
      <div
        data-testid="instructions-save-bar"
        className="shrink-0 flex items-center gap-3 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]"
      >
        {dirty ? (
          <span className="flex items-center gap-1.5 text-sm text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {i18nT("auto.unsaved_changes", undefined, "Unsaved changes")}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-green-400">
            <Icon path={mdiCheckCircleOutline} size={0.6} />
            {i18nT("auto.saved", undefined, "Saved")}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty || saving}
          data-testid="instructions-discard-btn"
          className="px-3 py-1.5 rounded text-sm font-medium text-[var(--text-secondary)] border border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
        >
          {i18nT("auto.discard", undefined, "Discard")}
        </button>
        <button
          type="button"
          onClick={onSave}
          // loadedMtime === null ⇒ no conflict token ⇒ save would no-op; keep it disabled.
          disabled={!dirty || saving || loadedMtime === null}
          data-testid="instructions-save-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50"
        >
          <Icon path={mdiContentSave} size={0.6} />
          {saving ? i18nT("auto.saving", undefined, "Saving…") : i18nT("auto.save", undefined, "Save")}
        </button>
      </div>
    </>
  );
}
