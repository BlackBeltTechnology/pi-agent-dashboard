## MODIFIED Requirements

### Requirement: Bridge auto-decides project_trust for dashboard-spawned headless sessions in the activation cwd

The bridge SHALL capture `activationCwd = process.cwd()` and whether the session is dashboard-spawned at bridge **activation** (before any `project_trust` event can fire — the event is emitted during resource-loader reload, ahead of `session_start`); dashboard-spawned SHALL be derived once from the single-use spawn token present at activation, which the bridge SHALL then remove from its process environment while keeping the value for its first registration. It SHALL register a `project_trust` handler (pi 0.79.0+) as a personal extension that reads `eventCwd` from the event's `cwd`, falling back to its own per-event `ctx` argument, inside try/catch; any error SHALL yield undecided. When pi's trust store file (of the running pi's agent directory, read without pi's lock) holds a recorded entry for `eventCwd` or an ancestor, or cannot be read, parsed or validated, the handler SHALL return undecided, so pi's own resolution applies — a deliberate change: a dashboard-spawned headless session in an activation cwd the user recorded as untrusted no longer auto-trusts. Otherwise it SHALL resolve `eventCwd`, the activation cwd included, through the `pi-trust-mirror` decision from the snapshot and, when the snapshot does not cover it and the live-query conditions hold, from the `pi-trust-mirror` live trust query, awaited for at most `piTrustMirror.liveQueryTimeoutMs` (the handler is asynchronous; pi awaits it) — consulting dashboard trust for sessions other than dashboard-spawned headless ones only when `piTrustMirror.coverInteractive` is true — and SHALL decide "trust" for this run when that yields dashboard trust, returning undecided otherwise. There is no activation-cwd rule of its own: a dashboard spawn into a folder that no dashboard trust source covers (a pinned folder, a folder inside a workspace folder, a covered access grant or YOLO root) SHALL NOT be auto-trusted, whichever road spawned it, and pi's own resolution applies. A dashboard-spawned headless session whose activation cwd the `pi-trust-mirror` forbidden-folder rules exclude (temporary, `~/Downloads`, `~/.cache` or forbidden folders) SHALL log `forbidden-folder`, and the reason SHALL be logged whenever a dashboard-spawned session is denied trust it would have had before this change (`not-covered` when no source covers the folder, else the existing reason code). Trust SHALL be per-run (never remembered). `ctx.isProjectTrusted()` SHALL be logging-only. Because pi applies the first yes/no among extension handlers, a "trust" from the bridge takes precedence over a later user extension's refusal; this SHALL be documented.

#### Scenario: Dashboard-spawned headless session in its activation cwd auto-trusts
- **WHEN** a dashboard-spawned headless RPC session raises `project_trust` while `eventCwd` equals `activationCwd`, dashboard trust covers the folder (for example it is pinned), and pi's trust store has no recorded entry for it or an ancestor
- **THEN** the handler SHALL decide "trust" for this run

#### Scenario: Activation cwd outside dashboard trust is not auto-trusted
- **WHEN** a dashboard-spawned headless RPC session raises `project_trust` while `eventCwd` equals `activationCwd`, the folder is unpinned, outside every workspace folder, covered by no grant or YOLO root, and `trust.json` has no entry for it
- **THEN** the handler SHALL return undecided, log `not-covered`, and pi's own resolution SHALL apply

#### Scenario: Recorded refusal beats the activation-cwd rule
- **WHEN** a dashboard-spawned headless RPC session raises `project_trust` in its activation cwd and `trust.json` records `false` for that cwd
- **THEN** the handler SHALL return undecided, and pi's recorded refusal SHALL apply

#### Scenario: Activation cwd in a temporary folder does not auto-trust
- **WHEN** a dashboard-spawned headless RPC session raises `project_trust` in its activation cwd `/private/tmp/clone`
- **THEN** the handler SHALL return undecided

#### Scenario: Interactive/TUI session defers
- **WHEN** an interactive (non-headless) session raises `project_trust`, `piTrustMirror.coverInteractive` is false, and dashboard trust covers `eventCwd`
- **THEN** the handler SHALL return undecided

#### Scenario: Interactive session uses dashboard trust only when covered
- **WHEN** an interactive session raises `project_trust` in a pinned folder and `piTrustMirror.coverInteractive` is true
- **THEN** the handler SHALL decide "trust" for this run

#### Scenario: Cwd differs from the activation cwd defers
- **WHEN** a dashboard-spawned headless session raises `project_trust` with `eventCwd` different from `activationCwd` and dashboard trust does not cover `eventCwd`
- **THEN** the handler SHALL return undecided

#### Scenario: Cwd differs from the activation cwd but dashboard trust covers it
- **WHEN** a dashboard-spawned headless session raises `project_trust` with `eventCwd` different from `activationCwd` and dashboard trust covers `eventCwd`
- **THEN** the handler SHALL decide "trust" for this run

#### Scenario: Non-dashboard-spawned session defers
- **WHEN** a session with `dashboardSpawned === false` raises `project_trust` and `piTrustMirror.coverInteractive` is false
- **THEN** the handler SHALL return undecided

#### Scenario: ctx.cwd read that throws defers
- **WHEN** the event carries no `cwd` and reading it from the event `ctx` throws (stale/replaced session)
- **THEN** the handler SHALL return undecided (no crash)

#### Scenario: Live trust query covers a session-scoped trusted repo
- **WHEN** a dashboard-spawned headless session raises `project_trust` with `eventCwd` different from `activationCwd`, the snapshot does not cover `eventCwd`, and the live trust query answers covered with a folder proof that holds
- **THEN** the handler SHALL decide "trust" for this run

#### Scenario: Live trust query exceeds its budget
- **WHEN** the live trust query has not answered within `piTrustMirror.liveQueryTimeoutMs`
- **THEN** the handler SHALL return undecided no later than that budget plus 100 ms, and log `live-timeout`
