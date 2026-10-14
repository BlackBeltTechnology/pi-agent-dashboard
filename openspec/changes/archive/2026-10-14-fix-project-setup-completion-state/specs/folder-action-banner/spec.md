## MODIFIED Requirements

### Requirement: Banner reflects the per-artifact setup state

The setup banner SHALL derive from the per-artifact checklist and SHALL have exactly two states:

| Required artifact | Banner | Menu |
|---|---|---|
| `.pi/settings.json` absent | info severity — "Not a pi project yet" with a `Set up →` action | `Project setup… 0/N` |
| `.pi/settings.json` present | *no setup banner*, whatever the optional tally | `Project setup… n/N` |

There SHALL be no intermediate "setup incomplete" banner. Partial setup is reported by the menu tally only.

The action SHALL spawn an interactive project-init session with cwd set to the directory, reusing the existing spawn-session machinery with the project-init skill pre-injected. It SHALL carry test id `folder-banner-setup-action-<cwd>`, superseding `project-init-btn`.

The client SHALL re-probe the row's init-status when ALL of the following gates hold:

- the row's most recent interpretable probe reported `.pi/settings.json` absent (a failed probe, which hides the banner per the fail-open rule, does not close this gate), AND
- the row passes the project-root gate that governs the setup rung (pinned, workspace-added, or positive git-root evidence);

and ANY of the following triggers fires:

- a session belonging to the row transitions into `idle` or `ended` from a different status (a finished turn, or the session ending), or
- a session belonging to the row is first observed, after the row's initial render, already `idle` or `ended` (a turn that completed while the client was not observing, e.g. across a reconnect), or
- a session belonging to the row that was last observed not `ended` disappears from the row's session list, or
- the browser document becomes visible again after being hidden, provided the row has not been probed within the last 30 seconds.

An interactive project-init session writes its artifacts and then waits idle; it is not expected to end. The setup rung SHALL therefore clear on the turn that wrote `.pi/settings.json`, without the user ending the session and without any other user action. A setup banner that survives its own successful remedy is the most visible failure this requirement prevents. Clearing the setup rung SHALL NOT suppress the rungs above it on the severity ladder: a freshly scaffolded `worktreeInit` hook MAY immediately surface the re-trust or init-needed rung, which is correct behavior.

The re-probe SHALL NOT depend on which control launched the setup: a project-init session started from the banner, from the folder actions menu, or from a terminal in the same directory SHALL all clear the setup rung the same way. The re-probe trigger SHALL survive the banner unmounting and remounting (folder collapse/expand, compact-mode toggle).

When probes overlap, the row SHALL display the result of the most recently issued probe; an older response arriving later SHALL be discarded.

Because project-init is interactive and may be abandoned, the re-probe SHALL be unconditional on the session's outcome: an abandoned session re-probes, finds the artifact still missing, and the banner correctly remains.

When the row's most recent interpretable probe reported `.pi/settings.json` present, no probe has yet been interpretable, or the row fails the project-root gate, none of these triggers SHALL re-probe, so such rows add no request load per turn or per tab switch.

#### Scenario: No pi configuration at all

- **GIVEN** a directory whose checklist reports `.pi/settings.json` absent
- **WHEN** the card renders
- **THEN** the banner SHALL read "Not a pi project yet" at info severity with a `Set up →` action

#### Scenario: Partial setup does not banner

- **GIVEN** a directory whose checklist reports 3 of 5 present, with `.pi/settings.json` among the present
- **WHEN** the card renders
- **THEN** no setup banner SHALL render
- **AND** the menu SHALL report `Project setup… 3/5`

#### Scenario: Fully set-up directory is quiet

- **GIVEN** a directory whose checklist reports every artifact present
- **WHEN** the card renders
- **THEN** no setup banner SHALL render

#### Scenario: The setup rung clears when the setup turn finishes

