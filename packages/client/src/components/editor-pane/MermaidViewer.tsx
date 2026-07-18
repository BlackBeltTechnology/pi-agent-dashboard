/**
 * Mermaid tab — fetches the `.mmd`/`.mermaid` source text via `/api/file/raw`
 * and renders it through the shared `MermaidBlock` (dynamic-imports mermaid,
 * theme-aware, zoom/pan). Reuses the chat diagram renderer rather than a third
 * copy. See change: improve-content-editor (tasks §4.3).
 */
import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { MermaidBlock } from "../preview/MermaidBlock.js";
import type { ViewerProps } from "./types.js";

export default function MermaidViewer({ cwd, path }: ViewerProps) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCode(null);
    setError(null);
    fetch(`${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => active && setCode(t))
      .catch((e) => active && setError(e instanceof Error ? e.message : "failed to load"));
    return () => {
      active = false;
    };
  }, [cwd, path]);

  if (error) return <div className="p-4 text-sm text-[var(--accent-red)]">{error}</div>;
  if (code === null) return <div className="p-4 text-sm text-[var(--text-tertiary)]">Loading…</div>;
  return (
    <div className="h-full overflow-auto p-4">
      <MermaidBlock code={code} />
    </div>
  );
}
