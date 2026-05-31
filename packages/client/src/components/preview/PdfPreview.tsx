/**
 * PDF preview using `pdfjs-dist`. Imported via dynamic `import()` so the
 * library lives in a separate Vite chunk (NOT in the main bundle). Page
 * navigation: Prev / Next + "Page X of Y". The pdfjs worker is bundled by
 * Vite as a separate static asset via `?url` import — no manual copy step.
 * See change: render-file-previews.
 */
import React, { useEffect, useRef, useState } from "react";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

// Lazy single-load of pdfjs. The dynamic import keeps it out of the main
// bundle (Vite splits dynamic imports automatically).
async function loadPdfJs(): Promise<typeof import("pdfjs-dist")> {
  const mod = await import("pdfjs-dist");
  // Lazily resolve the worker URL via Vite's `?url` query, which emits the
  // worker as a hashed static asset and returns its served URL. Idempotent
  // — first call sets it; subsequent calls overwrite with the same value.
  // @ts-ignore — Vite `?url` import resolves to a string at build time.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  return mod;
}

export function PdfPreview({ target }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const docRef = useRef<any>(null);

  // Load the document on target change.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPageNum(1);
    setPageCount(0);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const loadingTask = pdfjs.getDocument({ url: rawUrl(target) });
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load PDF");
      }
    })();
    return () => {
      cancelled = true;
      const doc = docRef.current;
      docRef.current = null;
      if (doc) doc.destroy();
    };
  }, [target.cwd, target.path]);

  // Render the current page when doc or pageNum changes.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !doc || pageCount === 0) return;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to render page");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNum, pageCount]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border-secondary)] text-xs">
        <button
          className="px-2 py-0.5 rounded hover:bg-[var(--bg-surface)] disabled:opacity-40"
          disabled={pageNum <= 1 || pageCount === 0}
          onClick={() => setPageNum((n) => Math.max(1, n - 1))}
        >
          Prev
        </button>
        <span className="text-[var(--text-muted)]">
          {pageCount === 0 ? "Loading…" : `Page ${pageNum} of ${pageCount}`}
        </span>
        <button
          className="px-2 py-0.5 rounded hover:bg-[var(--bg-surface)] disabled:opacity-40"
          disabled={pageNum >= pageCount || pageCount === 0}
          onClick={() => setPageNum((n) => Math.min(pageCount, n + 1))}
        >
          Next
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 bg-[var(--bg-canvas)] flex justify-center">
        <canvas ref={canvasRef} className="max-w-full h-auto" />
      </div>
    </div>
  );
}

export default PdfPreview;
