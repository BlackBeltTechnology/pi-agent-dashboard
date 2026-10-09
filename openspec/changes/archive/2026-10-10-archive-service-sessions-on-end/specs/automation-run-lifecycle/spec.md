## MODIFIED Requirements

### Requirement: Runs spawn automation sessions with configurable board visibility

A fired trigger SHALL spawn a pi session stamped `kind="automation"` carrying `automationRun { name, runId }`, launched via a `ServerPluginContext` spawn hook with the resolved model, action, `mode`, and `sandbox`. The spawn SHALL declare the session disposable once it ends, so the host archives it shortly after it ends. The session SHALL ALWAYS appear in the Automation view; that appearance is driven by the run record and SHALL NOT depend on the session remaining in the live set. Whether it ALSO appears on the normal board SHALL be governed by an effective visibility = the automation's `visibility` field if present, else the settings-level default (default `hidden`). When effective visibility is `hidden` the run SHALL be excluded from the board; when `shown` it SHALL render as a normal board card while it is live and after it ends until the host archives it.

#### Scenario: Hidden run absent from board, present in Automation view

- **WHEN** a run spawns with effective visibility `hidden`
- **THEN** it SHALL NOT render as a top-level board card AND SHALL appear in the Automation view's run list with status `running`.

#### Scenario: Shown run appears on board

- **WHEN** a run spawns with effective visibility `shown`
- **THEN** it SHALL render as a top-level board card AND SHALL also appear in the Automation view.

#### Scenario: Per-automation visibility overrides settings default

- **WHEN** the settings default is `hidden` and an automation declares `visibility: shown`
- **THEN** that automation's runs SHALL appear on the board while other automations' runs stay hidden.

#### Scenario: Ended shown run leaves the board when archived

- **WHEN** a run with effective visibility `shown` ends and the host archives it on end
- **THEN** it SHALL no longer render as a top-level board card AND its run SHALL still appear in the Automation view with its terminal status.

## ADDED Requirements

### Requirement: Run monitor survives its session being archived

The run monitor SHALL keep working for a run whose session the host has
archived: when the run session is not in the live set, the monitor SHALL
resolve the run from the run record by session id, SHALL show its terminal
status and captured result, and SHALL offer the run's transcript through the
read-only archived session view.

#### Scenario: Monitor opened on an archived run

- **WHEN** the monitor is opened for a run whose session was archived on end
- **THEN** it SHALL show the run's terminal status and captured result, SHALL
  NOT show the run as running, and SHALL link the transcript to the read-only
  archived session view

#### Scenario: Monitor opened on a live run is unchanged

- **WHEN** the monitor is opened for a run whose session is in the live set
- **THEN** it SHALL behave as before this requirement
