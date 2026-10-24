# client-trusted-types Specification

## Purpose
The dashboard client produces every value bound for a script-capable DOM sink (HTML, script URLs, script text) through a small set of named Trusted Types policies, with a sanitizing default policy as a safety net. This lets the browser enforce sink discipline.

## Requirements

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
The client SHALL learn the Trusted Types mode from the served document. In `report` mode the `default` policy SHALL return every input unchanged and only count the invocation, so rendered output is identical to having no policy. In `report` mode it SHALL additionally classify what `enforce` mode would have done with the input (shadow evaluation) into exactly one of the outcomes `would-block-script`, `would-block-script-url`, `would-alter-html`, `would-throw-html`, `not-evaluated` or `shadow-error`, or into no outcome when enforcement would leave the input intact. Shadow evaluation SHALL NOT change the returned value, SHALL NOT throw into the sink, SHALL NOT re-enter itself, and SHALL NOT change the count of `default`-policy invocations. Shadow evaluation SHALL use its own sanitizer state, separate from the sanitizer behind the named policies. In a browser with Trusted Types it MAY hold one module-private, parse-only policy that feeds only that sanitizer's inert parse and is never applied to a document sink. In `enforce` mode it SHALL apply the safety-net rules. In `off` and `enforce` modes it SHALL NOT perform shadow evaluation.

#### Scenario: Report mode is output-neutral
- **WHEN** Trusted Types is in `report` mode and a library assigns `<img src=x onerror=f()>` to an HTML sink
- **THEN** the value reaches the DOM unchanged and the invocation is counted

#### Scenario: Enforce mode sanitizes
- **WHEN** Trusted Types is in `enforce` mode and a library assigns the same value
- **THEN** the event handler is removed before the value reaches the DOM

#### Scenario: Mode unknown to the client
- **WHEN** the served document does not state a Trusted Types mode, as with a development server page
- **THEN** the client behaves as in `report` mode

#### Scenario: Shadow outcome for altered HTML
- **WHEN** Trusted Types is in `report` mode and a library assigns `<img src=x onerror=f()>` to an HTML sink
- **THEN** the value reaches the DOM unchanged
- **AND** one `would-alter-html` outcome is counted for that call's source

#### Scenario: Shadow outcome for dropped leading head content
- **WHEN** Trusted Types is in `report` mode and a library assigns `<style>p{color:red}</style><p>x</p>` to an HTML sink
- **THEN** the value reaches the DOM unchanged
- **AND** one `would-alter-html` outcome is counted, because enforcement would drop the leading `<style>`

#### Scenario: Shadow ignores HTML the enforce rules keep intact
- **WHEN** Trusted Types is in `report` mode and a library assigns tag-free text, or HTML that enforcement would neither strip nor drop
- **THEN** no shadow outcome is counted for that call

#### Scenario: Shadow outcome for script text
- **WHEN** Trusted Types is in `report` mode and code passes a string through the `default` policy's script-text path
- **THEN** the string is returned unchanged
- **AND** one `would-block-script` outcome is counted

#### Scenario: Shadow outcome for a non-allowlisted script URL
- **WHEN** Trusted Types is in `report` mode and code creates a worker from a same-origin URL outside the script-URL allowlist, such as `/plugin-assets/x/abc/worker.js`
- **THEN** the URL is returned unchanged
- **AND** one `would-block-script-url` outcome is counted
- **AND** an allowlisted URL such as `/assets/editor.worker.js` counts no shadow outcome

#### Scenario: Shadow sanitizer unavailable
- **WHEN** Trusted Types is in `report` mode and the enforce sanitizer cannot run
- **THEN** the input is returned unchanged and no error reaches the sink
- **AND** one `would-throw-html` outcome is counted

#### Scenario: Repeated input is classified once and still counted
- **WHEN** the same HTML string reaches the `default` policy many times while it stays in the classification memo
- **THEN** the enforce sanitization runs for it at most once
- **AND** every call counts the outcome classified for that string

