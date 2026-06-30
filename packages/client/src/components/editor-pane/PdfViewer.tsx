/**
 * PDF tab — renders via the browser's native PDF plugin through `<object>`,
 * sourced from `/api/file/raw`. Falls back to a download link when the browser
 * cannot render PDF inline. (`react-pdf` upgrade deferred per design.)
 *
 * See change: add-internal-monaco-editor-pane.
 */
import { getApiBase } from "../../lib/api-context.js";
import type { ViewerProps } from "./types.js";

export default function PdfViewer({ cwd, path }: ViewerProps) {
  const src = `${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`;
  return (
    <object data={src} type="application/pdf" className="h-full w-full" aria-label={path}>
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-[var(--text-secondary)]">
        <p>This browser cannot display the PDF inline.</p>
        <a href={src} download className="text-[var(--link)] hover:text-[var(--link-hover)] underline">
          Download {path}
        </a>
      </div>
    </object>
  );
}
