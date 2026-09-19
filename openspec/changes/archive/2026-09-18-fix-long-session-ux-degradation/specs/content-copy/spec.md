## MODIFIED Requirements

### Requirement: Copy button component
The CopyButton component SHALL accept `getText` (a `() => string` callback that
returns the text to copy), `icon` (icon node), and `title` (tooltip string)
props. On click, it SHALL invoke `getText()` to resolve the payload **at click
time**, copy the result to the clipboard, and display a ✓ checkmark for 1.5
seconds before reverting to the original icon.

Copying SHALL use the shared fallback-backed copy path rather than the
asynchronous Clipboard API alone. When the asynchronous Clipboard API is
unavailable or rejects — which is the normal case when the dashboard is served
over a non-secure origin such as a plain-http tunnel — the copy SHALL be
retried through a legacy selection-and-copy fallback, and SHALL succeed
whenever that fallback is supported by the browser. The fallback SHALL leave no
residual element in the document.

The ✓ confirmation SHALL be shown only when the copy actually succeeded. When
every available copy path fails, the button SHALL fail silently — no error is
thrown and no ✓ is displayed.

Resolving the payload at click time (rather than binding a pre-computed string
at render time) guarantees that payloads derived from committed DOM — e.g. a ref
read of a rendered `<table>` or message body — are non-empty even when the host
component renders exactly once (e.g. under `React.memo`).

#### Scenario: Successful copy
- **WHEN** the user clicks a CopyButton
- **THEN** `getText()` SHALL be invoked and its return value SHALL be copied to
  the clipboard, and the icon SHALL change to ✓ for 1.5 seconds

#### Scenario: Payload resolved from committed DOM on a single render
- **WHEN** a CopyButton's `getText` reads from a ref (e.g. a rendered table or
  message body) AND the host component renders only once
- **THEN** clicking the button SHALL copy the fully-rendered content, never an
  empty string

#### Scenario: Copy succeeds over a non-secure origin via the fallback
- **GIVEN** the dashboard is served over a non-secure origin so the asynchronous
  Clipboard API is unavailable or rejects
- **WHEN** the user clicks a CopyButton AND the legacy copy fallback is supported
- **THEN** the text SHALL still be copied to the clipboard
- **AND** the icon SHALL change to ✓ for 1.5 seconds
- **AND** no element used by the fallback SHALL remain in the document

#### Scenario: Clipboard unavailable
- **WHEN** neither the asynchronous Clipboard API nor the legacy copy fallback
  is available
- **THEN** the button SHALL fail silently without errors
- **AND** the ✓ checkmark SHALL NOT be displayed
