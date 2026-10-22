# Spec Delta

## Purpose

One shared URL classification decides whether the dashboard client, its plugins, and the Electron shell may navigate to, open, or link a URL. Every navigation sink goes through that classification, and a CI guard keeps new raw sinks from appearing.

## ADDED Requirements

### Requirement: URL classification
The system SHALL classify any candidate navigation target (a link destination, an opened window, a page navigation, or an external open) into exactly one of `internal`, `loopback`, `external`, `mailto`, or `blocked`, relative to the current origin. Classification SHALL be pure and SHALL never throw. A value that cannot be parsed SHALL classify as `blocked`.

#### Scenario: Same-origin path is internal
- **WHEN** the candidate is `/settings/general` or `/folder/abc/view?path=README.md`
- **THEN** it classifies as `internal`

#### Scenario: Scheme-relative path is not internal
- **WHEN** the current origin is `https://dash.example` and the candidate is `//evil.example/x`
- **THEN** it classifies as `external`

#### Scenario: Scheme-relative same host is still not internal
- **WHEN** the current origin is `https://dash.example` and the candidate is `//dash.example/settings`
- **THEN** it does not classify as `internal`

#### Scenario: Backslash input is blocked
- **WHEN** the candidate contains a backslash anywhere, such as `/\evil.example` or `\\evil.example`
- **THEN** it classifies as `blocked`

#### Scenario: Loopback http target
- **WHEN** the candidate is `http://127.0.0.1:5173/`, `http://localhost:3000/`, or `http://[::1]:8080/`
- **THEN** it classifies as `loopback`

#### Scenario: Loopback forms are normalized
- **WHEN** the candidate is `http://0x7f.0.0.1/`, `http://2130706433/`, `http://localhost./`, or `http://app.localhost:5173/`
- **THEN** it classifies as `loopback`

#### Scenario: LAN http dashboard
- **WHEN** the candidate is `http://192.168.16.204:8000/`
- **THEN** it classifies as `external`

#### Scenario: Same origin wins over loopback
- **WHEN** the current origin is `http://localhost:8000` and the candidate is `http://localhost:8000/settings`
- **THEN** it classifies as `internal`

#### Scenario: No page origin
- **WHEN** a caller that has no page origin (the Electron main process) classifies `/settings` or `//evil.example/x`
- **THEN** it classifies as `blocked`

#### Scenario: Public https target
- **WHEN** the candidate is `https://github.com/org/repo/pull/1`
- **THEN** it classifies as `external`

#### Scenario: Script-capable and local schemes are blocked
- **WHEN** the candidate scheme is `javascript:`, `vbscript:`, `data:`, `blob:`, `file:`, or any scheme other than `http:`, `https:` or `mailto:`, compared case-insensitively and after trimming whitespace and control characters
- **THEN** it classifies as `blocked`

#### Scenario: Control characters are blocked
- **WHEN** the raw candidate contains TAB, CR, LF, or another C0 control character anywhere other than leading or trailing whitespace, for example `https://exa\tmple.com/` or `java\x01script:alert(1)`
- **THEN** it classifies as `blocked`, even though a URL parser would silently strip or encode the character

#### Scenario: Unparseable input
- **WHEN** the candidate is not a string, is empty, or cannot be parsed as a URL
- **THEN** it classifies as `blocked`

### Requirement: Navigation goes through the classification
Every client, plugin, and Electron code path that navigates the current page, opens a new browsing context, or renders a link whose target comes from a variable SHALL first classify the target. A `blocked` target SHALL NOT be navigated, opened, or rendered as an active link.

#### Scenario: Agent tool argument with a javascript URL
- **WHEN** a tool renderer displays a URL argument `javascript:alert(1)` supplied by an agent
- **THEN** the URL renders as inert text with no `href`
- **AND** activating it performs no navigation

#### Scenario: Open-in-new-tab with a blocked target
- **WHEN** a UI action asks to open `data:text/html,<script>…` in a new tab
- **THEN** no window is opened
- **AND** the user sees a non-blocking "link blocked" notice

#### Scenario: Relayed repository URL
- **WHEN** session metadata relayed from a pi session carries a pull-request URL with a `javascript:` scheme
- **THEN** the session card renders no active link for it

#### Scenario: Allowed external target opens without opener
- **WHEN** an `external` target is opened in a new browsing context
- **THEN** the new context has no `opener` reference and sends no referrer

### Requirement: Shared classification across surfaces
The client, the plugin runtime SDK, and the Electron shell's link handling SHALL use the same classification, so a given absolute URL gets the same verdict on every surface. Media sources and markdown link protocols outside navigation (image `data:`/`blob:` sources, `irc:`/`xmpp:` links) keep their existing rules.

#### Scenario: Same verdict in Electron and browser
- **WHEN** the same absolute URL is classified by the web client and by the Electron shell's external-link handler
- **THEN** both return the same class

#### Scenario: Markdown media unaffected
- **WHEN** markdown renders an image with a `data:image/png` source or a `pi-asset:` source
- **THEN** the image renders exactly as before this capability

#### Scenario: Plugins use the SDK chokepoint
- **WHEN** a dashboard plugin needs to open or link a variable URL
- **THEN** the plugin runtime SDK exposes the same link and open helpers the core client uses

### Requirement: CI guard against raw sinks
CI SHALL fail when browser-side source outside the allowlisted chokepoint and policy modules contains a raw navigation or HTML sink. That covers the client, client-utils, plugin client code, the plugin runtime's browser code, and plugin apps. Sinks include `window.open`, `location` assignment or navigation, a non-literal anchor `href`, `setAttribute` of `href`/`src`/`srcdoc`, raw HTML injection, and worker or eval construction from strings.

#### Scenario: New raw window.open is rejected
- **WHEN** a pull request adds `window.open(url)` to a client component outside the allowlist
- **THEN** the guard fails and names the file, the line, and the sanctioned helper

#### Scenario: Allowlisted policy module passes
- **WHEN** the chokepoint or Trusted Types policy module itself contains a raw sink
- **THEN** the guard passes

#### Scenario: Test files are exempt
- **WHEN** a raw sink appears in a test file
- **THEN** the guard ignores it

#### Scenario: Property navigation is flagged
- **WHEN** a component assigns `anchor.href = x`, `frame.src = x`, or `window.location = x` outside the chokepoints
- **THEN** the guard fails unless the line carries an annotation with a reason

#### Scenario: Variable anchor href is flagged
- **WHEN** a component renders `<a href={agentUrl}>` with a non-literal expression outside the chokepoints
- **THEN** the guard fails unless the line carries an annotation with a reason

#### Scenario: Comments and strings do not match
- **WHEN** `window.open(` appears only inside a comment or a string literal
- **THEN** the guard ignores it

#### Scenario: Annotated exception
- **WHEN** a line directly below `// client-sinks: allow — <reason>` contains a raw sink
- **THEN** the guard passes it, and an annotation without a reason fails
