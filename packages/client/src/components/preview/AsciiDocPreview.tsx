/**
 * AsciiDoc preview. Fetches `/api/file/render` which runs `asciidoctor` in
 * `safe: "secure"` mode server-side; renders the returned HTML via
 * `dangerouslySetInnerHTML` (safe because server guarantees sanitization).
 * See change: render-file-previews.
 */
import React, { useEffect, useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { splitAdocDiagramSegments, type AdocSegment } from "../../lib/preview/adoc-diagram-splitter.js";
import { DiagramPreview } from "./DiagramPreview.js";
import { MermaidBlock } from "./MermaidBlock.js";
import { renderUrl } from "./raw-url.js";
import { logRejection } from "../../lib/report-error.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function AsciiDocPreview({ target }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await fetch(renderUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && typeof body.data?.html === "string") {
          setHtml(body.data.html);
        } else {
          setError(body.error || "failed to render");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to render");
      }
    })().catch(logRejection("AsciiDocPreview.render"));
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path]);

  const segments = useMemo<AdocSegment[]>(() => {
    if (!html) return [];
    return splitAdocDiagramSegments(html);
  }, [html]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (html == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;

  return (
    <div className="asciidoc-body">
      {segments.map((seg, idx) => {
        if (seg.kind === "raw") {
          return (
            <div
              key={idx}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          );
        }
        if (seg.type === "mermaid") {
          return (
            <MermaidBlock
              key={idx}
              code={seg.source}
              complete={true}
            />
          );
        }
        return (
          <div key={idx} className="my-2 h-[400px] border border-[var(--border-subtle)] rounded overflow-hidden">
            <DiagramPreview
              target={target}
              sourceText={seg.source}
            />
          </div>
        );
      })}
    </div>
  );
}
