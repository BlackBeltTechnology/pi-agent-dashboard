/**
 * Markdown tab — Preview (default) or Edit.
 *
 * Preview renders through the dashboard's canonical `MarkdownContent`
 * (`pi-asset:` resolves via the ambient `SessionAssetsContext`). Edit mounts
 * the controlled `MarkdownEditor`, gated on `fileKind(path).editable` (the
 * writable `.md`/`.mdx` subset — `.markdown` stays read-only). Save posts to
 * `/api/file/write` with the loaded mtime (optimistic concurrency): 200 clears
 * dirty; 409 surfaces the shared changed-on-disk banner.
 *
 * See change: add-internal-monaco-editor-pane.
 * See change: improve-content-editor (markdown edit #4).
 */
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { mdiContentSave, mdiEyeOutline, mdiPencilOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner.js";
import type { ViewerProps } from "./types.js";

const MarkdownEditor = lazy(() =>
  import("./MarkdownEditor.js").then((m) => ({ default: m.MarkdownEditor })),
);

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);
const basename = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

export default function MarkdownViewer({ cwd, path }: ViewerProps) {
  const { t } = useI18n();
  const editable = fileKind(absOf(cwd, path)).editable;
  const [content, setContent] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("");
  const [mtime, setMtime] = useState<number | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(() => {
    let active = true;
    setContent(null);
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
  }, [cwd, path]);

  useEffect(() => load(), [load]);

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
  }, [cwd, path, buffer, mtime, saving]);

  if (error) return <div className="p-4 text-sm text-[var(--accent-red)]">{error}</div>;
  if (content === null) return <div className="p-4 text-sm text-[var(--text-tertiary)]">{t("common.loading2", undefined, "Loading…")}</div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-2 py-1 text-xs">
        <button
          type="button"
          data-testid="md-preview-toggle"
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
        {editable && (
          <button
            type="button"
            data-testid="md-edit-toggle"
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
        )}
        {dirty && <span data-testid="md-dirty-dot" className="ml-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-yellow)]" />}
        <span className="flex-1" />
        {mode === "edit" && (
          <button
            type="button"
            data-testid="md-save-btn"
            onClick={onSave}
            disabled={!dirty || saving || mtime === null}
            className="flex items-center gap-1 rounded bg-[var(--accent-blue)] px-2 py-0.5 text-white disabled:opacity-40"
          >
            <Icon path={mdiContentSave} size={0.55} />
            <span>{saving ? t("editor.saving", undefined, "Saving…") : t("common.save", undefined, "Save")}</span>
          </button>
        )}
      </div>

      {conflict && (
        <ChangedOnDiskBanner
          fileName={basename(path)}
          onRefresh={() => load()}
          onDismiss={() => setConflict(false)}
        />
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "edit" && editable ? (
          <Suspense fallback={<div className="p-4 text-sm text-[var(--text-tertiary)]">{t("editor.loadingEditor", undefined, "Loading editor…")}</div>}>
            <MarkdownEditor value={buffer} onChange={setBuffer} />
          </Suspense>
        ) : (
          <div className="p-4">
            <MarkdownContent content={content} frontmatter="properties" />
          </div>
        )}
      </div>
    </div>
  );
}
