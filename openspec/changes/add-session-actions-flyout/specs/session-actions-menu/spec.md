## Purpose

One grouped flyout menu that holds every action available on a desktop session card. The card keeps only state plus a minimal set of inline controls, and the menu is reachable by click, hover, right-click or keyboard.

## ADDED Requirements

### Requirement: Desktop session card exposes one session actions menu with four entry points

The desktop session card SHALL expose a single session actions menu. The same menu, with the same items, SHALL open from each of these entry points:
- **Trigger:** a vertical-ellipsis button (`mdiDotsVertical`) in the card header (`session-actions-trigger-<sessionId>`, `aria-haspopup="menu"`, `aria-expanded` reflecting open state). The glyph SHALL differ from the folder actions menu's trigger and from every other menu trigger rendered on the card.
- **Hover strip:** a hover-intent zone along the card's right edge (see "Hover strip opens the menu only on deliberate dwell").
- **Right-click:** a `contextmenu` event on the card, which SHALL open the menu at the pointer and suppress the browser context menu. This SHALL NOT happen when:
  - the event target is a link or a text input (including the inline rename input);
  - the user has a non-empty text selection inside the card;
  - the card is being dragged.

  In those cases the browser's native menu SHALL appear.
- **Keyboard:** Shift+F10 or the ContextMenu key while keyboard focus is on an element inside the card that is not a text input. The card root itself does not need to be focusable.

Activating any entry point, and activating any item inside the menu, SHALL NOT select, navigate to, or start a drag of the card. Click, `contextmenu` and `keydown` events that originate inside the open menu SHALL NOT reach the card's own handlers, so they neither re-open nor move the menu. The mobile session card SHALL NOT render this menu.

#### Scenario: Trigger opens the menu
- **WHEN** the user clicks `session-actions-trigger-s1`
- **THEN** the session actions menu for `s1` SHALL open
- **AND** the trigger SHALL report `aria-expanded="true"`
- **AND** session `s1` SHALL NOT become selected as a result of the click

#### Scenario: Right-click opens the same menu at the pointer
- **WHEN** the user right-clicks a non-link area of session card `s1` at viewport point (150, 440)
- **THEN** the browser context menu SHALL NOT appear
- **AND** the session actions menu for `s1` SHALL open with its top-left corner at (150, 440), clamped to stay inside the viewport
- **AND** its items SHALL be identical to those shown when it is opened from the trigger

#### Scenario: Right-click on a link keeps the native menu
- **WHEN** the user right-clicks the PR link on session card `s1`
- **THEN** the browser's native context menu SHALL appear
- **AND** no session actions menu SHALL open

#### Scenario: Keyboard opens the menu from inside the card
- **WHEN** keyboard focus is on the Archive button of session card `s1` and the user presses Shift+F10
- **THEN** the session actions menu for `s1` SHALL open and focus its first enabled item

#### Scenario: Mobile card has no session actions menu
- **WHEN** the session list renders in the mobile layout
- **THEN** no `session-actions-trigger-*` SHALL render and right-clicking a card SHALL NOT open a session actions menu

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
- **PLUGINS:** the output of `session-card-action-bar` claims and intents, including the flows plugin's flow actions (see "Plugin contributions render inside the PLUGINS group").
- **VIEW:**
  - `Card sections…` opens the Session cards page of the session's group folder (`gitWorktree.mainPath` for worktree sessions, otherwise the session's cwd).
  - `Card section defaults…` opens the global Session cards defaults in Settings.

The menu holds the host's session actions, the `session-card-action-bar` slot output and the flows plugin's flow actions. Controls rendered inside other plugin-owned sections stay where their plugin renders them: MEMORY subcard content, `session-card-badge` claims in STATUS (for example, a relay badge popover), and worktree card-section claims (for example, KB re-index). Moving them is out of scope.

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

### Requirement: NEXT shows exactly one emphasised primary

