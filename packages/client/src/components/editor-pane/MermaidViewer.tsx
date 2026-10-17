/**
 * Mermaid tab — fetches the `.mmd`/`.mermaid` source text via `/api/file/raw`
 * and renders it through the shared `MermaidBlock` (dynamic-imports mermaid,
 * theme-aware, zoom/pan). Reuses the chat diagram renderer rather than a third
 * copy. See change: improve-content-editor (tasks §4.3).
 */
import { useCallback, useEffect, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { MermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { useMermaidSource } from "../../lib/preview/use-mermaid-source.js";
import { MermaidBlock } from "../preview/MermaidBlock.js";
import type { ViewerProps } from "./types.js";

export default function MermaidViewer({ cwd, path }: ViewerProps) {
  // Opted out of the access-grant dialog unless a provider declares operator
  // provenance (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch } = usePreviewFetch();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-fetch after "Apply fix to file". See change: add-preview-apply-fix-to-file.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);
  const mermaidSource = useMermaidSource({ cwd, path, kind: "mmd", reload });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadNonce is the intentional re-fetch trigger, not a read (apply-fix reload)
  useEffect(() => {
    let active = true;
    setCode(null);
    setError(null);
    previewFetch(`${getApiBase()}/api/file/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => active && setCode(t))
      .catch((e) => active && setError(e instanceof Error ? e.message : "failed to load"));
    return () => {
      active = false;
    };
  }, [cwd, path, previewFetch, reloadNonce]);

  if (error) return <div className="p-4 text-sm text-[var(--accent-red)]">{error}</div>;
  if (code === null) return <div className="p-4 text-sm text-[var(--text-tertiary)]">Loading…</div>;
  return (
    <MermaidSourceContext.Provider value={mermaidSource}>
      <div className="h-full overflow-auto p-4">
        <MermaidBlock code={code} ordinal={0} />
      </div>
    </MermaidSourceContext.Provider>
  );
}
