/**
 * AsciiDoc preview. Fetches `/api/file/render` which runs `asciidoctor` in
 * `safe: "secure"` mode server-side; renders the returned HTML via
 * `dangerouslySetInnerHTML`. The server DOMPurify-sanitizes the converted HTML
 * (asciidoctor `secure` mode still passes `+++`/`pass:[]` HTML through); the
 * only post-sanitize step is `renderAdocMath`, which adds trusted KaTeX markup
 * at text nodes outside `pre`/`code`.
 * See changes: render-file-previews, sanitize-untrusted-rendered-content.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type AdocSegment, splitAdocDiagramSegments } from "../../lib/preview/adoc-diagram-splitter.js";
import { hasAdocMath, renderAdocMath } from "../../lib/preview/adoc-math.js";
import { loadMathEngine } from "../../lib/preview/math-engine.js";
import { MermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { useMermaidSource } from "../../lib/preview/use-mermaid-source.js";
import { logRejection } from "../../lib/report-error.js";
import { DiagramPreview } from "./DiagramPreview.js";
import { MermaidBlock } from "./MermaidBlock.js";
import { renderUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function AsciiDocPreview({ target }: Props) {
  // Opted out of the access-grant dialog unless a provider declares operator
  // provenance (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch } = usePreviewFetch();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-fetch after "Apply fix to file". See change: add-preview-apply-fix-to-file.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce is the intentional re-fetch trigger, not a read (apply-fix reload)
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await previewFetch(renderUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && typeof body.data?.html === "string") {
          let rendered: string = body.data.html;
          // latexmath (`stem:[…]`, `[stem]`): KaTeX loaded only when the doc has math.
          if (hasAdocMath(rendered)) {
            const { katex } = await loadMathEngine();
            if (cancelled) return;
            rendered = renderAdocMath(rendered, katex);
          }
          setHtml(rendered);
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
  }, [target.cwd, target.path, previewFetch, reloadNonce]);

  const segments = useMemo<AdocSegment[]>(() => {
    if (!html) return [];
    return splitAdocDiagramSegments(html);
  }, [html]);

  // Mermaid segments in render order; the count backs the locator's parity guard.
  const mermaidCount = useMemo(() => segments.filter((s) => s.kind === "diagram" && s.type === "mermaid").length, [segments]);
  const mermaidSource = useMermaidSource({ cwd: target.cwd, path: target.path, kind: "adoc", reload, expectedCount: mermaidCount });

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (html == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;

  let mermaidOrdinal = 0;
  return (
    <MermaidSourceContext.Provider value={mermaidSource}>
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
              ordinal={mermaidOrdinal++}
            />
          );
        }
        return (
          <div key={idx} className="my-2 border border-[var(--border-subtle)] rounded overflow-hidden">
            <DiagramPreview
              target={target}
              sourceText={seg.source}
              inline
            />
          </div>
        );
      })}
    </div>
    </MermaidSourceContext.Provider>
  );
}
