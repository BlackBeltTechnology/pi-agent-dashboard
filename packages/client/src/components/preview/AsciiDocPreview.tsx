/**
 * AsciiDoc preview. Fetches `/api/file/render` which runs `asciidoctor` in
 * `safe: "secure"` mode server-side; renders the returned HTML via
 * `dangerouslySetInnerHTML` (safe because server guarantees sanitization).
 * See change: render-file-previews.
 */
import React, { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { renderUrl } from "./raw-url.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
}

export function AsciiDocPreview({ target }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(renderUrl(target));
        const body = await res.json();
        if (cancelled) return;
        if (body.success && typeof body.data?.html === "string") {
          setHtml(body.data.html);
        } else {
          setError(body.error || "failed to render");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to render");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path]);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (html == null) return <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;
  return (
    <div
      className="asciidoc-body prose prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
