# DOX — packages/web-access-plugin/src/client

Files in this directory. One row per source file. See change: render-unclaimed-custom-entries.

| File | Purpose |
|------|---------|
| `body-limits.ts` | `CUSTOM_BODY_MAX_CHARS` (64 000) — mirror of the client reducer constant (plugin cannot import client). Drift pinned by `parse-web-search.test.ts`. |
| `index.tsx` | Client barrel. Exports `catalog` + `WebSearchEntryCard` (names referenced by the manifest claim). |
| `parse-web-search.ts` | Pure, total parsing. `summarizeBody(body)` — collapsed counts only when provably complete (every count needs `Array.isArray`; marker / ≥64 000 chars / bad JSON → `{}`). `parseWebSearchPayload(payload)` → `SearchView \| FetchView \| null` (research/unknown/garbage → `null`); bounds `MAX_QUERIES=20`, `MAX_RESULTS_PER_QUERY=20`, `MAX_FETCH_URLS=50`; malformed items counted in `skipped`. `safeHttpUrl(raw)` → normalized `href` for http(s) without credentials, else `null`. Never throws. |
| `WebSearchEntryCard.tsx` | `custom-entry-renderer` component (`data-testid="web-search-entry"`). Collapsed-first; expand control only with `entryId`. Expanded from `payload` only (body nested data is ingest-truncated); `payloadError` → stored body + reason; loading → loading line. Plain text; links only via `safeHttpUrl`, `rel="noopener noreferrer"`. Icons `aria-hidden`. |
