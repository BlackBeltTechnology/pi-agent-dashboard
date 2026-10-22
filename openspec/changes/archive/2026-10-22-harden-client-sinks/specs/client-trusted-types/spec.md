# Spec Delta

## Purpose

The dashboard client produces every value bound for a script-capable DOM sink (HTML, script URLs, script text) through a small set of named Trusted Types policies, with a sanitizing default policy as a safety net. This lets the browser enforce sink discipline.

## ADDED Requirements

### Requirement: Policies registered before first render
When the browser supports Trusted Types, the client SHALL register its named policies and its `default` policy before the application renders. When the browser does not support Trusted Types, the client SHALL fall back to plain strings with identical rendered output.

#### Scenario: Supported browser
- **WHEN** the client boots in a browser exposing `trustedTypes`
- **THEN** the named policies and exactly one `default` policy exist before the first component renders

#### Scenario: Unsupported browser
- **WHEN** the client boots in a browser without `trustedTypes`
- **THEN** every preview, diagram, and editor renders exactly as without this capability
- **AND** app-owned HTML is still sanitized with its profile before injection
- **AND** no error is raised

### Requirement: App-owned sinks use named policies
Every application-owned HTML, script-URL, or script sink SHALL receive a trusted value created by a named policy chosen for that sink's context, never a raw string. The `default` policy is reserved for third-party library internals.

#### Scenario: Sanitized preview HTML
- **WHEN** an AsciiDoc preview, a DOCX preview, a server-rendered diagram preview, an inline math rewrite, an e-mail body frame, or a Mermaid diagram injects HTML
- **THEN** the value is produced by the sanitized-HTML policy using that sink's existing sanitizer configuration

#### Scenario: Mermaid colorize
- **WHEN** the Mermaid colorize step tints default nodes of renderer output
- **THEN** it works on a DOM produced by the sanitizer, with no string parse of the unsanitized output and no default-policy invocation
- **AND** the colorized result is still sanitized as the final step before injection

#### Scenario: Constant icon markup
- **WHEN** a plugin app renders an icon from a compile-time constant SVG map
- **THEN** the value is produced by the static-SVG policy from the constant map entry
- **AND** a key that is not in the map renders empty markup, as it does today

#### Scenario: Service-worker registration
- **WHEN** the client registers its service worker
- **THEN** the script URL is produced by the worker-URL policy

#### Scenario: Script URL allowlist
- **WHEN** app code, bundler-generated worker code, or a library (editor, PDF viewer) in a production build creates a worker or script URL
- **THEN** it is accepted only if it is same-origin and its path is `/sw.js` or a single `/assets/` file ending in `.js` or `.mjs`
- **AND** any other URL, including a same-origin `/api/` URL, is rejected

#### Scenario: Development build workers
- **WHEN** the editor or PDF viewer runs from the development server under enforcement
- **THEN** same-origin worker URLs that the development server serves for worker modules are also accepted, and `/api/` URLs are still rejected

### Requirement: Default policy follows the Trusted Types mode
The client SHALL learn the Trusted Types mode from the served document. In `report` mode the `default` policy SHALL return every input unchanged and only count the invocation, so rendered output is identical to having no policy. In `enforce` mode it SHALL apply the safety-net rules.

#### Scenario: Report mode is output-neutral
- **WHEN** Trusted Types is in `report` mode and a library assigns `<img src=x onerror=f()>` to an HTML sink
- **THEN** the value reaches the DOM unchanged and the invocation is counted

#### Scenario: Enforce mode sanitizes
- **WHEN** Trusted Types is in `enforce` mode and a library assigns the same value
- **THEN** the event handler is removed before the value reaches the DOM

#### Scenario: Mode unknown to the client
- **WHEN** the served document does not state a Trusted Types mode, as with a development server page
- **THEN** the client behaves as in `report` mode

### Requirement: Default policy is a sanitizing safety net under enforcement
In `enforce` mode the `default` policy SHALL pass through HTML strings that contain no `<`. It SHALL sanitize a string whose first element is `<svg` (skipping whitespace, an XML declaration, comments, and a doctype) using the Mermaid SVG sanitizer configuration, and every other HTML string with the HTML+SVG+MathML profile. It SHALL refuse script text and accept only allowlisted script URLs.

#### Scenario: Tag-free text passes unchanged
- **WHEN** a library assigns CSS text or plain text containing no `<` to an HTML sink
- **THEN** the value is used unchanged

#### Scenario: Library SVG keeps HTML labels
- **WHEN** a library assigns an SVG string containing `<foreignObject>` HTML labels
- **THEN** the labels survive sanitization