The `NEXT` group SHALL contain at most one item, rendered with primary emphasis. No other item in the menu SHALL carry primary emphasis, so a card shows at most one emphasised primary. It shows none when no candidate applies.
- When the Merge-emphasis rule of `worktree-lifecycle` holds for the session, the NEXT item SHALL be Merge. The OpenSpec primary SHALL then render, without emphasis, as an item of the `OPENSPEC` group.
- Otherwise, the NEXT item SHALL be the OpenSpec primary action that `openspec-attach-combo` derives for the attached change (Continue / Fast-forward / Apply / Archive / Verify).
- When neither applies, the `NEXT` group SHALL NOT render.

An item placed in NEXT SHALL NOT be repeated in its home group. While the session is working (streaming or auto-retrying), the NEXT item SHALL render `aria-disabled` with a reason, consistent with the inline primary it replaces.

#### Scenario: Apply is the next step
- **WHEN** session `s1` is attached to a change in state `IMPLEMENTING` and Merge is not primary
- **THEN** `NEXT` SHALL contain exactly one item, Apply
- **AND** the `OPENSPEC` group SHALL NOT also list Apply

#### Scenario: Merge wins and the OpenSpec primary stays reachable
- **WHEN** session `s1` is in a worktree with an open, non-draft PR whose checks are passing, and its attached change is `COMPLETE`
- **THEN** `NEXT` SHALL contain Merge
- **AND** the `OPENSPEC` group SHALL contain **Archive change** without emphasis
- **AND** the menu SHALL contain no other primary-emphasised item

#### Scenario: Ended session without a primary
- **WHEN** session `s1` has ended and no Merge-emphasis condition holds
- **THEN** no `NEXT` group SHALL render

### Requirement: Rarely used items fold behind one inline More… expander per group

A group MAY designate items as rare. When a group has two or more rare items, they SHALL be hidden behind a single `More…` item at the end of the group, labelled with the hidden count. When a group has exactly one rare item, it SHALL render inline with no expander.

Activating `More…` SHALL reveal the hidden items in place inside the same menu. It SHALL NOT open a nested submenu. It SHALL set `aria-expanded="true"`, keep the menu open, and move focus to the first revealed item. Arrow-key navigation SHALL include revealed items and skip hidden ones. The expanded state SHALL reset when the menu closes.

The rare set SHALL be: in `OPENSPEC`, Fast-forward, Explore…, Archive anyway…, Detach; in `GIT`, Close worktree….

#### Scenario: OpenSpec rare items fold
- **WHEN** the menu opens for a session attached to a change with all workflows enabled
- **THEN** Fast-forward, Explore…, Archive anyway… and Detach SHALL NOT be visible
- **AND** a `More…` item showing `4` SHALL render at the end of the `OPENSPEC` group

#### Scenario: Expanding More… moves focus into the revealed items
- **WHEN** focus is on the `OPENSPEC` `More…` item and the user presses Enter
- **THEN** the four hidden items SHALL become visible in place
- **AND** focus SHALL move to Fast-forward
- **AND** ArrowDown SHALL move focus to Explore…
- **AND** the menu SHALL remain open

#### Scenario: A single rare item is not folded
- **WHEN** a group's only rare item is Detach (for example, an ended attached session)
- **THEN** Detach SHALL render inline and no `More…` item SHALL render in that group

### Requirement: Menu items keep the availability of the controls they replace

Each menu item SHALL be offered exactly when the control it replaces was offered, and disabled exactly when that control was disabled, with the same reason text:
- Resume renders only for ended or hidden sessions with a `sessionFile`. Fork renders for any session with a `sessionFile`. Neither renders for remote-origin or ACP sessions.
- Resume and Fork are disabled while the session is resuming (`resuming === true`).
- Resume, Fork, New session and New worktree session are disabled with reason "session's directory no longer exists" when `cwdMissing` is true.
- New worktree session follows the `gitWorktreeEnabled`, `gitWorktree` and `isGitRepo === false` gates.
- Rename… renders only for non-ended sessions with rename support.
- Archive session follows exactly the gate of the card's header Archive button.
- Push, Open PR and Merge are disabled while the session is working.
- OpenSpec items follow the folder's workflow configuration and the streaming and ended rules of `openspec-attach-combo`.

A disabled item SHALL render `aria-disabled="true"` and stay focusable. Activating it SHALL NOT invoke its action and SHALL NOT close the menu. Activating an enabled item SHALL invoke the same handler the replaced control invoked, then close the menu. Activating an item that opens a dialog SHALL open that dialog, which paints above the menu's layer.

