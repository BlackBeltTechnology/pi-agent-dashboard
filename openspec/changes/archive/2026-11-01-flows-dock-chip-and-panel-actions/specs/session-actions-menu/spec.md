## MODIFIED Requirements

### Requirement: Menu groups are a fixed host-owned taxonomy

The menu SHALL render its items in these groups, in this order: `NEXT`, `SESSION`, `OPENSPEC`, `GIT`, `PLUGINS`, `VIEW`. A group SHALL render only when it has at least one item. Each group SHALL show its title, and `OPENSPEC` and `GIT` SHALL show the change name and branch respectively as a subtitle.

Group contents:
- **NEXT:** at most one item (see "NEXT shows exactly one emphasised primary").
- **SESSION:** Resume, Fork, New session, New worktree session, Rename…, Archive session, Exit pi session — each only when the control it corresponds to would be offered.
- **OPENSPEC**, by attachment state:
  - **Attached change (resolves `active` in the session's cwd):** the five lifecycle artifacts (Proposal, Design, Specs, Tasks, Archive) as one row, then Open change, the OpenSpec primary when it is not the NEXT item (an Archive primary is labelled **Archive change**), Verify (when neither primary nor NEXT), Fast-forward, Explore…, Archive anyway…, Detach. Each is subject to the folder's OpenSpec workflow configuration and the attach-combo state rules.
  - **Archived, missing, unresolved, or active in the main checkout:** the artifact letters the card shows for that state, as items with the same navigation, then Detach. No workflow item.
  - **No attached change:** Attach change…; New change…, Propose… and Explore… (only for active sessions, each subject to the workflow configuration); and Bulk archive… (when completed changes exist).
  - **Readiness gate:** the `OPENSPEC` group follows the same readiness gate as the OPENSPEC subcard (`session-card-subcards`).
    - `GLOBAL_OFF`, `OPTED_OUT`, `ABSENT` and `PENDING`: the group is omitted.
    - `BROKEN` and `STALE`: the group contains no workflow, attach, propose or archive item. It contains only Detach when a change is attached; otherwise it is omitted. Remediation stays on the card's disabled subcard.
    - Payload with no `readiness` field (older server): the group degrades exactly as the subcard does.
- **GIT:** Commit N changes… (when dirty), Switch branch…, then the worktree actions — Push, Open PR or View PR #N, Merge (when not the NEXT item), Close worktree…
- **PLUGINS:** the output of `session-card-action-bar` claims and intents (see "Plugin contributions render inside the PLUGINS group"). The flows plugin contributes here only for a session without flows (see `flows-plugin`).
- **VIEW:**
  - `Card sections…` opens the Session cards page of the session's group folder (`gitWorktree.mainPath` for worktree sessions, otherwise the session's cwd).
  - `Card section defaults…` opens the global Session cards defaults in Settings.

The menu holds the host's session actions and the `session-card-action-bar` slot output. Flow actions for a session with flows live in the FLOWS dock chip and the flow panel header (see `flows-dock-chip`). Controls rendered inside other plugin-owned sections stay where their plugin renders them: MEMORY subcard content, `session-card-badge` claims in STATUS (for example, a relay badge popover), and worktree card-section claims (for example, KB re-index). Moving them is out of scope.

Section visibility ids other than `spawn` and `actionbar-<pluginId>` (for example `openspec`, `git`, `flows`, `memory`) hide card sections only. They do not remove menu items.

Some controls act on one specific running thing rather than on the session. They stay on the card and are not mirrored in the menu:
- the PROCESS subcard's row controls: stop an in-flight tool, kill a background process, expand or collapse the drawer;
- the `ProcessSafetyChip` that replaces a hidden PROCESS subcard, and its sheet;
- the abort control on a running flow's status in the FLOWS subcard.

#### Scenario: Empty group is omitted
- **WHEN** the menu opens for a session with no plugin contributions
- **THEN** no `PLUGINS` heading SHALL render

