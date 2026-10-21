/**
 * HTML preview for LOCAL .html files only. Frames a live-server STATIC TARGET for
 * the file (`POST /api/live-server/start-static`, gated exactly like a raw read),
 * so relative stylesheets, scripts and images resolve against the file's document
 * root. The frame is a sandboxed, opaque-origin `<iframe src=…>` carrying a minted
 * capability path: NEVER `allow-same-origin`, NEVER `srcdoc`.
 *
 * The policy follows who opened it (`PreviewProvenance`): an operator surface (the
 * preview overlay opened by a click, an editor tab last activated by the operator)
 * runs scripts with open egress; every other surface — an agent preview card, an
 * undeclared mount — is restricted. A "Static (no scripts)" mode renders the same
 * document with an empty sandbox. A refused start keeps the denial notice. HTML in
 * chat content is explicitly NOT rendered here (separate threat model).
 *
 * See change: render-file-previews; improve-canvas-html-and-url-ux (file-and-url-preview).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { eligibleFetch, usePreviewFetch, usePreviewOpener } from "../../lib/access-grants/preview-provenance.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { startStaticTarget } from "../../lib/api/live-server-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { DenialNotice } from "./DenialNotice.js";
import { classifyResponse, type DenialFailure } from "./denial-fetch.js";

interface Props {
  target: { kind: "file"; cwd: string; path: string };
  /**
   * Ignored. Egress is now decided by the surface's provenance (`PreviewProvenance`),
   * not by a CSP `<meta>` injected into the document. Kept so existing callers compile.
   */
  restrictCsp?: boolean;
}

/** Classify a refused start; a 2xx never reaches here (`startStaticTarget` already handled it). */
async function failureOf(res: { error: string; response?: Response }, optedOut: boolean): Promise<DenialFailure> {
  if (!res.response) return { kind: "error", message: res.error };
  const result = await classifyResponse(res.response, optedOut);
  return result.kind === "ok" ? { kind: "error", message: res.error } : result;
}

type Started = { id: string; entry: string; root: string };

// The framed-preview machinery (capability lifecycle, address bar, egress banner) stays off the cold landing:
// previews are rendered through PreviewCard / the viewer registry, both in the entry graph.
const LiveFrame = lazy(() => import("../editor-pane/live/LiveFrame.js").then((m) => ({ default: m.LiveFrame })));

export function HtmlPreview({ target }: Props) {
  const [started, setStarted] = useState<Started | null>(null);
  const [failure, setFailure] = useState<DenialFailure | null>(null);
  // Opted out unless operator provenance is declared; Ask for access re-runs it
  // once, eligibly (surface-denial-remedy-in-previews, D4).
  const { fetch: previewFetch, optedOut } = usePreviewFetch();
  const opener = usePreviewOpener();
  const startUrl = `${getApiBase()}/api/live-server/start-static`;
  // The ask belongs to ONE target: a new target starts un-asked (fail closed).
  const key = `${target.cwd}\u0000${target.path}`;
  const [askedKey, setAskedKey] = useState<string | null>(null);
  const asked = askedKey === key;

  useEffect(() => {
    let cancelled = false;
    setStarted(null);
    setFailure(null);
    // Discarded with a stated handler. See change: cleanup-client-plugin-promises.
    void (async () => {
      const res = await startStaticTarget(target.cwd, target.path, asked ? eligibleFetch : previewFetch);
      if (cancelled) return;
      if (res.ok) {
        setStarted({ id: res.id, entry: res.entry, root: res.root });
        return;
      }
      const result = await failureOf(res, asked ? false : optedOut);
      if (!cancelled) setFailure(result);
    })().catch(logRejection("HtmlPreview.render"));
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, asked, previewFetch, optedOut]);

  if (failure) {
    return <DenialNotice result={failure} url={startUrl} path={target.path} onAsk={() => setAskedKey(key)} asked={asked} />;
  }
  const loading = <div className="text-[var(--text-muted)] text-sm p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>;
  if (!started) return loading;
  return (
    <Suspense fallback={loading}>
      <LiveFrame
        key={`${started.id}:${started.entry}`}
        target={{ kind: "static", id: started.id, root: started.root }}
        initialDeep={started.entry}
        opener={opener}
        title={target.path}
      />
    </Suspense>
  );
}
