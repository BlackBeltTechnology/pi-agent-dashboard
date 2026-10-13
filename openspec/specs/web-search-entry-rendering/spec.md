# web-search-entry-rendering Specification

## Purpose
Render the `pi-web-access` extension's `web-search-results` custom entries as compact, readable chat rows (searches with
answers and result links, fetches with URL metadata) instead of a raw JSON dump, via a dashboard plugin claiming the
`custom-entry-renderer` slot.

## Requirements

### Requirement: The web-access plugin SHALL claim web-search-results rows
A dashboard plugin SHALL claim the `custom-entry-renderer` slot for the `customType` `web-search-results`. The plugin
SHALL declare the `pi-web-access` pi extension as an advisory requirement; the claim SHALL remain active when that
extension is not installed, so rows in existing transcripts still render. Its rows SHALL remain subject to the
`search` custom event group gate exactly as fallback rows are.

#### Scenario: claimed row renders the web-access card
- **GIVEN** the web-access plugin is enabled
- **WHEN** a `web-search-results` row renders
- **THEN** the web-access card SHALL render it
- **AND** the generic fallback card SHALL NOT render for that row

#### Scenario: historical row renders without the extension installed
- **GIVEN** the web-access plugin is enabled and `pi-web-access` is not installed
- **WHEN** a transcript containing a `web-search-results` row is opened
- **THEN** the web-access card SHALL render it

#### Scenario: disabled plugin degrades to the generic fallback
- **GIVEN** the web-access plugin is disabled
- **WHEN** a `web-search-results` row renders
- **THEN** the generic fallback card SHALL render it

#### Scenario: claimed row is absorbed into a tool burst and renders identically
- **GIVEN** a `web-search-results` row between tool calls of the same burst
- **WHEN** the chat groups bursts
- **THEN** the row SHALL be absorbed into the burst rather than splitting it
- **AND** inside the expanded burst it SHALL offer the same collapsed presentation and expand affordance as at top level

#### Scenario: hidden search group suppresses the card
- **GIVEN** the `search` group's effective visibility is `false`
- **WHEN** a `web-search-results` row would render
- **THEN** nothing SHALL render for it

### Requirement: The collapsed row SHALL summarize without fetching and without partial counts
The collapsed row SHALL be derived from the row body alone and SHALL NOT fetch the payload. For a payload of
`type: "search"` it SHALL show a search label, the number of queries when the queries list is intact, and the total
number of results only when every query's results list is intact. For `type: "fetch"` it SHALL show a fetch label and
the number of URLs when the URL list (`urlMetadata`, or `urls` in the older shape) is intact. Any other `type` (including `research`) SHALL show the generic
web-access label with no count. When any query (search) or URL entry (fetch) carries a non-null `error`, the summary SHALL
append "· N failed" (translated, pluralised); the failed count SHALL be shown only when the list is intact and every item is
an object, and SHALL be omitted when it is zero. A list that was replaced by a truncation placeholder, a body that is
truncated or does not parse, or an unrecognized `type` SHALL yield the label with the affected count omitted — a
count SHALL never be derived from partial data.

#### Scenario: search summary
- **GIVEN** an untruncated body with `type: "search"`, 2 queries whose results lists hold 5 and 3 items
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the search label with "2 queries" and "8 results"

#### Scenario: fetch summary
- **GIVEN** an untruncated body with `type: "fetch"` and 4 URL entries
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the fetch label with "4 URLs"

#### Scenario: older fetch shape is counted
- **GIVEN** an untruncated body with `type: "fetch"`, no `urlMetadata`, and 3 entries in `urls`
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the fetch label with "3 URLs"

#### Scenario: placeholder results list omits the result count
- **GIVEN** a search body in which one query's results list was replaced by a truncation placeholder string
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the query count and SHALL NOT show a result count

#### Scenario: research subtype shows the label only
- **GIVEN** an untruncated body with `type: "research"`
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the generic web-access label with no count

#### Scenario: truncated body shows no count
- **GIVEN** a body that was truncated at row creation
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the label with no count
- **AND** no payload request SHALL be issued

#### Scenario: failed queries are counted
- **GIVEN** an untruncated search body with 3 queries, one with a non-null `error`, holding 2 results in total
- **WHEN** the row renders collapsed
- **THEN** it SHALL show "3 queries · 2 results · 1 failed"
- **AND** no payload request SHALL be issued

#### Scenario: failed count is never partial
- **GIVEN** a fetch body whose URL list is the older `urls` shape of plain strings
- **WHEN** the row renders collapsed
- **THEN** it SHALL show the URL count and SHALL NOT show a failed count

### Requirement: The expanded row SHALL show query and fetch detail from the full payload
On expansion the card SHALL render structured detail only from the fetched full payload, never from the row body. For
a search it SHALL list at most 20 queries, stating how many more were omitted, each with its text, provider, answer text, per-query error when present, and its results
(title, link, snippet), listing at most 20 results per query and stating how many more were omitted. For a fetch it
SHALL list at most 50 URLs, stating how many more were omitted, each with its title, content length, and error when
present, from either URL list shape. A payload of any other `type` (including
`research`) SHALL be presented as plain text bounded to the same display ceiling as row bodies. Items that cannot be interpreted SHALL be
skipped and their number stated. A row with no entry id SHALL offer no expand affordance. When the payload request
fails, the card SHALL present the stored body as plain text together with the failure reason.

