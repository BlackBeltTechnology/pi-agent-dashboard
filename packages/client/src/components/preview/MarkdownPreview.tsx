/**
 * Markdown preview. Fetches `/api/file` (text content) and renders via
 * the shared `<MarkdownContent>` component. See change: render-file-previews.
 */
import React, { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { readTextUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function MarkdownPreview({ target }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(readTextUrl(target));
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
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (content == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;
  return <MarkdownContent content={content} frontmatter="properties" />;
}
