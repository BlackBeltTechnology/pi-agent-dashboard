## ADDED Requirements

### Requirement: Shared onboarding step derivation
The client SHALL provide a `useOnboardingSteps()` hook that is the single source of truth for onboarding step state. It SHALL accept `{ providersReady, providersLoading, pinnedCount, sessionsCount }` as inputs and return `{ step1, step2, step3, allDone, resolved }`, where each step is `pending`, `done`, or `locked`. Every surface that renders the onboarding checklist SHALL derive its state from this hook and SHALL NOT re-implement the derivation.

The hook SHALL NOT fetch provider readiness itself; the caller supplies it, so that all consumers observe identical values within a single render pass.

`sessionsCount` SHALL count **user-visible** sessions only: sessions marked `hidden` (subagent sessions) SHALL be excluded. Sessions whose status is `ended` SHALL be included.

While provider readiness is still loading, the hook SHALL report `resolved=false`. The hook SHALL NOT report an unconfigured state merely because readiness has not yet resolved.

Consumers SHALL handle `resolved=false` as follows: the persistent card SHALL render nothing, and the `LandingPage` SHALL render its hero without step content — it SHALL NOT render steps in a provisional state, and it SHALL NOT collapse to an empty pane.

The hook SHALL be called before any conditional return in every component that uses it.

#### Scenario: Derivation matches the documented gate order
- **GIVEN** `providersReady=false`, `pinnedCount=0`, `sessionsCount=0`
- **WHEN** the hook resolves
- **THEN** it SHALL return `step1="pending"`, `step2="locked"`, `step3="locked"`, `allDone=false`

#### Scenario: Credentials unlock step ②
- **GIVEN** `providersReady=true`, `pinnedCount=0`, `sessionsCount=0`
- **WHEN** the hook resolves
- **THEN** it SHALL return `step1="done"`, `step2="pending"`, `step3="locked"`

#### Scenario: All satisfied
- **GIVEN** `providersReady=true`, `pinnedCount=1`, `sessionsCount=1`
- **WHEN** the hook resolves
- **THEN** it SHALL return all three steps `done` and `allDone=true`

#### Scenario: Both surfaces agree
- **GIVEN** the `LandingPage` and the persistent onboarding card are mounted simultaneously with the same inputs
- **WHEN** both render
- **THEN** the step states they display SHALL be identical

#### Scenario: Loading readiness renders nothing rather than "incomplete"
- **GIVEN** `providersLoading=true`
- **AND** the user is in fact fully configured
- **WHEN** the hook resolves
- **THEN** it SHALL report `resolved=false`
- **AND** the persistent card SHALL render nothing
- **AND** no onboarding surface SHALL appear and then disappear as readiness resolves

#### Scenario: LandingPage during the loading window
- **GIVEN** `providersLoading=true`
- **WHEN** the `LandingPage` renders
- **THEN** it SHALL render its hero
- **AND** it SHALL NOT render any step in a pending, done, or locked state

#### Scenario: Hidden subagent sessions do not complete step ③
- **GIVEN** `providersReady=true` and `pinnedCount=1`
- **AND** the only sessions present are marked `hidden`
- **WHEN** the hook resolves
- **THEN** `step3` SHALL be `pending`
- **AND** the latch SHALL NOT be written

#### Scenario: Mixed regression state is coherent
- **GIVEN** `providersReady=false`, `pinnedCount=1`, `sessionsCount=1`
- **WHEN** the hook resolves
- **THEN** `step1` SHALL be `pending`
- **AND** `step2` SHALL be `locked`
- **AND** `step3` SHALL be `done`
- **AND** `allDone` SHALL be `false`

### Requirement: Step ③ completion latches
Once a user-visible session has ever been observed, step ③ SHALL remain **done** even if the session count later returns to zero. The hook SHALL persist this fact under the `localStorage` key `dashboard:onboarding-session-started`, writing it **when the key is absent** and `sessionsCount > 0` is observed. Step ③'s done-condition SHALL be `sessionsCount > 0 || everStarted`. The client SHALL NOT clear this key.

