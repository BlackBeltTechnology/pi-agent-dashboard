## ADDED Requirements

### Requirement: Raw active-content responses are sandboxed

When `GET /api/file/raw` serves a scriptable media type (`text/html`, `image/svg+xml`, `application/xhtml+xml`, `application/xml`, `text/xml`), the response SHALL carry an enforced `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'` and `X-Content-Type-Options: nosniff` on every admission path, for 200 and 206, in every CSP mode. Other media types SHALL NOT carry this policy.

#### Scenario: Active-content raw responses carry the sandbox headers

- **GIVEN** `evil.svg` (containing `<script>` and an `onload` handler), `page.html`, `page.HTM` and `LOGO.SVG` exist inside a known cwd
- **WHEN** the client requests each from `/api/file/raw`
- **THEN** each response carries the sandbox `Content-Security-Policy` and `X-Content-Type-Options: nosniff`
- **AND** the `Content-Type` and the body bytes are unchanged

#### Scenario: Script-bearing SVG opened directly cannot run in the dashboard origin

- **GIVEN** `evil.svg` inside a known cwd contains a `<script>` that writes a marker to `document.title`
- **WHEN** a browser navigates directly to `/api/file/raw?cwd=…&path=evil.svg`
- **THEN** the marker is never written
- **AND** the document's `window.origin` is `"null"` (opaque), not the dashboard origin

#### Scenario: XML document types are classified as scriptable

- **GIVEN** the raw route's MIME mapping yields `application/xhtml+xml`, `application/xml`, `text/xml`, `TEXT/HTML; charset=utf-8` or `image/svg+xml`
- **WHEN** the route decides whether to apply the sandbox policy
- **THEN** each of those media types is treated as scriptable, and `text/plain`, `application/pdf`, `image/png` and `application/octet-stream` are not

#### Scenario: Ranged SVG response is sandboxed

- **GIVEN** `big.svg` exists inside a known cwd
- **WHEN** the client requests it with `Range: bytes=0-99`
- **THEN** the response status is 206 and it carries the sandbox `Content-Security-Policy` and `X-Content-Type-Options: nosniff`

#### Scenario: SVG admitted via the artifact root is sandboxed

- **GIVEN** `shot.svg` lives under an artifact root and outside every cwd and git root
- **WHEN** the client requests it from `/api/file/raw`
- **THEN** the response carries the sandbox `Content-Security-Policy` and `X-Content-Type-Options: nosniff`

#### Scenario: Grant-admitted HTML is sandboxed

- **GIVEN** `page.html` lives outside the session's cwd and git root and is admitted by an access grant
- **WHEN** the client requests it from `/api/file/raw`
- **THEN** the response carries the sandbox `Content-Security-Policy` and `X-Content-Type-Options: nosniff`

#### Scenario: Image preview of SVG keeps rendering

- **GIVEN** `logo.svg` with an inline `<style>` exists inside a known cwd
- **WHEN** the file preview renders it as an image from `/api/file/raw`
- **THEN** the rendered image has non-zero natural width and height

#### Scenario: Non-active types do not get the sandbox policy

- **GIVEN** `foo.pdf` and `photo.png` exist inside a known cwd
- **WHEN** the client requests each from `/api/file/raw`
- **THEN** neither response carries the sandbox `Content-Security-Policy`

#### Scenario: Sandbox policy holds in every CSP mode

- **WHEN** the client requests an `.svg` from `/api/file/raw` with the dashboard CSP mode `enforce`, `report` or `off`
- **THEN** the `Content-Security-Policy` header is the sandbox policy in all three modes, with `X-Content-Type-Options: nosniff`
- **AND** in `report` mode the response also carries the baseline `Content-Security-Policy-Report-Only`
