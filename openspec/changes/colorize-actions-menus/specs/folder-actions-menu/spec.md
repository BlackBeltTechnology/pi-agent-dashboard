## ADDED Requirements

### Requirement: Folder menu items carry an optional semantic tone

Every folder menu item, whether host or plugin-contributed, MAY carry one `UiTone`. Rendering, the `data-action-tone` hook, disabled behaviour and the contrast floors SHALL follow the session actions menu (`session-actions-menu`, "Menu items carry an optional semantic tone"):
- the icon takes the tone's `--accent-<hue>-text` token, and the label keeps the neutral item colour;
- an enabled `danger` item, while hovered or focused, renders on `--tint-red-bg` with icon and label in `--accent-red-text`;
- invalid tone values, including inherited object keys, render neutral;
- a disabled item drops the colour but keeps `data-action-tone`.

This applies in both the dropdown and the narrow-viewport sheet form. The `Group sessions by` radio items (`menuitemradio`) SHALL NOT be toned. `tone` has no effect on a host item that renders through its `node` escape hatch (add-to-workspace), because that node owns its own markup.

**Host item tones:**

| Tone | Items |
|---|---|
| create | Enable OpenSpec for this folder |
| caution | Clean up broken (N); Project setup… while an update is pending |

All other host items are neutral, including Remove from workspace (it only removes the folder from the workspace list and discards nothing), Project setup… when no update is pending, and the add-to-workspace node item. `danger` is reserved for actions that end a process or discard work.

**First-party plugin tones:**

| Plugin | Tone | Items |
|---|---|---|
| goal | create | New goal |
| automation | create | New automation |
| team | create | Enable team for this folder |
| team | danger | Disable team |
| kb | caution | the KB action item, only while its kind is `index` ("Index now"), `reindex` ("Reindex now") or `retry` ("Retry") |

The KB action item is neutral when its kind is `pin`, `configure`, `missing` or `busy`. The team items Team and Team settings… are neutral.

**Badge colour:** the item badge is 10 px text, so it SHALL use the text-role token `--accent-orange-text`, which reaches at least 4.5:1 on the menu surface in every built-in palette and mode. No host-rendered folder menu element SHALL compute its colour from a raw Tailwind palette class (for example `text-amber-400`). The `node` escape hatch owns its own markup and is excluded.

#### Scenario: Disable team is red
- **WHEN** the folder actions menu opens for a team-managed folder whose team can be disabled
- **THEN** **Disable team** SHALL carry `data-action-tone="danger"` and an `--accent-red-text` icon
- **AND** while hovered, its background SHALL be `--tint-red-bg` and its label `--accent-red-text`

#### Scenario: Remove from workspace stays neutral
- **WHEN** the folder actions menu opens for a folder that belongs to a workspace
- **THEN** **Remove from workspace** SHALL carry no `data-action-tone`

#### Scenario: Project setup is caution only while an update is pending
- **WHEN** the folder's init status reports a pending update
- **THEN** **Project setup…** SHALL carry `data-action-tone="caution"`
- **AND WHEN** no update is pending
- **THEN** it SHALL carry no `data-action-tone`

#### Scenario: KB tone follows the action kind
- **WHEN** the KB section's action kind is `reindex`
- **THEN** its folder menu item SHALL carry `data-action-tone="caution"`
- **AND WHEN** the kind becomes `pin` ("Pin folder")
- **THEN** the item SHALL carry no `data-action-tone`

#### Scenario: Radio items stay neutral
- **WHEN** the folder actions menu opens
- **THEN** no `menuitemradio` SHALL carry `data-action-tone`

#### Scenario: Tones render in the sheet form
- **WHEN** the folder actions menu opens as a sheet, because the viewport is narrower than 768 px or shorter than 600 px (for example 1200×560)
- **THEN** **Clean up broken (N)** SHALL still carry `data-action-tone="caution"` with an `--accent-orange-text` icon

#### Scenario: Badge uses the text-role token
- **GIVEN** the KB item shows its stale badge
- **WHEN** the menu opens
- **THEN** the badge's computed colour SHALL equal the resolved `--accent-orange-text`
- **AND** no host-rendered element of the open menu SHALL carry a raw palette colour class such as `text-amber-400`

## MODIFIED Requirements

### Requirement: Plugins contribute declarative menu items, not markup

