/**
 * EML (email) preview. Fetches the server-parsed `/api/file/eml` payload
 * (headers + sanitized HTML body + attachment metadata) and renders:
 *   - a collapsed, expandable header block whose values are escaped JSX text
 *     nodes (never `dangerouslySetInnerHTML`) — header injection defense;
 *   - the sanitized body inside `<iframe sandbox="" srcDoc>` — an OPAQUE-origin
 *     sandbox (no `allow-same-origin`, no `allow-scripts`), stricter than
 *     `HtmlPreview` because `.eml` bodies are untrusted sender HTML (design D2);
 *   - attachments dispatched by MIME to inline `PdfPreview` / `ImagePreview`
 *     (via `blob:` URLs, never top-level nav) or a download-only row (D4).
 * `cid:` inline images are resolved to `blob:` URLs before the srcDoc is built.
 * Remote content is blocked by default; "Load remote content" re-requests with
 * `?allowRemote=1` (browser fetches, server never does — no SSRF, design D3).
 * See change: add-eml-preview.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n";
import { ImagePreview } from "./ImagePreview.js";
import { emlAttachmentUrl, emlUrl } from "./raw-url.js";

const PdfPreview = lazy(() => import("./PdfPreview.js"));

interface FileTarget {
  kind: "file";
  cwd: string;
  path: string;
}

interface AttachmentMeta {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
}

interface EmlData {
  headers: { from: string; to: string; cc: string; subject: string; date: string };
  html: string;
  text: string;
  attachments: AttachmentMeta[];
  hasRemote: boolean;
}

interface Props {
  target: FileTarget;
}

/** Replace `cid:<id>` tokens (src + CSS `url()`) with resolved `blob:` URLs. */
function resolveCidRefs(html: string, cidToBlob: Map<string, string>): string {
  if (cidToBlob.size === 0) return html;
  return html.replace(/cid:([^"')\s>]+)/gi, (match, id: string) => {
    const blob = cidToBlob.get(id.toLowerCase());
    return blob ?? match;
  });
}

/** Wrap sanitized body HTML in a minimal document for the sandboxed iframe. */
function buildSrcDoc(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${bodyHtml}</body></html>`;
}

export function EmlPreview({ target }: Props) {
  const [data, setData] = useState<EmlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowRemote, setAllowRemote] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [srcDoc, setSrcDoc] = useState<string>("");
  const blobUrls = useRef<string[]>([]);

  // Fetch + parse. Re-runs when the target or the allow-remote flag changes.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(emlUrl(target, allowRemote));
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || `HTTP ${res.status}`);
          return;
        }
        setData(json.data as EmlData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.cwd, target.path, allowRemote]);

  // Resolve `cid:` inline images to blob URLs, then build the iframe srcDoc.
  useEffect(() => {
    if (!data) {
      setSrcDoc("");
      return;
    }
    let cancelled = false;
    // Track THIS run's blobs so a re-run (e.g. "Load remote content" toggles
    // `data`) revokes its own batch instead of leaking until unmount.
    const createdUrls: string[] = [];
    (async () => {
      const cidToBlob = new Map<string, string>();
      const inlineCids = data.attachments.filter((a) => a.contentId);
      await Promise.all(
        inlineCids.map(async (a) => {
          try {
            const res = await fetch(emlAttachmentUrl(target, a.index));
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            if (a.contentId) cidToBlob.set(a.contentId.toLowerCase(), url);
          } catch {
            /* broken cid → leave as-is (broken-image placeholder) */
          }
        }),
      );
      if (cancelled) return;
      blobUrls.current.push(...createdUrls);
      setSrcDoc(buildSrcDoc(resolveCidRefs(data.html, cidToBlob)));
    })();
    return () => {
      cancelled = true;
      // Revoke this run's blobs (created but the effect re-ran/unmounted) and
      // drop them from the unmount-safeguard list.
      for (const u of createdUrls) URL.revokeObjectURL(u);
      blobUrls.current = blobUrls.current.filter((u) => !createdUrls.includes(u));
    };
  }, [data, target.cwd, target.path]);

  // Final safeguard: revoke any surviving blob URLs on unmount.
  useEffect(() => {
    const urls = blobUrls;
    return () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    };
  }, []);

  if (error) return <div className="text-red-400 text-sm p-2">{error}</div>;
  if (!data) {
    return (
      <div className="text-[var(--text-muted)] text-sm p-2">
        {i18nT("common.loading2", undefined, "Loading…")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-sm" data-testid="eml-preview">
      <EmlHeader headers={data.headers} open={headerOpen} onToggle={() => setHeaderOpen((v) => !v)} />
      {data.hasRemote && !allowRemote && (
        <div className="flex items-center gap-2 px-2 py-1 bg-[var(--bg-surface)] border-b border-[var(--border-secondary)] text-xs">
          <span className="text-[var(--text-muted)]">
            {i18nT("preview.remoteBlocked", undefined, "Remote content blocked for your privacy.")}
          </span>
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
            data-testid="eml-load-remote"
            onClick={() => setAllowRemote(true)}
          >
            {i18nT("preview.loadRemote", undefined, "Load remote content")}
          </button>
        </div>
      )}
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        className="w-full flex-1 min-h-[30vh] border-0 bg-white"
        title={target.path}
        data-testid="eml-body-frame"
      />
      {data.attachments.length > 0 && (
        <div className="border-t border-[var(--border-secondary)]">
          {data.attachments.map((a) => (
            <AttachmentRow key={a.index} target={target} att={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmlHeader({
  headers,
  open,
  onToggle,
}: {
  headers: EmlData["headers"];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[var(--border-secondary)]">
      <button
        type="button"
        className="w-full text-left px-2 py-1 hover:bg-[var(--bg-surface)]"
        onClick={onToggle}
        data-testid="eml-header-toggle"
      >
        <div className="truncate font-medium text-[var(--text-primary)]">
          {headers.subject || i18nT("preview.noSubject", undefined, "(no subject)")}
        </div>
        {!open && (
          <div className="truncate text-xs text-[var(--text-muted)]">{headers.from}</div>
        )}
      </button>
      {open && (
        <dl className="px-2 pb-1 text-xs grid grid-cols-[auto_1fr] gap-x-2" data-testid="eml-header-full">
          <HeaderField label={i18nT("preview.from", undefined, "From")} value={headers.from} />
          <HeaderField label={i18nT("preview.to", undefined, "To")} value={headers.to} />
          {headers.cc && <HeaderField label={i18nT("preview.cc", undefined, "Cc")} value={headers.cc} />}
          <HeaderField label={i18nT("preview.date", undefined, "Date")} value={headers.date} />
          <HeaderField label={i18nT("preview.subject", undefined, "Subject")} value={headers.subject} />
        </dl>
      )}
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--text-muted)]">{label}</dt>
      {/* value is an escaped text node — never dangerouslySetInnerHTML */}
      <dd className="text-[var(--text-secondary)] break-words">{value}</dd>
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentRow({ target, att }: { target: FileTarget; att: AttachmentMeta }) {
  const [expanded, setExpanded] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const previewable = att.mimeType === "application/pdf" || att.mimeType.startsWith("image/");

  // Lazily fetch bytes into a blob URL when first expanded. `blobUrl`/`loading`
  // are read from the closure (NOT deps) so setting `loading` does not re-run
  // this effect and cancel its own in-flight fetch.
  useEffect(() => {
    if (!expanded || blobUrl) return;
    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(emlAttachmentUrl(target, att.index));
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(created);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [expanded, target.cwd, target.path, att.index]);

  return (
    <div className="text-xs" data-testid="eml-attachment" data-mime={att.mimeType}>
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="truncate flex-1 font-mono text-[var(--text-secondary)]">{att.filename}</span>
        <span className="text-[var(--text-muted)]">{formatSize(att.size)}</span>
        {previewable ? (
          <button
            type="button"
            className="px-2 py-0.5 rounded hover:bg-[var(--bg-surface)]"
            data-testid="eml-attachment-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? i18nT("common.collapse", undefined, "Collapse") : i18nT("common.expand", undefined, "Expand")}
          </button>
        ) : (
          <a
            className="px-2 py-0.5 rounded hover:bg-[var(--bg-surface)]"
            href={emlAttachmentUrl(target, att.index)}
            data-testid="eml-attachment-download"
          >
            {i18nT("common.download", undefined, "Download")}
          </a>
        )}
      </div>
      {expanded && previewable && (
        <div className="h-[50vh] border-t border-[var(--border-secondary)]">
          {loading || !blobUrl ? (
            <div className="text-[var(--text-muted)] p-2">{i18nT("common.loading2", undefined, "Loading…")}</div>
          ) : att.mimeType === "application/pdf" ? (
            <Suspense fallback={<div className="text-[var(--text-muted)] p-2">{i18nT("status.loadingPdfViewer", undefined, "Loading PDF viewer…")}</div>}>
              <PdfPreview target={target} srcUrl={blobUrl} />
            </Suspense>
          ) : (
            <ImagePreview target={target} srcUrl={blobUrl} />
          )}
        </div>
      )}
    </div>
  );
}

export default EmlPreview;