The write SHALL be idempotent: repeated writes of the same value are permitted (two hook instances and StrictMode double-invocation both produce them). Conformance SHALL be asserted on the **final stored value**, never on a write call count.

**All** `localStorage` access introduced by this capability — the latch key and the collapse key alike — SHALL be failure-tolerant: when storage is unavailable, throws on read, or throws on write, the client SHALL behave as if the key were absent and SHALL NOT propagate the error.

#### Scenario: Latch is written on first session
- **GIVEN** the latch key is absent
- **WHEN** `sessionsCount` transitions from `0` to `1`
- **THEN** the hook SHALL write the latch key
- **AND** step ③ SHALL be `done`

#### Scenario: Latch survives session count returning to zero
- **GIVEN** the latch key is present
- **AND** `providersReady=true` and `pinnedCount=1`
- **WHEN** `sessionsCount` is `0`
- **THEN** step ③ SHALL still be `done`
- **AND** `allDone` SHALL be `true`

#### Scenario: Latch does not mask a prerequisite regression
- **GIVEN** the latch key is present
- **AND** `providersReady=false`
- **WHEN** the hook resolves
- **THEN** `step1` SHALL be `pending`
- **AND** `allDone` SHALL be `false`

#### Scenario: Storage unavailable
- **GIVEN** `localStorage` reads and writes throw
- **WHEN** the hook resolves
- **THEN** it SHALL treat the latch as absent
- **AND** SHALL NOT throw

#### Scenario: Collapse-preference write failure does not crash the app
- **GIVEN** `localStorage.setItem` throws (for example, a private-mode quota error)
- **WHEN** the user collapses the card
- **THEN** the card SHALL collapse
- **AND** the client SHALL NOT throw
- **AND** the un-persisted preference SHALL fall back to the breakpoint default on the next load

#### Scenario: Latch is written on the same commit that completes onboarding
- **GIVEN** the latch key is absent, `providersReady=true`, `pinnedCount=1`, `sessionsCount=0`
- **WHEN** a session is added and the route changes in a single state commit
- **THEN** the latch key SHALL be written
- **AND** it SHALL still be present after a subsequent remount with `sessionsCount=0`

### Requirement: Persistent onboarding card
The client SHALL render a persistent onboarding card as a fixed overlay, mounted outside the content router in **both** the mobile and desktop shell branches, so that it remains visible across every route. It SHALL render the same three steps as the `LandingPage`, with the same CTAs and the same activation behaviour, deriving state from `useOnboardingSteps()`.

The card component SHALL be **mounted unconditionally** by the shell and SHALL decide internally whether to render content. It SHALL render its checklist when `allDone` is `false` and `resolved` is `true`, and SHALL render nothing otherwise. The shell SHALL NOT gate the card's mounting on `allDone`, because unmounting it in the commit that completes onboarding would prevent the step-③ latch effect from running. It SHALL NOT provide a dismiss control.

#### Scenario: Card survives the step ① navigation
- **GIVEN** onboarding is incomplete
- **WHEN** the user activates the Step ① CTA and the client navigates to the providers settings page
- **THEN** the card SHALL remain rendered
- **AND** SHALL continue to show steps ② and ③

#### Scenario: Card survives the step ③ navigation
- **GIVEN** onboarding is incomplete
- **WHEN** the user activates the Step ③ CTA and the client navigates to the new session
- **THEN** the card SHALL remain rendered until `allDone` becomes `true`

#### Scenario: Card component stays mounted after completion
- **GIVEN** the card is rendering its checklist
- **WHEN** all three steps become `done`
- **THEN** the card component SHALL still be mounted
- **AND** it SHALL render no visible content

#### Scenario: Card reflects credential setup without navigation
- **GIVEN** the card is visible with Step ① pending
- **AND** the user is on the providers settings page
- **WHEN** provider credentials are saved and `useProvidersReady()` reports `ready=true`
- **THEN** Step ① on the card SHALL become `done`
- **AND** Step ② SHALL become `pending`
- **AND** no navigation SHALL be required for this to be visible

