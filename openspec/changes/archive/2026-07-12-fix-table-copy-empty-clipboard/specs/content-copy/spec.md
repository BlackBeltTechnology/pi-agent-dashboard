## MODIFIED Requirements

### Requirement: Copy button component
The CopyButton component SHALL accept `getText` (a `() => string` callback that
returns the text to copy), `icon` (icon node), and `title` (tooltip string)
props. On click, it SHALL invoke `getText()` to resolve the payload **at click
time**, copy the result to the clipboard using `navigator.clipboard.writeText()`,
and display a ✓ checkmark for 1.5 seconds before reverting to the original icon.

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

#### Scenario: Clipboard unavailable
- **WHEN** `navigator.clipboard` is not available
- **THEN** the button SHALL fail silently without errors

### Requirement: Table copy buttons
Each rendered markdown table SHALL display an always-visible icon bar in the
top-right corner with two buttons: 📋 (copy as markdown) and 📊 (copy as TSV).
Each button SHALL resolve its payload from the committed table DOM at click time.

#### Scenario: Copy table as markdown
- **WHEN** the user clicks the 📋 button on a table
- **THEN** the table content SHALL be copied as a markdown-formatted table string
  (pipe-delimited with header separator)

#### Scenario: Copy table as TSV
- **WHEN** the user clicks the 📊 button on a table
- **THEN** the table content SHALL be copied as tab-separated values with rows
  separated by newlines

#### Scenario: Copy from a memoized single-render table
- **WHEN** the table is rendered inside a `React.memo` host that renders once
  AND the user clicks either table copy button
- **THEN** the copied content SHALL be the fully-rendered table (markdown or
  TSV), never an empty string