#### Scenario: Active content stripped
- **WHEN** a library assigns `<img src=x onerror=alert(1)>` to an HTML sink
- **THEN** the event handler is removed before the value reaches the DOM

#### Scenario: Script text refused
- **WHEN** code passes a string to `eval`, `new Function`, a `setTimeout` string, or a `javascript:` navigation while Trusted Types is enforced
- **THEN** the default policy returns no value and the browser blocks the call

#### Scenario: Cross-origin script URL refused
- **WHEN** code creates a worker or script from `https://cdn.example/x.js` while Trusted Types is enforced
- **THEN** the default policy returns no value and the browser blocks it

#### Scenario: Same-origin file route refused as a script
- **WHEN** code creates a worker from `/api/file/raw?path=payload.js` while Trusted Types is enforced
- **THEN** the default policy returns no value and the browser blocks it

### Requirement: Diagram output is unchanged under enforcement
With Trusted Types enforced, every supported Mermaid diagram type SHALL render pixel-identical to its rendering without Trusted Types, within the run-to-run variance of the same diagram rendered twice without Trusted Types.

#### Scenario: Flowchart keeps accent colorization
- **WHEN** a flowchart with HTML labels, a subgraph, and author `classDef` colors renders under enforcement
- **THEN** default nodes keep their theme accent tint and author colors are unchanged

#### Scenario: No silent degradation path
- **WHEN** a sanitized preview profile cannot reach parity with its no-Trusted-Types rendering
- **THEN** the sink is not switched to an unsanitized wrap, and the mismatch fails the visual check

#### Scenario: Diagram type matrix
- **WHEN** flowchart, sequence, class, state, ER, gantt, pie, mindmap, journey, gitGraph, timeline, quadrant, and xychart diagrams render under enforcement
- **THEN** each matches its no-Trusted-Types baseline

### Requirement: Violations are reported to the server
The client SHALL observe Trusted Types and CSP violations and default-policy invocations. It SHALL report them to the server in deduplicated, bounded batches over the authenticated API. Each report carries the directive, the sink name, the source file and line, and a count. It SHALL NOT carry any content sample. Reporting SHALL never block rendering.

#### Scenario: Violation in report mode
- **WHEN** an unpoliced sink receives a raw string while Trusted Types is in report mode
- **THEN** one aggregated report for that directive, sink, and source reaches the server within the batch interval

#### Scenario: Violation flood is bounded
- **WHEN** the same sink fires thousands of violations in a session
- **THEN** the client sends at most one report per flush interval (30 seconds, plus one on page hide), each carrying counts, not one report per violation

#### Scenario: Too many distinct keys in one flush
- **WHEN** 51 or more distinct (directive, sink, source) keys accumulate before a flush
- **THEN** the report carries the first 50 keys with their counts plus one `overflow` counter for the rest

#### Scenario: Server unreachable
- **WHEN** the report request fails
- **THEN** the batch is dropped and the UI is unaffected

### Requirement: Violation endpoint stores counters only
The server SHALL accept violation reports only from authenticated principals. It SHALL rate-limit them per principal, keep in-memory counters keyed by directive, sink, and source, and expose those counters to operators. It SHALL NOT persist raw samples.

#### Scenario: Unauthenticated report
- **WHEN** a request without a valid principal posts a violation report
- **THEN** the server rejects it and no counter changes

#### Scenario: Rate limit
- **WHEN** one principal posts more than 3 reports in a burst, or more than 12 within one minute
- **THEN** each excess report is rejected with HTTP 429 and no counter changes

#### Scenario: Oversized or malformed report
- **WHEN** a report exceeds the size limit or does not match the schema
- **THEN** the server rejects it without logging its body

### Requirement: Measured violation budget
The repository SHALL carry an automated browser check that loads the dashboard's core routes, file previews, settings and plugin settings pages, and plugin apps with Trusted Types in report mode. It SHALL fail when any route records a Trusted Types violation, or more `default`-policy invocations than its recorded per-route budget.

#### Scenario: New unpoliced sink
- **WHEN** a change introduces a raw `innerHTML` assignment in app code
- **THEN** the budget check fails because that route's `default`-policy invocations exceed its budget, and it names the route, sink, and source

#### Scenario: Harness validity
- **WHEN** the check runs
- **THEN** a separate control step expects and observes exactly one deliberate violation, which proves the directive is active
- **AND** that control violation does not count against any route's budget
- **AND** the check fails if any checked page shows the server-offline state
