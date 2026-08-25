# folder-action-banner Specification

## Purpose
TBD - created by archiving change add-folder-action-banner. Update Purpose after archive.
## Requirements
### Requirement: Calls to action render in a full-width tier-0 banner

Every blocking directory-card call to action — project setup, init-hook run, init progress and init failure — SHALL render in a single full-width banner, never inline on the git row. The git row SHALL become facts-only (branch, dirty state, commit affordance) and SHALL carry no call-to-action control.

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
| `.pi/settings.json` present | *no banner*, whatever the optional tally | `Project setup… n/N` |

There SHALL be no intermediate "setup incomplete" banner. Partial setup is reported by the menu tally only.

The action SHALL spawn an interactive project-init session with cwd set to the directory, reusing the existing spawn-session machinery with the project-init skill pre-injected. It SHALL carry test id `folder-banner-setup-action-<cwd>`, superseding `project-init-btn`.

The client SHALL retain the spawned session's id and re-probe the originating row's init-status when **that session's status becomes `ended`**, so the banner clears without requiring an unrelated refetch. A setup banner that survives its own successful remedy is the most visible failure this requirement prevents — the hook-run path already re-fetches on success, and the scaffold path SHALL do the same.

Because project-init is interactive and may be abandoned, the re-probe SHALL be unconditional on the session's outcome: an abandoned session re-probes, finds the artifact still missing, and the banner correctly remains.

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

#### Scenario: The banner clears after its own action succeeds

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** the project-init session spawned from that banner reaches status `ended` having written `.pi/settings.json`
- **THEN** the row's init-status SHALL be re-probed
- **AND** the banner SHALL disappear without any other user action

#### Scenario: An abandoned setup session leaves the banner standing

- **GIVEN** a directory showing the "Not a pi project yet" banner
- **WHEN** the spawned project-init session reaches status `ended` WITHOUT writing `.pi/settings.json`
- **THEN** the row's init-status SHALL still be re-probed
- **AND** the banner SHALL remain rendered

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

