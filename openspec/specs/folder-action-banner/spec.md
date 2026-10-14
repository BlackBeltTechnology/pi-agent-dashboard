# folder-action-banner Specification

## Purpose
TBD - created by archiving change add-folder-action-banner. Update Purpose after archive.

## Requirements

### Requirement: Calls to action render in a full-width tier-0 banner

Every blocking directory-card call to action — project setup, init-hook run, init progress and init failure — SHALL render in a single full-width banner, never inline on the git row. The git row SHALL become facts-only (branch and dirty state, per the `directory-card-layout` tier-2 contract) and SHALL carry no call-to-action control.

The banner SHALL render **below the git row** when a git row is present, and **directly below the folder header row** when the directory has no git row. It SHALL carry test id `folder-banner-<kind>-<cwd>`.

At most one banner SHALL render per directory. When several conditions qualify simultaneously, the banner SHALL show the highest-severity one, in the order **init failure > hook re-trust > init needed > not a pi project**.

`Clean up broken (N)` SHALL NOT appear in the banner: broken sessions are ended sessions whose directory is gone, which is housekeeping and does not block the folder. It SHALL render as an item in the folder actions menu's `DIRECTORY` group instead.

The banner SHALL render only on a row representing a project root — a git root, or a directory the user explicitly pinned or added to a workspace. An arbitrary non-git subdirectory SHALL NOT receive a "not a pi project" banner; a weak signal that is tolerable on a small inline control is not tolerable on a full-width tier-0 surface.

This gate SHALL be evaluated **client-side**, from the pinned-directory and workspace membership the folder list already holds, plus the git-root signal already available for the row. It SHALL NOT require a new field on the init-status payload.

The banner's test id SHALL name its rung: `folder-banner-{setup,init-needed,retrust,failed,running}-<cwd>`.

#### Scenario: Unconfigured directory shows a setup banner, not a git-row button

- **GIVEN** a directory whose init-status reports zero present setup artifacts
- **WHEN** the directory card renders
- **THEN** a `folder-banner-setup-<cwd>` element SHALL render full-width below the header
- **AND** no "Set up project" control SHALL render inside the git row

#### Scenario: Banner placement without a git row

- **GIVEN** a non-git directory qualifying for a banner
- **WHEN** the card renders
- **THEN** the banner SHALL render directly below the folder header row

#### Scenario: Only the highest-severity banner renders

- **GIVEN** a directory with both a failed init run and a revoked hook trust
- **WHEN** the card renders
- **THEN** only the init-failure banner SHALL render

#### Scenario: Cleanup is not a banner

- **GIVEN** a directory with 3 broken sessions and no blocking init state
- **WHEN** the card renders
- **THEN** no banner SHALL render
- **AND** the folder actions menu's `DIRECTORY` group SHALL offer the cleanup action

#### Scenario: A non-project subdirectory gets no banner

- **GIVEN** a row for an arbitrary non-git directory that the user has not pinned or added to a workspace
- **WHEN** the card renders
- **THEN** no "not a pi project" banner SHALL render

### Requirement: Tier 0 means the folder cannot proceed

A banner SHALL render only for a state that blocks the folder from being worked in. Optional, non-blocking freshness SHALL NOT produce a banner under any circumstance; it is a menu affordance only.

