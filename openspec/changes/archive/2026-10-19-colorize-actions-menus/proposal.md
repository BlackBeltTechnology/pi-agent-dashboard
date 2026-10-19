## Why

The `add-session-actions-flyout` mockup gave each menu action a coloured icon by meaning: green to go, blue to create, orange for caution, red for destructive. It also gave the NEXT row a blue tint and coloured the lifecycle bars. None of that was specified, so the shipped session actions menu is monochrome: every icon inherits the row's `--text-secondary`.

The folder actions menu is monochrome too, and its badge uses a raw `text-amber-400` instead of a theme token. In a 15-item menu, Exit and Close worktree look exactly like Rename or Refresh. Users have to read every label to find the dangerous ones or the next step.

## What Changes

- **New shared tone vocabulary.** `UiTone = "go" | "create" | "caution" | "danger"`, the `UI_TONES` list and an `isUiTone` guard, exported from `@blackbelt-technology/pi-dashboard-shared` (`dashboard-plugin/ui-primitives.ts`).
  - Each tone maps to the existing **text-role** accent token `--accent-{green,blue,orange,red}-text`. These are already declared for every palette and reach at least 5.64:1 on the menu surface everywhere.
  - No new colour tokens.
- **Icon-only colour.** A toned item colours its icon only. The label keeps the neutral item colour, so meaning never relies on colour alone (WCAG 1.4.1). Items without a tone render exactly as now.
- **`danger` rows**, while hovered or focused, render on `--tint-red-bg` with icon and label in `--accent-red-text` (≥ 4.57:1 measured).
- **Stable hook.** Toned items expose `data-action-tone`, named so it does not collide with the existing pill `data-tone` vocabulary.
- **Session actions menu.**
  - Host item tones:

    | Tone | Items |
    |---|---|
    | go | Resume, New session, Verify, Merge |
    | create | Fork, New change, Propose, Open PR (creates a PR) |
    | caution | New worktree session, Commit N changes, Archive anyway |
    | danger | Exit pi session, Close worktree (actions that end a process or discard work) |
    | neutral | everything else, including View PR #N |

  - The emphasised NEXT row becomes outlined (`--tint-blue-border`) with a blue icon, replacing the `--accent-soft` fill. NEXT emphasis takes precedence over the item's tone.
  - The lifecycle row's segments gain a coloured state bar plus a distinct glyph per state (`✓` done, `▸` current, `–` skipped, `○` todo) in the card's state hues, using text-role tokens so they pass contrast.
- **Folder actions menu.**
  - Host item tones: create for Enable OpenSpec; caution for Clean up broken (N), and for Project setup while an update is pending. The rest stay neutral, including Remove from workspace (it discards nothing), the add-to-workspace node item and the Group-by radio items.
  - Tones apply in both the dropdown and the narrow-viewport sheet.
  - The badge's raw `text-amber-400` becomes `--accent-orange-text`.
- **Plugin API, additive and optional:**
  - `FolderMenuContribution` (`@blackbelt-technology/dashboard-plugin-runtime`) gains `tone?: UiTone`. The runtime whitelist forwards a valid tone and drops an invalid one.
  - `UiActionListItem` (`ui:action-list` primitive, shared) gains `tone?: UiTone`. It is honoured both in the session menu's PLUGINS group and inline.
  - An unknown or missing tone renders neutral; the item is never dropped. Existing plugins compile and render unchanged.
- **First-party plugins adopt tones:**
  - goal: New goal → create;
  - automation: New automation → create;
  - team: Enable team → create, Disable team → danger;
  - kb: the action item is caution only while it means Index, Reindex or Retry.
- **Contrast floors:** every coloured glyph reaches at least 3:1, and every coloured or overlaid text reaches at least 4.5:1, on its actual backdrop, in every built-in palette and mode. This is guarded by one unit test.
- **Coordination:** `align-ui-contract-recipes` also edits `SessionActionsPanel.tsx` `MenuEntry` and the `session-actions-menu` spec. The label rule here is relative, so it holds under either change's label colour. Whichever archives second rebases (design D11).
- Out of scope:
  - React claim output in the PLUGINS group;
  - the card's own inline controls and lifecycle bar;
  - the mobile kebab menu.
- Mockup: mockups/actions-menus-tones (in this change), synced to the reconciled spec (text-role tokens, outlined NEXT, lifecycle glyphs).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-actions-menu`:
  - menu items carry an optional semantic tone that colours the icon;
  - danger rows get a red hover/focus;
  - the NEXT row is outlined in blue;
  - lifecycle segments show a coloured state bar;
  - the PLUGINS-group requirement notes the optional `tone` on `ui:action-list` items.
- `folder-actions-menu`:
  - items, host and plugin, carry an optional tone that colours the icon, with a danger hover/focus;
  - the plugin contribution type gains optional `tone`; the runtime forwards a valid tone and an unknown one renders neutral;
  - the badge uses `--accent-orange-text`.
- `plugin-ui-primitive-registry`: `ui:action-list` items accept an optional `tone`, rendered as an icon colour in both menu and inline modes.

## Impact

- `packages/shared/src/dashboard-plugin/ui-primitives.ts`: `UiTone`, `UI_TONES`, `isUiTone`; `UiActionListItem.tone?`.
- `packages/client-utils/src/`:
  - `tone.ts` (`toneIconClass`, `toneRowClass`), a new `./tone` subpath export;
  - `ActionList.tsx` honours `tone`, with `IconByKey` taking a `className`.
- `packages/dashboard-plugin-runtime/src/folder-menu-contributions.tsx`: `FolderMenuContribution.tone?`, forwarded at registration (`:160`, `:262-279`).
- `packages/client/src/lib/session/session-menu-items.ts`: `SessionMenuItem.tone?` plus the tone assignments.
- `packages/client/src/components/session/SessionActionsPanel.tsx`: `MenuEntry` icon colour, danger hover/focus, outlined NEXT, lifecycle bars plus glyphs on text-role tokens.
- `packages/client/src/components/folder/FolderActionsMenu.tsx`: `FolderMenuItem.tone?`, icon colour, danger hover, badge token.
- `packages/client/src/components/session/SessionList.tsx`: folder host item tones.
- Plugins: `goal-plugin`, `automation-plugin`, `team-plugin`, `kb-plugin` folder sections (tone field only).
- Docs: `docs/session-actions-menu.md`, the plugin-author docs for folder menu contributions and `ui:action-list`, and `AGENTS.md` rows. A root CHANGELOG `## [Unreleased]` "Added" entry; package versions bump at release cut.
- No server, extension or WebSocket protocol change. Intents already pass arbitrary props, so `tone` rides through unchanged.
- Mockup: mockups/actions-menus-tones (in this change).

## Discipline Skills

- `doubt-driven-review`: the change extends two **published plugin APIs** (`FolderMenuContribution`, `UiActionListItem`). Once released, the field's name and value set are effectively irreversible, so the API shape is stress-tested before it stands.
- `security-hardening`: `tone` arrives from untyped plugin intent payloads and `as any` plugins, which is untrusted input. It must be validated by `isUiTone` and used only as a lookup key, never interpolated into a class or style.
- No other checkpoint applies: no auth, secrets or PII; no latency budget change; no new endpoint, job or external call.
