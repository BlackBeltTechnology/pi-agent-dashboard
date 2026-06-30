/**
 * Markdown tab — fetches text via `/api/file` and renders through the
 * dashboard's canonical `MarkdownContent`. `pi-asset:` references resolve via
 * the ambient `SessionAssetsContext` provided around the content area.
 *
 * See change: add-internal-monaco-editor-pane.
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api-context.js";
import { MarkdownContent } from "../MarkdownContent.js";
import type { ViewerProps } from "./types.js";

export default function MarkdownViewer({ cwd, path }: ViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    fetch(`${getApiBase()}/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        if (!body.success || body.data?.type !== "file") {
          setError(body.error ?? "Failed to load file");
          return;
        }
        setContent(body.data.content ?? "");
      })
      .catch((err) => active && setError(err?.message ?? "Network error"));
    return () => {
      active = false;
    };
  }, [cwd, path]);

  if (error) {
    return <div className="p-4 text-sm text-[var(--accent-red)]">{error}</div>;
  }
  if (content === null) {
    return <div className="p-4 text-sm text-[var(--text-tertiary)]">Loading…</div>;
  }
  return (
    <div className="h-full overflow-auto p-4">
      <MarkdownContent content={content} frontmatter="properties" />
    </div>
  );
}