- **GIVEN** a project-root directory showing the "Not a pi project yet" banner
- **AND** a project-init session in that directory that is `streaming`
- **WHEN** that session's turn finishes having written `.pi/settings.json`, and the session stays open (idle)
- **THEN** the row's init-status SHALL be re-probed
- **AND** the setup rung SHALL no longer render, without the session ending and without any other user action

#### Scenario: The banner clears after its own action succeeds

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** the project-init session spawned from that banner reaches status `ended` having written `.pi/settings.json`
- **THEN** the row's init-status SHALL be re-probed
- **AND** the setup rung SHALL no longer render without any other user action

#### Scenario: A scaffolded hook surfaces the next rung

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** setup writes a `.pi/settings.json` declaring an untrusted `worktreeInit` hook and the row re-probes
- **THEN** the setup rung SHALL no longer render
- **AND** the re-trust rung SHALL render in its place

#### Scenario: A turn completed while unobserved still clears the setup rung

- **GIVEN** a project-root directory showing the "Not a pi project yet" banner
- **WHEN** a session belonging to that row, which wrote `.pi/settings.json`, first appears in the row's session list already `idle` (for example after a reconnect)
- **THEN** the row's init-status SHALL be re-probed
- **AND** the setup rung SHALL no longer render

#### Scenario: Starting a turn does not re-probe

- **GIVEN** a project-root directory showing the "Not a pi project yet" banner
- **WHEN** a session belonging to that row transitions into `streaming`
- **THEN** the row's init-status SHALL NOT be re-probed

#### Scenario: Setup launched outside the banner also clears it

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** a session belonging to that row that was NOT spawned from the banner finishes a turn having written `.pi/settings.json`
- **THEN** the setup rung SHALL no longer render

#### Scenario: Tracking survives a banner remount

- **GIVEN** a directory showing the "Not a pi project yet" banner and a running project-init session in it
- **WHEN** the user collapses and re-expands the folder (or toggles compact mode) before the session's turn finishes
- **AND** the turn then finishes having written `.pi/settings.json`
- **THEN** the setup rung SHALL no longer render

#### Scenario: Returning to the tab re-probes

- **GIVEN** a directory showing the "Not a pi project yet" banner, last probed more than 30 seconds ago
- **AND** `.pi/settings.json` was created while the dashboard tab was hidden, by a process the dashboard does not track
- **WHEN** the tab becomes visible
- **THEN** the row's init-status SHALL be re-probed
- **AND** the setup rung SHALL no longer render

#### Scenario: Rapid tab switching does not re-probe repeatedly

- **GIVEN** a directory showing the "Not a pi project yet" banner, probed less than 30 seconds ago
- **WHEN** the tab becomes visible
- **THEN** the row's init-status SHALL NOT be re-probed

#### Scenario: A stale probe response does not resurrect the banner

- **GIVEN** two overlapping probes for one row, the later-issued reporting `.pi/settings.json` present
- **WHEN** the earlier-issued probe's response (reporting it absent) arrives last
- **THEN** the row SHALL keep the later-issued result and the setup rung SHALL NOT render

#### Scenario: A failed probe does not stop retries

- **GIVEN** a project-root directory whose last interpretable probe reported `.pi/settings.json` absent
- **AND** the most recent probe failed, so the banner is hidden per the fail-open rule
- **WHEN** a session belonging to that row finishes a turn
- **THEN** the row's init-status SHALL be re-probed

#### Scenario: An abandoned setup session leaves the banner standing

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** the spawned project-init session finishes a turn or reaches status `ended` WITHOUT writing `.pi/settings.json`
- **THEN** the row's init-status SHALL still be re-probed
- **AND** the banner SHALL remain rendered

#### Scenario: Configured or non-root rows do not re-probe

- **GIVEN** a row whose last probe reports `.pi/settings.json` present, OR a row that fails the project-root gate
- **WHEN** a session belonging to that row finishes a turn, or the tab becomes visible
- **THEN** the row's init-status SHALL NOT be re-probed
