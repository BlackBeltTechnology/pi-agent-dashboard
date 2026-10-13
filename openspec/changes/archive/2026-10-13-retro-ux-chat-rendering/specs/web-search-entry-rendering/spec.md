## MODIFIED Requirements

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

## ADDED Requirements

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
