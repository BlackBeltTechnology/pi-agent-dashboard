# Scenario-gate decisions — add-google-connect

Answers to the spec gaps found by scenario design (HARD gate). Each line is normative for tests and implementation; where a spec requirement names the behaviour, this file fixes the concrete value. "Gmail precedent" = existing gmail-plugin behaviour kept.

## Clients, selection, dialog (A)
| gap | decision |
|---|---|
| A1 env switch values | `off`, `0`, `false` (case-insensitive) disable; any other value = on, unknown values logged once as a warning |
| A2 / C7 Drive read/write on a built-in account | 400 `own_client_required` (server-enforced, not only UI) |
| A3 upload of an existing client id | secret (and redirect fields) update; label and domains kept |
| A4 client JSON errors | existing Gmail validator codes reused; a JSON with both `installed` and `web` is refused as invalid |
| A5 domain input | trim, lowercase, strip a leading `@`; an entry without a dot → `invalid_domain` |
| A6 project-id mismatch on upload | warning, upload accepted (Gmail precedent) |
| A7 unknown client id in a connect request | 404 `client_not_found` |
| A8 no product ticked | "Continue with Google" disabled until ≥1 product; server refuses an empty list with 400 `no_products` |
| A9 prompt on a new connect | `prompt=select_account consent` (account chooser always shown) |
| A10 / B5 flow lifetime | 300 s (Gmail precedent); dialog then shows "Sign-in timed out — try again" (code `timeout`) |
| A11 several own clients, built-in unavailable | nothing preselected; Continue disabled until a client is chosen |
| A12 email changed on re-auth (same subject) | stored email updated from the id token |
| A13 product off + grant needs re-auth | `product_disabled` first (no token needed) |
| A14 unknown/missing product in a lease | 400 `bad_request` |
| A15 two consents for the same account | second start refused 409 `consent_in_progress` |
| A16 product-change dialog | products already on are shown ticked and locked; turning one off happens in the account table |

## Return paths, disclosure, accounts, Gmail (B)
| gap | decision |
|---|---|
| B1 return page Copy | copies the full original return URL (held in memory, never rendered); the paste field accepts it |
| B2 return page with `error=` / missing code or state | shows "Google sign-in was cancelled" + Close; after the confirm click opens the dashboard's remote callback with `error` and `state` so the dialog stops waiting |
| B3 target origin from `state` | only `https:` origins or `http://localhost` / `http://127.0.0.1` (any port), no userinfo; anything else → generic error, no Continue control |
| B4 flow/state refusals | 400 `invalid_state` (unknown or mismatched state), 404 `unknown_flow`; disconnect of an unknown account 404 `not_found` |
| B6 restricted product requested on the remote built-in path (API) | 400 `restricted_scope_remote` |
| B7 own-client data-use text | none shown, nothing recorded |
| B8 disclosure acceptance | body-less `PUT`, server records its current version; a stored version newer than shipped counts as accepted; hub-local only (`origin_denied`) |
| B9 `error=access_denied` returned | flow ends; dialog shows "Google access was cancelled" with Retry |
| B10 account summary | catalogue order (Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts); none on → "No products on" |
| B11 reporting a Google-page error | "Window didn't come back?" fold-out offers "Google showed an error" with the fixed code list (Gmail precedent) |
| B13 store full during import | atomic: nothing imported, no marker, Gmail keeps leasing legacy, retried next start |
| B14 legacy accounts without a client | skipped (stay legacy-only), logged once |
| B15 / C1 retries | 3 attempts total; without `Retry-After` 500 ms ×2 with jitter; waits capped at 30 s; `Retry-After` > 30 s fails at once with `rate_limited` |
| B16 email in a connect request | one `@`, non-empty local part, domain with a dot, no whitespace, ≤ 254 chars; empty string = not given (Gmail precedent) |
| B17 store full on connect | pre-checked before Google opens for a new account; reconnect of an existing account allowed |
| B18 delegated lease fails | the existing Gmail error is returned; no fallback to legacy tokens for an imported account |
| B19 Gmail `dependsOn` | none (spec/design); tasks fixed accordingly |
| B20 later legacy accounts | every start imports legacy subs absent from `imported:gmail`; an empty legacy namespace writes no marker |
| B21 automatic-setup hand-off reasons | existing `HandoffReason` values unchanged |
| B22 / B23 client naming, publish step | existing behaviour unchanged (`pi-dashboard-<n>`; `publish` reported `skipped` for Internal) |
| B24 Gmail-off message | "Gmail is off for <email> in Settings → Google accounts" (spec text) |
| B25 410/503 rule scope | every `/api/plugins/gmail/*` management route; `GET /api/plugins/gmail/state` answers 200 with `moved: true` |

## Product tools (C)
| gap | decision |
|---|---|
| C2 retrying writes | retry 429 always; 5xx only for idempotent methods (GET, PUT, DELETE); POST never retried on 5xx |
| C3 confirm previews | text ≤ 500 chars, first 5 rows, ≤ 20 attendees/targets + "+N more" |
| C4 generic error codes | `calendar_error`, `drive_error`, `docs_error`, `sheets_error`, `slides_error`, `tasks_error`, `contacts_error` |
| C5 operation above level | `level_insufficient` naming Settings → Google accounts, before any HTTP call |
| C6 paging | Docs/Slides text 20 000 chars with `nextOffset`; lists 50 items with `nextPageToken` |
| C8 `gdrive_pick` at read/write level | works (returns picked ids) |
| C9 picker cancel/timeout | returns `{ files: [] }`; 5 min timeout; picks valid until disconnect |
| C10 invalid export format | `unsupported_export` listing the valid formats for that file type |
| C11 download writes | temp file in the target dir then rename; removed on failure; parent dirs created inside the workspace |
| C12 upload size | ≤ 5 MB (multipart); larger → `file_too_large` |
| C13 Docs text format | Markdown (`#` headings, `-` lists, pipe tables) |
| C14 replace with 0 matches | no confirmation; returns `no_match` with count 0 |
| C15 stale revision | mapped from the write's own 400 `FAILED_PRECONDITION` (Contacts: etag mismatch) → `revision_changed`; no pre-check |
| C16 revision id omitted | tool reads the current revision when the confirmation is shown and guards with it |
| C17 one row wider than the cell cap | at least one full row returned |
| C18 values vs range size | range = top-left anchor; extent derived from the values |
| C19 literal writes | `valueInputOption=RAW` unless formula evaluation is requested (`USER_ENTERED`) |
| C20 slide layouts | Google predefined layout enum; unknown → argument error listing valid values |
| C21 update with no change | success `unchanged: true`, no confirmation |
| C22 contact search | query passed verbatim; no warm-up |
