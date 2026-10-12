# Test Plan — render-unclaimed-custom-entries

Stage: design   Generated: 2026-10-11

No clarification markers: every Triple below has concrete values.

> **Collateral:** `tests/e2e/subagent-fanout-admission.spec.ts` #F4 (and quarantined #F2) currently assert
> that the refusal `custom-entry-card` is VISIBLE. `diagnostics` defaults to hidden, so those assertions
> must be rewritten (F13). Without that, the e2e suite goes red.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | custom-event-groups: admission refusal resolves to diagnostics | decision-table | L1 | automated | shipped defaults | resolve `subagent-admission-refused`, `subagents:spawn`, `subagent-notification`, `web-search-results` | → `diagnostics`, `subagents`, `subagents`, `search`; `diagnostics.default === false` |
| E2 | custom-event-groups: existing config gains diagnostics hidden | state-transition | L1 | automated | stored file with the 5 old shipped groups; `seenShippedIds` lacks `diagnostics` | store load + merge | `diagnostics` appended as the LAST group with `default:false`; `seenShippedIds` now contains it; the file is rewritten |
| E3 | custom-event-groups: earlier user rule keeps claiming refusals | decision-table | L1 | automated | stored file with a user group `{id:"mine",pattern:"^subagent-"}` before the merge | merge, then resolve `subagent-admission-refused` | resolves to `mine`, not `diagnostics` |
| E4 | custom-event-groups: deleted group stays deleted (existing invariant) | state-transition | L1 | automated | stored file whose `seenShippedIds` contains `diagnostics` but whose groups lack it | store load | `diagnostics` NOT re-added; refusal resolves to `other` |
| E5 | custom-entry-rendering: structured view only for untruncated objects | decision-table | L1 | automated | bodies: `{"a":1,"b":"x"}`; `{"n":[1,2],"o":{"k":1}}`; `"«3 earlier lines hidden»\n{\"a\":1}"`; a 64 000-char string ending in `{"a":1}`; `[1,2]`; `42`; `null`; `{}`; `hello`; `{bad` | `parseFallbackObject(body)` | entries `[["a","1"],["b","x"]]`; `[["n","[1,2]"],["o","{\"k\":1}"]]` (compact); `null` for every other input |
| E6 | custom-entry-rendering: key count bounded | BVA | L1 | automated | objects with 1, 49, 50, 51, 120 keys | `parseFallbackObject` | entries.length 1/49/50/50/50; omitted 0/0/0/1/70 |
| E7 | custom-entry-rendering: ingest placeholders shown verbatim | EP | L1 | automated | body `{"__truncated":true,"reason":"size","thresholdBytes":262144}` and `{"answer":"ab…[9000 chars hidden]…yz","results":"[array truncated]"}` | `parseFallbackObject` | entries carry the placeholder strings unchanged; nothing is dropped or invented |
| E8 | web-search: collapsed counts never partial | decision-table | L1 | automated | bodies: search with 2 queries holding 5 + 3 results; search with `queries:"[array truncated]"`; search whose query #2 has `results:"[truncated: deep]"`; fetch with 4 `urlMetadata`; fetch with no `urlMetadata` and 3 `urls`; `type:"research"`; `type:"zzz"`; marker-prefixed body; ≥64 000-char body; invalid JSON | collapsed summary derivation | `{q:2,r:8}`; `{}`; `{q:2}` (no r); `{urls:4}`; `{urls:3}`; label-only ×5 |
| E9 | web-search: expanded list bounds | BVA | L1 | automated | payload query with 20 / 21 / 35 results; 20 / 21 queries; fetch with 50 / 51 URLs | build expanded view model | 20 shown, +0 / +1 / +15; 20 queries, +0 / +1; 50 URLs, +0 / +1 |
| E10 | web-search: older fetch shape | EP | L1 | automated | fetch payload `{urls:[{url,title,content:"abcd"}]}` | `parseWebSearchPayload` | FetchView item `{url,title,size:4,error:null}` |
| E11 | web-search: providers rendering | EP | L1 | automated | query with `providers:["exa","brave"]`; query with only `provider:"exa"` | view model | provider text `exa, brave`; `exa` |
| E12 | web-search: malformed items counted, not invented | EP | L1 | automated | search payload with results `[{title,url,snippet}, "x", null]` | `parseWebSearchPayload` | 1 valid result; `skipped === 2` |
| E13 | web-search: safe link allow-list | decision-table | L1 | automated | `https://example.com/a`, `http://x.org`, `HTTPS://Example.COM/a b`, `javascript:alert(1)`, `JAVASCRIPT:alert(1)`, ` javascript:alert(1)`, `\tjavascript:x`, `data:text/html,x`, `//host/x`, `https://trusted.com@evil.example/`, `https://u:p@x.org`, `not a url` | `safeHttpUrl` | the first 3 → normalized `href` (`https://example.com/a%20b` form for the 3rd); all others → `null` |
| E14 | web-search: real logged payload shapes parse | EP | L1 | automated | redacted fixtures captured from session logs: search, fetch(`urlMetadata`), fetch(`urls`), research | `parseWebSearchPayload` + collapsed derivation | search/fetch → typed views with expected counts; research → `null` view (label-only); no throw |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | custom-entry-rendering: object body → key/value list | EP | L1 | automated | `CustomEntryCard` body `{"cause":"cap","inFlight":2,"reason":"Refused…"}` | render | `[data-testid=custom-entry-card]` holds a `<dl>` with 3 `<dt>` (`cause`, `inFlight`, `reason`); `customType` label present; no `<pre>` |
| F2 | custom-entry-rendering: HTML-looking values inert | EP | L1 | automated | object values `<img src=x onerror=alert(1)>`, `[x](javascript:alert(1))` | render | text content contains both literals; the card contains 0 `img` and 0 `a` elements |
| F3 | custom-entry-rendering: plain-text paths unchanged | EP | L1 | automated | bodies: prose, a marker-prefixed object, a JSON array | render | single `<pre>` with the body verbatim; no `<dl>` |
| F4 | custom-entry-rendering: omitted-keys notice | BVA | L1 | automated | object with 51 keys | render | 50 `<dt>` elements and the visible text "1 more key" (i18n key) |
| F5 | custom-event-groups × rendering: diagnostics hidden by default | decision-table | L1 | automated | `CustomEntryRow` msg `{customType:"subagent-admission-refused",groupId:"diagnostics"}` | render with default prefs; then with `customEventGroups.diagnostics=true` | renders `null`; then a `custom-entry-card` |
| F6 | web-search: claimed row renders the card | EP | L1 | automated | `CustomEntryRow` with a registry holding the web-access claim; `web-search-results` row | render | `[data-testid=web-search-entry]` present; no `custom-entry-card` |
| F7 | web-search: disabled plugin degrades to fallback | EP | L1 | automated | same row; registry with no web-access claim | render | `custom-entry-card` with structured view present |
| F8 | web-search: hidden search group suppresses | decision-table | L1 | automated | same row with `customEventGroups.search=false` | render | renders `null` |
| F9 | web-search: collapsed renders without fetching | state-transition | L1 | automated | 50 collapsed `WebSearchEntryCard` rows with entry ids | render all | 0 calls to `fetch` / `fetchPayload`; each shows its summary text ("2 queries · 8 results") |
| F10 | web-search: expanded search detail | EP | L1 | automated | expanded, `payload` = search with 2 queries, one with `error:"rate limited"` | render | each query text, provider, answer and result title + snippet visible; "rate limited" visible |
| F11 | web-search: link rendering | decision-table | L1 | automated | expanded results with urls `https://example.com/a`, `javascript:alert(1)`, `https://t.com@evil.example/` | render | exactly 1 `a`, with `href="https://example.com/a"`, `target="_blank"`, `rel="noopener noreferrer"`, text = raw url; the other 2 render as text |
| F12 | web-search: markdown answer literal | EP | L1 | automated | answer `# Heading\n[x](https://evil)` | expanded render | no `h1`/`a` from the answer; literal text present |
| F13 | web-search: research payload plain text | EP | L1 | automated | expanded, `payload` `{type:"research",summary:"…",sources:[…]}` | render | single plain-text block containing `summary`; 0 `a` elements |
| F14 | web-search: no entry id → no expansion | state-transition | L1 | automated | row without `entryId` | render + attempt click on the header | no expand control (`aria-expanded` absent); `onToggle` never called |
| F15 | web-search: icons decorative | EP | L1 | automated | collapsed search and fetch rows | render | every `svg` has `aria-hidden="true"`; a text label is present |
| F16 | admission e2e collateral: refusal hidden by default, visible when enabled | state-transition | L3 | automated | faux scenario `[[faux:subagent-fanout-refused]]` | run the scenario; then enable "Diagnostics" in the View popover | no `custom-entry-card` with text `subagent-admission-refused` at first, while the refused tool card is still terminal with "Refused by host admission"; after enabling, the card is visible and shows `cause` and `cap` keys |
| F17 | web-search: live row in the harness, collapsed → expanded | state-transition | L3 | automated | new faux scenario emitting a `web-search-results` entry (2 queries, 8 results, one https link) between two tool calls | send the prompt; click the row | the row shows "2 queries · 8 results" inside the tool burst (not splitting it); after the click the result link has `rel="noopener noreferrer"`; exactly 1 payload request to `/api/sessions/:id/entry/:entryId` |
| F18 | web-search: replay parity | state-transition | L3 | automated | session from F17 | cold reload | same collapsed summary text; the expanded detail matches the live view |
| F19 | visual quality of the web-access card and key/value fallback across the 4 themes, light/dark | visual | — | manual-only | studio / earth / athlete / gradient × light/dark | a human inspects collapsed + expanded rows | [judgment: legible, aligned, consistent with OmEntryCard chrome — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | custom-entry-rendering: hostile body never breaks the transcript | fault-injection (parse) | L1 | automated | body of 20 000 nested `[` plus a `{` prefix; a body making `JSON.stringify` throw (mocked) | `parseFallbackObject` | returns `null`, does not throw |
| X2 | custom-entry-rendering: render-time throw contained | fault-injection (render) | L1 | automated | structured `<dl>` renderer forced to throw (mock) in a list with 2 sibling rows | render the list | the card shows the `<pre>` body; both siblings render; no error reaches the chat boundary |
| X3 | web-search: failed payload degrades to the stored body | fault-injection (abort) | L1 | automated | expanded with `payloadError:"entry not found"` and no payload | render | stored body as plain text + "entry not found" visible; no structured list |
| X4 | web-search: loading state | fault-injection (delay) | L1 | automated | expanded with `payloadLoading:true` | render | loading line visible; no structured list and no body |
| X5 | web-search: parser total on garbage | fault-injection (input) | L1 | automated | `null`, `7`, `"x"`, `[]`, `{type:"search",queries:{}}`, `{type:"search",queries:[null,{results:{}}]}`, `{type:"fetch",urlMetadata:[1]}` | `parseWebSearchPayload` | never throws; returns `null` or a view with `skipped` > 0 |
| X6 | web-search: renderer throw falls back (existing boundary) | fault-injection (render) | L1 | automated | `WebSearchEntryCard` forced to throw inside `CustomEntryRow` | render | generic `custom-entry-card` renders for that row |

### Packaging / registration

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | web-search: plugin registered and bundled | EP | L1 | automated | repo state after registration | run `bundled-plugins-complete`, `publish-allowlist-complete`, `publish-tarball-hygiene`, `plugin-registry-populated`, manifest-validator tests | all green; generated registry contains `{pluginId:"web-access", slot:"custom-entry-renderer", customType:"web-search-results"}` |
| R2 | web-search: i18n parity | EP | L1 | automated | en / zh-CN / hu catalogs | `i18n-lint --strict` + the plugin's catalog key-parity test | identical key sets; 0 violations |
| R3 | web-search: chunk budget | threshold | L1 | automated | production build | `mdi-chunk-size` test | under the cap (measured against origin/develop) |

---

## Coverage summary

- Requirements covered: 9/9 (custom-event-groups ×1 modified; custom-entry-rendering ×1 modified; web-search ×4 added + registration + collateral)
- Scenarios by class: edge 14 · perf 0 · frontend 19 · error 6 · packaging 3
- Scenarios by level: L1 38 · L2 0 · L3 3 · — 1
- Scenarios by disposition: automated 41 · manual-only 1

## New infra needed

- A faux scenario in `qa/fixtures/faux-scenarios.ts` that emits a `web-search-results` custom entry between two tool
  calls (exemplar: the om ledger scenario near line 454). This is a fixture, not a new harness.
