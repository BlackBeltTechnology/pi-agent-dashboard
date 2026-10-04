/**
 * Markdown preview. Fetches `/api/file` (text content) and renders via
 * the shared `<MarkdownContent>` component. See change: render-file-previews.
 */
import React, { useEffect, useMemo, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { readTextUrl } from "./raw-url.js";
import { dirname } from "./resolve-local-image-src.js";

const absOf = (cwd: string, rel: string): string => (rel ? `${cwd}/${rel}` : cwd);

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function MarkdownPreview({ target }: Props) {
  // Opted out of the access-grant dialog unless a provider declares operator
  // provenance (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch } = usePreviewFetch();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await previewFetch(readTextUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && body.data?.type === "file") {
          setContent(body.data.content);
        } else {
          setError(body.error || "failed to load");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      }
    })().catch(logRejection("MarkdownPreview.load"));
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, previewFetch]);

  // Stable identity keeps MarkdownContent's React.memo guard effective. See change: fix-markdown-remount-storm (D3).
  const imageBase = useMemo(() => ({ cwd: target.cwd, dir: absOf(target.cwd, dirname(target.path)) }), [target.cwd, target.path]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (content == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;
  return (
    <MarkdownContent
      content={content}
      frontmatter="properties"
      imageBase={imageBase}
    />
  );
}
