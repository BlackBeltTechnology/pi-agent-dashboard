# client-api-response-validation

## ADDED Requirements

### Requirement: Client fetch helpers validate response before parsing JSON

The dashboard client SHALL provide a shared `fetchJson<T>` helper (`packages/client/src/lib/fetch-json.ts`) that wraps `fetch` and validates the response BEFORE calling `res.json()`. The helper SHALL parse and return JSON ONLY when both conditions hold: the response is ok (`res.ok === true`) AND the response `content-type` includes `application/json`. When either condition fails, the helper SHALL NOT call `res.json()`; it SHALL instead throw a typed `ApiHttpError` carrying `status`, `statusText`, `contentType`, and a bounded `bodySnippet` of the response body. The thrown error's `message` SHALL name the real HTTP status (e.g. `HTTP 504 Gateway Timeout`) rather than a JSON-syntax error.

This closes the gap where a non-JSON response (a reverse-proxy / gateway HTML error page such as `<html><head>…` with no `<!DOCTYPE>`, an SPA-fallback page, an empty body, or a misrouted `/api/*` request) is parsed as JSON and surfaces to the user as `Unexpected token '<', "<html> <h"... is not valid JSON`.

#### Scenario: 2xx JSON response is parsed and returned
- **GIVEN** a request whose response has status 200 and `content-type: application/json`
- **WHEN** the body is valid JSON `{ "success": true, "data": [...] }`
- **THEN** `fetchJson` SHALL return the parsed object as `T`
- **AND** SHALL NOT throw

#### Scenario: Non-2xx response with an HTML body throws a typed error, not a JSON parse error
- **GIVEN** a request whose response has status 504 and `content-type: text/html`
- **AND** the body begins with `<html><head><title>504 Gateway Timeout</title>`
- **WHEN** `fetchJson` processes the response
- **THEN** it SHALL throw an `ApiHttpError`
- **AND** the error `status` SHALL be `504`
- **AND** the error `message` SHALL name the HTTP status (not `Unexpected token '<'`)
- **AND** `res.json()` SHALL NOT have been called

#### Scenario: 2xx response with a non-JSON content-type throws (SPA fallback / misroute)
- **GIVEN** a request whose response has status 200 but `content-type: text/html`
- **AND** the body is an HTML page (e.g. the SPA `index.html` returned by a misrouted `/api/git/*` request)
- **WHEN** `fetchJson` processes the response
- **THEN** it SHALL throw an `ApiHttpError`
- **AND** the error `contentType` SHALL identify the actual content-type
- **AND** `res.json()` SHALL NOT have been called

#### Scenario: Empty body does not surface as a cryptic parse error
- **GIVEN** a response with status 502 and an empty or non-JSON body
- **WHEN** `fetchJson` processes the response
- **THEN** it SHALL throw an `ApiHttpError` whose `message` names the status
- **AND** SHALL NOT throw a native JSON `SyntaxError`

#### Scenario: bodySnippet is bounded
- **GIVEN** an error response whose body is a large (>10 KB) HTML page
- **WHEN** `fetchJson` constructs the `ApiHttpError`
- **THEN** `bodySnippet` SHALL be truncated to a bounded length (≈200 chars)
- **AND** the full body SHALL NOT be retained on the error

### Requirement: Worktree dialog load failures surface the real HTTP error

The worktree-spawn dialog's prerequisite loads (`fetchWorktrees`, `fetchGitHead`, `fetchBranches` in `packages/client/src/lib/git-api.ts`) SHALL route through `fetchJson`. When one of those requests returns a non-JSON response, the dialog's `loadError` SHALL render the real HTTP status/message rather than `Unexpected token '<', "<html> <h"... is not valid JSON`.

#### Scenario: Worktree dialog shows HTTP status on a gateway error
- **GIVEN** the `+Worktree Session` dialog opens
- **AND** `GET /api/git/worktrees?cwd=…` returns status 504 with an HTML body
- **WHEN** the dialog's parallel prerequisite load runs
- **THEN** `loadError` SHALL contain the HTTP status (e.g. `HTTP 504`)
- **AND** SHALL NOT contain `Unexpected token '<'`

#### Scenario: Status-branching helpers retain their semantics
- **GIVEN** `checkoutBranch` issues `POST /api/git/checkout` and the server replies 409 with `{ "dirty": true, "files": [...] }`
- **WHEN** the helper processes the response
- **THEN** it SHALL still return the dirty-result union (`{ success: false, dirty: true, files }`)
- **AND** the content-type guard SHALL NOT convert this valid JSON 409 into an `ApiHttpError`
