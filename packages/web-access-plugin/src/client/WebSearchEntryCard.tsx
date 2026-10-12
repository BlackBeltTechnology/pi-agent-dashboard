/**
 * WebSearchEntryCard — the web-access `custom-entry-renderer` contribution for
 * `web-search-results` entries emitted by `pi-web-access`.
 *
 * Contract (spec: web-search-entry-rendering; design D3):
 *   - COLLAPSED-FIRST: the collapsed line derives from the row body ALONE; the
 *     container owns the payload fetch and expansion state (presentation only).
 *   - Counts are never partial (see `summarizeBody`).
 *   - EXPANDED content comes from the fetched payload only — the stored body's
 *     nested data was replaced by ingest placeholders, so a typed view of it
 *     would be silently partial.
 *   - Everything is PLAIN TEXT except `http(s)` URLs without credentials, which
 *     become `rel="noopener noreferrer"` links (original text, normalized
 *     target). No markdown, no `dangerouslySetInnerHTML`.
 *   - Icons are decorative (`aria-hidden`) and additive to a text label.
 *
 * See change: render-unclaimed-custom-entries.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiChevronDown, mdiChevronRight, mdiFileDownloadOutline, mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useMemo } from "react";
import { CUSTOM_BODY_MAX_CHARS } from "./body-limits.js";
import {
  type FetchView,
  parseWebSearchPayload,
  type SearchView,
  safeHttpUrl,
  summarizeBody,
} from "./parse-web-search.js";

type T = ReturnType<typeof useT>;

const PRE_CLASS =
  "m-0 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all";
const MUTED = "text-[var(--text-muted)]";
const MAX_PLAIN_LINES = 200;

/** Last-200-lines / 64 000-char display form (matches the reducer's body bound). */
function boundPlainText(text: string): string {
  const lines = text.split("\n");
  const tail = lines.length > MAX_PLAIN_LINES ? lines.slice(-MAX_PLAIN_LINES).join("\n") : text;
  return tail.length > CUSTOM_BODY_MAX_CHARS ? tail.slice(-CUSTOM_BODY_MAX_CHARS) : tail;
}

function payloadAsText(payload: unknown): string {
  try {
    return boundPlainText(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
  } catch {
    return "";
  }
}

/** Clickable only when `safeHttpUrl` accepts it; otherwise plain text. */
function UrlText({ raw }: { raw: string }) {
  const href = safeHttpUrl(raw);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline break-all">
      {raw}
    </a>
  ) : (
    <span className="break-all">{raw}</span>
  );
}

const plural = (t: T, base: string, count: number, one: string, other: string) =>
  count === 1
    ? t(`${base}One`, { count }, one.replace("{count}", String(count)))
    : t(`${base}Other`, { count }, other.replace("{count}", String(count)));

function Skipped({ t, count }: { t: T; count: number }) {
  return count > 0 ? (
    <div data-testid="web-search-skipped" className={`px-2 py-0.5 text-[11px] ${MUTED}`}>
      {t("skippedItems", { count }, `${count} items could not be displayed`)}
    </div>
  ) : null;
}

function More({ t, count }: { t: T; count: number }) {
  return count > 0 ? (
    <div className={`px-2 py-0.5 text-[11px] ${MUTED}`}>{t("moreItems", { count }, `+${count} more`)}</div>
  ) : null;
}

