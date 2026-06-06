import React from "react";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";
import type { ToolContext } from "./types.js";

interface Props {
  path: string;
  line?: number;
  col?: number;
  /** Token marked absolute (POSIX `/`, decoded `file://`, Windows drive). */
  absolute?: boolean;
  context: ToolContext;
  children: React.ReactNode;
}

/**
 * Resolve a possibly-relative path against `cwd` using string ops only
 * (browser-safe; no `node:path` dependency). Good enough for the link
 * `title` tooltip — server-side `/api/file` still does the authoritative
 * `path.resolve` for actual reads. Absolute paths (POSIX `/` or Windows
 * drive) are returned unchanged.
 */
function resolveAgainstCwd(cwd: string | undefined, p: string): string {
  if (!cwd) return p;
  if (p.startsWith("/")) return p;
  if (/^[A-Za-z]:[\\/]/.test(p)) return p; // Windows drive-absolute
  const base = cwd.replace(/\/+$/, "");
  if (p.startsWith("./")) return `${base}/${p.slice(2)}`;
  if (p.startsWith("../")) {
    // collapse `../` segments against cwd
    const parts = base.split("/");
    let rel = p;
    while (rel.startsWith("../")) {
      parts.pop();
      rel = rel.slice(3);
    }
    return `${parts.join("/")}/${rel}`;
  }
  return `${base}/${p}`;
}

/**
 * Clickable file reference rendered inside tool output and prose. Routes
 * click by environment via the shared {@link useFileOpenRouting} hook:
 *   localhost + detected editor → POST /api/open-editor
 *   otherwise                   → inline read-only preview overlay
 *
 * Absolute tokens (POSIX `/`, decoded `file://`, Windows drive) are passed
 * through verbatim — never re-rooted under `cwd` (D2).
 *
 * See change: unify-file-link-openability (spec: tool-output-linkification).
 */
export function FileLink({ path, line, col, absolute, context, children }: Props) {
  const { cwd, localEditorAvailable, editorName, preview, openFile, closePreview } =
    useFileOpenRouting(context);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void openFile(path, line);
  };

  // Absolute paths are already anchored; only relative paths get cwd-joined.
  const resolved = absolute ? path : resolveAgainstCwd(cwd, path);
  const titleSuffix = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const title = localEditorAvailable
    ? `Open ${resolved}${titleSuffix} in ${editorName}`
    : `Preview ${resolved}${titleSuffix}`;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={title}
        // Inline-only styling, no padding/margin/user-select so native text
        // selection across the link boundary is preserved (D8).
        className="text-blue-400 hover:underline bg-transparent border-0 p-0 m-0 font-inherit cursor-pointer"
        style={{ font: "inherit" }}
      >
        {children}
      </button>
      {preview && cwd && (
        <FilePreviewOverlay
          cwd={cwd}
          path={preview.path}
          line={preview.line}
          onClose={closePreview}
        />
      )}
    </>
  );
}
