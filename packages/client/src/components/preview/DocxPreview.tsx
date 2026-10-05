/**
 * Docx preview (design D7/D8). Fetches `/api/file/render`, which returns a
 * discriminated result: `mode:"pdf"` (document-converter render — mount the
 * existing PdfPreview against `/api/file/rendered-pdf`) or `mode:"html"` (mammoth
 * baseline — render server-sanitized HTML via `dangerouslySetInnerHTML`, mirror
 * of AsciiDocPreview, with the shared truncation banner when images were
 * trimmed). `{success:false}` degrades to FallbackPreview (design D5).
 * See change: render-office-previews.
 */

import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { TooLargePreview } from "../editor-pane/TooLargePreview.js";
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
  // Opted out of the access-grant dialog unless a provider declares operator
  // provenance (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch } = usePreviewFetch();
  const [data, setData] = useState<DocxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setFailed(false);
    setTooLarge(false);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      try {
        const res = await previewFetch(renderUrl(target));
        // Size-gate 413 → name the real office limit (D6), before the generic failure branch.
        if (res.status === 413) {
          if (!cancelled) setTooLarge(true);
          return;
        }
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
    })().catch(logRejection("DocxPreview.render"));
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, previewFetch]);

  if (tooLarge) return <TooLargePreview cwd={target.cwd} path={target.path} cap={OFFICE_SIZE_CAPS.docx} />;
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
        className="asciidoc-body p-2"
        dangerouslySetInnerHTML={{ __html: data.html }}
      />
    </div>
  );
}
