## Why

The `add-session-actions-flyout` mockup gave each menu action a coloured icon by meaning: green to go, blue to create, orange for caution, red for destructive. It also gave the NEXT row a blue tint and coloured the lifecycle bars. None of that was specified, so the shipped session actions menu is monochrome: every icon inherits the row's `--text-secondary`.

The folder actions menu is monochrome too, and its badge uses a raw `text-amber-400` instead of a theme token. In a 15-item menu, Exit, Close worktree and Remove from workspace look exactly like Rename or Refresh. Users have to read every label to find the dangerous ones or the next step.

## What Changes

- **New shared tone vocabulary.** `UiTone = "go" | "create" | "caution" | "danger"`, exported from `@blackbelt-technology/pi-dashboard-shared` (`dashboard-plugin/ui-primitives.ts`). Each tone maps to the existing `--tint-{green,blue,orange,red}-fg` tokens, which are already declared for every palette. No new colour tokens.
- **Icon-only colour.** A toned item colours its icon only. The label keeps its normal text colour, so meaning never relies on colour alone (WCAG 1.4.1), and labels stay as readable as today. Items without a tone render exactly as now.
- **`danger` rows** also get a red-tinted hover/focus background (`--tint-red-bg`).
- **Session actions menu.**
  - Host items get the following tones:

    | Tone | Items |
    |---|---|
    | go | Resume, New session, Verify, Merge |
    | create | Fork, New change, Propose, Open PR (creates a PR) |
    | caution | New worktree session, Commit N changes, Archive anyway |
    | danger | Stop, Exit pi session, Close worktree |
    | neutral | everything else, including View PR #N |

  - The emphasised NEXT row moves from `--accent-soft` to the blue tint triple (`--tint-blue-bg/-fg/-border`).
  - The lifecycle row's segments gain a coloured state bar. It uses the same state colours and glyphs as the card's lifecycle bar (shared `statusPresentation`: done `--status-idle`, current `--status-working`, pending `--text-muted`), so the two never disagree.
- **Folder actions menu.**
  - Host items get these tones: create for Add to workspace and Enable OpenSpec; caution for Clean up broken (N) and Project setup when an update is pending; danger for Remove from workspace; neutral for the rest. The Group-by radio items stay neutral.
  - The badge's raw `text-amber-400` becomes a theme token.
- **Plugin API, additive and optional:**
  - `FolderMenuContribution` (`@blackbelt-technology/dashboard-plugin-runtime`) gains `tone?: UiTone`. The runtime forwards it.
  - `UiActionListItem` (`ui:action-list` primitive, shared) gains `tone?: UiTone`. It is honoured both in the session menu's PLUGINS group and in inline action rows.
  - An unknown or missing tone renders neutral. The item is never dropped. Existing plugins compile and render unchanged. Minor version bump.
- **First-party plugins adopt tones:** goal (New goal → create), automation (New automation → create), team (Enable team → create, Disable team → danger, Team settings → neutral), kb (Reindex → caution).
- **Contrast floor:** every tone's icon colour SHALL reach at least 3:1 against the menu surface in every built-in palette and mode (WCAG 1.4.11). Measured base dark values are 8.46–10.80:1.
- Out of scope:
  - React claim output in the PLUGINS group (a plugin that renders its own markup keeps styling itself);
  - the card's own inline controls;
  - the mobile kebab menu.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-actions-menu`: menu items carry an optional semantic tone that colours the icon; danger rows get a red hover; the NEXT row uses the blue tint; lifecycle segments show a coloured state bar.
- `folder-actions-menu`:
  - items, host and plugin, carry an optional tone that colours the icon, with a danger hover;
  - the plugin contribution type gains optional `tone`, and an unknown tone renders neutral;
  - the badge uses a theme token.
- `plugin-ui-primitive-registry`: `ui:action-list` items accept an optional `tone`, rendered as an icon colour in both menu and inline modes.

## Impact

- `packages/shared/src/dashboard-plugin/ui-primitives.ts`: `UiTone`; `UiActionListItem.tone?`.
- `packages/client-utils/src/`:
  - a tone → class helper (`toneIconClass`, `toneRowClass`), shared by every renderer;
  - `ActionList.tsx` honours `tone`.
- `packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`: `FolderMenuContribution.tone?`, forwarded at registration (`:160`, `:262-279`).
- `packages/client/src/lib/session/session-menu-items.ts`: `SessionMenuItem.tone?` plus the tone assignments.
- `packages/client/src/components/session/SessionActionsPanel.tsx`: `MenuEntry` icon colour, danger hover, NEXT tint, lifecycle bars via `statusPresentation` (`client-utils/src/statusPresentation.ts`).
- `packages/client/src/components/folder/FolderActionsMenu.tsx`: `FolderMenuItem.tone?`, icon colour, danger hover, badge token.
- `packages/client/src/components/session/SessionList.tsx`: folder host item tones.
- Plugins: `goal-plugin`, `automation-plugin`, `team-plugin`, `kb-plugin` folder sections (tone field only).
- Docs: `docs/session-actions-menu.md`, the plugin-author docs for folder menu contributions and `ui:action-list`, and `AGENTS.md` rows. Every published package touched gets a CHANGELOG entry and a minor bump.
- No server, extension or WebSocket protocol change. Intents already pass arbitrary props, so `tone` rides through unchanged.
- Mockup: mockups/actions-menus-tones (in this change).

## Discipline Skills

- `doubt-driven-review`: the change extends two **published plugin APIs** (`FolderMenuContribution`, `UiActionListItem`). Once released, the field's name and value set are effectively irreversible, so the API shape is stress-tested before it stands.
- No other checkpoint applies: no auth, secrets, PII or untrusted input; no latency budget change; no new endpoint, job or external call.
