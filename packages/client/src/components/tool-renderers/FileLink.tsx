import React, { useState } from "react";
import { isLocalhost, openEditor } from "../../lib/editor-api.js";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import type { ToolContext } from "./types.js";

interface Props {
  path: string;
  line?: number;
  col?: number;
  context: ToolContext;
  children: React.ReactNode;
}

/**
 * Resolve a possibly-relative path against `cwd` using string ops only
 * (browser-safe; no `node:path` dependency). Good enough for the link
 * `title` tooltip — server-side `/api/file` still does the authoritative
 * `path.resolve` for actual reads.
 */
function resolveAgainstCwd(cwd: string | undefined, p: string): string {
  if (!cwd) return p;
  if (p.startsWith("/")) return p;
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
 * Clickable file reference rendered inside tool output. Routes click by
 * environment (D3):
 *   localhost + detected editor → POST /api/open-editor
 *   otherwise                   → inline read-only preview overlay
 *
 * See change: linkify-tool-output (spec: tool-output-linkification).
 */
export function FileLink({ path, line, col, context, children }: Props) {
  const { cwd, editors } = context;
  const [previewOpen, setPreviewOpen] = useState(false);

  const localEditorAvailable = isLocalhost() && editors.length > 0;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!cwd) return; // no cwd → nothing actionable
    if (localEditorAvailable) {
      await openEditor(cwd, editors[0].id, path, line);
    } else {
      setPreviewOpen(true);
    }
  };

  const resolved = resolveAgainstCwd(cwd, path);
  const titleSuffix = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const title = localEditorAvailable
    ? `Open ${resolved}${titleSuffix} in ${editors[0].name}`
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
      {previewOpen && cwd && (
        <FilePreviewOverlay
          cwd={cwd}
          path={path}
          line={line}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
