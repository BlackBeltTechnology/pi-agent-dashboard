## ADDED Requirements

### Requirement: Doctor Markdown table cells are escaped
Every doctor Markdown table — the shared report formatter, the web Diagnostics
"Copy as Markdown" output and the Electron doctor page — SHALL escape the check
name and message cells by replacing each `\` with `\\`, then each `|` with
`\|`, then each line break with a space, so cell text can never close its cell
or start a new row. As a consequence, backslashes in a message are shown
literally when the Markdown is rendered.

#### Scenario: Backslash directly before a pipe
- **WHEN** a check's message is `a\|b` and another check's message is `C:\path\`
- **THEN** their message cells SHALL be emitted as `a\\\|b` and `C:\\path\\`, and each row SHALL parse into exactly four cells under GitHub-Flavored-Markdown table rules (as implemented by `remark-gfm`)

#### Scenario: Name cell is escaped
- **WHEN** a check's name is `ABI mismatch: a|b\`
- **THEN** its name cell SHALL be emitted as `ABI mismatch: a\|b\\` and the row SHALL parse into exactly four cells

#### Scenario: Multi-line message
- **WHEN** a check's message is `line1` followed by a newline and `line2`
- **THEN** its row SHALL stay on one line with the message cell `line1 line2`