#### Scenario: Card disappears on completion
- **GIVEN** the card is visible
- **WHEN** all three steps become `done`
- **THEN** the card SHALL NOT be rendered

#### Scenario: Card and LandingPage coexist
- **GIVEN** onboarding is incomplete
- **AND** no session, folder, settings, or overlay route is active, so `LandingPage` is rendered
- **THEN** both the `LandingPage` step cards and the persistent card SHALL be rendered
- **AND** they SHALL display the same step states

#### Scenario: Mounted in both shell branches
- **GIVEN** onboarding is incomplete
- **WHEN** the shell renders in the mobile branch
- **THEN** the card SHALL be present
- **AND** the same SHALL hold when the shell renders in the desktop branch

### Requirement: Onboarding card collapse
The persistent onboarding card SHALL be collapsible to a compact pill that displays onboarding progress and no step detail. The collapsed state SHALL persist under the `localStorage` key `dashboard:onboarding-collapsed`. The card SHALL default to expanded when `useMediaQuery("(min-width: 640px)")` is true and collapsed when it is false, whenever no persisted preference exists. Where `matchMedia` is unavailable, the client SHALL treat the viewport as wide and default to expanded, matching the convention established at `InstructionsPage.tsx:99-105`. A persisted preference SHALL always take precedence over this default. Expanding and collapsing SHALL each be reachable by a single activation of a labelled control.

#### Scenario: Collapse persists across reload
- **GIVEN** the card is expanded
- **WHEN** the user collapses it and the client reloads
- **THEN** the card SHALL render collapsed

#### Scenario: Collapsed pill states progress
- **GIVEN** the card is collapsed
- **AND** two of three steps are `done`
- **THEN** the pill SHALL convey `2 of 3` complete
- **AND** SHALL expose a control to expand

#### Scenario: Narrow viewport default
- **GIVEN** no persisted collapse preference exists
- **AND** `useMediaQuery("(min-width: 640px)")` reports `false`
- **WHEN** the card renders
- **THEN** it SHALL render collapsed

#### Scenario: Wide viewport default
- **GIVEN** no persisted collapse preference exists
- **AND** `useMediaQuery("(min-width: 640px)")` reports `true`
- **WHEN** the card renders
- **THEN** it SHALL render expanded

#### Scenario: matchMedia unavailable defaults to expanded
- **GIVEN** no persisted collapse preference exists
- **AND** `window.matchMedia` is undefined
- **WHEN** the card renders
- **THEN** it SHALL render expanded
- **AND** SHALL NOT throw

### Requirement: Onboarding card placement and layering
The persistent onboarding card SHALL be anchored to the bottom-right of the viewport at a stacking level **below** the transient overlays (`WorktreeInitStack`, toast hosts), so that a time-sensitive overlay is never obscured by the standing onboarding reminder. The card SHALL NOT trap focus, SHALL NOT render as a modal dialog, and SHALL be exposed as a labelled complementary landmark. Its width SHALL be capped so it never exceeds the viewport.

#### Scenario: Transient overlay wins the shared corner
- **GIVEN** the onboarding card is visible
- **WHEN** a transient bottom-right overlay is also rendered
- **THEN** the transient overlay SHALL be drawn above the onboarding card

#### Scenario: Card is skippable and does not trap focus
- **GIVEN** the card is expanded
- **WHEN** the user tabs through the page
- **THEN** focus SHALL be able to move past the card to the rest of the page
- **AND** the card SHALL expose an accessible name identifying it as onboarding

### Requirement: Onboarding card clears the composer
On routes that render a message composer, the persistent onboarding card SHALL be raised by a fixed offset so that it clears a single-line composer. The offset SHALL be driven by an explicit prop supplied at the mount site, derived from whether a session is selected. This offset SHALL apply to both the expanded card and the collapsed pill.

The offset is **fixed, not measured**. A composer grown to multiple lines MAY overlap the card; this is an accepted limitation rather than a defect, taken because a measured offset would require observing composer resize on every route.

