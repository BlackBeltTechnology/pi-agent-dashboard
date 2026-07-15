/**
 * Pptx (slide-deck) preview (design P1/P2/P4). Unlike DocxPreview, this does
 * NOT convert on mount: a slide render is seconds of Docker + LibreOffice
 * latency, so it is user-initiated. The initial state shows a "Render slides"
 * affordance; activating it calls `/api/file/render` (which converts pptx → PDF
 * via document-converter and caches it), shows progress, then mounts the
 * existing `PdfPreview` (lazy pdfjs) against `/api/file/rendered-pdf`. Any
 * `{success:false}` (incl. engine-absent — there is no in-process fallback for
 * pptx) degrades to `FallbackPreview` (download). See change: render-pptx-preview.
 */
import React, { lazy, Suspense, useState } from "react";
import { t as i18nT } from "../../lib/i18n";
import { FallbackPreview } from "./FallbackPreview.js";
import { renderedPdfUrl, renderUrl } from "./raw-url.js";

const PdfPreview = lazy(() => import("./PdfPreview.js"));

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

type State = "idle" | "loading" | "pdf" | "failed";

export function PptxPreview({ target }: Props) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(renderUrl(target));
      const body = await res.json();
      if (body.success && body.data?.mode === "pdf") {
        setState("pdf");
      } else {
        setError(typeof body.error === "string" ? body.error : null);
        setState("failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to render");
      setState("failed");
    }
  }

  if (state === "failed") return <FallbackPreview target={target} />;

  if (state === "pdf") {
    return (
      <Suspense
        fallback={
          <div className="text-[var(--text-muted)] text-sm p-2">
            {i18nT("status.loadingPdfViewer", undefined, "Loading PDF viewer…")}
          </div>
        }
      >
        <PdfPreview target={target} srcUrl={renderedPdfUrl(target)} />
      </Suspense>
    );
  }

  if (state === "loading") {
    return (
      <div className="text-[var(--text-muted)] text-sm p-4 flex items-center justify-center h-full">
        {i18nT("preview.pptxRendering", undefined, "Rendering slides…")}
      </div>
    );
  }

  // idle — the "Render slides" affordance (design P2). No auto-fetch.
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center h-full">
      <button
        type="button"
        data-testid="pptx-render-slides"
        onClick={activate}
        className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-fg,#fff)] hover:opacity-90"
      >
        {i18nT("preview.pptxRenderSlides", undefined, "Render slides")}
      </button>
      <p className="text-xs text-[var(--text-muted)] max-w-sm">
        {i18nT(
          "preview.pptxRenderNote",
          undefined,
          "Slide rendering runs on demand and can take a few seconds.",
        )}
      </p>
    </div>
  );
}
