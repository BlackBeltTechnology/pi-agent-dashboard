# link-provider-recognition Specification

## Purpose
Recognises which service a web URL points to (GitHub, JIRA, YouTube, …) so chat links can show a provider icon and a short, readable label without changing where the link goes.

## Requirements

### Requirement: Classification is pure and offline

The system SHALL classify an http(s) URL into a provider, an icon and a display label using only the URL string. Classification MUST NOT make a network request, MUST NOT read configuration that the URL author controls, MUST return the same result for the same input, and MUST NOT throw: an unparseable URL classifies as generic with its original text as the label.

#### Scenario: no network access during classification
- **WHEN** a chat message containing `https://github.com/org/repo/pull/12` renders while the network is offline
- **THEN** the link SHALL render with the GitHub provider icon and label

#### Scenario: deterministic result
- **WHEN** the same URL is classified twice
- **THEN** both results SHALL be identical

#### Scenario: unparseable input
- **WHEN** the input is `https://[bad`
- **THEN** classification SHALL return the generic provider with label `https://[bad` and SHALL NOT throw

### Requirement: Known providers are recognised by host

The system SHALL recognise at least these providers by URL host: GitHub (`github.com`), GitLab (`gitlab.com`), JIRA (`*.atlassian.net` with a `/browse/<KEY>-<n>` path), YouTube (`youtube.com`, `youtu.be`), npm (`npmjs.com`), Stack Overflow (`stackoverflow.com`), Google Docs and Drive (`docs.google.com`, `drive.google.com`) and loopback hosts. Host matching MUST be exact or on a dot-boundary suffix.

#### Scenario: look-alike host is not recognised
- **WHEN** the URL is `https://github.com.evil.example/org/repo`
- **THEN** it SHALL NOT be classified as GitHub

#### Scenario: JIRA ticket on an Atlassian host
- **WHEN** the URL is `https://acme.atlassian.net/browse/PROJ-9`
- **THEN** it SHALL be classified as JIRA

#### Scenario: loopback URL
- **WHEN** the URL is `http://localhost:5173/app`
- **THEN** it SHALL be classified as a local server

### Requirement: Recognised URL shapes get a short label

For recognised shapes the system SHALL produce a short label: GitHub/GitLab pull request or issue → `<owner>/<repo>#<n>`; GitHub/GitLab repository → `<owner>/<repo>`; GitHub/GitLab file → `<owner>/<repo>: <file name>`; JIRA ticket → `<KEY>-<n> (<site>)` where `<site>` is the Atlassian subdomain; npm package → package name. Every other URL, including loopback URLs and recognised providers with other shapes, SHALL keep its full URL text as the label.

#### Scenario: GitHub pull request
- **WHEN** the URL is `https://github.com/org/repo/pull/123`
- **THEN** the label SHALL be `org/repo#123`

#### Scenario: GitHub file
- **WHEN** the URL is `https://github.com/org/repo/blob/main/src/a.ts`
- **THEN** the label SHALL be `org/repo: a.ts`

#### Scenario: JIRA ticket names its site
- **WHEN** the URL is `https://acme.atlassian.net/browse/PROJ-9`
- **THEN** the label SHALL be `PROJ-9 (acme)`

#### Scenario: unrecognised URL
- **WHEN** the URL is `https://example.com/docs/page`
- **THEN** the provider SHALL be generic and the label SHALL be `https://example.com/docs/page`

#### Scenario: loopback keeps its URL
- **WHEN** the URL is `http://localhost:50452/board.html`
- **THEN** the label SHALL be `http://localhost:50452/board.html`

### Requirement: Labels never hide the destination

A shortened label SHALL be used only when the visible link text is the URL itself. When the author wrote their own link text (a markdown `[text](url)` anchor), that text SHALL be kept and only the icon added. The visible text SHALL remain the accessible name. The full URL SHALL always be exposed as the tooltip and accessible description. The link target MUST be the original URL, unchanged.

#### Scenario: author-written link text is kept
- **WHEN** a markdown anchor `[the fix](https://github.com/org/repo/pull/123)` renders
- **THEN** the visible text SHALL be `the fix` preceded by the GitHub icon

#### Scenario: full URL in the tooltip
- **WHEN** a bare `https://github.com/org/repo/pull/123` renders as `org/repo#123`
- **THEN** its tooltip SHALL contain the full URL and its `href` SHALL equal the original URL

#### Scenario: copy keeps the original text
- **WHEN** the user selects and copies a message containing a shortened URL link
- **THEN** the copied text SHALL contain the original URL, not the short label

#### Scenario: partial selection of a label
- **WHEN** the user's selection covers only part of a shortened label
- **THEN** the copied text SHALL contain the whole original URL in its place