Removing `SlotPill.actions` SHALL be a compile-time break for any consumer that still passes it. No runtime compatibility path SHALL be added: the prop is not silently ignored, and no shim converts a passed node into a contribution. A supported plugin is a compiled one, so a type error is the correct and complete signal.

Plugins SHALL contribute menu items as data to a folder-scoped contribution registry. The plugin-facing contribution type SHALL be `{ id, group, label, icon, onSelect, badge?, disabled?, tone? }`, where `id`, `group`, `label`, `icon` and `onSelect` are **required**. `tone` is the shared `UiTone` (`"go" | "create" | "caution" | "danger"`). The registry SHALL forward a valid tone to the rendered item. For an invalid tone it SHALL leave the tone unset, keeping the item, which renders neutral. It SHALL NOT accept a `ReactNode`, and it SHALL NOT accept the host's `pressed` toggle field: the host cannot group, order, keyboard-navigate or mobile-adapt opaque nodes.

The **host's** own item type MAY retain its existing `node` escape hatch and `pressed` field — today used by add-to-workspace, whose popover and test-id contract must survive verbatim, and by urgency sort's `aria-pressed`. That exception SHALL NOT be exposed to plugins.

`group` SHALL be one of the fixed taxonomy values; a contribution naming an unknown group SHALL be dropped rather than rendered ungrouped — an unknown group indicates a version mismatch, and inventing a home for it hides that. `tone` is presentational. A contribution naming a tone outside `UiTone` SHALL render as neutral and SHALL NOT be dropped, because a wrong colour hides nothing the user needs. A contribution missing any required field SHALL degrade to a no-op without breaking sibling items.

Each registration SHALL carry the identity of the contributing plugin — the same `pluginId` the existing slot registry uses, read from the plugin context by the registration API rather than supplied in the contribution payload, so a plugin SHALL NOT be able to declare itself as another. That identity is what makes the ordering and collision rules below evaluable; without it they reference data the model cannot supply.

Registrations SHALL be keyed by the PAIR `(pluginId, contributionId)`, and the two collision rules apply to different cases:

- **Same `pluginId` AND same `id`** — a re-registration of one key. The **most recent** registration SHALL win, so a section that unmounts and remounts (including a development double-mount) keeps a live callback rather than a dropped one. Recency SHALL NOT decide anything else.
- **Different `pluginId`, same `id`** — two distinct keys competing for one rendered item. The winner SHALL be chosen by a stable comparison of the plugin identities (never by recency or mount order), so the outcome is identical across load orders.

Stating only "most recent wins" would make the cross-plugin case depend on mount order, which the ordering rule above exists to eliminate.

#### Scenario: Markup contribution is no longer possible

- **WHEN** a plugin renders a `SlotPill`
- **THEN** no `actions` prop SHALL be accepted

#### Scenario: Remount keeps the live callback

- **GIVEN** a slot section registered a contribution and then unmounted and remounted, re-registering the same id
- **WHEN** the user activates that item
- **THEN** the most recent registration's callback SHALL run

#### Scenario: Unmounted section leaves no ghost item

- **GIVEN** a slot section that registered a contribution
- **WHEN** that section unmounts, for example because its plugin was disabled
- **THEN** its item SHALL NOT render in the menu

#### Scenario: A late-mounting section updates an open menu

- **GIVEN** the folder actions menu is open
- **WHEN** a slot section mounts and registers a contribution
- **THEN** the open menu SHALL render the new item without being closed and reopened

#### Scenario: Card-placement sections do not register

- **GIVEN** a KB section rendered in the worktree-card placement, whose scope has no folder actions menu
- **WHEN** it renders
- **THEN** it SHALL NOT register a contribution

#### Scenario: Unknown group is dropped

- **GIVEN** a contribution naming a group outside the fixed taxonomy
- **WHEN** the menu renders
- **THEN** that item SHALL NOT render
- **AND** sibling items SHALL render normally

#### Scenario: Contributed tone reaches the rendered item

- **GIVEN** a plugin contributes `{ id: "team-disable", group: "workspace", label: "Disable team", icon: mdiLinkOff, onSelect, tone: "danger" }`
- **WHEN** the folder actions menu opens
- **THEN** the item SHALL carry `data-action-tone="danger"`

#### Scenario: Unknown tone renders neutral, not dropped

- **GIVEN** a contribution with `tone: "purple"`
- **WHEN** the menu renders
- **THEN** the item SHALL render with no `data-action-tone`
- **AND** activating it SHALL run its callback