#### Scenario: New session carries the parent's proposal
- **WHEN** the user activates New session in the menu of a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"` and a UUIDv4 `requestId`
- **AND** the menu SHALL close

#### Scenario: Disabled item stays focusable and inert
- **WHEN** session `s1` has `cwdMissing === true` and the user activates Fork in its menu
- **THEN** Fork SHALL have `aria-disabled="true"` with reason "session's directory no longer exists"
- **AND** no fork request SHALL be sent
- **AND** the menu SHALL remain open

#### Scenario: Streaming disables worktree mutations
- **WHEN** the menu opens for a streaming worktree session
- **THEN** Push and Merge SHALL render `aria-disabled="true"`

#### Scenario: Ended session has no Rename
- **WHEN** the menu opens for an ended session
- **THEN** no Rename… item SHALL render

### Requirement: Card status that can be clicked stays on the card and is mirrored in the menu

The desktop card SHALL keep these clickable status elements, each with its current click behaviour:
- the OpenSpec lifecycle bar segments and the attached change link;
- the archived / missing / main-checkout artifact letters and badges;
- the remediation control of a disabled OPENSPEC subcard;
- the git branch control, the dirty-files pill and the PR link.

The menu SHALL also offer each of their actions. The remediation control is the exception, because it is a property of the disabled subcard state rather than a session action.

The lifecycle artifact row in the `OPENSPEC` group SHALL mirror the card's lifecycle bar: the same five segments, the same done / current / skipped / pending state, and the same per-segment action (read artifact, open tasks, archive). A segment that is inert on the card SHALL render in the menu as non-interactive status. It SHALL NOT be focusable and SHALL NOT be a `menuitem`, matching the card's rule that inert segments are not focusable.

#### Scenario: Lifecycle segment works on both surfaces
- **WHEN** the user clicks the Design segment on the card of a session attached to `add-auth`
- **THEN** the Design artifact of `add-auth` SHALL open
- **AND WHEN** the user instead activates the Design item in that session's menu
- **THEN** the same artifact SHALL open and the menu SHALL close

#### Scenario: Skipped artifact is inert in the menu
- **WHEN** the attached change skipped its specs artifact
- **THEN** the Specs segment in the menu's artifact row SHALL NOT be focusable and SHALL NOT have `role="menuitem"`

### Requirement: Hover strip opens the menu only on deliberate dwell

On devices matching `(hover: hover) and (pointer: fine)`, each desktop card SHALL have a hover strip.
- **Geometry:** a band 32 px wide along the card's right edge, spanning the full card height.
- **Detection:** geometric, from pointer coordinates. The strip SHALL NOT intercept pointer events, so controls under it stay clickable.
- **Over controls:** while the pointer is over a button or link, the strip SHALL NOT arm.

The strip SHALL open the menu only when both of these hold:
- the pointer has stayed inside it for at least the dwell time (default 300 ms);
- the pointer speed, measured over the most recent 100 ms, is below the speed cutoff (default 0.4 px/ms).

Leaving the strip before the menu opens SHALL cancel it. A menu opened by hover SHALL NOT move focus. Escape SHALL still close it, leaving focus where it was.

A menu opened by hover SHALL stay open while the pointer is over the card, the menu, or the gap between them. It SHALL close after a grace period (default 300 ms) once the pointer is outside all three. A menu opened by click, right-click or keyboard SHALL NOT close on pointer leave.

The strip SHALL NOT arm:
- while any session actions menu was opened by click, right-click or keyboard;
- while a dialog is open;
- while the card is being renamed inline or dragged;
- on devices without fine hover.

#### Scenario: Fast pass-through to the chat does not open the menu
- **WHEN** the pointer crosses the strip of card `s1` toward the chat pane at 1.5 px/ms without stopping
- **THEN** the menu SHALL NOT open

#### Scenario: Dwell opens the menu without stealing focus
- **WHEN** the pointer rests inside the strip of card `s1` for 300 ms below the speed cutoff
- **THEN** the menu for `s1` SHALL open
- **AND** keyboard focus SHALL remain where it was

