/**
 * Diagram preview component (design D1/D7).
 *
 * Fetches rendered SVG from the server proxy (`/api/diagram/render`).
 * On success, displays the SVG inside the shared zoom-pan viewport.
 * On failure or decline (code === "unavailable"), falls back to displaying
 * the plain diagram source with an informative notice.
 *
 * See change: diagram-rendering.
 */
import { useEffect, useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { readTextUrl } from "./raw-url.js";
import { ZoomControls } from "./ZoomControls.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  sourceText?: string;
}

export function DiagramPreview({ target, sourceText }: Props) {
  const [source, setSource] = useState<string | null>(sourceText ?? null);
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const { state: zoom, handlers, zoomIn, zoomOut, reset } = useZoomPan();

  // 1. Fetch source text if not provided directly
  useEffect(() => {
    if (sourceText !== undefined) {
      setSource(sourceText);
      return;
    }
    setSource(null);
    setSvg(null);
    setStatusNotice(null);
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(readTextUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && typeof body.data?.content === "string") {
          setSource(body.data.content);
        } else {
          setStatusNotice(body.error || "Failed to load diagram source");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setStatusNotice(err instanceof Error ? err.message : "Failed to load diagram source");
          setLoading(false);
        }
      }
    })().catch(logRejection("DiagramPreview.loadSource"));

    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, sourceText]);

  // 2. Once source is available, request render from proxy
  useEffect(() => {
    if (source === null) return;

    let cancelled = false;
    setLoading(true);
    setStatusNotice(null);
    setSvg(null);

    void (async () => {
      try {
        const base = getApiBase();
        const res = await fetch(`${base}/api/diagram/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "plantuml",
            source,
          }),
        });
        const body = await res.json();
        if (cancelled) return;

        if (res.ok && body.success && typeof body.data?.svg === "string") {
          setSvg(body.data.svg);
          setLoading(false);
        } else if (body.code === "unavailable") {
          setStatusNotice("Diagram rendering is not configured");
          setLoading(false);
        } else {
          setStatusNotice(body.error || "Failed to render diagram");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setStatusNotice(err instanceof Error ? err.message : "Upstream diagram render failed");
          setLoading(false);
        }
      }
    })().catch(logRejection("DiagramPreview.renderDiagram"));

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--text-muted)]" data-testid="diagram-preview-loading">
        {i18nT("status.loadingDiagram", undefined, "Loading diagram…")}
      </div>
    );
  }

  // If we have rendered SVG, mount in zoom-pan viewport
  if (svg) {
    return (
      <div
        className="relative h-full w-full overflow-hidden bg-[var(--bg-surface)] select-none"
        data-testid="diagram-preview-viewport"
      >
        <ZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} scale={zoom.scale} />
        <div
          className="flex h-full w-full items-center justify-center"
          {...handlers}
          style={{ cursor: zoom.scale > 1 ? "grab" : "default", touchAction: "none" }}
        >
          <div
            data-testid="diagram-svg-container"
            className="flex items-center justify-center"
            style={{
              transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`,
              transformOrigin: "center center",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    );
  }

  // Universal fallback: display source text with explanatory notice
  return (
    <div className="flex flex-col h-full overflow-auto p-4 bg-[var(--bg-primary)] font-mono text-xs" data-testid="diagram-preview-fallback">
      {statusNotice && (
        <div className="mb-3 px-3 py-2 rounded bg-amber-950/30 border border-amber-800/40 text-amber-200" data-testid="diagram-status-notice">
          {statusNotice}
        </div>
      )}
      <pre className="text-[var(--text-secondary)] whitespace-pre overflow-x-auto">
        <code>{source}</code>
      </pre>
    </div>
  );
}