#### Scenario: Card is offset on a session route
- **GIVEN** onboarding is incomplete
- **AND** a session is selected, so a single-line composer is rendered
- **THEN** the card SHALL render with the composer-clearing offset applied
- **AND** the card's bounding box SHALL NOT intersect the composer's bounding box

#### Scenario: Card is not offset without a composer
- **GIVEN** onboarding is incomplete
- **AND** no session is selected
- **THEN** the card SHALL render at its default offset

## MODIFIED Requirements

### Requirement: Step ① Setup credentials
Step ① SHALL navigate the user to the providers page of the settings panel when its CTA is activated.

#### Scenario: CTA routes to providers page
- **GIVEN** Step ① is in the **pending** state
- **WHEN** the user clicks the Step ① CTA button
- **THEN** the client SHALL navigate to `/settings/providers`

#### Scenario: Done state reflects provider detection
- **GIVEN** `/api/providers` returns at least one entry with a non-empty `apiKey`
- **WHEN** Step ① renders
- **THEN** it SHALL display a ✔ row with the label "Credentials configured"

### Requirement: Step ③ Start session
Step ③ SHALL spawn a session in the first pinned directory when its CTA is activated. The CTA SHALL be disabled whenever no directories are pinned. Step ③ SHALL render as **done** when an active session exists **or** when the onboarding latch records that a session was previously started (see "Step ③ completion latches").

#### Scenario: CTA spawns in first pinned folder
- **GIVEN** Step ③ is in the **pending** state
- **AND** the pinned directory list has `firstPinnedCwd` as its first entry
- **WHEN** the user clicks the Step ③ CTA button
- **THEN** the client SHALL invoke `onSpawnSession(firstPinnedCwd)`

#### Scenario: Locked when no folders pinned
- **GIVEN** no directories are pinned
- **WHEN** Step ③ renders
- **THEN** its CTA SHALL be disabled
- **AND** a hint SHALL indicate that a pinned folder is required

#### Scenario: Done state reflects active sessions
- **GIVEN** at least one active session exists
- **WHEN** Step ③ renders
- **THEN** it SHALL display a ✔ row with the count of active sessions

#### Scenario: Done state persists after all sessions end
- **GIVEN** the onboarding latch is set
- **AND** no user-visible sessions exist
- **AND** at least one directory is pinned
- **WHEN** Step ③ renders
- **THEN** it SHALL render as **done**
- **AND** it SHALL NOT display a session count of zero beside the done indicator
- **AND** it SHALL instead display the count-free label "First session complete"

### Requirement: Empty-state onboarding surface
The dashboard client SHALL render a `LandingPage` component in the main content pane whenever no session, terminal, editor, settings panel, or other primary view is selected. The `LandingPage` SHALL display three onboarding steps — Setup credentials, Add folder, Start session — each rendered in one of three states: **pending**, **done**, or **locked**. These states SHALL be obtained from `useOnboardingSteps()` rather than derived locally.

#### Scenario: First-run user sees all guidance
- **GIVEN** no LLM provider has a non-empty `apiKey` in `/api/providers`
- **AND** no pinned directories exist
- **AND** no active sessions exist
- **WHEN** the LandingPage renders
- **THEN** Step ① "Setup credentials" SHALL be **pending** with a CTA button
- **AND** Step ② "Add folder" SHALL be **locked** with a hint identifying credentials as the unmet prerequisite
- **AND** Step ③ "Start session" SHALL be **locked** with a hint identifying a pinned folder as the unmet prerequisite

#### Scenario: Fully configured user sees compact status
- **GIVEN** at least one provider has a non-empty `apiKey`
- **AND** at least one directory is pinned
- **AND** at least one session exists
- **WHEN** the LandingPage renders
- **THEN** all three steps SHALL render as single-line done rows with a ✔ indicator
- **AND** no CTA buttons SHALL be rendered

#### Scenario: Partially configured user progresses
- **GIVEN** at least one provider has a non-empty `apiKey`
- **AND** no pinned directories exist
- **WHEN** the LandingPage renders
- **THEN** Step ① SHALL render as **done**
- **AND** Step ② SHALL render as **pending** with a CTA button
- **AND** Step ③ SHALL render as **locked**