#### Scenario: Close button under the strip stays usable
- **WHEN** the pointer rests on the card's Exit ✕ button, which lies partly inside the strip, for 500 ms
- **THEN** the menu SHALL NOT open
- **AND** clicking ✕ SHALL exit the session as before

#### Scenario: Hover-opened menu closes after the grace period
- **WHEN** a hover-opened menu is open and the pointer leaves card, gap and menu for longer than 300 ms
- **THEN** the menu SHALL close

#### Scenario: Escape closes a hover-opened menu
- **WHEN** a hover-opened menu is open and the user presses Escape
- **THEN** the menu SHALL close and keyboard focus SHALL stay on the element that had it before

#### Scenario: Touch devices have no hover strip
- **WHEN** the device does not match `(hover: hover) and (pointer: fine)`
- **THEN** no hover strip SHALL arm, and the trigger and keyboard entry points SHALL still open the menu

### Requirement: Menu placement and layering

The menu SHALL render through the layer portal and paint at the `popover` layer token. It SHALL never use a raw numeric z-index.

**Placement:**
- When opened from the trigger, the hover strip or the keyboard, the menu SHALL be positioned `fixed` beside the card's right edge, with its top aligned to the card's top and clamped inside the viewport. It SHALL re-measure on ancestor scroll (including the sidebar list) and on resize, without re-rendering the menu's content. Scrolling inside the menu itself SHALL NOT reposition it.
- When opened by right-click, the menu SHALL be positioned at the pointer. It stays anchored to the card at that offset, so it tracks ancestor scroll and resize like a trigger-opened menu, clamped inside the viewport.
- When there is not enough room to the right of the card, the menu SHALL stay clamped inside the viewport, even if it overlaps the card.
- Its height SHALL be capped to the available viewport space, with the overflow scrolling inside the menu and group headings staying visible while it scrolls. As `popover-viewport-positioning` requires, any minimum-height floor SHALL NOT push the menu past the space it is clamped to. The menu is anchored to the card and opens to the side, not to a trigger above or below, so the up/down flip decision of that requirement does not apply.

At most one actions menu SHALL be open at a time across session and folder scopes. Opening a session actions menu SHALL close any other session actions menu and any open folder actions menu, and vice versa.

#### Scenario: Menu paints above neighbouring cards
- **WHEN** the menu of card `s1` overlaps card `s2`, which establishes its own stacking context
- **THEN** the menu SHALL paint entirely above `s2`

#### Scenario: Dialog paints above the menu
- **WHEN** a menu is open and a modal dialog opens
- **THEN** the dialog SHALL paint above the menu

#### Scenario: Menu follows its card when the sidebar scrolls
- **WHEN** the trigger-opened menu of card `s1` is open and the sidebar list scrolls by 60 px
- **THEN** the menu SHALL move with `s1` and stay aligned to its top edge

#### Scenario: Opening a session menu closes the folder menu
- **WHEN** the folder actions menu of `/a` is open and the user opens the session actions menu of `s1`
- **THEN** the folder actions menu SHALL close and only the session actions menu of `s1` SHALL be open

### Requirement: Menu is keyboard accessible

The menu SHALL have `role="menu"`. Every host item SHALL have `role="menuitem"`. Plugin intent action lists SHALL render as `menuitem`s. React claim output in the `PLUGINS` group SHALL be exposed as a labelled `role="group"` per plugin, and its focusable controls SHALL join the menu's arrow-key order.

**Opening:** opening by click or keyboard SHALL move focus to the first enabled item.

**While open:**
- ArrowDown and ArrowUp SHALL move focus through the visible focusable items, wrapping at the ends;
- Home and End SHALL jump to the first and last item;
- Escape and Tab SHALL close the menu and return focus to the element that had focus when the menu opened (the trigger for a click on it). When that element is no longer in the document, focus SHALL go to the trigger;
- an outside click SHALL close the menu.

#### Scenario: Escape returns focus to the opener
- **WHEN** the menu was opened with Shift+F10 while the Archive button of card `s1` had focus, and the user presses Escape
- **THEN** the menu SHALL close and focus SHALL return to that Archive button

#### Scenario: Arrow navigation skips folded items
- **WHEN** the `OPENSPEC` `More…` group is collapsed and focus is on the item before it
- **THEN** ArrowDown SHALL move focus to `More…`, not to a hidden item

