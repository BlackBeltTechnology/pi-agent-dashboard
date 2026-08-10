/**
 * Editable spreadsheet tab — the `.csv` Preview/Edit toggle (D4), generalizing
 * the markdown Preview/Edit affordance to an `editable` non-markdown kind.
 *
 * Preview mounts the `SpreadsheetPreview` grid (its own `/api/file/sheet`
 * fetch); Edit mounts a plain Monaco text buffer (`MarkdownEditor`, a generic
 * controlled Monaco editor) over the raw CSV loaded from `/api/file` `content`.
 * Save posts to `/api/file/write` with the loaded mtime (optimistic
 * concurrency): 200 clears dirty, 409 surfaces the shared changed-on-disk
 * banner and leaves disk untouched.
 *
 * Only `.csv` reaches this tab today (the sole `editable` spreadsheet); binary
 * `.xlsx`/`.xls` render the read-only grid directly.
 *
 * See change: open-view-command-in-editor-pane (D4).
 */
import { mdiContentSave, mdiEyeOutline, mdiPencilOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { SpreadsheetPreview } from "../preview/SpreadsheetPreview.js";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner.js";
import type { ViewerProps } from "./types.js";

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor.js").then((m) => ({ default: m.MarkdownEditor })),
);

const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

export default function EditableSpreadsheetTab({ cwd, path }: ViewerProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("");
  const [mtime, setMtime] = useState<number | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setError(null);
    setConflict(false);
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        if (!body.success || body.data?.type !== "file") {
          setError(body.error ?? t("editor.failedToLoadFile", undefined, "Failed to load file"));
          return;
        }
        const text = body.data.content ?? "";
        setContent(text);
        setBuffer(text);
        setMtime(typeof body.data.mtime === "number" ? body.data.mtime : null);
      })
      .catch((err) => active && setError(err?.message ?? t("common.networkError", undefined, "Network error")));
    return () => {
      active = false;
    };
  }, [cwd, path, t]);

  // Load the raw text only when Edit is first entered (Preview uses the grid's
  // own fetch), and lazily so the grid path stays content-free.
  useEffect(() => {
    if (mode === "edit" && content === null) load();
  }, [mode, content, load]);

  const dirty = content !== null && buffer !== content;

  const onSave = useCallback(async () => {
    if (mtime === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, path, content: buffer, mtime }),
      });
      const body = await res.json();
      if (res.status === 200 && body.success) {
        setContent(buffer);
        setMtime(body.data?.mtime ?? mtime);
        setConflict(false);
      } else if (res.status === 409) {
        setConflict(true);
      } else {
        setError(body.error ?? t("editor.saveFailed", { status: res.status }, "Save failed ({status})"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.networkError", undefined, "Network error"));
    } finally {
      setSaving(false);
    }
  }, [cwd, path, buffer, mtime, saving, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-2 py-1 text-xs">
        <button
          type="button"
          data-testid="csv-preview-toggle"
          onClick={() => setMode("preview")}
          aria-pressed={mode === "preview"}
          className={[
            "flex items-center gap-1 rounded px-2 py-0.5",
            mode === "preview" ? "bg-[var(--bg-selected)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
          ].join(" ")}
        >
          <Icon path={mdiEyeOutline} size={0.55} />
          <span>{t("editor.preview", undefined, "Preview")}</span>
        </button>
        <button
          type="button"
          data-testid="csv-edit-toggle"
          onClick={() => setMode("edit")}
          aria-pressed={mode === "edit"}
          className={[
            "flex items-center gap-1 rounded px-2 py-0.5",
            mode === "edit" ? "bg-[var(--bg-selected)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]",
          ].join(" ")}
        >
          <Icon path={mdiPencilOutline} size={0.55} />
          <span>{t("common.edit", undefined, "Edit")}</span>
        </button>
        {dirty && <span data-testid="csv-dirty-dot" className="ml-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-yellow)]" />}
        <span className="flex-1" />
        {mode === "edit" && (
          <button
            type="button"
            data-testid="csv-save-btn"
            onClick={onSave}
            disabled={!dirty || saving || mtime === null}
            className="flex items-center gap-1 rounded bg-[var(--accent-blue)] px-2 py-0.5 text-white disabled:opacity-40"
          >
            <Icon path={mdiContentSave} size={0.55} />
            <span>{saving ? t("editor.saving", undefined, "Saving…") : t("common.save", undefined, "Save")}</span>
          </button>
        )}
      </div>

      {error && <div className="px-2 py-1 text-xs text-[var(--accent-red)]">{error}</div>}

      {conflict && (
        <ChangedOnDiskBanner
          fileName={basename(path)}
          onRefresh={() => load()}
          onDismiss={() => setConflict(false)}
        />
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "edit" ? (
          content === null ? (
            <div className="p-4 text-sm text-[var(--text-tertiary)]">{t("common.loading2", undefined, "Loading…")}</div>
          ) : (
            <Suspense fallback={<div className="p-4 text-sm text-[var(--text-tertiary)]">{t("editor.loadingEditor", undefined, "Loading editor…")}</div>}>
              <MarkdownEditor value={buffer} onChange={setBuffer} />
            </Suspense>
          )
        ) : (
          <SpreadsheetPreview target={{ kind: "file", cwd, path }} />
        )}
      </div>
    </div>
  );
}