The setup banner SHALL be gated on **required** artifacts only, and the required set SHALL be exactly one artifact: `.pi/settings.json` **resolved at the config root** (for a worktree row, the main checkout — never the row's own directory). Its absence is the only setup state that means pi cannot act in the directory at all.

A directory missing solely optional artifacts — `AGENTS.md`, prompts, `openspec/`, DOX, KB config — SHALL render no banner, while still reporting its tally in the menu. A repository with a working pi configuration but no `AGENTS.md` is demonstrably able to proceed, so it SHALL NOT be given a blocking surface.

#### Scenario: Optional-only gap renders no banner

- **GIVEN** a directory whose `.pi/settings.json` is present but whose `AGENTS.md` and `openspec/` are missing
- **WHEN** the card renders
- **THEN** no banner SHALL render
- **AND** the menu SHALL still report the per-artifact tally

#### Scenario: Template drift never banners

- **GIVEN** a directory whose init-status reports `setupOutdated: true`
- **WHEN** the card renders
- **THEN** no banner SHALL render for that condition

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

### Requirement: A running init replaces the banner's content in place

While an init run is in flight for the directory, the running state SHALL render as replacement content **inside the existing banner element**, not as an additional ladder rung and not as a separate element. Starting a run from the banner SHALL NOT cause the banner to move, change position, or be replaced by a different element.

#### Scenario: Starting a run does not move the banner

- **GIVEN** a directory whose banner offers an init action
- **WHEN** the user starts the run from that banner
- **THEN** the running state SHALL render within the same banner element
- **AND** the banner's position on the card SHALL NOT change

### Requirement: Probe failure fails open

When the setup-artifact probe or init-status fetch fails, the client SHALL render **no** banner. It SHALL NOT render a "not a pi project" banner from missing data — a false blocking claim is worse than a missing prompt.

#### Scenario: Failed probe renders nothing

- **GIVEN** the init-status probe for a directory returns an error
- **WHEN** the card renders
- **THEN** no banner SHALL render for that directory

#### Scenario: Absent checklist is not an absent project

- **GIVEN** an init-status response whose checklist field is absent altogether — the shape the client's own fail-open path produces
- **WHEN** the card renders
- **THEN** no banner SHALL render
- **AND** the absence SHALL NOT be read as "zero artifacts present"

#### Scenario: Stale client degrades to silence

- **GIVEN** a client receiving an init-status payload it cannot interpret
- **WHEN** the card renders
- **THEN** no banner SHALL render

#### Scenario: Checklist outranks the transitional boolean

- **GIVEN** a transitional payload carrying both the legacy `configured` boolean and the checklist, disagreeing with each other
- **WHEN** the banner state is derived
- **THEN** the checklist SHALL be used and the boolean ignored

### Requirement: Hook re-trust banners; template drift does not

A change to the hook definition hash revokes trust and blocks the hook from running from a UI click. That state SHALL render a banner at `--severity-warning-*` with a `Review…` action opening the existing trust-confirm dialog.

Template drift (`setupOutdated: true`) SHALL surface only as a `● update` badge on the menu's permanent `Project setup…` item.

#### Scenario: Revoked trust banners at warning severity

- **GIVEN** a directory whose hook definition changed since it was last trusted
- **WHEN** the card renders
- **THEN** a warning-severity banner SHALL render with a `Review…` action
- **AND** activating it SHALL open the trust-confirm dialog

#### Scenario: Drift badges the menu item only

- **GIVEN** a directory reporting `setupOutdated: true`
- **WHEN** the folder actions menu opens
- **THEN** the `Project setup…` item SHALL carry a `● update` badge

### Requirement: Banner uses existing severity tokens and distinct glyphs

Banner surfaces SHALL draw colour exclusively from the existing `--severity-{info,warning,error}-{bg,fg,border}` triples. No new colour token SHALL be introduced.

Glyphs SHALL be: project setup `mdiTextBoxCheckOutline` (replacing `mdiFolderPlusOutline`, which read as "add a folder" beside the card's own `mdiFolderOpen`), run init hook `mdiScriptTextPlayOutline` (replacing `mdiCogPlayOutline`, which collided with `mdiCog`), init failed `mdiAlertCircleOutline`, cleanup `mdiBroom`. No glyph SHALL carry two meanings on the rendered card.

#### Scenario: No new tokens

- **WHEN** the banner renders at any severity
- **THEN** its colours SHALL resolve from an existing `--severity-*` triple

#### Scenario: Setup and hook glyphs are distinct from the card's other glyphs

- **WHEN** a card renders the folder glyph, the settings cog and a setup banner
- **THEN** no two of them SHALL use the same glyph

### Requirement: Banner is accessible

The banner SHALL be a region with an accessible name. Its action SHALL be a real `<button>` or link, reachable by keyboard, meeting the 44px touch target at mobile width. Error and failure banners SHALL announce politely, not assertively.

An unchanged banner SHALL NOT be re-announced when the card re-renders or its init-status is refetched: the live region SHALL announce on a change of banner identity or message, not on every render. Without this the polite region still nags on each refetch.

#### Scenario: Banner action is keyboard reachable

- **WHEN** the user tabs through the directory card
- **THEN** the banner action SHALL receive focus with a visible focus ring

#### Scenario: Failure announces politely

- **WHEN** an init-failure banner appears
- **THEN** it SHALL be announced via a polite live region
