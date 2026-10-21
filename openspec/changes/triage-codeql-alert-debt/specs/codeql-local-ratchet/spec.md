## ADDED Requirements

### Requirement: Baseline reasons are mirrored on GitHub
A baseline entry whose reason is `github-dismissed (#<n>, <reason>)` SHALL
correspond to GitHub alert `<n>` dismissed with that reason. An open `develop`
alert that maps to an entry reasoned `operator-authz:`, `false-positive:` or
`accepted-risk:` SHALL be dismissed, and the entry rewritten to the
`github-dismissed (#<n>, …)` form.

#### Scenario: Triaged entry has no open alert
- **WHEN** the open `develop` alerts are listed after the post-merge CodeQL scan completes and the residue dismissal has run
- **THEN** none SHALL match a baseline entry carrying `operator-authz:`, `false-positive:` or `accepted-risk:`

### Requirement: No untriaged baseline debt
No baseline entry SHALL carry the `untriaged` reason.

#### Scenario: No untriaged debt
- **WHEN** `codeql-baseline.json` is read after this change
- **THEN** no entry SHALL have reason `untriaged`
