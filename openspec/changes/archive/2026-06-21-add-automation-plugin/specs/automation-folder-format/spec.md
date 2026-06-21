# automation-folder-format

## ADDED Requirements

### Requirement: Dual-scope automation definitions on disk

Automation definitions SHALL be read from two scopes: per-folder at `<repo>/.pi/automation/<name>/` and global at `~/.pi/automation/<name>/`. Each automation directory SHALL contain an `automation.yaml`. The plugin SHALL merge both scopes for display, tagging each automation with its scope.

#### Scenario: Per-folder automation discovered

- **WHEN** a repo contains `.pi/automation/weekly-brief/automation.yaml`
- **THEN** the automation `weekly-brief` SHALL appear in that folder's Automation view with scope `folder`.

#### Scenario: Global automation discovered across folders

- **WHEN** `~/.pi/automation/nightly-bugfix/automation.yaml` exists
- **THEN** `nightly-bugfix` SHALL appear in the Automation view of any folder with scope `global`.

#### Scenario: Name collision across scopes kept distinct

- **WHEN** both `<repo>/.pi/automation/x/` and `~/.pi/automation/x/` exist
- **THEN** both SHALL be listed as separate entries distinguished by scope badge.

### Requirement: automation.yaml schema

`automation.yaml` SHALL declare `on` (trigger block with `kind`), `action` (`kind: prompt` with `prompt` path, OR `kind: skill` with `skill`), `model` (bare provider/model id or `@role`), `mode` (`worktree` | `local`), `sandbox` (`read-only` | `workspace-write` | `full-access`), `concurrency` (`skip` | `queue` | `parallel`, default `skip`), and an OPTIONAL `visibility` (`hidden` | `shown`) overriding the settings-level default. Unknown trigger `kind` values SHALL fail validation, mark the automation invalid in the view, and SHALL NOT prevent other automations from loading.

#### Scenario: Valid schedule automation parses

- **WHEN** `automation.yaml` declares `on.kind: schedule`, `on.cron: "0 9 * * 1"`, `action.kind: prompt`, `model: "@fast"`, `mode: worktree`, `concurrency: skip`
- **THEN** the automation SHALL be parsed and armed.

#### Scenario: Unknown trigger kind isolates failure

- **WHEN** an automation declares `on.kind: slack.message` and no registered trigger handles `slack.message`
- **THEN** that automation SHALL be marked invalid with an error naming the kind, and sibling automations SHALL still load and arm.

### Requirement: Run/triage store with retention

Each run SHALL write to `<scope>/.pi/automation/runs/<date>-<name>/result.md`. A run that produces no findings SHALL be auto-archived. The store SHALL retain at most the last 100 runs per automation, pruning oldest-first.

#### Scenario: Empty run auto-archived

- **WHEN** a run completes with no findings
- **THEN** its run record SHALL be marked archived and SHALL NOT surface as an unread Triage item.

#### Scenario: Retention prunes beyond 100

- **WHEN** a 101st run for one automation completes
- **THEN** the oldest run record for that automation SHALL be pruned, leaving 100.