#### Scenario: Unattached session offers attach actions
- **WHEN** the menu opens for an active session with no attached change in an OpenSpec-initialised folder
- **THEN** the `OPENSPEC` group SHALL contain Attach change…, New change… and Explore…
- **AND** SHALL NOT contain the lifecycle artifact row

#### Scenario: Archived attachment offers only letters and Detach
- **WHEN** the menu opens for a session whose attachment resolves `archived` with proposal, design and tasks
- **THEN** the `OPENSPEC` group SHALL contain items P, D and T that navigate to the archived artifacts, then Detach
- **AND** no workflow item and no NEXT item derived from OpenSpec SHALL render

#### Scenario: Opted-out folder has no OpenSpec items
- **WHEN** the menu opens for a session whose cwd readiness is `OPTED_OUT`
- **THEN** no `OPENSPEC` group SHALL render

#### Scenario: Broken folder offers only Detach
- **WHEN** the menu opens for a session attached to a change in a cwd whose readiness is `BROKEN`
- **THEN** the `OPENSPEC` group SHALL contain only Detach
- **AND** no NEXT item derived from OpenSpec SHALL render

#### Scenario: Worktree session omits New worktree session
- **WHEN** the menu opens for a session whose `gitWorktree` is set
- **THEN** the `SESSION` group SHALL NOT contain New worktree session

#### Scenario: Card sections targets the group folder for a worktree session
- **WHEN** the user activates `Card sections…` for a session whose `gitWorktree.mainPath` is `/repo`
- **THEN** the app SHALL navigate to `/repo`'s Session cards page

### Requirement: Plugin contributions render inside the PLUGINS group

The menu SHALL host plugin actions through the existing `session-card-action-bar` slot. No new slot or contribution mechanism is added. The only plugin-facing addition is the optional `tone` field on existing `ui:action-list` items (see `plugin-ui-primitive-registry`).

**Lifecycle.** Claims on the slot SHALL stay mounted for the lifetime of the desktop card, so their effects, subscriptions and the dialogs they own survive the menu closing. Their rendered output SHALL appear only inside the menu's `PLUGINS` group, with their existing props, per-claim error isolation, and the per-plugin `actionbar-<pluginId>` visibility filter.

**Rendering:**
- Intent `action-list` contributions on the slot SHALL render as `menuitem`s, honouring each action's optional `tone` (see "Menu items carry an optional semantic tone").
- React claim output SHALL render inside a labelled group per plugin.
- Activating an enabled control inside plugin output SHALL close the menu and SHALL NOT select the card. A dialog the claim opened in response SHALL stay open.
- The `PLUGINS` heading SHALL render only when plugin output has rendered content.

#### Scenario: Plugin output appears only in the menu
- **WHEN** the goal plugin's `session-card-action-bar` claim renders for goal-linked session `s1`
- **THEN** its output SHALL NOT render on the card
- **AND** it SHALL render in the `PLUGINS` group of `s1`'s menu when the menu is open

#### Scenario: Claim-owned dialog survives the menu closing
- **WHEN** the user activates **New flow…** in the `PLUGINS` group of a flowless session `s1`'s menu
- **THEN** the menu SHALL close
- **AND** the flows plugin's authoring dialog SHALL open and stay open

#### Scenario: Intent action list renders as menu items
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1`
- **THEN** each action SHALL render in `s1`'s menu with `role="menuitem"`

#### Scenario: Claim rendering nothing leaves no heading
- **WHEN** the only action-bar claim renders `null` for session `s1`
- **THEN** `s1`'s menu SHALL NOT render a `PLUGINS` heading

#### Scenario: Plugin action-list item honours its tone
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1` with one action `{ label: "Stop recording", tone: "danger" }`
- **THEN** that action's `menuitem` in `s1`'s `PLUGINS` group SHALL carry `data-action-tone="danger"` and an icon coloured `--accent-red-text`
