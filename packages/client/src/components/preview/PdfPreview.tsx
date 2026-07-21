/**
 * PDF preview using `pdfjs-dist`. Imported via dynamic `import()` so the
 * library lives in a separate Vite chunk (NOT in the main bundle). Renders the
 * document through pdfjs's own `PDFViewer` component (`pdfjs-dist/web/
 * pdf_viewer.mjs`): virtualized continuous scroll, a text layer (selection +
 * ctrl-F find), and link handling — no hand-rolled paging. The pdfjs worker is
 * bundled by Vite as a separate static asset via `?url` import — no manual copy
 * step. See change: render-file-previews. See change: pdf-preview-continuous-scroll.
 */
import { useEffect, useRef, useState } from "react";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  /**
   * Optional source-URL override. Defaults to `/api/file/raw` for the target.
   * `DocxPreview` passes `/api/file/rendered-pdf` to stream a docx→PDF render;
   * `EmlPreview` passes a `blob:` URL for a PDF attachment.
   * See change: render-office-previews. See change: add-eml-preview.
   */
  srcUrl?: string;
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

// Load the pdfjs component viewer + its stylesheet via dynamic import so both
// ride the lazy PdfPreview chunk, NOT the main bundle. `PdfPreview` is imported
// statically by the editor-pane viewer-registry, so a top-level `import` of
// these would leak pdfjs into the main entry (breaks the §160 lazy guarantee).
// See change: pdf-preview-continuous-scroll.
async function loadViewer(): Promise<typeof import("pdfjs-dist/web/pdf_viewer.mjs")> {
  const [mod] = await Promise.all([
    import("pdfjs-dist/web/pdf_viewer.mjs"),
    import("pdfjs-dist/web/pdf_viewer.css"),
  ]);
  return mod;
}

type ViewerHandle = {
  doc: import("pdfjs-dist").PDFDocumentProxy;
  viewer: import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer;
};

/** Release a viewer handle: detach the document from the viewer, then destroy it. */
function destroyViewer(handle: ViewerHandle): void {
  handle.viewer.setDocument(null as never);
  handle.doc.destroy();
}

/** Load the document and construct the pdfjs `PDFViewer` bound to `container`. */
async function mountViewer(container: HTMLDivElement, url: string): Promise<ViewerHandle> {
  const [pdfjs, { EventBus, PDFLinkService, PDFViewer }] = await Promise.all([
    loadPdfJs(),
    loadViewer(),
  ]);
  const doc = await pdfjs.getDocument({ url }).promise;
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  // Enable the text layer (textLayerMode 2) → text selection + ctrl-F find.
  const viewer = new PDFViewer({ container, eventBus, linkService, textLayerMode: 2 });
  linkService.setViewer(viewer);
  viewer.setDocument(doc);
  linkService.setDocument(doc, null);
  return { doc, viewer };
}

export function PdfPreview({ target, srcUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { cwd, path } = target;

  // Construct the pdfjs `PDFViewer` once per document load; tear it down on
  // unmount / target change. If the effect is torn down before the async mount
  // resolves, the late handle is destroyed instead of being adopted.
  useEffect(() => {
    let cancelled = false;
    let handle: ViewerHandle | null = null;
    setError(null);
    const container = containerRef.current;
    if (!container) return;
    mountViewer(container, srcUrl ?? rawUrl({ kind: "file", cwd, path }))
      .then((h) => {
        if (cancelled) destroyViewer(h);
        else handle = h;
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load PDF");
      });
    return () => {
      cancelled = true;
      if (handle) destroyViewer(handle);
    };
  }, [cwd, path, srcUrl]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;

  // pdfjs `PDFViewer` measures its container and requires a positioned parent
  // with a definite height plus an absolutely-positioned scroll container
  // holding a `.pdfViewer` child (which the viewer fills in). See design.md.
  return (
    <div className="relative h-full">
      <div ref={containerRef} className="pdfViewerContainer absolute inset-0 overflow-auto">
        <div className="pdfViewer" />
      </div>
    </div>
  );
}

export default PdfPreview;