#### Scenario: expanded search lists queries and results
- **GIVEN** an expanded search row whose payload has queries with results
- **WHEN** it renders
- **THEN** each query text SHALL appear with its provider (or providers) and answer, and each listed result with its title and snippet

#### Scenario: per-query error is visible
- **GIVEN** a query whose `error` is non-null
- **WHEN** the expanded row renders
- **THEN** that query SHALL show its error text

#### Scenario: results per query are bounded
- **GIVEN** a query with 35 results in the payload
- **WHEN** the expanded row renders
- **THEN** 20 results SHALL be listed followed by an indication that 15 more were omitted

#### Scenario: research payload renders as plain text
- **GIVEN** an expanded row whose payload has `type: "research"`
- **WHEN** it renders
- **THEN** the payload SHALL appear as plain text with no structured view and no links

#### Scenario: failed fetch degrades to the stored body
- **GIVEN** an expanded row whose payload request fails
- **WHEN** it renders
- **THEN** the stored body SHALL render as plain text together with the failure reason

#### Scenario: row without an entry id offers no expansion
- **GIVEN** a `web-search-results` row carrying no entry id
- **WHEN** it renders
- **THEN** the collapsed summary SHALL render
- **AND** no expand affordance SHALL be offered and no payload request SHALL be issued

#### Scenario: malformed items are counted, not invented
- **GIVEN** a payload in which one result is not an object
- **WHEN** the expanded row renders
- **THEN** the valid results SHALL render and the card SHALL state that 1 item could not be displayed

### Requirement: Extension-authored content SHALL render safely
All payload text (queries, providers, answers, titles, snippets, errors) SHALL render as PLAIN TEXT — no markdown
interpretation, no HTML injection. A result or fetch URL SHALL render as a clickable link only when it parses as an
absolute URL whose scheme is `http` or `https` and that carries no embedded user name or password; the link target
SHALL be the normalized URL while the visible link text SHALL be the original string, opening in a new browsing
context with `rel="noopener noreferrer"`. Any other URL SHALL render as plain text. Answer and snippet text SHALL be
visually bounded so one entry cannot grow the chat unboundedly. Malformed payload content SHALL never break rendering
of the transcript.

#### Scenario: http(s) result becomes a safe link
- **GIVEN** a result with `url: "https://example.com/a"`
- **WHEN** the expanded row renders
- **THEN** it SHALL render a link to that URL with `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: non-http URL stays text
- **GIVEN** a result whose url is `"javascript:alert(1)"`, `"JAVASCRIPT:alert(1)"`, `" javascript:alert(1)"`, `"data:text/html,x"`, `"//host/x"`, or `"https://trusted.com@evil.example/"`
- **WHEN** the expanded row renders
- **THEN** the URL SHALL appear as plain text and no link SHALL be created

#### Scenario: markdown answer is not interpreted
- **GIVEN** an answer containing `# Heading` and `[x](https://evil)`
- **WHEN** the expanded row renders
- **THEN** the answer SHALL appear as literal text

### Requirement: Web-search row conforms to the UI contract in every state
The web-search row SHALL contain no Tailwind palette class, hex or `rgba(` literal, and SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` in these states: collapsed, expanded search (answer, results, per-query error, no results), fetch with a failed URL, loading, payload unavailable, and skipped items. Specifically:
- the header icon SHALL use `--text-secondary`; the summary, provider, snippet and size text SHALL use `--text-secondary`, not `--text-muted`;
- the header time and any text inside a button or link SHALL be at least 12 px;
- result and fetch links SHALL use `--link` (`--link-hover` on hover, `ui-contract.md` link row, as markdown links in chat), be underlined, carry an `aria-hidden` external-link icon and the visually hidden text "(opens in a new tab)", and keep `target="_blank" rel="noopener noreferrer"`;
- per-query and per-fetch errors SHALL render as error-severity pills with an icon;
- the loading state SHALL be a `role="status"` element with a spinner and "Loading details…";
- when the payload is unavailable, the row SHALL show a warning-severity notice that names the reason and says the summary saved with the chat is shown, followed by the stored body (`custom-entry-rendering` "Payload unavailability SHALL degrade to the stored body");
- the row's left edge SHALL align with the left edge of the tool-call rows around it, both standalone and when absorbed into a tool burst.

#### Scenario: Errors use the severity family
- **WHEN** an expanded row contains a query error and a fetch error
- **THEN** both errors render as pills whose computed colours equal the active theme's `--severity-error-fg` and `--severity-error-bg`

#### Scenario: Evicted payload is a warning, not an error
- **WHEN** the payload request returns 404 for an evicted entry
- **THEN** a warning-severity notice states that full details are no longer stored and the saved summary is shown, and the stored body follows it

#### Scenario: Links are recognisable without colour
- **WHEN** an expanded search shows a result with an http(s) URL
- **THEN** the link is underlined in `--link`, has an external-link icon, and its accessible name ends with "(opens in a new tab)"

#### Scenario: Row aligns with the tool timeline
- **WHEN** a web-search row renders between two tool-call rows, at 1440 px and at 375 px
- **THEN** the row's left edge equals the tool-call rows' left edge

#### Scenario: Absorbed row keeps the burst inset
- **WHEN** a web-search row is absorbed into a tool burst
- **THEN** its left edge equals the left edge of the other rows inside that burst

#### Scenario: Collapsed row still does not fetch
- **WHEN** the restyled row is rendered collapsed
- **THEN** no payload request is made until the user expands it
