/**
 * HTML preview for LOCAL .html files only. Fetches the file as text from
 * `/api/file/raw` and renders via `<iframe sandbox="allow-same-origin" srcdoc=…>`.
 * NO `allow-scripts`/`allow-forms`/`allow-top-navigation`/`allow-popups` — the
 * sandbox attribute without `allow-scripts` blocks all JS execution. HTML in
 * chat content is explicitly NOT rendered here (separate threat model).
 * See change: render-file-previews.
 */
import React, { useEffect, useState } from "react";
import { withRestrictiveCsp } from "../../lib/canvas/canvas-doc-csp.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { eligibleFetch, usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { rawUrl } from "./raw-url.js";
import { logRejection } from "../../lib/report-error.js";
import { type DenialFailure, denialFetch } from "./denial-fetch.js";
import { DenialNotice } from "./DenialNotice.js";

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
  const [failure, setFailure] = useState<DenialFailure | null>(null);
  // Opted out unless operator provenance is declared; Ask for access re-runs it
  // once, eligibly (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch, optedOut } = usePreviewFetch();
  const url = rawUrl(target);
  // The ask belongs to ONE target: a new target starts un-asked (fail closed).
  const [askedUrl, setAskedUrl] = useState<string | null>(null);
  const asked = askedUrl === url;

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailure(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      const r = await denialFetch(asked ? eligibleFetch : previewFetch, url, asked ? false : optedOut);
      if (cancelled) return;
      if (r.kind !== "ok") {
        setFailure(r);
        return;
      }
      let text: string;
      try {
        text = await r.response.text();
      } catch (e) {
        // A body stream that aborts must end in an error, not a permanent "Loading…".
        if (!cancelled) setFailure({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (!cancelled) setHtml(restrictCsp ? withRestrictiveCsp(text) : text);
    })().catch(logRejection("HtmlPreview.render"));
    return () => {
      cancelled = true;
    };
  }, [url, restrictCsp, asked, previewFetch, optedOut]);

  if (failure) {
    return <DenialNotice result={failure} url={url} path={target.path} onAsk={() => setAskedUrl(url)} asked={asked} />;
  }
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