### Requirement: Plugin contributions render inside the PLUGINS group

The menu SHALL host plugin actions through the existing `session-card-action-bar` slot. No new plugin API is added.

**Lifecycle.** Claims on the slot SHALL stay mounted for the lifetime of the desktop card, so their effects, subscriptions and the dialogs they own survive the menu closing. Their rendered output SHALL appear only inside the menu's `PLUGINS` group, with their existing props, per-claim error isolation, and the per-plugin `actionbar-<pluginId>` visibility filter.

**Rendering:**
- Intent `action-list` contributions on the slot SHALL render as `menuitem`s.
- React claim output SHALL render inside a labelled group per plugin.
- Activating an enabled control inside plugin output SHALL close the menu and SHALL NOT select the card. A dialog the claim opened in response SHALL stay open.
- The `PLUGINS` heading SHALL render only when plugin output has rendered content.

#### Scenario: Plugin output appears only in the menu
- **WHEN** the goal plugin's `session-card-action-bar` claim renders for goal-linked session `s1`
- **THEN** its output SHALL NOT render on the card
- **AND** it SHALL render in the `PLUGINS` group of `s1`'s menu when the menu is open

#### Scenario: Claim-owned dialog survives the menu closing
- **WHEN** the user activates **Run Flow…** in the `PLUGINS` group of `s1`'s menu
- **THEN** the menu SHALL close
- **AND** the flows plugin's run dialog SHALL open and stay open

#### Scenario: Intent action list renders as menu items
- **WHEN** a plugin publishes an `action-list` intent on `session-card-action-bar` for `s1`
- **THEN** each action SHALL render in `s1`'s menu with `role="menuitem"`

#### Scenario: Claim rendering nothing leaves no heading
- **WHEN** the only action-bar claim renders `null` for session `s1`
- **THEN** `s1`'s menu SHALL NOT render a `PLUGINS` heading

### Requirement: Menu follows its session's live state

While open, the menu SHALL re-derive its items from the session's current state, so items enable, disable, appear or disappear in place, and the NEXT item may change. It SHALL NOT show a snapshot taken at open time.

When the item that had focus still exists by id, focus SHALL stay on it. Otherwise focus SHALL move to the first enabled item.

When the card the menu belongs to unmounts while the menu is open (the session is archived, filtered out, or its folder collapses), the menu SHALL close and focus SHALL move to the session list region. Focus SHALL NOT fall to the document body.

#### Scenario: Streaming starts while the menu is open
- **WHEN** the menu of idle worktree session `s1` is open with focus on Push, and `s1` starts streaming
- **THEN** Push SHALL become `aria-disabled="true"` without the menu closing
- **AND** focus SHALL remain on Push

#### Scenario: Focused item disappears
- **WHEN** focus is on Open PR in `s1`'s menu and a PR is detected for the branch, so Open PR is replaced by View PR #N
- **THEN** focus SHALL move to the first enabled item of the menu

#### Scenario: Card unmounts under an open menu
- **WHEN** `s1`'s menu is open and `s1` is archived from another surface, so its card unmounts
- **THEN** the menu SHALL close
- **AND** focus SHALL be inside the session list region, not on the document body

### Requirement: Menu opens within 100 ms

With 50 session cards rendered, the menu SHALL be visible within 100 ms of a trigger click, at the 95th percentile over 20 opens.

#### Scenario: Open latency with a large session list
- **WHEN** 50 session cards are rendered and the trigger of one card is clicked 20 times (closing in between)
- **THEN** the 95th-percentile time from click to the menu panel being visible SHALL be at most 100 ms

### Requirement: Stable test hooks

The menu SHALL expose:
- `session-actions-menu-<sessionId>` on its panel;
- `session-menu-item-<id>` on host items;
- `session-menu-more-<group>` on each `More…` expander.

The New session and New worktree session items SHALL keep the existing test ids `session-card-spawn-sibling` and `session-card-spawn-worktree`.

#### Scenario: Legacy spawn test ids survive
- **WHEN** a test opens the menu of an eligible git session and queries `session-card-spawn-worktree`
- **THEN** it SHALL find the New worktree session item