#### Scenario: A late unsafe input at a busy call site is still classified
- **WHEN** one call site passes 150 distinct safe HTML strings and then one string carrying an event handler, all within one 30-second window and within its time and size budget
- **THEN** that last call counts `would-alter-html`

#### Scenario: Budget exhaustion is visible
- **WHEN** the current 30-second report window has already used its classification budget (200 classifications, 2 Mi UTF-16 code units of input, or 50 ms of classification time) and a new distinct HTML input arrives
- **THEN** the input is returned unchanged without classification
- **AND** one `not-evaluated` outcome is counted for that input in this window, however often it repeats within the window

#### Scenario: Budget renews each window
- **WHEN** an HTML input skipped for budget in one window arrives again in a later window with budget left
- **THEN** it is classified and its outcome counted

#### Scenario: Classifier fault is distinguished from a sanitizer outage
- **WHEN** the shadow classifier fails for a reason other than the enforce sanitizer being unavailable or throwing
- **THEN** the input is returned unchanged
- **AND** one `shadow-error` outcome is counted and no `would-throw-html` outcome

#### Scenario: No re-entry during classification
- **WHEN** a `default` policy callback is invoked while shadow evaluation is already running
- **THEN** the nested call returns its input unchanged, starts no further shadow evaluation, and counts no `default`-policy invocation

#### Scenario: Shadow evaluation raises no Trusted Types violation
- **WHEN** a page loads in report mode in a browser with Trusted Types and shadow evaluation classifies HTML inputs
- **THEN** shadow evaluation itself causes no Trusted Types violation report

#### Scenario: Shadow evaluation leaves default-policy counts unchanged
- **WHEN** the same page loads in report mode with and without shadow evaluation
- **THEN** the number of counted `default`-policy invocations is the same

#### Scenario: No shadow work outside report mode
- **WHEN** Trusted Types is in `off` or `enforce` mode
- **THEN** no shadow outcome is counted

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
The client SHALL observe Trusted Types and CSP violations, default-policy invocations, and shadow outcomes. It SHALL report them to the server in deduplicated, bounded batches over the authenticated API. Each entry carries the directive, the sink name, the source file and line (at most 512 UTF-16 code units), and a count. A per-source shadow entry uses the directive `trusted-types-shadow` and the outcome name as the sink, and is ordered after every other entry. In addition, each report SHALL carry the non-zero per-outcome shadow totals as a separate aggregate of at most six keys, each value at most 1,000,000 with any remainder carried to the next report, outside the entry cap and `overflow`. A report SHALL be sent when only shadow totals are pending. The client SHALL keep shadow totals after any failed send except a schema rejection (400). After a 400 it SHALL discard them and add one `shadow-error` to the next totals. The serialized report SHALL stay within the server's body limit, shedding the lowest-priority entries (per-source shadow detail first) into `overflow`. No report SHALL carry any content sample. Reporting SHALL never block rendering.

#### Scenario: Violation in report mode
- **WHEN** an unpoliced sink receives a raw string while Trusted Types is in report mode
- **THEN** one aggregated report for that directive, sink, and source reaches the server within the batch interval

#### Scenario: Shadow outcome reported
- **WHEN** shadow evaluation counts `would-alter-html` three times from one source within a flush interval
- **THEN** the next report carries one entry with directive `trusted-types-shadow`, sink `would-alter-html`, that source, and count 3
- **AND** its shadow aggregate carries `would-alter-html: 3`
- **AND** the report carries no part of the HTML

#### Scenario: Shadow aggregate survives entry overflow
- **WHEN** 60 distinct non-shadow keys and one `would-block-script` outcome accumulate before a flush
- **THEN** the report's shadow aggregate carries `would-block-script: 1`
- **AND** no non-shadow key is displaced into `overflow` by a shadow entry

#### Scenario: Shadow aggregate survives a transient failure
- **WHEN** a report carrying a shadow aggregate is answered with 401, 403, 408, 413, 429 or a 5xx status, or fails on the network
- **THEN** the next report carries those shadow counts again, added to any new ones