function SearchBody({ view, t }: { view: SearchView; t: T }) {
  return (
    <div className="space-y-2" data-testid="web-search-detail">
      {view.queries.map((q, i) => (
        <div key={i} className="rounded bg-[var(--bg-secondary)] px-2 py-1" data-testid="web-search-query">
          <div className="font-medium text-[var(--text-secondary)] break-words">{q.query}</div>
          {q.providers ? (
            <div className={`text-[11px] ${MUTED}`}>{t("providerLabel", { provider: q.providers }, `via ${q.providers}`)}</div>
          ) : null}
          {q.error ? <div className="text-[11px] text-red-400 break-words">{q.error}</div> : null}
          {q.answer ? (
            <div
              data-testid="web-search-answer"
              className="mt-1 text-[var(--text-secondary)] whitespace-pre-wrap break-words line-clamp-6"
            >
              {q.answer}
            </div>
          ) : null}
          {q.results.length > 0 ? (
            <ul className="m-0 mt-1 list-none space-y-1 p-0">
              {q.results.map((r, j) => (
                <li key={j} data-testid="web-search-result" className="min-w-0">
                  <div className="text-[var(--text-secondary)] break-words">{r.title}</div>
                  <div className="text-[11px]">
                    <UrlText raw={r.url} />
                  </div>
                  {r.snippet ? (
                    <div className={`text-[11px] ${MUTED} whitespace-pre-wrap break-words line-clamp-3`}>{r.snippet}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            !q.error && <div className={`text-[11px] ${MUTED}`}>{t("noResults", undefined, "No results")}</div>
          )}
          <More t={t} count={q.omittedResults} />
        </div>
      ))}
      <More t={t} count={view.omittedQueries} />
      <Skipped t={t} count={view.skipped} />
    </div>
  );
}

function FetchBody({ view, t }: { view: FetchView; t: T }) {
  return (
    <div className="space-y-1" data-testid="web-search-detail">
      <ul className="m-0 list-none space-y-1 p-0">
        {view.items.map((it, i) => (
          <li key={i} data-testid="web-search-fetch-item" className="rounded bg-[var(--bg-secondary)] px-2 py-1 min-w-0">
            <div className="text-[var(--text-secondary)] break-words">{it.title}</div>
            <div className="text-[11px]">
              <UrlText raw={it.url} />
            </div>
            {it.size !== null ? (
              <div className={`text-[11px] ${MUTED}`}>{t("sizeChars", { count: it.size }, `${it.size} chars`)}</div>
            ) : null}
            {it.error ? <div className="text-[11px] text-red-400 break-words">{it.error}</div> : null}
          </li>
        ))}
      </ul>
      <More t={t} count={view.omitted} />
      <Skipped t={t} count={view.skipped} />
    </div>
  );
}

export function WebSearchEntryCard({
  body,
  timestamp,
  entryId,
  expanded,
  onToggle,
  payload,
  payloadError,
  payloadLoading,
}: CustomEntryRendererProps): React.ReactElement {
  const t = useT();
  const summary = useMemo(() => summarizeBody(body), [body]);
  const view = useMemo(() => parseWebSearchPayload(payload), [payload]);

  const label =
    summary.type === "search"
      ? t("labelSearch", undefined, "Web search")
      : summary.type === "fetch"
        ? t("labelFetch", undefined, "Web fetch")
        : (payload as { type?: unknown } | undefined)?.type === "research"
          ? t("labelResearch", undefined, "Web research")
          : t("labelGeneric", undefined, "Web search results");
  const icon = summary.type === "fetch" ? mdiFileDownloadOutline : mdiWeb;

  const parts: string[] = [];
  if (summary.queries !== undefined) parts.push(plural(t, "queries", summary.queries, "{count} query", "{count} queries"));
  if (summary.results !== undefined) parts.push(plural(t, "results", summary.results, "{count} result", "{count} results"));
  if (summary.urls !== undefined) parts.push(plural(t, "urls", summary.urls, "{count} URL", "{count} URLs"));
  const summaryText = parts.join(" · ");

  const storedBody = (
    <pre data-testid="web-search-fallback-body" className={PRE_CLASS}>
      {body}
    </pre>
  );

  let bodyContent: React.ReactNode;
  if (payloadError) {
    bodyContent = (
      <div className="space-y-1">
        <div data-testid="web-search-error" className="text-[11px] text-red-400 break-words">
          {t("detailsUnavailable", { error: payloadError }, `Details unavailable: ${payloadError}`)}
        </div>
        {storedBody}
      </div>
    );
  } else if (payloadLoading) {
    bodyContent = (
      <div data-testid="web-search-loading" className={`px-2 py-1 text-xs ${MUTED} italic`}>
        {t("loading", undefined, "Loading…")}
      </div>
    );
  } else if (payload !== undefined) {
    bodyContent =
      view?.kind === "search" ? (
        <SearchBody view={view} t={t} />
      ) : view?.kind === "fetch" ? (
        <FetchBody view={view} t={t} />
      ) : (
        <pre data-testid="web-search-plain-payload" className={PRE_CLASS}>
          {payloadAsText(payload)}
        </pre>
      );
  } else {
    bodyContent = storedBody;
  }

  const headerInner = (
    <>
      <span aria-hidden className="inline-flex text-cyan-400">
        <Icon path={icon} size={0.55} />
      </span>
      <span data-testid="web-search-label" className="font-medium text-[var(--text-secondary)]">
        {label}
      </span>
      {summaryText ? (
        <span data-testid="web-search-summary" className="min-w-0 truncate text-[var(--text-muted)]">
          {summaryText}
        </span>
      ) : null}
      <span className="ml-auto shrink-0 text-[var(--text-tertiary)]">{new Date(timestamp).toLocaleTimeString()}</span>
      {entryId ? (
        <span aria-hidden className="shrink-0 text-[var(--text-muted)] inline-flex">
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className="my-1 mx-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] overflow-hidden text-xs"
      data-testid="web-search-entry"
      data-entry-id={entryId ?? ""}
    >
      {entryId ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          title={label}
          data-testid="web-search-toggle"
          aria-label={`${label}: ${expanded ? t("collapse", undefined, "Collapse entry") : t("expand", undefined, "Expand entry")}`}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--bg-secondary)] cursor-pointer"
        >
          {headerInner}
        </button>
      ) : (
        <div data-testid="web-search-header" title={label} className="w-full flex items-center gap-2 px-3 py-1.5 text-left">
          {headerInner}
        </div>
      )}
      {entryId && expanded && (
        <div className="px-2 pb-2 max-h-[420px] overflow-y-auto" data-testid="web-search-body">
          {bodyContent}
        </div>
      )}
    </div>
  );
}
