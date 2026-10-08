/**
 * KbTestSearch — try a query against the folder's SAVED index from the
 * settings page (`GET /api/kb/search`). Read-only: never reindexes, never
 * searches unsaved form state, no trust verdicts.
 *
 * Snippet match markers (`[term]`) render as `<mark>` TEXT NODES — the snippet
 * is never injected as HTML.
 *
 * See change: improve-kb-settings-sources-and-search (design D8).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import type { KbSearchDocType, KbSearchResponse } from "../shared/kb-plugin-types.js";
import { searchKb } from "./kb-api.js";

/** Split `a [b] c` into text/mark parts without touching HTML. */
function snippetParts(snippet: string): Array<{ text: string; mark: boolean }> {
  const out: Array<{ text: string; mark: boolean }> = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), mark: false });
    out.push({ text: m[1], mark: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), mark: false });
  return out;
}

type Lane = "" | KbSearchDocType;

export function KbTestSearch({ cwd, dirty }: { cwd: string; dirty: boolean }): React.ReactElement {
  const t = useT();
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState<Lane>("");
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KbSearchResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await searchKb(cwd, q, { limit, ...(lane ? { docType: lane } : {}) }));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = (path: string): void => {
    void navigator.clipboard?.writeText(path);
    setCopied(path);
    setTimeout(() => setCopied((c) => (c === path ? null : c)), 1500);
  };

  const field = "text-[12px] bg-transparent border border-[var(--border-subtle)] rounded px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:border-indigo-500/60";

  return (
    <div className="px-4 py-3 border-b border-[var(--border-subtle)]" data-testid="kb-test-search">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-bold mb-2">{t("testSearchHeading", undefined, "Test search")}</div>
      <form onSubmit={(e) => void submit(e)} className="flex items-center gap-1.5">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder", undefined, "ask the index a question…")} data-testid="kb-search-input" className={`flex-1 ${field}`} />
        <select value={lane} onChange={(e) => setLane(e.target.value as Lane)} data-testid="kb-search-lane" className={field} aria-label={t("searchLane", undefined, "Lane")}>
          <option value="">{t("laneAll", undefined, "all lanes")}</option>
          <option value="doc">doc</option>
          <option value="agents">agents</option>
          <option value="source-md">source-md</option>
        </select>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} data-testid="kb-search-limit" className={field} aria-label={t("searchLimit", undefined, "Limit")}>
          {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="submit" disabled={busy || !query.trim()} data-testid="kb-search-submit" className="text-[12px] px-3 py-1 rounded border text-indigo-300 border-indigo-500/50 bg-indigo-500/10 disabled:opacity-40">
          {t("search", undefined, "Search")}
        </button>
      </form>

      {dirty && (
        <div className="mt-1.5 text-[11px] text-amber-400" data-testid="kb-search-dirty">
          {t("searchDirtyNotice", undefined, "Results reflect the last saved index, not the unsaved changes above.")}
        </div>
      )}
      {error && <div className="mt-1.5 text-[11px] text-red-400" role="alert" data-testid="kb-search-error">{error}</div>}
      {result?.needsReindex && (
        <div className="mt-1.5 text-[11px] text-amber-400" data-testid="kb-search-needs-reindex">
          {t("searchNeedsReindex", undefined, "The index predates this version — rebuild it, then search again.")}
        </div>
      )}
      {result && !result.needsReindex && (
        <div className="mt-2" data-testid="kb-search-results">
          <div className="text-[11px] text-[var(--text-muted)] mb-1" data-testid="kb-search-summary">
            {t("searchSummary", { count: result.hits.length, ms: result.tookMs }, `${result.hits.length} hits · ${result.tookMs} ms`)}
          </div>
          {result.hits.length === 0 && (
            <div className="text-[11px] italic text-[var(--text-muted)]" data-testid="kb-search-empty">
              {t("searchEmpty", undefined, "No matches in the saved index.")}
            </div>
          )}
          {result.hits.map((h) => (
            <button type="button" key={h.chunkId} onClick={() => copy(h.path)} data-testid="kb-search-hit" className="block w-full text-left px-2 py-1.5 mb-1 rounded border border-[var(--border-subtle)] hover:border-indigo-500/50">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-[var(--text-secondary)] truncate">{h.path}{h.headingPath ? ` :: ${h.headingPath}` : ""}</span>
                <span className="ml-auto text-[10px] text-[var(--text-muted)]">{h.root} · {h.docType} · {h.score.toFixed(2)}</span>
              </div>
              <div className="text-[11px] text-[var(--text-tertiary)]" data-testid="kb-search-snippet">
                {snippetParts(h.snippet).map((p, i) =>
                  p.mark ? <mark key={`${i}-${p.text}`} className="bg-indigo-500/30 text-inherit">{p.text}</mark> : <span key={`${i}-${p.text}`}>{p.text}</span>,
                )}
              </div>
              {copied === h.path && <div className="text-[10px] text-green-400" data-testid="kb-search-copied">{t("copied", undefined, "Path copied")}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
