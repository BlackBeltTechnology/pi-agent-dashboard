## MODIFIED Requirements

### Requirement: Folder action bar layout

Each folder group in the sidebar SHALL render its action controls on the SAME
row as the group git info (`GroupGitInfo`): the git info is left-aligned
(`min-w-0`) and the `FolderActionBar` is right-grouped (`ml-auto`, content
width). The action bar SHALL contain, in order: the Initialize control
(conditional, see the Initialize Requirements) and `Clean up broken (N)`
(conditional).

The action bar SHALL NOT contain a Directory Settings control — that entry point
moves into the folder actions menu. The action bar SHALL NOT contain a
`Terminals(N)` button, an `Editor` button, a native-editor (e.g. `Zed`) button, a
`+Session` button, or a `+Worktree` button — Terminals and Editor are removed (the
internal folder editor pane at `/folder/:encodedCwd/editor` remains reachable from
the Directory home page and ChatView), native-editor launch is removed, and spawn
buttons live in the elevated spawn-button stack. A wide init state (the running /
failed `WorktreeInitChip`) SHALL wrap to its own line rather than overflow the git
row.

The action bar SHALL render only when it holds at least one control. With Directory Settings
gone, a configured folder with no pending init and no broken sessions leaves the bar empty; in
that case it SHALL NOT render rather than render as an empty row.

#### Scenario: Action bar omits Terminals, Editor, native-editor, and spawn buttons

- **WHEN** a folder group action bar is rendered for a git repository
- **THEN** the action bar SHALL NOT contain a `Terminals(N)` button
- **THEN** the action bar SHALL NOT contain an `Editor` button
- **THEN** the action bar SHALL NOT contain a `Zed` (or any native-editor) button
- **THEN** the action bar SHALL NOT contain a `+Session` button
- **THEN** the action bar SHALL NOT contain a `+Worktree` button

#### Scenario: Actions share the git row, right-grouped

- **WHEN** a folder group header is rendered expanded
- **THEN** the git info and the action bar SHALL render on one row
- **AND** the git info SHALL be left-aligned and the action bar SHALL be right-grouped

#### Scenario: Settings cog no longer renders on the action bar

- **WHEN** a folder group header is rendered expanded
- **THEN** no Directory Settings cog SHALL render on the action bar
- **AND** the Initialize and `Clean up broken (N)` controls SHALL continue to render when their conditions hold

#### Scenario: Empty action bar does not render

- **GIVEN** a configured folder with no pending init and no broken sessions
- **WHEN** its header renders expanded
- **THEN** the action bar SHALL NOT render

## REMOVED Requirements

### Requirement: Pi Resources button with updated icon

**Reason**: Already superseded before this change, and now fully retired by it. The
control this requirement describes was re-labelled by `directory-settings-page`,
which records that the cog icon and "Directory Settings" label replace "the prior
`mdiToyBrickOutline` icon and 'Pi Resources' label". In source the button's `title`
and `aria-label` are both "Directory Settings"; only its handler prop retains the
legacy name `onOpenPiResources`. There is therefore no distinct Pi Resources button
on the action bar to preserve — the single control moves into the folder actions
menu as the Directory Settings item.

**Migration**: The `onOpenPiResources` prop is renamed to `onOpenDirectorySettings` to match
what it opens; it already routes to `buildFolderSettingsUrl`. Navigation to a directory's
settings continues to work unchanged, now via the folder actions menu.

`pi-resources-view` carries **two** requirements describing this same superseded control —
"Folder header navigation button" and "Pi Resources button icon" (which mandates that "the
button SHALL retain its right-aligned position in the action bar"). Both are stale in the same
way and NEITHER is resolved here; they are pre-existing drift, recorded in the proposal.
