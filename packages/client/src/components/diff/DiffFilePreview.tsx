/**
 * Diff panel "Preview" mode body (D11) — renders the CURRENT on-disk file the
 * diff was made against through the type-based renderer, the same
 * `fileKind → viewerRegistry` dispatch a file-tree open uses (markdown→rendered,
 * image, pdf, docx, spreadsheet, html, mermaid, monaco for code).
 *
 * It fetches `GET /api/file?cwd&path` ONCE for `{ kind, mimeType, size }` — the
 * metadata a `ViewerProps` needs (`size` is required and has no other source),
 * and the same call doubles as the existence probe: a 404 renders a not-found
 * state instead of crashing the panel. The rich viewer then fetches its own
 * bytes via `/api/file*` (NOT the diff panel's `/api/session-file`).
 *
 * Stateless embed: it does NOT replicate `openInSplit`'s mtime / optimistic-
 * concurrency / scroll state (S8).
 *
 * See change: open-view-command-in-editor-pane (D11).
 */
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CappedViewer } from "../editor-pane/CappedViewer.js";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

interface Props {
  cwd: string;
  /** Path relative to `cwd`. */
  path: string;
}

interface Meta {
  kind: string;
  mimeType: string;
  size: number;
}

export function DiffFilePreview({ cwd, path }: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setMeta(null);
    setNotFound(false);
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        if (!body?.success || body.data?.type !== "file") {
          setNotFound(true);
          return;
        }
        setMeta({
          kind: String(body.data.kind ?? "unknown"),
          mimeType: String(body.data.mimeType ?? "application/octet-stream"),
          size: typeof body.data.size === "number" ? body.data.size : 0,
        });
      })
      .catch(() => active && setNotFound(true));
    return () => {
      active = false;
    };
  }, [cwd, path]);

  if (notFound) {
    return (
      <div
        data-testid="diff-preview-not-found"
        className="flex h-32 items-center justify-center text-sm text-[var(--text-tertiary)]"
      >
        {i18nT("diff.previewFileMissing", undefined, "File is no longer available to preview.")}
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--text-tertiary)]">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    );
  }

  const viewer = fileKind(absOf(cwd, path)).viewer;
  return (
    <div data-testid="diff-preview-body" className="h-full">
      <CappedViewer
        viewer={viewer}
        cwd={cwd}
        path={path}
        kind={meta.kind as never}
        mimeType={meta.mimeType}
        size={meta.size}
      />
    </div>
  );
}
