## MODIFIED Requirements

### Requirement: HTML preview is sandboxed without script execution

The `HtmlPreview` component SHALL render local `.html` files by framing a live-server **static target** for the file, so relative stylesheets, scripts and images resolve against the file's document root. The frame SHALL never carry `allow-same-origin`. On a surface that declares operator provenance (the preview overlay opened by a click, an editor tab last activated by the operator), it SHALL run scripts with open egress. On every other surface it SHALL use the restricted preview-egress policy. A "Static (no scripts)" mode SHALL render the same document with an empty sandbox. The component SHALL NOT populate `srcdoc` from file contents. HTML in chat content SHALL NOT be rendered by this component.

#### Scenario: Sandbox excludes scripts

- **GIVEN** a local `.html` file containing a `<script>` tag
- **WHEN** the user opens it and selects "Static (no scripts)"
- **THEN** the frame's sandbox is empty and the `<script>` does not execute

#### Scenario: Scripts run isolated on operator open

- **GIVEN** a local `.html` file whose script writes text into the page
- **WHEN** the user opens it from the file tree or by clicking a chat file link
- **THEN** the script runs and its output is visible
- **AND** the frame's sandbox does not contain `allow-same-origin`

#### Scenario: Undeclared surface is restricted

- **GIVEN** an agent-emitted preview card for a local `.html` file
- **WHEN** it renders without an operator click
- **THEN** it uses the restricted preview-egress policy

#### Scenario: Observe-tier reader still previews HTML

- **GIVEN** a browser authenticated with a tier that may read files but not control live servers
- **WHEN** it opens a local `.html` preview
- **THEN** the page renders as a static target

#### Scenario: Relative assets resolve

- **GIVEN** `mockups/a/index.html` linking `./style.css` and `img/logo.png`
- **WHEN** it opens in the chat preview overlay or the editor pane
- **THEN** both assets load and the page renders styled

#### Scenario: Chat HTML content NOT rendered

- **GIVEN** an agent message contains an `<html>` block in its content
- **WHEN** the message renders in `ChatView`
- **THEN** the existing markdown / text rendering path runs; the `HtmlPreview` component does NOT render chat content (HtmlPreview is only invoked for a local `.html` file target)

### Requirement: EmlPreview renders headers, isolated body, and attachments

The client SHALL provide an `EmlPreview` renderer (registered for `RendererKind "email"`)
that fetches `/api/file/eml`, displays the message headers (from, to, subject, date), renders
the sanitized body inside an `<iframe>` whose `sandbox` attribute is the **empty string**
(opaque origin — NOT `allow-same-origin`, and no `allow-scripts`, `allow-forms`,
`allow-top-navigation`, or `allow-popups`), and lists the attachments. This is deliberately
stricter than `HtmlPreview` (which may run scripts in an opaque origin for local `.html`)
because `.eml` bodies are untrusted sender HTML: an opaque origin removes any same-origin
access to `/api/*` from embedded refs. Header values SHALL be rendered as escaped text nodes
(never `dangerouslySetInnerHTML`). Like every other renderer, `EmlPreview` SHALL be wired
through `PreviewBody` so it is usable both inline within `PreviewCard` and full-screen within
the `/view` overlay, and SHALL NOT own navigation or surface chrome.

#### Scenario: Body rendered in an opaque-origin, script-free sandbox
- **GIVEN** an `.eml` whose body HTML (post-sanitize) is rendered by `EmlPreview`
- **WHEN** the component mounts
- **THEN** the body iframe's `sandbox` attribute is exactly `""` (empty — no `allow-same-origin`,
  no `allow-scripts`) and no body script executes and the body has no same-origin API access

#### Scenario: Header values are escaped, not HTML
- **GIVEN** an `.eml` whose decoded Subject header contains `<img src=x onerror=alert(1)>`
- **WHEN** `EmlPreview` displays the headers
- **THEN** the subject is shown as literal text (escaped); no element is created from it

#### Scenario: Headers displayed
- **WHEN** `EmlPreview` renders a parsed `.eml`
- **THEN** the from, to, subject, and date headers are shown

#### Scenario: Same component in both shells
- **GIVEN** the inline `PreviewCard` displays an `.eml` target
- **WHEN** the user activates the `⤢ expand` affordance
- **THEN** the `/view` overlay mounts the SAME `EmlPreview` component with the same `target` prop
