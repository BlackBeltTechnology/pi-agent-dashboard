## ADDED Requirements

### Requirement: One script tag embeds the chat

`GET /api/plugins/web-chat/public/widget.js` SHALL serve a self-contained script (no external requests other than to its own endpoint, at most 50 KB gzipped) that, after `window.WebChat.init({ endpoint, getCredential, title?, locale? })` (`endpoint` = the dashboard origin serving the plugin), renders a launcher and chat panel inside a shadow root. `getCredential` SHALL return `{ bearer }` or `{ token }`; the widget SHALL send it as `Authorization: Bearer` or `X-Web-Chat-Token` respectively, SHALL never put it in a URL, and SHALL call `getCredential` again on `401` before retrying once. The widget SHALL consume the stream (`GET stream?cid=<id>`) with `fetch`, reconnect with exponential backoff from 1 to 30 seconds, and re-fetch the credential before each reconnect.

#### Scenario: Credential never in URL
- **WHEN** the widget creates a conversation and opens its stream
- **THEN** no request URL SHALL contain the credential

#### Scenario: Expired credential refreshed
- **WHEN** a request answers `401`
- **THEN** the widget SHALL call `getCredential` once and retry with the new credential

### Requirement: The widget is accessible

The panel SHALL be operable by keyboard only, trap focus while open, close on `Escape` and return focus to the launcher, announce new assistant messages through an `aria-live="polite"` region, and meet WCAG 2.2 AA contrast (≥ 4.5:1 for text) in its default theme.

#### Scenario: Keyboard-only round trip
- **WHEN** a user opens the launcher with `Enter`, types a message, sends with `Enter` and closes with `Escape`
- **THEN** each step SHALL work without a pointer and focus SHALL return to the launcher
