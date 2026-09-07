# diagram-render-proxy Specification

## Purpose
Server-side text-to-diagram rendering through a Kroki instance: resolves the permitted endpoint, encodes diagram source, fetches and sanitizes SVG, caches responses, and declines cleanly when no endpoint is permitted — so the browser never contacts Kroki directly.

## Requirements

### Requirement: Kroki endpoint resolution ladder

The server SHALL resolve the diagram rendering endpoint in strict order: (1) an explicitly configured Kroki URL (config field or environment override, the override read live rather than only at first-run seeding); (2) if none is configured and remote rendering is explicitly opted in, the public `https://kroki.io`; (3) otherwise rendering is declined. The endpoint SHALL never be derived from request input.

#### Scenario: Configured URL wins
- **WHEN** a Kroki URL is configured and remote rendering opt-in is also set
- **THEN** the configured URL is used

#### Scenario: Remote opt-in fallback
- **WHEN** no Kroki URL is configured and remote rendering is opted in
- **THEN** `https://kroki.io` is used

#### Scenario: No endpoint permitted
- **WHEN** no Kroki URL is configured and remote rendering is not opted in
- **THEN** the render request is declined with a distinct, machine-readable "rendering unavailable" response (not a generic error)

#### Scenario: Request cannot choose the endpoint
- **WHEN** a render request carries any URL-like parameter
- **THEN** it has no effect on the endpoint used

### Requirement: Diagram render endpoint

The server SHALL expose a render endpoint that accepts diagram source text plus a declared diagram type, encodes it (deflate + base64url), fetches the SVG from the resolved Kroki endpoint via HTTP GET, sanitizes the returned SVG, and returns it to the client. The allowed type set SHALL initially be `plantuml` only; other types SHALL be rejected. Requests SHALL be bounded: source size capped, upstream fetch on an abort timeout, and concurrent upstream fetches capped — a hung endpoint resolves to the upstream-failure response. Diagram source SHALL never be executed locally.

#### Scenario: Oversized source rejected
- **WHEN** the submitted source exceeds the size cap
- **THEN** the request is rejected before any encoding or upstream contact

#### Scenario: Hung upstream times out
- **WHEN** the Kroki endpoint accepts the connection but never responds
- **THEN** the request resolves to the upstream-failure response within the timeout, not an indefinite hang

#### Scenario: PlantUML source renders to sanitized SVG
- **WHEN** valid PlantUML source is submitted with type `plantuml` and an endpoint is resolved
- **THEN** the response contains SVG that renders the diagram, with script content and event handlers removed

#### Scenario: Unsupported type rejected
- **WHEN** a request declares an unknown diagram type
- **THEN** the response is a 400 rejection without contacting the Kroki endpoint

#### Scenario: Upstream failure degrades cleanly
- **WHEN** the Kroki endpoint is unreachable or returns an error
- **THEN** the response is a distinct upstream-failure error (allowing the client to fall back to source view), and the failure is logged with latency

### Requirement: Render response caching

The server SHALL cache successful render responses keyed by diagram type + source content hash + endpoint, serving repeat requests from cache without contacting Kroki.

#### Scenario: Cache hit skips upstream
- **WHEN** the same diagram source is rendered twice
- **THEN** the second response is served from cache with no upstream request

#### Scenario: Changed source misses cache
- **WHEN** the diagram source changes by one byte
- **THEN** a fresh upstream render is fetched
