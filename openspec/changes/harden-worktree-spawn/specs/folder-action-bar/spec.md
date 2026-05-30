## ADDED Requirements

### Requirement: Worktree dialog existing-row bootstrap probe
The `WorktreeSpawnDialog` SHALL, in parallel with its existing `GET /api/git/worktrees` + `GET /api/git/head` + `GET /api/git/branches` fetches, call `GET /api/git/worktree/bootstrap-status?cwd=<path>` once per existing-worktree row. The probe runs against each row's `path` (NOT the dialog's `cwd`) so the main row and every sibling worktree get their own answer. Results SHALL drive per-row UI:

- `needsBootstrap: false` (reasons `not_required` or `ok`) → row renders today's `Spawn →` button unchanged.
- `needsBootstrap: true, reason: "no_node_modules"` or `"stale_lockfile"` → row renders `⚠ Install deps + Spawn →` in place of `Spawn →`. Clicking this variant SHALL run the same bootstrap flow as `Create + Spawn →` against the row's path, then auto-spawn pi on success.

When the probe fails (network error, server error), the row SHALL render today's `Spawn →` button unchanged (fail-open).

#### Scenario: Healthy row keeps Spawn arrow
- **WHEN** the dialog opens and bootstrap-status for the main row returns `{ needsBootstrap: false, reason: "ok" }`
- **THEN** the row SHALL render the existing `Spawn →` action
- **AND** clicking it SHALL send `spawn_session { cwd: <row.path> }` as today

#### Scenario: Non-bootstrap repo rows unchanged
- **WHEN** the dialog opens on a repo where the bootstrap heuristic is `not_required` for every row
- **THEN** every row SHALL render `Spawn →` exactly as today
- **AND** NO `⚠` indicator SHALL appear on any row

#### Scenario: Sibling worktree missing node_modules
- **WHEN** the dialog opens and bootstrap-status for a sibling worktree row returns `{ needsBootstrap: true, reason: "no_node_modules" }`
- **THEN** the row SHALL render `⚠ Install deps + Spawn →` instead of `Spawn →`
- **AND** the row SHALL include a tooltip / inline note explaining the worktree needs `npm install` before it can host a pi session

#### Scenario: Clicking install-then-spawn variant runs bootstrap and spawns
- **WHEN** the user clicks `⚠ Install deps + Spawn →` on a row whose bootstrap-status was `no_node_modules`
- **THEN** the client SHALL invoke the bootstrap flow against `<row.path>` with a fresh `requestId`
- **AND** the dialog SHALL render bootstrap progress (live tail of install output, ≤ 4 KB)
- **AND** on `bootstrap_done` the client SHALL send `spawn_session { cwd: <row.path>, requestId }` and auto-navigate as today
- **AND** on `bootstrap_failed` the dialog SHALL render the error in the same surface used by `Create + Spawn →` failures (error code + collapsed stderr details), without spawning pi

#### Scenario: Probe failure falls back to Spawn arrow
- **WHEN** `GET /api/git/worktree/bootstrap-status?cwd=...` fails (HTTP 5xx, network error)
- **THEN** the row SHALL render today's `Spawn →` button unchanged
- **AND** the dialog SHALL NOT block on the probe failure (other rows continue rendering as their probes resolve)

### Requirement: Worktree dialog create-form bootstrap progress
When the user submits the Create form (`Create + Spawn →`), the client SHALL render a bootstrap progress surface inside the dialog as soon as the server starts emitting `bootstrap_progress` events tagged with the request's `requestId`. The surface SHALL show:

- A live tail of install output, last ≤ 4 KB, in a fixed-height scroll region with monospace font.
- A "Installing dependencies…" header and (when known) the detected install command (e.g., `npm ci`).
- The Cancel button SHALL remain enabled and SHALL close the dialog when clicked. The server-side install continues to completion regardless (see design).

`Create + Spawn →` SHALL change its label to `Installing…` and become disabled for the duration of bootstrap. On `bootstrap_done` the existing post-create code SHALL run unchanged (call `onSpawn(res.path, { gitWorktreeBase: base })`). On `bootstrap_failed` the dialog SHALL surface the error code + message + collapsed stderr details using the existing error-display surface; pi SHALL NOT be spawned.

#### Scenario: Live tail renders during install
- **WHEN** the server emits `bootstrap_progress` events
- **THEN** the dialog SHALL render the latest `line` field in the scroll region
- **AND** the `Create + Spawn →` button SHALL show `Installing…` and be disabled

#### Scenario: Detected install command shown
- **WHEN** the server emits its first `bootstrap_progress` event carrying the resolved install command (e.g., `> npm ci` as line 1)
- **THEN** the dialog SHALL show that command in the bootstrap progress header

#### Scenario: Bootstrap success triggers spawn
- **WHEN** `bootstrap_done` arrives for the dialog's `requestId`
- **THEN** the client SHALL call `onSpawn(<res.path>, { gitWorktreeBase: <base> })` and close the dialog
- **AND** the existing auto-navigate via `spawnRequestId` SHALL fire

#### Scenario: Bootstrap failure shows error, no spawn
- **WHEN** `bootstrap_failed` arrives for the dialog's `requestId`
- **THEN** the dialog SHALL render `{ code, message }` in the error surface
- **AND** the collapsed stderr details SHALL be available via the existing `<details>` widget
- **AND** NO `spawn_session` message SHALL be sent

#### Scenario: Cancel during install closes dialog
- **WHEN** the user clicks Cancel while `Installing…` is showing
- **THEN** the dialog SHALL close
- **AND** the server SHALL continue running the install to completion in the background (per design)
- **AND** NO spawn SHALL be initiated even if `bootstrap_done` arrives later

#### Scenario: Bootstrap-skipped path unchanged
- **WHEN** the server responds `{ bootstrap: { ran: false, skippedReason: "not_required" } }` without emitting any bootstrap events
- **THEN** the dialog SHALL behave exactly as today (no progress surface, direct call to `onSpawn`)
