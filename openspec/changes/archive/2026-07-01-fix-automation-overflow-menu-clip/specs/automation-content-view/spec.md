## MODIFIED Requirements

### Requirement: Automation card shows a last-run summary and a Stop action

Each valid automation card SHALL show a last-run summary inline — the latest run's status pill, a relative timestamp, the findings count, and a link to its `result.md` (or log when errored) — derived from the runs already loaded. When the automation has a `running` run, the card SHALL expose a Stop action that aborts that run; otherwise the card SHALL expose Run now. Edit and Delete (with confirmation) SHALL remain available; Delete MAY live under an overflow control. The overflow control's menu SHALL render in a body-mounted portal (via the `ui:popover` primitive) so it is visible and clickable independent of the card's `overflow-hidden` clip, and SHALL dismiss on outside click or Esc.

#### Scenario: Last-run summary rendered on the card

- **WHEN** an automation has at least one prior run
- **THEN** its card SHALL show the latest run's status, relative time, findings count, and result/log link.

#### Scenario: Stop replaces Run now while running

- **WHEN** an automation has a `running` run
- **THEN** the card SHALL show a Stop action (not Run now) that stops that run.

#### Scenario: Overflow menu is visible over the card when opened

- **WHEN** a user activates the `⋯` overflow control on an automation card
- **THEN** the Edit and Delete actions SHALL render in a portal anchored to the control, positioned so they are not clipped by the card's `overflow-hidden` container, and SHALL remain in-viewport when the card sits near a viewport or scroll-container edge.

#### Scenario: Overflow menu dismisses on outside click or Esc

- **WHEN** the overflow menu is open
- **AND** the user clicks outside the menu and its trigger, or presses Esc
- **THEN** the menu SHALL close without invoking Edit or Delete.