#### Scenario: Shadow-only totals are sent
- **WHEN** shadow totals are pending and no entry is pending at a flush
- **THEN** a report carrying the shadow aggregate and no entries is sent

#### Scenario: Schema rejection does not poison later reports
- **WHEN** a report is rejected with status 400
- **THEN** its shadow totals are discarded
- **AND** the next report carries the counts gathered after it plus one `shadow-error`, so the loss is visible

#### Scenario: Oversized count is split across reports
- **WHEN** a shadow total exceeds 1,000,000 at a flush
- **THEN** the report carries 1,000,000 for that outcome and the remainder is carried to the next report

#### Scenario: Report stays within the body limit
- **WHEN** 50 distinct keys with 512-character sources are pending
- **THEN** the serialized report stays within the server's body limit, the entries that do not fit are counted in `overflow`, and the shadow aggregate is included

#### Scenario: Long source is truncated, not rejected
- **WHEN** a violation's source URL is longer than 512 UTF-16 code units
- **THEN** the entry carries the first 512 code units as its source and the report is accepted

#### Scenario: Violation flood is bounded
- **WHEN** the same sink fires thousands of violations in a session
- **THEN** the client sends at most one report per flush interval (30 seconds, plus one on page hide), each carrying counts, not one report per violation

#### Scenario: Too many distinct keys in one flush
- **WHEN** 51 or more distinct (directive, sink, source) keys accumulate before a flush
- **THEN** the report carries at most 50 keys, in priority order and within the body limit, with their counts, plus one `overflow` counter for the rest

#### Scenario: Server unreachable
- **WHEN** the report request fails
- **THEN** the batch's entries are dropped, its shadow totals are kept for the next report, and the UI is unaffected
- **AND** shadow totals still pending when the final page-hide send fails are lost

### Requirement: Violation endpoint stores counters only
The server SHALL accept violation reports only from authenticated principals. It SHALL rate-limit them per principal, keep in-memory counters keyed by directive, sink, and source, and expose those counters to operators. It SHALL NOT persist raw samples. It SHALL accept an optional shadow aggregate. Its keys that are shadow outcome names SHALL carry valid counts; other keys SHALL be ignored and never persisted. For an accepted report it SHALL add the known keys of that aggregate to the persisted Trusted Types shadow counters, and nothing else from the report. Per-source entries SHALL stay in memory; per-source shadow entries SHALL be held apart from the other counters, so they never evict them. A present shadow aggregate that is not an object SHALL make the report invalid.

#### Scenario: Unauthenticated report
- **WHEN** a request without a valid principal posts a violation report
- **THEN** the server rejects it and no counter changes

#### Scenario: Rate limit
- **WHEN** one principal posts more than 3 reports in a burst, or more than 12 within one minute
- **THEN** each excess report is rejected with HTTP 429 and no counter changes

#### Scenario: Oversized or malformed report
- **WHEN** a report exceeds the size limit or does not match the schema
- **THEN** the server rejects it without logging its body

#### Scenario: Unknown shadow key is ignored
- **WHEN** an otherwise valid report's shadow aggregate carries a key other than the six shadow outcome names
- **THEN** the server accepts the report, persists its known shadow keys, and creates no counter for the unknown key

#### Scenario: Shadow detail never evicts violation counters
- **WHEN** more than 500 distinct per-source shadow entries are accepted after a violation counter was recorded
- **THEN** that violation counter is still served by `GET /api/csp-violations`

#### Scenario: Non-object shadow aggregate rejects the report
- **WHEN** a report carries a shadow aggregate that is an array, a string, a number or `null`
- **THEN** the server rejects the report and no counter changes

#### Scenario: Invalid shadow count rejects the report
- **WHEN** a report's shadow aggregate carries a known outcome with a count that is not an integer from 1 to 1,000,000
- **THEN** the server rejects the report and no counter changes

#### Scenario: Accepted shadow aggregate is persisted
- **WHEN** an accepted report carries the shadow aggregate `would-block-script-url: 2`
- **THEN** the persisted shadow counter `would-block-script-url` increases by 2
- **AND** its per-source shadow entries change only the in-memory counters

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
