# Spec Delta

## MODIFIED Requirements

### Requirement: Empty-state onboarding surface
The dashboard client SHALL render a `LandingPage` component in the main content pane whenever no session, terminal, editor, settings panel, or other primary view is selected. The `LandingPage` SHALL display its three onboarding steps as a single ordered list, in this order: connect a model provider, create your first project, start your first session.

Each step SHALL be in one of three states, derived from the current application state. Step ① has a fourth state, **skipped** (see "Step ① can be skipped"):
- **pending:** the first pending step in order is expanded and carries the step's call-to-action. Any later pending step renders as one line with no controls, naming the earlier step it waits on;
- **done:** the step collapses to one line with a check marker. Only Step ① may add the Claude subscription compat status, and only Step ② the "already existed" note, beneath that line;
- **locked:** the step collapses to one line with a lock marker and text naming the unmet prerequisite, and renders no controls;
- **skipped** (Step ① only): the step collapses to one line with a skip marker, text stating that provider setup was skipped, and one secondary control that resumes setup. A skipped step is not pending: it is never the expanded first pending step, and no later step waits on it. It is not done either, and SHALL NOT count toward the progress line.

Every state SHALL be conveyed by a marker and text, never by colour alone. Above the list, a progress line SHALL state how many of the three steps are done. At most one control SHALL use the primary-button treatment: the call-to-action of the first pending step, if any.

#### Scenario: First-run user sees all guidance
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has not been skipped
- **AND** no pinned directories exist
- **AND** no active sessions exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL be **pending** with a CTA button
- **AND** Step ② SHALL be **locked**, rendering no controls, with text identifying credentials as the unmet prerequisite
- **AND** Step ③ SHALL be **locked**, rendering no controls, with text identifying a project folder as the unmet prerequisite
- **AND** the progress line SHALL report 0 of 3 steps done

#### Scenario: Fully configured user sees compact status
- **GIVEN** `useProvidersReady()` reports credentials
- **AND** at least one directory is pinned
- **AND** at least one session exists
- **WHEN** the LandingPage renders
- **THEN** all three steps SHALL render as done rows with a ✔ indicator
- **AND** no step CTA buttons SHALL be rendered (a compat **Turn on** action beneath Step ① is not a step CTA)

#### Scenario: Folder pinned before credentials
- **GIVEN** `useProvidersReady()` reports no credentials
- **AND** Step ① has not been skipped
- **AND** a directory was pinned from the sidebar
- **AND** no sessions exist
- **WHEN** the LandingPage renders
- **THEN** only Step ① SHALL be expanded with a primary CTA
- **AND** Step ③ SHALL render as one line with no controls, naming Step ① as the step it waits on

#### Scenario: Partially configured user progresses
- **GIVEN** `useProvidersReady()` reports credentials
- **AND** no pinned directories exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL render as **done**
- **AND** Step ② SHALL render as **pending** with its inline project-name field and Create project button
- **AND** Step ③ SHALL render as **locked**
- **AND** the progress line SHALL report 1 of 3 steps done

## ADDED Requirements

### Requirement: Step ① done row reports the Claude subscription compat state
While Step ① is **done** and the `anthropic` subscription is authenticated, its done row SHALL show a compat status only when the Claude subscription compat switch is off: a notice that Claude subscription requests may be billed as extra usage, with a secondary **Turn on** action that sets the same global switch as the `anthropic` provider row. Landing SHALL NOT probe, recommend or install `pi-anthropic-messages`.

#### Scenario: Switch off
- **GIVEN** the `anthropic` subscription is authenticated and the compat switch is off
- **WHEN** Step ① renders as **done**
- **THEN** its done row shows the extra-usage notice with a **Turn on** action using the secondary-button treatment
- **AND** the status is announced politely to assistive technology
- **AND** Step ② remains usable

#### Scenario: Turn on from Landing
- **WHEN** the operator activates **Turn on**
- **THEN** the compat switch is on and the done row shows no compat status
- **AND** no package install is enqueued

#### Scenario: Switch on
- **GIVEN** the compat switch is on
- **WHEN** Step ① renders as **done**
- **THEN** its done row shows no compat status

#### Scenario: No Claude subscription
- **GIVEN** `anthropic` is not authenticated
- **WHEN** Step ① renders as **done** because another provider is configured
- **THEN** its done row shows no compat status

## REMOVED Requirements

### Requirement: Step ① done row reports the Claude peer state
**Reason**: `pi-anthropic-messages` is no longer probed, recommended or installed; the compat switch replaces it.
**Migration**: See "Step ① done row reports the Claude subscription compat state".
