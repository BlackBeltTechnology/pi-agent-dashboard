/**
 * Docx preview (design D7/D8). Fetches `/api/file/render`, which returns a
 * discriminated result: `mode:"pdf"` (document-converter render — mount the
 * existing PdfPreview against `/api/file/rendered-pdf`) or `mode:"html"` (mammoth
 * baseline — render server-sanitized HTML via `dangerouslySetInnerHTML`, mirror
 * of AsciiDocPreview, with the shared truncation banner when images were
 * trimmed). `{success:false}` degrades to FallbackPreview (design D5).
 * See change: render-office-previews.
 */
import React, { lazy, Suspense, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { FallbackPreview } from "./FallbackPreview.js";
import { rawUrl, renderedPdfUrl, renderUrl } from "./raw-url.js";
import { TruncationBanner } from "./TruncationBanner.js";

const PdfPreview = lazy(() => import("./PdfPreview.js"));

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

type DocxData =
  | { mode: "pdf" }
  | { mode: "html"; html: string; truncated: boolean; imageCount: number; note?: string };

export function DocxPreview({ target }: Props) {
  const [data, setData] = useState<DocxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(renderUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && body.data?.mode) {
          setData(body.data as DocxData);
        } else {
          // Unrenderable tail → FallbackPreview (design D5).
          setFailed(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to render");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path]);

  if (failed) return <FallbackPreview target={target} />;
  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (data == null)
    return (
      <div className="text-[var(--text-muted)] text-sm p-2">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    );

  if (data.mode === "pdf") {
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

  return (
    <div className="flex flex-col h-full">
      {data.truncated ? (
        <TruncationBanner
          message={
            data.note ??
            i18nT("preview.docxImagesTrimmed", undefined, "Images trimmed — download for the full document.")
          }
          downloadHref={rawUrl(target)}
        />
      ) : null}
      <div
        className="asciidoc-body prose prose-invert max-w-none p-2"
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  );
}
