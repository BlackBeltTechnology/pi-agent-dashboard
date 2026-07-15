/**
 * HTML preview for LOCAL .html files only. Fetches the file as text from
 * `/api/file/raw` and renders via `<iframe sandbox="allow-same-origin" srcdoc=…>`.
 * NO `allow-scripts`/`allow-forms`/`allow-top-navigation`/`allow-popups` — the
 * sandbox attribute without `allow-scripts` blocks all JS execution. HTML in
 * chat content is explicitly NOT rendered here (separate threat model).
 * See change: render-file-previews.
 */
import React, { useEffect, useState } from "react";
import { withRestrictiveCsp } from "../../lib/canvas-doc-csp.js";
import { t as i18nT } from "../../lib/i18n";
import { rawUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  /**
   * When true (canvas auto-open, no user click), a restrictive CSP `<meta>` is
   * injected into the rendered document so it cannot beacon external
   * subresources — auto-open egress ≤ manual-click egress. See change:
   * auto-canvas (Section 8 / S34).
   */
  restrictCsp?: boolean;
}

export function HtmlPreview({ target, restrictCsp = false }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(rawUrl(target));
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        const text = await res.text();
        if (!cancelled) setHtml(restrictCsp ? withRestrictiveCsp(text) : text);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, restrictCsp]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (html == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;
  return (
    <iframe
      sandbox="allow-same-origin"
      srcDoc={html}
      className="w-full h-full border-0 bg-white"
      title={target.path}
    />
  );
}
