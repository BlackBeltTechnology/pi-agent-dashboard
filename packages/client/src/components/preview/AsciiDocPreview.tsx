/**
 * AsciiDoc preview. Fetches `/api/file/render` which runs `asciidoctor` in
 * `safe: "secure"` mode server-side; renders the returned HTML via
 * `dangerouslySetInnerHTML`. The server DOMPurify-sanitizes the converted HTML
 * (asciidoctor `secure` mode still passes `+++`/`pass:[]` HTML through); the
 * only post-sanitize step is `renderAdocMath`, which adds trusted KaTeX markup
 * at text nodes outside `pre`/`code`.
 * See changes: render-file-previews, sanitize-untrusted-rendered-content.
 */
import { repairAsciiDoc } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/asciidoc.js";
import type { MarkupRepair } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/types.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type AdocSegment, splitAdocDiagramSegments } from "../../lib/preview/adoc-diagram-splitter.js";
import { hasAdocMath, renderAdocMath } from "../../lib/preview/adoc-math.js";
import { loadMathEngine } from "../../lib/preview/math-engine.js";
import { MermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { useMermaidSource } from "../../lib/preview/use-mermaid-source.js";
import { logRejection } from "../../lib/report-error.js";
import { DiagramPreview } from "./DiagramPreview.js";
import { MarkupRepairBanner } from "./MarkupRepairBanner.js";
import { MermaidBlock } from "./MermaidBlock.js";
import { renderUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

/** Converted HTML → displayable HTML (latexmath via the lazily loaded KaTeX engine). */
async function withMath(html: string): Promise<string> {
  if (!hasAdocMath(html)) return html;
  const { katex } = await loadMathEngine();
  return renderAdocMath(html, katex);
}

export function AsciiDocPreview({ target }: Props) {
  // Opted out of the access-grant dialog unless a provider declares operator
  // provenance (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch } = usePreviewFetch();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Markup repairs the server applied + the file's modification token at render time.
  // See change: add-md-adoc-markup-repair.
  const [repairs, setRepairs] = useState<MarkupRepair[]>([]);
  const [renderMtime, setRenderMtime] = useState<number | undefined>(undefined);
  const [viewOriginal, setViewOriginal] = useState(false);
  // Unrepaired rendering, fetched lazily on first "view original" and cached.
  const [originalHtml, setOriginalHtml] = useState<string | null>(null);
  const originalRequested = useRef(false);
  // Re-fetch after "Apply fix to file". See change: add-preview-apply-fix-to-file.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce is the intentional re-fetch trigger, not a read (apply-fix reload)
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    setRepairs([]);
    setRenderMtime(undefined);
    setViewOriginal(false);
    setOriginalHtml(null);
    originalRequested.current = false;
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await previewFetch(renderUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && typeof body.data?.html === "string") {
          const rendered = await withMath(body.data.html);
          if (cancelled) return;
          setRepairs(Array.isArray(body.data.repairs) ? body.data.repairs : []);
          setRenderMtime(typeof body.data.mtime === "number" ? body.data.mtime : undefined);
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

  const toggleOriginal = useCallback(() => {
    setViewOriginal((v) => !v);
    if (originalRequested.current) return;
    originalRequested.current = true;
    void (async () => {
      try {
        const res = await previewFetch(`${renderUrl(target)}&repair=0`);
        const body = await res.json();
        if (body.success && typeof body.data?.html === "string") setOriginalHtml(await withMath(body.data.html));
        else originalRequested.current = false;
      } catch (e) {
        originalRequested.current = false;
        throw e;
      }
    })().catch(logRejection("AsciiDocPreview.viewOriginal"));
  }, [previewFetch, target]);

  const shownHtml = viewOriginal && originalHtml !== null ? originalHtml : html;
  const repairApply = useMemo(() => ({ renderMtime, repair: repairAsciiDoc }), [renderMtime]);

  const segments = useMemo<AdocSegment[]>(() => {
    if (!shownHtml) return [];
    return splitAdocDiagramSegments(shownHtml);
  }, [shownHtml]);

  // Mermaid segments in render order; the count backs the locator's parity guard.
  const mermaidCount = useMemo(() => segments.filter((s) => s.kind === "diagram" && s.type === "mermaid").length, [segments]);
  const baseMermaidSource = useMermaidSource({ cwd: target.cwd, path: target.path, kind: "adoc", reload, expectedCount: mermaidCount });
  const repairActive = repairs.length > 0;
  // Per-diagram apply waits for the markup apply (block ordinals on disk differ).
  const mermaidSource = useMemo(
    () => (baseMermaidSource && repairActive ? { ...baseMermaidSource, markupRepairActive: true } : baseMermaidSource),
    [baseMermaidSource, repairActive],
  );

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (html == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;

  let mermaidOrdinal = 0;
  return (
    <MermaidSourceContext.Provider value={mermaidSource}>
    {repairActive && (
      <MarkupRepairBanner repairs={repairs} viewOriginal={viewOriginal} onToggleOriginal={toggleOriginal} apply={repairApply} />
    )}
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
