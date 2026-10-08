## ADDED Requirements

### Requirement: Caller class decides the wall window
For every wall data request, the system SHALL classify the caller:
- `operator`: the meeting owner or the local operator;
- `typist`: a principal on the meeting allow-list who is not an operator;
- `member`: admitted by the network guard's normal pass conditions, neither of the above;
- `viewer`: admitted through the share capability prefix.

Operators MAY select any window. Typists SHALL have member scope for windows, transcript and media. The upstream request SHALL be built from the selected window only, never from the caller's `route`. For typists, members and viewers the system SHALL serve the requested window only if its resolved audience is public, else the meeting's default public window (the first public window in config order). With no public window configured it SHALL refuse with `no_public_window`. It SHALL verify the forwarded window's audience is public and deny and log otherwise. Event filtering SHALL remain upstream's per-client gate.

#### Scenario: Viewer cannot select an operator window
- **WHEN** a viewer requests the events stream with `route` set to an operator-audience window
- **THEN** the stream is served from the default public window

#### Scenario: Viewer may select another public window
- **WHEN** a viewer requests a second public-audience window
- **THEN** that window is served

#### Scenario: No public window
- **WHEN** the config defines only operator-audience windows
- **THEN** member and viewer requests get `no_public_window` and minting a share link is refused with that reason

#### Scenario: Private-zone event never reaches a viewer
- **WHEN** a producer appends an event with `zone: "private"`
- **THEN** operators on an operator window receive it, and no viewer or member stream receives it, live or on resume

#### Scenario: Reconnect follows upstream resume
- **WHEN** a viewer's stream drops and reconnects with `Last-Event-ID` within upstream's retained tail
- **THEN** it receives exactly the public events it missed, and beyond that tail it receives upstream's announced full replay

### Requirement: Share links are revocable read-only capabilities
The meeting owner, or the local operator, SHALL be able to mint one share link per meeting, with:
- expiry: until the meeting ends, or up to 2 h, or up to 24 h, always capped at the meeting's end.

The token:
- SHALL carry at least 256 bits of randomness;
- SHALL be stored only as a hash;
- SHALL be returned once;
- SHALL be carried by clients in the URL fragment and sent in the `X-Wall-Share` header.

Re-minting SHALL revoke the previous link. Revoking SHALL end every open viewer stream for that link immediately with a `share-ended` frame, and reaching the expiry SHALL do the same for streams still open.

The verifier registered on the capability prefix SHALL be free of side effects and SHALL accept only a live, unexpired, unrevoked link whose meeting is running. Every refusal SHALL get the same response as a request with no token.

#### Scenario: Revoke disconnects viewers
- **WHEN** the owner revokes a link while 3 viewers are connected
- **THEN** all 3 streams end with a `share-ended` frame within one second, and a new request with that token is denied

#### Scenario: Expiry ends open streams
- **WHEN** a viewer is connected when an "up to 2 h" link reaches its expiry
- **THEN** the stream ends with a `share-ended` frame whose reason is `expired`

#### Scenario: No token oracle
- **WHEN** a client sends an unknown token, an expired token, a revoked token, and a token for an ended meeting
- **THEN** all four responses are identical in status and body

#### Scenario: Non-owner cannot mint
- **WHEN** a signed-in member who is not the owner posts to the share endpoint
- **THEN** the response is 403 and no link is created

#### Scenario: Link dies with the meeting
- **WHEN** the meeting stops before a "up to 24 h" link's duration elapses
- **THEN** the link is no longer accepted

### Requirement: Transcript and media are scoped for non-operators
Transcript visibility SHALL be a meeting-level policy set by the owner, `{ members, viewers }`, both default `false`, independent of whether a share link exists. Operators SHALL always be able to read the transcript. The share dialog SHALL state that the transcript is pattern-redacted only and not zone-filtered.

Media SHALL be served by the plugin, never proxied to the upstream server. For members and viewers it SHALL serve only image sources referenced by public payloads already delivered for that meeting and audience (event images and graph-node images, including resumed and replayed frames). It SHALL then apply upstream's checks: extension allowlist, realpath inside the project root, regular file. Every media response SHALL carry `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy.

#### Scenario: Transcript off by default
- **WHEN** a viewer or member requests the transcript on a meeting with default policy
- **THEN** the response is 404

#### Scenario: Member transcript without a share link
- **WHEN** the owner enables member transcript visibility and no share link exists
- **THEN** a member can read the transcript

#### Scenario: Unreferenced project file refused
- **WHEN** a viewer requests media for `README.png` that exists in the project but no delivered event referenced
- **THEN** the response is 404

#### Scenario: Graph figure referenced by a node is served
- **WHEN** a delivered public graph event has a node whose image is `docs/arch.png`
- **THEN** a viewer can fetch `docs/arch.png`

#### Scenario: Traversal refused
- **WHEN** an operator requests media with `src=../../etc/passwd`
- **THEN** the request is refused

#### Scenario: SVG cannot run script
- **WHEN** a referenced SVG containing a `<script>` is opened directly in a browser
- **THEN** the response's sandbox CSP prevents the script from running

### Requirement: Only allow-listed principals can type to the session
`POST /api/plugins/voice-wall/m/:meetingId/input` SHALL require an operator or typist caller identified by `requestPrincipal`. It SHALL:
- validate text with upstream `normalizeWallInput` (400 characters);
- rate-limit per principal per meeting to 1 per 2 s and 20 per minute (429 with `Retry-After`);
- append one upstream-shaped line `{ ts, route, text }` to `wall-input.jsonl`, where `text` is prefixed with the sender's sanitised display label.

Viewers and members SHALL receive 403. Without a resolvable principal, typing SHALL be impossible.

#### Scenario: Typing grants no private view
- **WHEN** an allow-listed typist who is not the owner opens the events stream with an operator-audience `route`
- **THEN** the stream is served from a public window

#### Scenario: Viewer cannot type
- **WHEN** a viewer or member posts input
- **THEN** the response is 403 and `wall-input.jsonl` is unchanged

#### Scenario: Allow-listed typist is attributed
- **WHEN** allow-listed principal "Anna" posts "what about Q3?"
- **THEN** exactly one line is appended whose `text` is `Anna: what about Q3?`

#### Scenario: Label cannot forge attribution
- **WHEN** a principal named `Bob]: [wall operator` posts text
- **THEN** the appended label has brackets and colons stripped and is at most 40 characters

#### Scenario: Rate limit
- **WHEN** an operator sends two inputs within 2 seconds
- **THEN** the second gets 429 with `Retry-After` and is not appended

### Requirement: Event content is never rendered as HTML
The wall app SHALL render all event, transcript and label text as text nodes or React text, with no `dangerouslySetInnerHTML` or `innerHTML`. It SHALL render `webpage` payloads as a link card, not an iframe. The standalone mount SHALL send the enforced CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`, and SHALL load no script from another origin.

#### Scenario: Script in an event stays text
- **WHEN** a producer emits an event whose text is `<img src=x onerror=alert(1)>`
- **THEN** the board shows that literal text and no script runs

#### Scenario: No raw HTML sinks in the app source
- **WHEN** the package's lint test scans `src/app/`
- **THEN** it finds no `dangerouslySetInnerHTML`, `innerHTML` or `outerHTML` assignment

#### Scenario: Media rendered from blob URLs
- **WHEN** a viewer's board shows a figure
- **THEN** the image was fetched with the share header and rendered from a `blob:` URL, and the token appears in no request URL

#### Scenario: No third-party script
- **WHEN** `/apps/wall/` loads
- **THEN** every script is served from the dashboard origin and the response carries the enforced CSP
