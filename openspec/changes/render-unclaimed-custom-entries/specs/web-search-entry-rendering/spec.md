## Purpose

Render the `pi-web-access` extension's `web-search-results` custom entries as compact, readable chat rows (searches with
answers and result links, fetches with URL metadata) instead of a raw JSON dump, via a dashboard plugin claiming the
`custom-entry-renderer` slot.

## ADDED Requirements

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
web-access label with no count. A list that was replaced by a truncation placeholder, a body that is
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
