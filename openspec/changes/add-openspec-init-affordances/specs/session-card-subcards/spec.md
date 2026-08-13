## ADDED Requirements

### Requirement: OPENSPEC subcard visibility is governed by broadcast readiness

The OPENSPEC subcard's gate SHALL be the cwd's broadcast readiness state (see
`openspec-readiness`), replacing the `openspecHasDir || openspecPending` condition currently
evaluated in `SessionCard.tsx` and the equivalent condition in `ComposerSessionActions.tsx`.

| readiness state | OPENSPEC subcard |
|---|---|
| `GLOBAL_OFF` | hidden |
| `OPTED_OUT` | hidden |
| `ABSENT` | hidden |
| `PENDING` | existing placeholder |
| `BROKEN` | rendered **disabled** |
| `STALE` | rendered **disabled** |
| `READY` | rendered live |

`ABSENT` hides rather than disabling: initialization is offered once on the folder card, not
repeated on every session card in that directory.

When `readiness` is absent from the payload — an older server — the gate SHALL degrade to the
previous `hasOpenspecDir || pending` behaviour and SHALL NOT render a disabled subcard.

#### Scenario: Directory with no OpenSpec hides the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `ABSENT`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: Partially initialized directory disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `BROKEN`
- **THEN** an element with title text `OPENSPEC` SHALL appear
- **AND** it SHALL NOT render the Explore, Propose, Attach, or Archive controls

#### Scenario: Valid project with no pi skills disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `STALE`
  with reason `missing-skills`
- **THEN** the OPENSPEC subcard SHALL render disabled
- **AND** the reason text SHALL indicate that the project's OpenSpec skills are missing

#### Scenario: Ready project renders live controls

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `READY`
- **THEN** the OPENSPEC subcard SHALL render its full control set

#### Scenario: Legacy server degrades to previous behaviour

- **WHEN** the client receives `OpenSpecData` with no `readiness` field
- **THEN** the subcard SHALL render exactly as it does today
- **AND** no disabled variant SHALL be shown

### Requirement: Disabled OPENSPEC subcard is inert and routes to a surface that can remediate

A disabled OPENSPEC subcard SHALL render a reason line describing why OpenSpec is unavailable
for this directory, and exactly one focusable control.

Every action control that the live subcard would render SHALL be **absent from the DOM**, not
merely visually dimmed. A control that is focusable but silently does nothing is a worse
failure than the state this change removes, because it fails identically while appearing
deliberate.

The single control SHALL target the surface that can actually resolve the reported reason:

| reason | control target |
|---|---|
| `missing-changes-dir`, `cli-failed` (`BROKEN`) | the folder card's OpenSpec section |
| `missing-skills` (`STALE`) | the folder card's OpenSpec section |
| `profile-stale` (`STALE`) | Settings → OpenSpec Workflow Profile |

A control pointing at a surface that cannot remediate the reported reason SHALL NOT be
rendered.

When the target is the folder card's OpenSpec section, activating the control SHALL scroll that
folder's header into view, expand the folder group if it is collapsed, and move focus to the
OpenSpec section. It SHALL NOT open a Repair or Update dialog from the session card — the
session card reports readiness and never acts on it.

The reason text SHALL be the accessible explanation — not a `title` attribute — and SHALL
distinguish each reason.

#### Scenario: No action controls in the tab order

- **WHEN** the OPENSPEC subcard renders disabled
- **THEN** the only focusable element within it SHALL be the single remediation control

#### Scenario: Broken state routes to the folder card

- **WHEN** the subcard renders disabled with reason `missing-changes-dir`
- **THEN** its control SHALL target the folder card's OpenSpec section
- **AND** it SHALL NOT target the Settings profile section

#### Scenario: Routing scrolls and expands a collapsed folder

- **WHEN** the user activates the control on a disabled subcard whose folder group is collapsed
- **THEN** the folder group SHALL be expanded
- **AND** its header SHALL be scrolled into view
- **AND** focus SHALL move to the OpenSpec section
- **AND** no Repair or Update dialog SHALL open

#### Scenario: Profile staleness routes to Settings

- **WHEN** the subcard renders disabled with reason `profile-stale`
- **THEN** its control SHALL target the settings surface containing the OpenSpec Workflow
  Profile section

#### Scenario: Reason text distinguishes the states

- **WHEN** the subcard renders disabled for `BROKEN`
- **THEN** the reason text SHALL differ from the text rendered for each `STALE` reason

## MODIFIED Requirements

### Requirement: Subcards hide when their content is empty

Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no
element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

For MEMORY, WORKSPACE, and FLOWS, the wrapper's visibility is governed by the `shouldRender`
claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no
plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that
registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender`
**whose boolean condition matches the claim component's own render/skip condition**, so the
wrapper never renders an empty panel.

For the FLOWS subcard specifically, the `session-card-flows` claim (`SessionFlowActionsClaim`)
returns `null` when the session has zero flows AND edit mode is off AND no flow is running or
has run. Its `shouldRender` predicate (`shouldRenderFlowsSubcard`) SHALL therefore return
`true` **iff at least one of**: the session's `flowsList` is non-empty, the flows plugin's edit
mode (`editFlow`) is on, or the session has at least one flow event. The predicate SHALL NOT
open on mere pi-flows extension presence (existence of a `flows` / `flows:*` command) when none
of those conditions hold.

**The OPENSPEC subcard is exempt from the empty-content rule.** Its visibility is governed by
readiness, and in the `BROKEN` and `STALE` states it renders deliberately with no action
controls. An OPENSPEC panel containing only a reason line and a single remediation control
SHALL NOT be treated as empty.

#### Scenario: Empty PROCESS subcard is hidden

- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: Control-less OPENSPEC subcard is not treated as empty

- **WHEN** the OPENSPEC subcard renders disabled, containing only a reason line and a single
  remediation control
- **THEN** the panel and its `OPENSPEC` title SHALL still render

#### Scenario: FLOWS subcard hidden when extension loaded but nothing actionable

- **WHEN** a desktop session card is rendered for a session whose cwd has the pi-flows
  extension loaded (a `flows` command is present)
- **AND** the session's `flowsList` is empty
- **AND** the flows plugin edit mode (`editFlow`) is off
- **AND** the session has no flow event (no flow running or previously run)
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** no empty flows panel SHALL be rendered

#### Scenario: FLOWS subcard appears in edit mode with zero flows

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList`
- **AND** the flows plugin edit mode (`editFlow`) is on
- **THEN** an element with title text `FLOWS` SHALL appear (the author-first / New-Edit entry
  point)

#### Scenario: FLOWS subcard appears when a flow has run with zero listed flows

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList` and edit
  mode off
- **AND** the session has at least one flow event (a flow ran or is running)
- **THEN** an element with title text `FLOWS` SHALL appear
