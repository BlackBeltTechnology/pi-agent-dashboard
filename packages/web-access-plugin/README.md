# @blackbelt-technology/pi-dashboard-web-access-plugin

Dashboard rendering for the [`pi-web-access`](https://www.npmjs.com/package/pi-web-access)
extension. It claims the `custom-entry-renderer` slot for `web-search-results` entries, so
web searches and fetches show up in chat as compact cards instead of a raw JSON dump.

## What it shows

- **Collapsed** (default): one line, derived from the stored row body — for example
  `Web search · 2 queries · 8 results` or `Web fetch · 4 URLs`. A count is shown only when it
  is provably complete; research entries and unknown subtypes show the label only.
- **Expanded** (only for rows that carry an entry id): built from the full payload, fetched
  on first expand.
  - Search: up to 20 queries, each with provider(s), answer, error and up to 20 results
    (title, link, snippet). Overflow shows "+N more".
  - Fetch: up to 50 URLs with title, size and error (both the `urlMetadata[]` and the older
    `urls[]` payload shapes).
  - Research / unknown subtypes: the payload as bounded plain text.
  - Payload unavailable: the stored body as plain text plus the failure reason.

## Safety

All text is rendered as plain text — no markdown, no HTML. Only `http(s)` URLs without
embedded credentials become links, opened with `rel="noopener noreferrer"`.

## Behaviour notes

- Client-only: no server part, no configuration.
- `requires.piExtensions: ["pi-web-access"]` is advisory (reported in the plugins UI). The
  claim stays active, so rows in old sessions still render.
- Rows are hidden or shown by the shipped `search` custom event group (visible by default).
- When this plugin is disabled, `web-search-results` rows fall back to the generic card,
  which shows JSON-object bodies as a key/value list.
